import { NextResponse } from 'next/server';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  const supabase = getServiceClient();

  // Find all pending posts with HEIC storage paths
  const { data: posts, error: fetchErr } = await supabase
    .from('scheduled_posts')
    .select('id, image_url, storage_path, caption')
    .eq('status', 'pending')
    .like('storage_path', '%.heic');

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!posts || posts.length === 0) {
    return NextResponse.json({ ok: true, message: 'No HEIC records found', converted: 0 });
  }

  const { default: heicDecode } = await import('heic-decode');
  const { default: sharp } = await import('sharp');

  const results: { id: string; caption: string; ok: boolean; error?: string }[] = [];

  for (const post of posts) {
    try {
      // Download HEIC from Supabase storage
      const { data: fileData, error: dlErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(post.storage_path);

      if (dlErr || !fileData) throw new Error(`Download failed: ${dlErr?.message}`);

      const heicBuffer = Buffer.from(await fileData.arrayBuffer());

      // Convert HEIC → JPEG
      const { width, height, data } = await heicDecode({ buffer: heicBuffer });
      const jpegBuffer = await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
        .jpeg({ quality: 92 })
        .toBuffer();

      // Upload JPEG with new path
      const newPath = post.storage_path.replace(/\.heic$/, '.jpg');
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(newPath, new Uint8Array(jpegBuffer), {
          contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
        });

      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(newPath);

      // Update DB record
      const { error: updateErr } = await supabase
        .from('scheduled_posts')
        .update({ image_url: urlData.publicUrl, storage_path: newPath })
        .eq('id', post.id);

      if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

      // Delete old HEIC from storage
      await supabase.storage.from(STORAGE_BUCKET).remove([post.storage_path]).catch(() => {});

      results.push({ id: post.id, caption: post.caption, ok: true });
    } catch (err) {
      results.push({
        id: post.id, caption: post.caption, ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    converted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
