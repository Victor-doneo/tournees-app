-- Suivi d'exécution des automatismes (affiché dans « Suivi des tournées »)
-- À exécuter dans Supabase -> SQL Editor
create table if not exists public.job_runs (
  job text primary key,
  last_run timestamptz not null default now(),
  ok boolean not null default true,
  message text
);
alter table public.job_runs enable row level security;
drop policy if exists "job_runs lecture" on public.job_runs;
create policy "job_runs lecture" on public.job_runs for select to authenticated using (true);
