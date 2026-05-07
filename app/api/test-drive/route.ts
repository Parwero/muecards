import { NextResponse } from 'next/server';
import { createSign } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const report: Record<string, unknown> = {};

  // 1. Check env vars
  const credsJson  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const porSubirId = process.env.DRIVE_FOLDER_POR_SUBIR_ID;
  const subidasId  = process.env.DRIVE_FOLDER_SUBIDAS_ID;

  report.env = {
    GOOGLE_SERVICE_ACCOUNT_JSON: credsJson ? `✓ presente (${credsJson.length} chars)` : '✗ FALTA',
    DRIVE_FOLDER_POR_SUBIR_ID:   porSubirId ?? '✗ FALTA',
    DRIVE_FOLDER_SUBIDAS_ID:     subidasId  ?? '✗ FALTA',
  };

  if (!credsJson) {
    return NextResponse.json({ ok: false, report, error: 'Falta GOOGLE_SERVICE_ACCOUNT_JSON' });
  }

  // 2. Parse JSON
  let creds: { client_email?: string; private_key?: string };
  try {
    creds = JSON.parse(credsJson);
    report.json_parse = '✓ JSON válido';
    report.client_email = creds.client_email ?? '✗ campo client_email ausente';
    report.has_private_key = creds.private_key ? '✓ presente' : '✗ FALTA';
  } catch (e) {
    return NextResponse.json({ ok: false, report, error: `JSON inválido: ${e}` });
  }

  if (!creds.client_email || !creds.private_key) {
    return NextResponse.json({ ok: false, report, error: 'JSON incompleto' });
  }

  // 3. Get OAuth token
  let token: string;
  try {
    const privateKey = creds.private_key.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: creds.client_email, scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
    })).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const jwt = `${header}.${payload}.${signer.sign(privateKey, 'base64url')}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      report.oauth = `✗ ${data.error_description ?? data.error ?? res.status}`;
      return NextResponse.json({ ok: false, report, error: 'OAuth falló' });
    }
    token = data.access_token;
    report.oauth = '✓ token obtenido';
  } catch (e) {
    report.oauth = `✗ excepción: ${e}`;
    return NextResponse.json({ ok: false, report, error: 'Error al firmar JWT' });
  }

  // 4. List files in Por Subir
  if (!porSubirId) {
    report.drive_list = '✗ DRIVE_FOLDER_POR_SUBIR_ID no configurado';
  } else {
    try {
      const q = encodeURIComponent(`'${porSubirId}' in parents and trashed = false`);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=10`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json() as { files?: { name: string; mimeType: string }[]; error?: { message?: string } };
      if (!res.ok) {
        report.drive_list = `✗ ${data.error?.message ?? res.status}`;
      } else {
        const files = data.files ?? [];
        report.drive_list = `✓ ${files.length} archivo(s) encontrado(s)`;
        report.files_preview = files.slice(0, 5).map((f) => `${f.name} (${f.mimeType})`);
      }
    } catch (e) {
      report.drive_list = `✗ excepción: ${e}`;
    }
  }

  return NextResponse.json({ ok: true, report });
}
