'use client';

import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { CheckCircle2, AlertCircle, Loader2, Copy, ExternalLink } from 'lucide-react';
import Link from 'next/link';

type SetupResult = {
  found: boolean;
  ig_user_id: string | null;
  page_name: string | null;
  all_pages: Array<{ page_id: string; page_name: string; ig_user_id: string | null }>;
  error?: string;
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-400 transition hover:text-gold-300"
    >
      <Copy className="h-3 w-3" />
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export default function SetupPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);

  const discover = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/ig-setup', { cache: 'no-store' });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setResult({
        found: false,
        ig_user_id: null,
        page_name: null,
        all_pages: [],
        error: e instanceof Error ? e.message : 'Error inesperado',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative z-10 mx-auto max-w-2xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <Logo />
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400 transition hover:text-gold-300"
        >
          ← Volver
        </Link>
      </header>

      <h1 className="mb-2 font-serif text-3xl text-parchment-50">Configuración inicial</h1>
      <p className="mb-8 font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
        Descubre tu Instagram User ID para el archivo .env.local
      </p>

      <div className="rule-gold mb-8" />

      {/* Step 1: Token check */}
      <section className="mb-8 space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          01 · Token
        </h2>
        <p className="font-serif text-lg text-parchment-100">
          Asegúrate de que <code className="font-mono text-gold-300">IG_ACCESS_TOKEN</code> está
          definido en tu{' '}
          <code className="font-mono text-gold-300">.env.local</code>.
        </p>
        <p className="font-mono text-[11px] text-parchment-400">
          El token debe tener los scopes:{' '}
          <span className="text-parchment-200">
            instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement
          </span>
        </p>
      </section>

      {/* Step 2: Discover */}
      <section className="mb-8 space-y-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          02 · Descubrir IG User ID
        </h2>
        <button
          type="button"
          onClick={discover}
          disabled={loading}
          className="flex items-center gap-3 border border-gold-500/40 bg-gradient-to-b from-gold-400/20 to-gold-500/5 px-6 py-3 font-serif text-lg text-gold-300 transition hover:from-gold-400/30 hover:shadow-gold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando Meta API…
            </>
          ) : (
            <>
              <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
              Buscar mi cuenta de Instagram
            </>
          )}
        </button>

        {result && (
          <div
            className={`rounded-sm border p-5 ${
              result.error || !result.found
                ? 'border-ember-500/40 bg-ember-500/5'
                : 'border-gold-500/40 bg-gold-400/5'
            }`}
          >
            {result.error ? (
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ember-500" />
                <div>
                  <p className="font-mono text-sm text-ember-500">Error al consultar la API:</p>
                  <p className="mt-1 font-mono text-xs text-parchment-300">{result.error}</p>
                </div>
              </div>
            ) : result.found && result.ig_user_id ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-gold-400" />
                  <p className="font-mono text-sm text-gold-300">
                    Cuenta encontrada: <strong>{result.page_name}</strong>
                  </p>
                </div>
                <div className="rounded-sm border border-ink-600 bg-ink-900 px-4 py-3">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-parchment-400">
                    IG_USER_ID
                  </p>
                  <div className="flex items-center justify-between gap-4">
                    <code className="font-mono text-xl text-parchment-50">
                      {result.ig_user_id}
                    </code>
                    <CopyButton value={result.ig_user_id} />
                  </div>
                </div>
                <p className="font-mono text-[11px] text-parchment-400">
                  Copia este valor y pégalo como{' '}
                  <code className="text-gold-300">IG_USER_ID</code> en tu{' '}
                  <code className="text-gold-300">.env.local</code>.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ember-500" />
                <div>
                  <p className="font-mono text-sm text-ember-500">
                    No se encontró una cuenta Instagram Business vinculada.
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-parchment-400">
                    Asegúrate de que tu cuenta de Instagram es del tipo{' '}
                    <strong className="text-parchment-200">Business o Creator</strong> y está
                    vinculada a una Página de Facebook que administras con este token.
                  </p>
                  {result.all_pages.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {result.all_pages.map((p) => (
                        <li
                          key={p.page_id}
                          className="font-mono text-[10px] text-parchment-400"
                        >
                          Página <span className="text-parchment-200">{p.page_name}</span>{' '}
                          (id: {p.page_id}) —{' '}
                          {p.ig_user_id ? (
                            <span className="text-gold-300">IG: {p.ig_user_id}</span>
                          ) : (
                            <span className="text-ember-500">sin cuenta IG vinculada</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Step 3: Supabase reminder */}
      <section className="rounded-sm border border-ink-700 bg-ink-900/60 p-5 space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          03 · Supabase (pendiente)
        </h2>
        <p className="font-serif text-parchment-100">
          Crea un proyecto gratuito en{' '}
          <a
            href="https://supabase.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold-300 underline"
          >
            supabase.com
          </a>
          , ejecuta <code className="font-mono text-gold-300">supabase/schema.sql</code> en el SQL
          Editor, y copia las tres claves en tu <code className="font-mono text-gold-300">.env.local</code>.
        </p>
        <ul className="space-y-1 font-mono text-[11px] text-parchment-400">
          <li>· NEXT_PUBLIC_SUPABASE_URL → Settings → API → Project URL</li>
          <li>· NEXT_PUBLIC_SUPABASE_ANON_KEY → Settings → API → anon/public</li>
          <li>· SUPABASE_SERVICE_ROLE_KEY → Settings → API → service_role ⚠️</li>
        </ul>
      </section>
    </main>
  );
}
