'use client';

import { useEffect, useState } from 'react';
import { Clock, Loader2, RefreshCw, Inbox, X } from 'lucide-react';
import type { ScheduledPost } from '@/types';

interface ScheduledListProps {
  /** Incremented by the parent whenever a new post is scheduled, forcing a refetch */
  refreshKey: number;
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

export function ScheduledList({ refreshKey }: ScheduledListProps) {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/posts?status=pending', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { posts: ScheduledPost[] };
      setPosts(data.posts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const cancel = async (id: string) => {
    setDeleting((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar.');
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Auto-refresh every 30 s so newly scheduled posts appear without manual reload
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex h-full flex-col">
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
        <div className="border-l-2 border-ember-500 bg-ember-500/5 px-3 py-2 font-mono text-xs text-ember-500">
          {error}
        </div>
      )}

      {loading && posts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-parchment-400">
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
        <ul className="-mx-1 flex-1 space-y-3 overflow-y-auto pr-1">
          {posts.map((post) => {
            const when = formatWhen(post.scheduled_time);
            return (
              <li
                key={post.id}
                className={`group relative flex gap-3 rounded-sm border bg-ink-900/70 p-3 transition ${
                  deleting.has(post.id)
                    ? 'border-ink-700 opacity-50'
                    : 'border-ink-700 hover:border-gold-500/40'
                }`}
              >
                {/* Cancel button — visible on hover */}
                <button
                  type="button"
                  onClick={() => cancel(post.id)}
                  disabled={deleting.has(post.id)}
                  aria-label="Cancelar publicación"
                  className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-sm border border-ink-600 bg-ink-900 text-parchment-400 opacity-0 transition group-hover:opacity-100 hover:border-ember-500/60 hover:text-ember-400 disabled:cursor-not-allowed"
                >
                  {deleting.has(post.id) ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>

                <div className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-sm border border-ink-700 bg-ink-950">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.image_url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-3 font-serif text-sm leading-snug text-parchment-50">
                    {post.caption || <span className="italic text-parchment-400">Sin descripción</span>}
                  </p>
                  <div className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-parchment-400">
                    <Clock className="h-3 w-3 text-gold-400/70" />
                    <span>{when.date}</span>
                    <span className="text-ink-500">·</span>
                    <span>{when.time}</span>
                    <span className="ml-auto text-gold-400/80">{when.relative}</span>
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
