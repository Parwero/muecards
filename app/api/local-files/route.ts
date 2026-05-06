import { NextResponse } from 'next/server';
import { readdirSync, statSync, existsSync } from 'fs';
import { extname, join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const DEFAULT_FOLDER = 'G:\\Mi unidad\\Poke\\Por Subir';

export async function GET() {
  const folder = process.env.WATCH_FOLDER ?? DEFAULT_FOLDER;

  if (!existsSync(folder)) {
    return NextResponse.json({ files: [], available: false });
  }

  try {
    const files = readdirSync(folder)
      .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
      .flatMap((f) => {
        try {
          const s = statSync(join(folder, f));
          return [{ name: f, size: s.size }];
        } catch {
          return [];
        }
      });

    return NextResponse.json({ files, available: true });
  } catch {
    return NextResponse.json({ files: [], available: false });
  }
}
