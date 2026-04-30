'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { Loader2, LogIn } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error ?? 'Error al iniciar sesión.');
      }
    } catch {
      setError('Error de conexión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex justify-center">
          <Logo />
        </div>

        <div className="border border-ink-700 bg-ink-900/80 p-8">
          <h1 className="mb-1 font-serif text-2xl text-parchment-50">Acceso privado</h1>
          <p className="mb-8 font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
            Introduce tus credenciales
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400">
                Usuario
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full border border-ink-600 bg-ink-950 px-4 py-2.5 font-mono text-sm text-parchment-100 outline-none focus:border-gold-500/60 focus:ring-1 focus:ring-gold-500/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full border border-ink-600 bg-ink-950 px-4 py-2.5 font-mono text-sm text-parchment-100 outline-none focus:border-gold-500/60 focus:ring-1 focus:ring-gold-500/30"
              />
            </div>

            {error && (
              <p className="font-mono text-[11px] text-ember-500">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 border border-gold-500/40 bg-gradient-to-b from-gold-400/20 to-gold-500/5 py-3 font-serif text-lg text-gold-300 transition hover:from-gold-400/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" strokeWidth={1.5} />
              )}
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
