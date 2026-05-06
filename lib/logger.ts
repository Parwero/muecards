import { getServiceClient } from '@/lib/supabase';

export type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  route: string;
  message: string;
  details?: Record<string, unknown>;
}

export async function log(entry: LogEntry): Promise<void> {
  const structured = { ts: new Date().toISOString(), ...entry };

  if (entry.level === 'error') {
    console.error('[muecards]', JSON.stringify(structured));
  } else {
    console.log('[muecards]', JSON.stringify(structured));
  }

  try {
    const supabase = getServiceClient();
    await supabase.from('app_logs').insert({
      level: entry.level,
      route: entry.route,
      message: entry.message,
      details: entry.details ?? null,
    });
  } catch {
    // Don't let logging failures break the main flow
  }
}
