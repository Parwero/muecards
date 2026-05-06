'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { UploadZone } from '@/components/UploadZone';
import { ScheduleForm } from '@/components/ScheduleForm';
import { ScheduledList } from '@/components/ScheduledList';
import { CheckCircle2, AlertCircle } from 'lucide-react';

type Toast = { kind: 'ok' | 'err'; message: string } | null;

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<Toast>(null);

  // Create preview URL; convert HEIC→JPEG blob on the client before displaying
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    setTitle(file.name.replace(/\.[^/.]+$/, ''));

    const name = file.name.toLowerCase();
    const isHeic =
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      name.endsWith('.heic') ||
      name.endsWith('.heif');

    if (!isHeic) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }

    // heic-decode uses Node.js APIs (fs) and cannot run in the browser.
    // Show the "Foto iOS lista" placeholder — conversion happens server-side on publish.
    setPreviewUrl(null);
    setPreviewLoading(false);
  }, [file]);

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const canSubmit = Boolean(file && scheduledTime && title.trim().length > 0 && caption.trim().length > 0);

  const handleSubmit = async () => {
    if (!file || !scheduledTime) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('title', title);
      fd.append('caption', caption);
      fd.append('scheduled_time', new Date(scheduledTime).toISOString());

      const res = await fetch('/api/schedule', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      setToast({ kind: 'ok', message: 'Publicación programada correctamente.' });
      setFile(null);
      setTitle('');
      setCaption('');
      setScheduledTime('');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setToast({
        kind: 'err',
        message: e instanceof Error ? e.message : 'Error al programar',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative z-10 mx-auto max-w-7xl px-6 py-10 lg:px-10 lg:py-14">
      {/* ------------ HEADER ------------ */}
      <header className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <Logo />
        <div className="flex flex-col items-end gap-2 text-right">
          <p className="font-serif text-sm italic text-parchment-300">
            Catálogo privado · colección de cartas
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-parchment-400">
            publicador automático · cada hora en punto
          </p>
          <div className="flex items-center gap-4">
            <Link
              href="/logs"
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400 transition hover:text-gold-300"
            >
              ⬡ Logs
            </Link>
            <Link
              href="/setup"
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400 transition hover:text-gold-300"
            >
              ⚙ Configuración
            </Link>
          </div>
        </div>
      </header>

      {/* ------------ GRID ------------ */}
      <div className="grid gap-10 lg:grid-cols-12">
        {/* Left: upload */}
        <section className="lg:col-span-4">
          <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            01 · La carta
          </h2>
          <p className="mb-5 font-serif text-2xl text-parchment-50">Imagen</p>
          <UploadZone file={file} previewUrl={previewUrl} onFileChange={setFile} />
        </section>

        {/* Middle: form */}
        <section className="lg:col-span-5">
          <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            02 · El anuncio
          </h2>
          <p className="mb-5 font-serif text-2xl text-parchment-50">Caption & horario</p>
          <ScheduleForm
            title={title}
            caption={caption}
            scheduledTime={scheduledTime}
            submitting={submitting}
            canSubmit={canSubmit}
            onTitleChange={setTitle}
            onCaptionChange={setCaption}
            onScheduledTimeChange={setScheduledTime}
            onSubmit={handleSubmit}
          />
        </section>

        {/* Right: queue */}
        <aside className="lg:col-span-3">
          <ScheduledList refreshKey={refreshKey} />
        </aside>
      </div>

      {/* ------------ FOOTER ------------ */}
      <footer className="mt-20 flex items-center justify-between border-t border-ink-700 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-parchment-400">
          muecards · v0.1
        </p>
        <p className="font-serif text-sm italic text-parchment-400">
          &ldquo;Una carta, una historia.&rdquo;
        </p>
      </footer>

      {/* ------------ TOAST ------------ */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 border px-4 py-3 font-mono text-xs shadow-card backdrop-blur ${
            toast.kind === 'ok'
              ? 'border-gold-500/50 bg-ink-900/90 text-gold-300'
              : 'border-ember-500/50 bg-ink-900/90 text-ember-500'
          }`}
        >
          {toast.kind === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="pt-0.5">{toast.message}</span>
        </div>
      )}
    </main>
  );
}
