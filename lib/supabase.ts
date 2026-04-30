import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser / public client — uses the ANON key.
 * Safe to expose in client components (RLS policies must be in place
 * on the `scheduled_posts` table and the `post-images` bucket).
 */
let browserClient: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars',
    );
  }

  browserClient = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return browserClient;
}

/**
 * Server-side admin client — uses the SERVICE_ROLE key.
 * NEVER import this from a client component. Only API routes / server actions.
 * Bypasses RLS so cron jobs and uploads can run regardless of policies.
 */
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars',
    );
  }

  // No singleton on the server: each request gets a fresh client to avoid
  // leaking auth state across invocations in serverless functions.
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const STORAGE_BUCKET = 'post-images';
