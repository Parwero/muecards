'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, AlertCircle, Info, AlertTriangle, ArrowLeft } from 'lucide-react';

type LogEntry = {
  id: string;
  created_at: string;
  level: 'info' | 'warn' | 'error';
  route: string;
  message: string;
  details: Record<string, unknown> | null;
};

const LEVEL_STYLES = {
  error: {
    border: 'border-ember-500/40',
    bg: 'bg-ember-500/5',
    text: 'text-ember-400',
    badge: 'bg-ember-500/10 text-ember-400',
    Icon: AlertCircle,
  },
  warn: {
    border: 'border-gold-500/40',
    bg: 'bg-gold-400/5',
    text: 'text-gold-400',
    badge: 'bg-gold-400/10 text-gold-400',
    Icon: AlertTriangle,
  },
  info: {
    border: 'border-ink-600',
    bg: 'bg-ink-900/60',
    text: 'text-parchment-300',
    badge: 'bg-ink-800 text-parchment-400',
    Icon: Info,
  },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');

  const load = async () => {
    setLoading(true);
    const url = filter === 'all' ? '/api/admin/logs' : `/api/admin/logs?level=${filter}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    setLogs(data.logs ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <main className="relative z-10 mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/"
            className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400 transition hover:text-gold-300"
          >
            <ArrowLeft className="h-3 w-3" />
            Volver
          </Link>
          <h1 className="font-serif text-3xl text-parchment-50">Registro de errores</h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400">
            {loading ? 'cargando…' : `${logs.length} entradas`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(['all', 'error', 'warn', 'info'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setFilter(lvl)}
              className={`font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-sm border transition ${
                filter === lvl
                  ? 'border-gold-500/60 bg-gold-400/10 text-gold-300'
                  : 'border-ink-600 text-parchment-400 hover:border-gold-500/40 hover:text-parchment-200'
              }`}
            >
              {lvl === 'all' ? 'Todos' : lvl}
            </button>
          ))}
          <button
            onClick={load}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 text-parchment-300 transition hover:border-gold-500/60 hover:text-gold-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="h-px bg-gradient-to-r from-gold-400/30 via-gold-400/10 to-transparent mb-6" />

      {logs.length === 0 && !loading ? (
        <div className="py-20 text-center">
          <p className="font-serif text-lg text-parchment-300">Sin registros</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
            los errores aparecerán aquí
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((entry) => {
            const style = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info;
            const { Icon } = style;
            return (
              <div
                key={entry.id}
                className={`rounded-sm border ${style.border} ${style.bg} px-4 py-3`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${style.text}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${style.badge}`}
                      >
                        {entry.level}
                      </span>
                      <span className="font-mono text-[10px] text-parchment-400">
                        {entry.route}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-parchment-400">
                        {formatDate(entry.created_at)}
                      </span>
                    </div>
                    <p className={`mt-1 font-mono text-xs ${style.text}`}>{entry.message}</p>
                    {entry.details && (
                      <pre className="mt-2 overflow-x-auto rounded-sm bg-ink-950 px-3 py-2 font-mono text-[10px] text-parchment-400">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
