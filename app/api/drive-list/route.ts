import { NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { driveListImages } from '@/lib/google-drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/drive-list
 *
 * Lists image files in the Google Drive "Por Subir" folder without downloading anything.
 * Returns file metadata so the UI can show a preview panel before the user confirms the import.
 */
export async function GET() {
  const credsJson  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const porSubirId = process.env.DRIVE_FOLDER_POR_SUBIR_ID;

  const missing = [
    !credsJson  && 'GOOGLE_SERVICE_ACCOUNT_JSON',
    !porSubirId && 'DRIVE_FOLDER_POR_SUBIR_ID',
  ].filter(Boolean);

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Faltan variables de entorno: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const token = await getGoogleAccessToken(credsJson!);
    const files  = await driveListImages(token, porSubirId!);
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
