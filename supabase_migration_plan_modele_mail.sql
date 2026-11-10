-- ═══════════════════════════════════════════════════════════════
-- Migration : modèle modifiable du mail PLAN DE CHARGEMENT
-- À exécuter dans Supabase → SQL Editor (APRÈS supabase_migration_plan_acces_partenaires.sql)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.loading_plan_mail_template (
  id         int primary key default 1 check (id = 1),   -- une seule ligne
  subject    text not null default 'PLAN DE CHARGEMENT/ CCV / ANTONY / {date}',
  greeting   text not null default 'Bonjour,',
  intro      text not null default 'Plan de chargement CCV / Antony pour le {date_longue} :',
  signature  text not null default 'Cordialement',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);
insert into public.loading_plan_mail_template (id) values (1) on conflict (id) do nothing;

alter table public.loading_plan_mail_template enable row level security;
drop policy if exists "lpmt_select" on public.loading_plan_mail_template;
create policy "lpmt_select" on public.loading_plan_mail_template
  for select using (public.has_loading_plan_access());
drop policy if exists "lpmt_update" on public.loading_plan_mail_template;
create policy "lpmt_update" on public.loading_plan_mail_template
  for update using (public.has_loading_plan_access()) with check (public.has_loading_plan_access());
