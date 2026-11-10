-- ═══════════════════════════════════════════════════════════════
-- Migration : destinataires + historique d'envoi du PLAN DE CHARGEMENT
-- À exécuter dans Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.loading_plan_recipients (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  full_name  text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Un enregistrement par mail envoyé (sert à signaler « déjà envoyé » pour une journée)
create table if not exists public.loading_plan_sends (
  id              uuid primary key default gen_random_uuid(),
  delivery_date   date not null,
  subject         text not null,
  recipients_count int not null default 0,
  sent_by         uuid references public.users(id),
  sent_at         timestamptz not null default now()
);
create index if not exists loading_plan_sends_date_idx on public.loading_plan_sends (delivery_date);

alter table public.loading_plan_recipients enable row level security;
alter table public.loading_plan_sends enable row level security;

drop policy if exists "lpr_admin_all" on public.loading_plan_recipients;
create policy "lpr_admin_all" on public.loading_plan_recipients
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "lps_admin_select" on public.loading_plan_sends;
create policy "lps_admin_select" on public.loading_plan_sends
  for select using (public.current_user_role() = 'admin');
-- (l'écriture dans loading_plan_sends se fait depuis la fonction Edge avec la clé service)
