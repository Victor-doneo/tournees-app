-- ═══════════════════════════════════════════════════════════════
-- Migration : accès au PLAN DE CHARGEMENT pour certains comptes partenaires
-- À exécuter dans Supabase → SQL Editor (APRÈS supabase_migration_plan_destinataires.sql)
-- ═══════════════════════════════════════════════════════════════

-- 1) Drapeau par compte (activé par un admin dans la page Utilisateurs)
alter table public.users add column if not exists can_manage_loading_plan boolean not null default false;

-- 2) Droit « plan de chargement » = admin, ou partenaire avec le drapeau
create or replace function public.has_loading_plan_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' or (role = 'partner' and can_manage_loading_plan)
                   from public.users where id = auth.uid()), false)
$$;

-- 3) Seul un admin peut modifier ce drapeau (un partenaire ne peut pas se l'accorder lui-même)
create or replace function public.users_protect_loading_plan_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.can_manage_loading_plan is distinct from old.can_manage_loading_plan
     and public.current_user_role() <> 'admin' then
    raise exception 'Seul un administrateur peut modifier cet accès';
  end if;
  return new;
end $$;
drop trigger if exists users_protect_loading_plan_flag on public.users;
create trigger users_protect_loading_plan_flag before update on public.users
  for each row execute function public.users_protect_loading_plan_flag();

-- 4) Destinataires et historique d'envoi : admin + partenaires autorisés
drop policy if exists "lpr_admin_all" on public.loading_plan_recipients;
drop policy if exists "lpr_access_all" on public.loading_plan_recipients;
create policy "lpr_access_all" on public.loading_plan_recipients
  for all using (public.has_loading_plan_access()) with check (public.has_loading_plan_access());

drop policy if exists "lps_admin_select" on public.loading_plan_sends;
drop policy if exists "lps_access_select" on public.loading_plan_sends;
create policy "lps_access_select" on public.loading_plan_sends
  for select using (public.has_loading_plan_access());

-- 5) Lecture des données nécessaires au plan (ces policies s'AJOUTENT à celles qui existent ; lecture seule)
do $$
begin
  if to_regclass('public.delivery_dates') is not null then
    drop policy if exists "delivery_dates_read_loading_plan" on public.delivery_dates;
    create policy "delivery_dates_read_loading_plan" on public.delivery_dates
      for select using (public.has_loading_plan_access());
  end if;
  if to_regclass('public.tours') is not null then
    drop policy if exists "tours_read_loading_plan" on public.tours;
    create policy "tours_read_loading_plan" on public.tours
      for select using (public.has_loading_plan_access());
  end if;
  if to_regclass('public.tours_references') is not null then
    drop policy if exists "tours_references_read_loading_plan" on public.tours_references;
    create policy "tours_references_read_loading_plan" on public.tours_references
      for select using (public.has_loading_plan_access());
  end if;
end $$;
