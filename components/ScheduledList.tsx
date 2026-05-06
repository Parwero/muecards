'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, Loader2, RefreshCw, Inbox, X, ImageOff, Check } from 'lucide-react';
import type { ScheduledPost } from '@/types';

interface ScheduledListProps {
  refreshKey: number;
}

const LS_KEY = 'mue_deleted_ids';

function loadDeletedFromStorage(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as string[]);
  } catch { return new Set(); }
}

function persistDeleted(id: string) {
  try {
    const ids = loadDeletedFromStorage();
    ids.add(id);
    // Keep last 200 entries to avoid bloat
    localStorage.setItem(LS_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {}
}

function formatWhen(iso: string): { date: string; time: string; relative: string } {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.round(diffMs / 3_600_000);
  const diffD = Math.round(diffMs / 86_400_000);

  let relative: string;
  if (Math.abs(diffMin) < 60) relative = diffMin >= 0 ? `en ${diffMin}m` : `hace ${-diffMin}m`;
  else if (Math.abs(diffH) < 24) relative = diffH >= 0 ? `en ${diffH}h` : `hace ${-diffH}h`;
  else relative = diffD >= 0 ? `en ${diffD}d` : `hace ${-diffD}d`;

  return {
    date: d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    time: d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    relative,
  };
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduledList({ refreshKey }: ScheduledListProps) {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [editTimes, setEditTimes] = useState<Record<string, string>>({});
  // In-memory filter (cleared on unmount); localStorage is the persistent layer
  const deletedRef = useRef<Set<string>>(new Set());

  const isDeleted = (id: string) =>
    deletedRef.current.has(id) || loadDeletedFromStorage().has(id);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/posts?status=pending', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { posts: ScheduledPost[] };
      setPosts((data.posts ?? []).filter((p) => !isDeleted(p.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const markDeleted = (id: string) => {
    deletedRef.current.add(id);
    persistDeleted(id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setEditTimes((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const cancel = async (id: string) => {
    setDeleting((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/posts/${id}`, { method: 'DELETE', redirect: 'manual' });

      // opaqueredirect (type 0) or genuine 404 → row is already gone
      if (res.status === 0 || res.status === 404) {
        markDeleted(id);
        return;
      }

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const d = (await res.json()) as { error?: string }; msg = d.error ?? msg; } catch {}
        throw new Error(msg);
      }

      markDeleted(id);
      // Reload so rescheduled dates refresh
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar.');
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(id); return next; });
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
      setPosts((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, scheduled_time: new Date(newTime).toISOString() } : p,
        ),
      );
      setEditTimes((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.');
    } finally {
      setSaving((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex flex-col">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-parchment-50">En cola</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400">
            {loading ? 'cargando…' : `${posts.length} programadas`}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
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

      {loading && posts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-12 text-parchment-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
          <Inbox className="h-6 w-6 text-parchment-400/60" strokeWidth={1.5} />
          <p className="font-serif text-lg text-parchment-200">La cola está vacía</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
            programa tu primera carta
          </p>
        </div>
      ) : (
        <ul className="-mx-1 space-y-3 overflow-y-auto pr-1">
          {posts.map((post) => {
            const when = formatWhen(post.scheduled_time);
            return (
              <li
                key={post.id}
                className={`flex gap-3 rounded-sm border bg-ink-900/70 p-3 transition ${
                  deleting.has(post.id)
                    ? 'border-ink-700 opacity-50'
                    : 'border-ink-700 hover:border-gold-500/40'
                }`}
              >
                <div className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-sm border border-ink-700 bg-ink-950">
                  {post.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                        const ph = e.currentTarget.nextElementSibling as HTMLElement | null;
                        if (ph) ph.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div
                    className="absolute inset-0 items-center justify-center"
                    style={{ display: post.image_url ? 'none' : 'flex' }}
                  >
                    <ImageOff className="h-5 w-5 text-parchment-600" strokeWidth={1.5} />
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start gap-1">
                    <p className="line-clamp-2 flex-1 font-serif text-sm leading-snug text-parchment-50">
                      {post.caption || <span className="italic text-parchment-400">Sin descripción</span>}
                    </p>
                    <button
                      type="button"
                      onClick={() => cancel(post.id)}
                      disabled={deleting.has(post.id)}
                      aria-label="Cancelar publicación"
                      className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-ember-500/50 text-ember-400 transition hover:bg-ember-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deleting.has(post.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-parchment-400">
                    <Clock className="h-3 w-3 text-gold-400/70" />
                    <span>{when.date}</span>
                    <span className="text-ink-500">·</span>
                    <span>{when.time}</span>
                    <span className="ml-auto text-gold-400/80">{when.relative}</span>
                  </div>

                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="datetime-local"
                      value={editTimes[post.id] ?? toDatetimeLocal(post.scheduled_time)}
                      onChange={(e) =>
                        setEditTimes((prev) => ({ ...prev, [post.id]: e.target.value }))
                      }
                      className="flex-1 rounded-sm border border-ink-600 bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] text-parchment-300 focus:border-gold-500/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => saveTime(post.id)}
                      disabled={
                        !(editTimes[post.id] && editTimes[post.id] !== toDatetimeLocal(post.scheduled_time)) ||
                        saving.has(post.id)
                      }
                      aria-label="Guardar fecha"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-gold-500/40 text-gold-400 transition hover:bg-gold-500/10 disabled:cursor-not-allowed disabled:border-ink-600 disabled:text-parchment-600"
                    >
                      {saving.has(post.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
