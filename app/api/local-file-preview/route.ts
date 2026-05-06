import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import sharp from 'sharp';
import heicDecode from 'heic-decode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_FOLDER = 'G:\\Mi unidad\\Poke\\Por Subir';

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') ?? '';
  const folder = process.env.WATCH_FOLDER ?? DEFAULT_FOLDER;

  // Prevent path traversal
  if (!name || basename(name) !== name) {
    return NextResponse.json({ error: 'Filename inválido.' }, { status: 400 });
  }

  const filePath = join(folder, name);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Archivo no encontrado.' }, { status: 404 });
  }

  try {
    const raw = readFileSync(filePath);
    const ext = extname(name).toLowerCase();
    const isHeic = ext === '.heic' || ext === '.heif';

    let jpeg: Buffer;
    if (isHeic) {
      const { width, height, data } = await heicDecode({ buffer: raw });
      jpeg = await sharp(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        { raw: { width, height, channels: 4 } },
      )
        .resize(300, 300, { fit: 'cover' })
        .jpeg({ quality: 75 })
        .toBuffer();
    } else {
      jpeg = await sharp(raw)
        .resize(300, 300, { fit: 'cover' })
        .jpeg({ quality: 75 })
        .toBuffer();
    }

    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Preview failed' },
      { status: 500 },
    );
  }
}
