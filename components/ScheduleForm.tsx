'use client';

import { useEffect, useState } from 'react';
import { Calendar, Loader2, Send, Type, Layers, RefreshCw } from 'lucide-react';

const IG_CAPTION_LIMIT = 2200;

interface ScheduleFormProps {
  caption: string;
  scheduledTime: string;
  submitting: boolean;
  canSubmit: boolean;
  onCaptionChange: (v: string) => void;
  onScheduledTimeChange: (v: string) => void;
  onSubmit: () => void;
}

function getMinDateTime(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    now.getFullYear() +
    '-' +
    pad(now.getMonth() + 1) +
    '-' +
    pad(now.getDate()) +
    'T' +
    pad(now.getHours()) +
    ':' +
    pad(now.getMinutes())
  );
}

/** Convert ISO string to datetime-local value (local timezone) */
function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

export function ScheduleForm({
  caption,
  scheduledTime,
  submitting,
  canSubmit,
  onCaptionChange,
  onScheduledTimeChange,
  onSubmit,
}: ScheduleFormProps) {
  const charCount = caption.length;
  const overLimit = charCount > IG_CAPTION_LIMIT;

  const [queueMode, setQueueMode] = useState(false);
  const [fetchingSlot, setFetchingSlot] = useState(false);

  const fetchNextSlot = async () => {
    setFetchingSlot(true);
    try {
      const res = await fetch('/api/queue-next', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { next_slot?: string; error?: string };
      if (data.next_slot) {
        onScheduledTimeChange(isoToLocal(data.next_slot));
      }
    } catch (e) {
      console.error('[queue-next]', e);
    } finally {
      setFetchingSlot(false);
    }
  };

  // When queue mode is toggled ON, auto-fetch the next available slot.
  useEffect(() => {
    if (queueMode) {
      fetchNextSlot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueMode]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !submitting) onSubmit();
      }}
      className="space-y-6"
    >
      {/* Caption */}
      <div>
        <label className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-300">
            <Type className="h-3 w-3" />
            Caption
          </span>
          <span
            className={`font-mono text-[11px] tabular-nums ${
              overLimit
                ? 'text-ember-500'
                : charCount > IG_CAPTION_LIMIT * 0.9
                  ? 'text-gold-400'
                  : 'text-parchment-400'
            }`}
          >
            {charCount.toLocaleString()} / {IG_CAPTION_LIMIT.toLocaleString()}
          </span>
        </label>
        <textarea
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          placeholder="Describe la carta: set, rareza, condición, historia…"
          rows={7}
          className="w-full resize-y rounded-sm border border-ink-600 bg-ink-900 px-4 py-3 font-serif text-lg leading-relaxed text-parchment-50 placeholder:text-parchment-400/60 focus:border-gold-500/60 focus:bg-ink-800"
        />
      </div>

      {/* Queue mode toggle */}
      <div className="flex items-start gap-3 rounded-sm border border-ink-700 bg-ink-900/60 px-4 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={queueMode}
          onClick={() => setQueueMode((v) => !v)}
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-gold-400 ${
            queueMode
              ? 'border-gold-500/60 bg-gold-400/20'
              : 'border-ink-600 bg-ink-800'
          }`}
        >
          <span
            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
              queueMode
                ? 'left-[18px] bg-gold-400'
                : 'left-0.5 bg-parchment-400/40'
            }`}
          />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-300">
            <Layers className="h-3 w-3" />
            Cola automática · cada 2 días
          </p>
          <p className="mt-1 font-mono text-[10px] text-parchment-400">
            {queueMode
              ? 'Fecha calculada desde el último post en cola + 48 h.'
              : 'Activa para encolar automáticamente sin solaparse.'}
          </p>
        </div>
        {queueMode && (
          <button
            type="button"
            onClick={fetchNextSlot}
            disabled={fetchingSlot}
            aria-label="Recalcular siguiente hueco"
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-ink-600 text-parchment-300 transition hover:border-gold-500/60 hover:text-gold-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${fetchingSlot ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* Schedule time */}
      <div>
        <label className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-300">
          <Calendar className="h-3 w-3" />
          Fecha y hora de publicación
        </label>
        <input
          type="datetime-local"
          value={scheduledTime}
          min={getMinDateTime()}
          onChange={(e) => {
            if (!queueMode) onScheduledTimeChange(e.target.value);
          }}
          readOnly={queueMode}
          className={`w-full rounded-sm border border-ink-600 bg-ink-900 px-4 py-3 font-mono text-sm text-parchment-100 focus:border-gold-500/60 focus:bg-ink-800 [color-scheme:dark] ${
            queueMode ? 'cursor-not-allowed opacity-70' : ''
          }`}
        />
        <p className="mt-2 font-mono text-[10px] text-parchment-400">
          {queueMode
            ? 'En modo cola la fecha se calcula automáticamente.'
            : 'El publicador corre cada hora en punto. Programa al menos 5 min en el futuro.'}
        </p>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit || submitting || overLimit || fetchingSlot}
        className="group relative flex w-full items-center justify-center gap-3 border border-gold-500/40 bg-gradient-to-b from-gold-400/20 to-gold-500/5 px-6 py-4 font-serif text-lg tracking-wide text-gold-300 transition hover:from-gold-400/30 hover:to-gold-500/10 hover:text-gold-300 hover:shadow-gold disabled:cursor-not-allowed disabled:border-ink-600 disabled:from-ink-800 disabled:to-ink-800 disabled:text-parchment-400/50 disabled:shadow-none"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Programando…</span>
          </>
        ) : (
          <>
            <Send className="h-4 w-4" strokeWidth={1.5} />
            <span>{queueMode ? 'Añadir a la cola' : 'Programar publicación'}</span>
          </>
        )}
      </button>
    </form>
  );
}
