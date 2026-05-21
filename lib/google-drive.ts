export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif',
]);

export const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/png':  'png', 'image/webp': 'webp',
  'image/heic': 'jpg', 'image/heif': 'jpg',
};

export async function driveListImages(token: string, folderId: string): Promise<DriveFile[]> {
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

export async function driveDownload(token: string, fileId: string): Promise<Buffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Descarga fallida: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function driveMove(token: string, fileId: string, from: string, to: string): Promise<void> {
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

export async function driveGetThumbnailLink(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const data = await res.json() as { thumbnailLink?: string };
  return data.thumbnailLink ?? null;
}

export async function convertHeicToJpeg(input: Buffer): Promise<Buffer> {
  const { default: heicDecode } = await import('heic-decode');
  const { default: sharp }      = await import('sharp');
  const { width, height, data } = await heicDecode({ buffer: input });
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}
