import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { driveDownload, driveGetThumbnailLink, convertHeicToJpeg } from '@/lib/google-drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/drive-thumbnail?id=<driveFileId>
 *
 * Proxies a Drive file thumbnail through the server so the browser can display it
 * without needing a Google OAuth token in the frontend.
 *
 * Strategy:
 *   1. Try Drive's pre-generated thumbnailLink (fast, no full download).
 *   2. Fall back to full download + sharp resize (needed when Drive has no thumbnail yet).
 */
export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get('id');
  const mime   = req.nextUrl.searchParams.get('mime') ?? '';

  if (!fileId) {
    return new NextResponse('Falta el parámetro id', { status: 400 });
  }

  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credsJson) {
    return new NextResponse('Falta GOOGLE_SERVICE_ACCOUNT_JSON', { status: 500 });
  }

  try {
    const token = await getGoogleAccessToken(credsJson);

    // Try Drive's pre-generated thumbnail first (small image, fast)
    const thumbnailLink = await driveGetThumbnailLink(token, fileId);
    if (thumbnailLink) {
      const thumbRes = await fetch(thumbnailLink, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (thumbRes.ok) {
        const data = await thumbRes.arrayBuffer();
        return new NextResponse(data, {
          headers: {
            'Content-Type': thumbRes.headers.get('content-type') ?? 'image/jpeg',
            'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          },
        });
      }
    }

    // Fallback: full download + resize with Sharp
    const rawBuffer = await driveDownload(token, fileId);
    const isHeic    = mime === 'image/heic' || mime === 'image/heif';
    const { default: sharp } = await import('sharp');

    const imgBuffer = isHeic ? await convertHeicToJpeg(rawBuffer) : rawBuffer;
    const thumbnail = await sharp(imgBuffer)
      .resize(200, undefined, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    return new NextResponse(thumbnail, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'Error', { status: 500 });
  }
}
