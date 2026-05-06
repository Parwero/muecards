import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import heicDecode from 'heic-decode';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const image = form.get('image');

    if (!(image instanceof File)) {
      return NextResponse.json({ error: 'No image' }, { status: 400 });
    }

    const rawBuffer = Buffer.from(await image.arrayBuffer());
    const name = image.name.toLowerCase();
    const isHeic =
      image.type === 'image/heic' ||
      image.type === 'image/heif' ||
      name.endsWith('.heic') ||
      name.endsWith('.heif');

    let jpegBuffer: Buffer;

    if (isHeic) {
      const { width, height, data } = await heicDecode({ buffer: rawBuffer });
      jpegBuffer = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        raw: { width, height, channels: 4 },
      })
        .jpeg({ quality: 80 })
        .toBuffer();
    } else {
      jpegBuffer = await sharp(rawBuffer).jpeg({ quality: 80 }).toBuffer();
    }

    return new NextResponse(new Uint8Array(jpegBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Preview failed' },
      { status: 500 },
    );
  }
}
