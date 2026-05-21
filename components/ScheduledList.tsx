'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Clock, Loader2, RefreshCw, Inbox, X, ImageOff, Check,
  CloudDownload, CheckCircle2, HardDriveDownload,
} from 'lucide-react';
import type { ScheduledPost } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

interface ScheduledListProps {
  refreshKey: number;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SENTINEL_YEAR = 2090;
const DAY_MS        = 24 * 60 * 60 * 1000;
const LS_KEY        = 'mue_deleted_ids';

// ── localStorage helpers ─────────────────────────────────────────────────────

function loadDeletedFromStorage(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as string[]); }
  catch { return new Set(); }
}

function persistDeleted(id: string) {
  try {
    const ids = loadDeletedFromStorage();
    ids.add(id);
    localStorage.setItem(LS_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isLegacyUnconfirmed(post: ScheduledPost) {
  return new Date(post.scheduled_time).getFullYear() >= SENTINEL_YEAR;
}

function formatWhen(iso: string) {
  const d      = new Date(iso);
  const now    = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  const diffH   = Math.round(diffMs / 3_600_000);
  const diffD   = Math.round(diffMs / 86_400_000);

  let relative: string;
  if (Math.abs(diffMin) < 60)  relative = diffMin >= 0 ? `en ${diffMin}m`  : `hace ${-diffMin}m`;
  else if (Math.abs(diffH) < 24) relative = diffH  >= 0 ? `en ${diffH}h`   : `hace ${-diffH}h`;
  else                           relative = diffD  >= 0 ? `en ${diffD}d`   : `hace ${-diffD}d`;

  return {
    date:     d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    time:     d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    relative,
  };
}

function toDatetimeLocal(iso: string) {
  const d   = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextSlot(scheduledPosts: ScheduledPost[], offsetDays = 1): string {
  const lastMs = scheduledPosts.reduce(
    (max, p) => Math.max(max, new Date(p.scheduled_time).getTime()),
    Date.now(),
  );
  const next = new Date(lastMs + offsetDays * DAY_MS);
  next.setHours(9, 0, 0, 0);
  return toDatetimeLocal(next.toISOString());
}

// ── Component ────────────────────────────────────────────────────────────────

export function ScheduledList({ refreshKey }: ScheduledListProps) {
  // DB posts
  const [posts,          setPosts]          = useState<ScheduledPost[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [deleting,       setDeleting]       = useState<Set<string>>(new Set());
  const [saving,         setSaving]         = useState<Set<string>>(new Set());
  const [confirming,     setConfirming]     = useState<Set<string>>(new Set());
  const [editTimes,      setEditTimes]      = useState<Record<string, string>>({});

  // Drive files (not yet in Supabase)
  const [driveFiles,      setDriveFiles]      = useState<DriveFile[]>([]);
  const [driveFetching,   setDriveFetching]   = useState(false);
  const [driveImporting,  setDriveImporting]  = useState<Set<string>>(new Set());
  const [driveEditTimes,  setDriveEditTimes]  = useState<Record<string, string>>({});
  const [driveMsg,        setDriveMsg]        = useState<string | null>(null);
  const [driveError,      setDriveError]      = useState<string | null>(null);

  // History
  const [history,        setHistory]        = useState<ScheduledPost[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const deletedRef = useRef<Set<string>>(new Set());

  const isDeleted = (id: string) =>
    deletedRef.current.has(id) || loadDeletedFromStorage().has(id);

  // ── Load DB posts ──────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/posts?status=pending', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { posts: ScheduledPost[] };
      const fetched = (data.posts ?? []).filter((p) => !isDeleted(p.id));

      // Merge rather than replace: keep any posts that were optimistically added
      // to the UI (e.g. via drive-queue) but haven't yet been confirmed by this
      // particular fetch. This prevents a concurrent in-flight load() — triggered
      // by the 30-second interval — from wiping a post that just appeared.
      setPosts((prev) => {
        const fetchedIds = new Set(fetched.map((p) => p.id));
        const optimistic = prev.filter((p) => !fetchedIds.has(p.id) && !isDeleted(p.id));
        return [...fetched, ...optimistic].sort(
          (a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime(),
        );
      });

      const scheduled = fetched.filter((p) => !isLegacyUnconfirmed(p));
      const legacy    = fetched.filter((p) =>  isLegacyUnconfirmed(p));
      setEditTimes((prev) => {
        const next = { ...prev };
        legacy.forEach((post, i) => {
          if (!next[post.id]) next[post.id] = nextSlot(scheduled, i + 1);
        });
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res  = await fetch('/api/posts?status=published', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { posts: ScheduledPost[] };
      setHistory((data.posts ?? []).reverse());
    } catch {
      // non-critical
    } finally {
      setHistoryLoading(false);
    }
  };

  // ── List Drive files (no download) ────────────────────────────────────────

  const listDrive = async () => {
    setDriveFetching(true);
    setDriveMsg(null);
    setDriveError(null);
    try {
      const res  = await fetch('/api/drive-list');
      const data = (await res.json()) as { files?: DriveFile[]; error?: string };
      if (!res.ok) { setDriveError(data.error ?? `HTTP ${res.status}`); return; }

      const files = data.files ?? [];
      setDriveFiles(files);

      const scheduled = posts.filter((p) => !isLegacyUnconfirmed(p));
      setDriveEditTimes((prev) => {
        const next = { ...prev };
        files.forEach((f, i) => {
          if (!next[f.id]) next[f.id] = nextSlot(scheduled, i + 1);
        });
        return next;
      });

      if (files.length === 0) {
        setDriveMsg('No hay fotos nuevas en la carpeta Por Subir.');
      } else {
        setDriveMsg(`${files.length} foto${files.length !== 1 ? 's' : ''} listas para importar.`);
      }
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : 'No se pudo conectar con Drive.');
    } finally {
      setDriveFetching(false);
    }
  };

  // ── Queue one Drive file (fast path — no download) ───────────────────────
  //
  // Saves the scheduled date immediately (< 1 s). The actual file download
  // and upload to Supabase Storage is deferred to the daily cron so we never
  // hit Vercel Hobby's 10-second function limit.

  const importDriveFile = async (file: DriveFile) => {
    const timeStr = driveEditTimes[file.id];
    if (!timeStr) return;

    setDriveImporting((prev) => new Set(prev).add(file.id));
    setDriveError(null);
    try {
      const res = await fetch('/api/drive-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driveFileId:   file.id,
          driveName:     file.name,
          driveFileMime: file.mimeType,
          scheduledTime: new Date(timeStr).toISOString(),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; post?: ScheduledPost; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // Remove from Drive list
      setDriveFiles((prev) => prev.filter((f) => f.id !== file.id));
      setDriveEditTimes((prev) => { const n = { ...prev }; delete n[file.id]; return n; });

      // Add the returned post directly to the queue — instant UI update
      if (data.post) {
        setPosts((prev) =>
          [...prev, data.post!].sort(
            (a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime(),
          ),
        );
      }

      setDriveMsg('Foto añadida a la cola. La imagen se descargará antes de publicarse.');
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : 'No se pudo añadir a la cola.');
    } finally {
      setDriveImporting((prev) => { const n = new Set(prev); n.delete(file.id); return n; });
    }
  };

  const ignoreDriveFile = (id: string) => {
    setDriveFiles((prev) => prev.filter((f) => f.id !== id));
    setDriveEditTimes((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  // ── DB post actions ───────────────────────────────────────────────────────

  const markDeleted = (id: string) => {
    deletedRef.current.add(id);
    persistDeleted(id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setEditTimes((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const cancel = async (id: string) => {
    setDeleting((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/posts/${id}`, { method: 'DELETE', redirect: 'manual' });
      if (res.status === 0 || res.status === 404) { markDeleted(id); return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      markDeleted(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar.');
    } finally {
      setDeleting((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const saveTime = async (id: string) => {
    const newTime = editTimes[id];
    if (!newTime) return;
    setSaving((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await fetch(`/api/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_time: new Date(newTime).toISOString() }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setPosts((prev) => prev.map((p) =>
        p.id === id ? { ...p, scheduled_time: new Date(newTime).toISOString() } : p,
      ));
      setEditTimes((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.');
    } finally {
      setSaving((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  // Confirm a legacy date=2099 post (already in Supabase, just needs a real date)
  const confirmLegacy = async (id: string) => {
    const timeStr = editTimes[id];
    if (!timeStr) return;
    setConfirming((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const nextTime = new Date(timeStr).toISOString();
      const res = await fetch(`/api/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_time: nextTime }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setPosts((prev) => prev.map((p) =>
        p.id === id ? { ...p, scheduled_time: nextTime } : p,
      ));
      setEditTimes((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo programar.');
    } finally {
      setConfirming((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  // ── Effects ───────────────────────────────────────────────────────────────

  // Refresh DB posts + history whenever parent signals an update (e.g. after direct upload)
  useEffect(() => {
    load();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Fetch Drive file list once on mount (user can also refresh manually with the button)
  useEffect(() => {
    listDrive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh DB posts every 30 s
  useEffect(() => {
    const id = setInterval(() => { load(); loadHistory(); }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const scheduled     = posts.filter((p) => !isLegacyUnconfirmed(p));
  const legacyPending = posts.filter((p) =>  isLegacyUnconfirmed(p));
  const hasPorSubir   = driveFiles.length > 0 || legacyPending.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-8">

      {/* ── En cola ──────────────────────────────────────── */}
      <section className="flex flex-col">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-2xl text-parchment-50">En cola</h2>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400">
              {loading ? 'cargando…' : `${scheduled.length} programadas`}
            </p>
          </div>
          <button
            type="button" onClick={load}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 text-parchment-300 transition hover:border-gold-500/60 hover:text-gold-300"
            aria-label="Recargar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        <div className="rule-gold mb-4" />

        {error && (
          <div className="mb-3 border-l-2 border-ember-500 bg-ember-500/5 px-3 py-2 font-mono text-xs text-ember-500">
            {error}
          </div>
        )}

        {loading && scheduled.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-parchment-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : scheduled.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Inbox className="h-6 w-6 text-parchment-400/60" strokeWidth={1.5} />
            <p className="font-serif text-lg text-parchment-200">La cola está vacía</p>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
              confirma una foto de abajo para añadirla
            </p>
          </div>
        ) : (
          <ul className="-mx-1 space-y-3 overflow-y-auto pr-1">
            {scheduled.map((post) => {
              const when = formatWhen(post.scheduled_time);
              return (
                <li
                  key={post.id}
                  className={`flex gap-3 rounded-sm border bg-ink-900/70 p-3 transition ${
                    deleting.has(post.id) ? 'border-ink-700 opacity-50' : 'border-ink-700 hover:border-gold-500/40'
                  }`}
                >
                  <Thumbnail url={post.image_url} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-start gap-1">
                      <p className="line-clamp-2 flex-1 font-serif text-sm leading-snug text-parchment-50">
                        {post.caption || <span className="italic text-parchment-400">Sin descripción</span>}
                      </p>
                      <CancelBtn onClick={() => cancel(post.id)} loading={deleting.has(post.id)} />
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-parchment-400">
                      <Clock className="h-3 w-3 text-gold-400/70" />
                      <span>{when.date}</span><span className="text-ink-500">·</span><span>{when.time}</span>
                      <span className="ml-auto text-gold-400/80">{when.relative}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        type="datetime-local"
                        value={editTimes[post.id] ?? toDatetimeLocal(post.scheduled_time)}
                        onChange={(e) => setEditTimes((prev) => ({ ...prev, [post.id]: e.target.value }))}
                        className="flex-1 rounded-sm border border-ink-600 bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] text-parchment-300 focus:border-gold-500/60 focus:outline-none"
                      />
                      <button
                        type="button" onClick={() => saveTime(post.id)}
                        disabled={!(editTimes[post.id] && editTimes[post.id] !== toDatetimeLocal(post.scheduled_time)) || saving.has(post.id)}
                        aria-label="Guardar fecha"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-gold-500/40 text-gold-400 transition hover:bg-gold-500/10 disabled:cursor-not-allowed disabled:border-ink-600 disabled:text-parchment-600"
                      >
                        {saving.has(post.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Por subir ────────────────────────────────────── */}
      <section className="flex flex-col">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-xl text-parchment-50">Por subir</h2>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400">
              {driveFetching
                ? 'consultando Drive…'
                : `${driveFiles.length + legacyPending.length} pendientes de confirmar`}
            </p>
          </div>
          <button
            type="button"
            onClick={listDrive}
            disabled={driveFetching}
            className="flex items-center gap-1.5 rounded-sm border border-ink-600 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-parchment-300 transition hover:border-gold-500/60 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CloudDownload className={`h-3.5 w-3.5 ${driveFetching ? 'animate-spin' : ''}`} />
            {driveFetching ? 'consultando…' : 'sincronizar con drive'}
          </button>
        </header>

        {driveMsg && (
          <div className="mb-3 border-l-2 border-gold-500/60 bg-gold-500/5 px-3 py-2 font-mono text-xs text-gold-300">
            {driveMsg}
          </div>
        )}

        {driveError && (
          <div className="mb-3 border-l-2 border-ember-500 bg-ember-500/5 px-3 py-2 font-mono text-xs text-ember-500">
            {driveError}
          </div>
        )}

        <div className="rule-gold mb-4" />

        {!hasPorSubir ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Inbox className="h-5 w-5 text-parchment-400/60" strokeWidth={1.5} />
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
              sin archivos pendientes · pulsa sincronizar para consultar Drive
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">

            {/* Drive files — not yet uploaded to Supabase */}
            {driveFiles.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-gold-400/70">
                  <HardDriveDownload className="h-3 w-3" />
                  de google drive · confirmar para importar
                </p>
                <ul className="-mx-1 space-y-3 pr-1">
                  {driveFiles.map((file) => (
                    <li
                      key={file.id}
                      className={`flex gap-3 rounded-sm border bg-ink-900/50 p-3 transition ${
                        driveImporting.has(file.id) ? 'border-ink-700 opacity-50' : 'border-gold-500/20 hover:border-gold-500/40'
                      }`}
                    >
                      {/* Thumbnail proxied through our API */}
                      <div className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-sm border border-ink-700 bg-ink-950">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/drive-thumbnail?id=${file.id}&mime=${encodeURIComponent(file.mimeType)}`}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                            const ph = e.currentTarget.nextElementSibling as HTMLElement | null;
                            if (ph) ph.style.display = 'flex';
                          }}
                        />
                        <div className="absolute inset-0 items-center justify-center" style={{ display: 'none' }}>
                          <ImageOff className="h-5 w-5 text-parchment-600" strokeWidth={1.5} />
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                        <div className="flex items-start gap-1">
                          <p className="line-clamp-3 flex-1 font-serif text-sm leading-snug text-parchment-200">
                            {file.name.replace(/\.[^/.]+$/, '') || <span className="italic text-parchment-400">Sin nombre</span>}
                          </p>
                          <button
                            type="button"
                            onClick={() => ignoreDriveFile(file.id)}
                            disabled={driveImporting.has(file.id)}
                            aria-label="Ignorar"
                            className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-ink-600 text-parchment-500 transition hover:border-ember-500/50 hover:text-ember-400 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="datetime-local"
                            value={driveEditTimes[file.id] ?? ''}
                            onChange={(e) => setDriveEditTimes((prev) => ({ ...prev, [file.id]: e.target.value }))}
                            className="flex-1 rounded-sm border border-ink-600 bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] text-parchment-300 focus:border-gold-500/60 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => importDriveFile(file)}
                            disabled={!driveEditTimes[file.id] || driveImporting.has(file.id)}
                            aria-label="Confirmar e importar"
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-gold-500/50 text-gold-400 transition hover:bg-gold-500/10 disabled:cursor-not-allowed disabled:border-ink-600 disabled:text-parchment-600"
                          >
                            {driveImporting.has(file.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Legacy: DB posts with sentinel date=2099 (imported via old sync-drive) */}
            {legacyPending.length > 0 && (
              <div className="flex flex-col gap-3">
                {driveFiles.length > 0 && (
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-parchment-500">
                    ya en supabase · pendientes de fecha
                  </p>
                )}
                <ul className="-mx-1 space-y-3 pr-1">
                  {legacyPending.map((post) => (
                    <li
                      key={post.id}
                      className={`flex gap-3 rounded-sm border bg-ink-900/50 p-3 transition ${
                        deleting.has(post.id) ? 'border-ink-700 opacity-50' : 'border-ink-700 hover:border-gold-500/30'
                      }`}
                    >
                      <Thumbnail url={post.image_url} />
                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                        <div className="flex items-start gap-1">
                          <p className="line-clamp-3 flex-1 font-serif text-sm leading-snug text-parchment-200">
                            {post.caption || <span className="italic text-parchment-400">Sin descripción</span>}
                          </p>
                          <CancelBtn onClick={() => cancel(post.id)} loading={deleting.has(post.id)} />
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="datetime-local"
                            value={editTimes[post.id] ?? ''}
                            onChange={(e) => setEditTimes((prev) => ({ ...prev, [post.id]: e.target.value }))}
                            className="flex-1 rounded-sm border border-ink-600 bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] text-parchment-300 focus:border-gold-500/60 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => confirmLegacy(post.id)}
                            disabled={!editTimes[post.id] || confirming.has(post.id)}
                            aria-label="Confirmar fecha"
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-gold-500/50 text-gold-400 transition hover:bg-gold-500/10 disabled:cursor-not-allowed disabled:border-ink-600 disabled:text-parchment-600"
                          >
                            {confirming.has(post.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Historial ────────────────────────────────────── */}
      <section className="flex flex-col">
        <header className="mb-4">
          <h2 className="font-serif text-xl text-parchment-50">Historial</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400">
            {historyLoading ? 'cargando…' : `${history.length} publicada${history.length !== 1 ? 's' : ''}`}
          </p>
        </header>

        <div className="rule-gold mb-4" />

        {historyLoading && history.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-parchment-400">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Inbox className="h-5 w-5 text-parchment-400/60" strokeWidth={1.5} />
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
              sin publicaciones aún
            </p>
          </div>
        ) : (
          <ul className="-mx-1 space-y-2 pr-1">
            {history.map((post) => {
              const d       = new Date(post.scheduled_time);
              const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
              const timeStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
              return (
                <li
                  key={post.id}
                  className="flex gap-3 rounded-sm border border-ink-700 bg-ink-900/40 p-2.5 opacity-80 transition hover:opacity-100"
                >
                  <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-sm border border-ink-700 bg-ink-950">
                    {post.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-between">
                    <p className="line-clamp-2 font-serif text-xs leading-snug text-parchment-300">
                      {post.caption || <span className="italic text-parchment-500">Sin descripción</span>}
                    </p>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-parchment-500">
                      <CheckCircle2 className="h-3 w-3 text-green-500/70" />
                      <span>{dateStr}</span>
                      <span className="text-ink-500">·</span>
                      <span>{timeStr}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

    </div>
  );
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function Thumbnail({ url }: { url: string }) {
  return (
    <div className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-sm border border-ink-700 bg-ink-950">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url} alt=""
          className="h-full w-full object-cover" loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
            const ph = e.currentTarget.nextElementSibling as HTMLElement | null;
            if (ph) ph.style.display = 'flex';
          }}
        />
      ) : null}
      <div className="absolute inset-0 items-center justify-center" style={{ display: url ? 'none' : 'flex' }}>
        <ImageOff className="h-5 w-5 text-parchment-600" strokeWidth={1.5} />
      </div>
    </div>
  );
}

function CancelBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={loading}
      aria-label="Cancelar"
      className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-ember-500/50 text-ember-400 transition hover:bg-ember-500/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
    </button>
  );
}
