-- =============================================================
-- Muecards — Supabase schema
-- Run in the Supabase SQL editor (or via `supabase db execute`).
-- =============================================================

-- Enable UUID helpers (usually on by default in Supabase).
create extension if not exists "pgcrypto";

-- -------------------------------------------------------------
-- Table: scheduled_posts
-- -------------------------------------------------------------
create table if not exists public.scheduled_posts (
  id               uuid primary key default gen_random_uuid(),
  image_url        text        not null,
  caption          text        not null,
  scheduled_time   timestamptz not null,
  status           text        not null default 'pending'
                   check (status in ('pending', 'published', 'failed')),
  storage_path     text,
  ig_media_id      text,
  error_message    text,
  created_at       timestamptz not null default now()
);

create index if not exists scheduled_posts_pending_idx
  on public.scheduled_posts (scheduled_time)
  where status = 'pending';

-- -------------------------------------------------------------
-- Storage bucket: post-images  (PUBLIC — IG needs fetchable URLs)
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do update set public = true;

-- -------------------------------------------------------------
-- RLS — lock the table down. The API routes use the service-role
-- key (bypasses RLS), so no client-facing policy is needed.
-- -------------------------------------------------------------
alter table public.scheduled_posts enable row level security;
-- intentionally NO policies — only service_role can touch rows.

-- -------------------------------------------------------------
-- Table: app_logs  (used by lib/logger.ts and GET /api/admin/logs)
-- -------------------------------------------------------------
create table if not exists public.app_logs (
  id         bigserial   primary key,
  level      text        not null check (level in ('info', 'warn', 'error')),
  route      text        not null,
  message    text        not null,
  details    jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_logs_created_at_idx on public.app_logs (created_at desc);
create index if not exists app_logs_level_idx      on public.app_logs (level);

alter table public.app_logs enable row level security;
-- intentionally NO policies — only service_role can touch rows.
