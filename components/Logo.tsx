import { Spade } from 'lucide-react';

/**
 * Muecards wordmark.
 * Small diamond glyph + serif lowercase lockup.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative flex h-9 w-9 items-center justify-center">
        <div className="absolute inset-0 rotate-45 border border-gold-400/60" />
        <div className="absolute inset-1.5 rotate-45 bg-gold-400/10" />
        <Spade className="relative h-4 w-4 text-gold-400" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-serif text-2xl tracking-tight text-parchment-50">
          muecards
        </span>
        <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-parchment-400">
          scheduler
        </span>
      </div>
    </div>
  );
}
