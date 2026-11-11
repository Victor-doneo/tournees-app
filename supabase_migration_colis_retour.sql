-- ═══════════════════════════════════════════════════════════════
-- Migration : COLIS À RETOURNER (récupérés dans Urbantz en fin de journée)
-- À exécuter dans Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.return_labels (
  id               uuid primary key default gen_random_uuid(),
  task_date        date not null,
  round_name       text,
  tour_code        text,
  task_id          text,
  barcode          text not null,
  item_name        text,
  item_description text,
  item_status      text,
  reason           text,
  customer_name    text,
  customer_phone   text,
  address          text,
  zip              text,
  city             text,
  printed_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (task_date, barcode)
);
create index if not exists return_labels_date_idx on public.return_labels (task_date);

alter table public.return_labels enable row level security;
drop policy if exists "rl_admin_all" on public.return_labels;
create policy "rl_admin_all" on public.return_labels
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
