import { NextRequest, NextResponse } from 'next/server';
import { createSign } from 'crypto';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

// ── Google Drive helpers ──────────────────────────────────────────────────────

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif',
]);

const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/png': 'png',  'image/webp': 'webp',
  'image/heic': 'jpg', 'image/heif': 'jpg',
};

/**
 * Converts a HEIC/HEIF buffer to JPEG.
 * Strategy: heic-decode (WASM, no native deps) → raw pixels → sharp JPEG encode.
 * If both fail, throws so the caller can decide what to do.
 */
async function convertHeicToJpeg(input: Buffer): Promise<Buffer> {
  const { default: heicDecode } = await import('heic-decode');
  const { default: sharp } = await import('sharp');
  const { width, height, data } = await heicDecode({ buffer: input });
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Creates a short-lived Google OAuth access token using a service account JSON.
 * Uses Node.js built-in `crypto` to sign the JWT — no external packages needed.
 */
async function getAccessToken(credsJson: string): Promise<string> {
  let creds: ServiceAccountCreds;
  try {
    creds = JSON.parse(credsJson) as ServiceAccountCreds;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido.');
  }

  // Vercel sometimes escapes newlines when storing multi-line env vars
  const privateKey = creds.private_key.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   creds.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  })).toString('base64url');

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error_description?: string; error?: string };
    throw new Error(body.error_description ?? body.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as { access_token: string };
  if (!data.access_token) throw new Error('La respuesta OAuth no contiene access_token.');
  return data.access_token;
}

async function driveListImages(token: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { files?: DriveFile[] };
  return (data.files ?? []).filter((f) => IMAGE_MIME_TYPES.has(f.mimeType));
}

async function driveDownload(token: string, fileId: string): Promise<Buffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Descarga fallida: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function driveMove(token: string, fileId: string, from: string, to: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${to}&removeParents=${from}&fields=id`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(_req: NextRequest) {
  const credsJson  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const porSubirId = process.env.DRIVE_FOLDER_POR_SUBIR_ID;
  const subidasId  = process.env.DRIVE_FOLDER_SUBIDAS_ID;

  // Friendly error listing exactly which env vars are missing
  const missing = [
    !credsJson  && 'GOOGLE_SERVICE_ACCOUNT_JSON',
    !porSubirId && 'DRIVE_FOLDER_POR_SUBIR_ID',
    !subidasId  && 'DRIVE_FOLDER_SUBIDAS_ID',
  ].filter(Boolean);

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Faltan variables de entorno en Vercel: ${missing.join(', ')}. Ve a Vercel → Settings → Environment Variables y añádelas.` },
      { status: 400 },
    );
  }

  // Auth
  let token: string;
  try {
    token = await getAccessToken(credsJson!);
  } catch (e) {
    return NextResponse.json(
      { error: `Error autenticando con Google: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  // List images
  let files: DriveFile[];
  try {
    files = await driveListImages(token, porSubirId!);
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo leer "Por Subir" en Drive: ${e instanceof Error ? e.message : String(e)}. ¿Compartiste la carpeta con la cuenta de servicio?` },
      { status: 500 },
    );
  }

  if (files.length === 0) {
    return NextResponse.json({ ok: true, uploaded: 0, moved: 0, results: [] });
  }

  const supabase = getServiceClient();
  const results: { file: string; ok: boolean; moved: boolean; error?: string }[] = [];

  for (const file of files) {
    const caption = file.name.replace(/\.[^/.]+$/, '');
    const isHeic  = file.mimeType === 'image/heic' || file.mimeType === 'image/heif';

    try {
      // Download from Drive
      const rawBuffer = await driveDownload(token, file.id);

      let finalBuffer: Buffer;
      let contentType: string;
      let outExt: string;

      if (isHeic) {
        finalBuffer = await convertHeicToJpeg(rawBuffer);
        contentType = 'image/jpeg';
        outExt = 'jpg';
      } else {
        finalBuffer = rawBuffer;
        contentType = file.mimeType;
        outExt = EXT_FOR_MIME[file.mimeType] ?? 'jpg';
      }

      // Upload to Supabase Storage
      const objectName  = `${Date.now()}-${crypto.randomUUID()}.${outExt}`;
      const storagePath = `local_queued/${objectName}`;

      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, new Uint8Array(finalBuffer), {
          contentType, cacheControl: '3600', upsert: false,
        });

      if (uploadErr) throw new Error(`Supabase upload: ${uploadErr.message}`);

      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      if (!urlData.publicUrl) {
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
        throw new Error('No se pudo obtener URL pública de Supabase.');
      }

      // Insert DB row with sentinel date
      const { error: insertErr } = await supabase
        .from('scheduled_posts')
        .insert({
          image_url:      urlData.publicUrl,
          caption,
          scheduled_time: '2099-01-01T09:00:00.000Z',
          status:         'pending',
          storage_path:   storagePath,
        });

      if (insertErr) {
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
        throw new Error(`DB insert: ${insertErr.message}`);
      }

      // Move in Google Drive: Por Subir → Subidas
      try {
        await driveMove(token, file.id, porSubirId!, subidasId!);
        results.push({ file: file.name, ok: true, moved: true });
      } catch (moveErr) {
        // Card is in queue — report move failure as warning only
        results.push({
          file: file.name, ok: true, moved: false,
          error: `Subido OK, no movido en Drive: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}`,
        });
      }
    } catch (err) {
      results.push({
        file: file.name, ok: false, moved: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok:       true,
    uploaded: results.filter((r) => r.ok).length,
    moved:    results.filter((r) => r.moved).length,
    warnings: results.filter((r) => r.ok && !r.moved).map((r) => r.error),
    results,
  });
}
