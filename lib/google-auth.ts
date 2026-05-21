interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
}

export async function getGoogleAccessToken(credsJson: string): Promise<string> {
  let creds: ServiceAccountCreds;
  try {
    creds = JSON.parse(credsJson) as ServiceAccountCreds;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido.');
  }

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

  // Dynamic import keeps the Node.js-only 'crypto' module out of the static
  // module graph so webpack does not try to bundle it for non-nodejs contexts.
  const { createSign } = await import('crypto');
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
