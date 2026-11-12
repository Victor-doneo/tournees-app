-- ═══════════════════════════════════════════════════════════════
-- Migration : SUIVI DES TOURNÉES en lecture seule pour certains partenaires
-- À exécuter dans Supabase → SQL Editor (après supabase_migration_colis_retour.sql)
-- ═══════════════════════════════════════════════════════════════
alter table public.users add column if not exists can_view_tour_tracking boolean not null default false;

create or replace function public.has_tour_tracking_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' or (role = 'partner' and can_view_tour_tracking)
                   from public.users where id = auth.uid()), false)
$$;

-- Seul un admin peut modifier ce drapeau
create or replace function public.users_protect_tracking_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.can_view_tour_tracking is distinct from old.can_view_tour_tracking
     and public.current_user_role() <> 'admin' then
    raise exception 'Seul un administrateur peut modifier cet accès';
  end if;
  return new;
end $$;
drop trigger if exists users_protect_tracking_flag on public.users;
create trigger users_protect_tracking_flag before update on public.users
  for each row execute function public.users_protect_tracking_flag();

-- Lecture seule (ces policies s'ajoutent à celles qui existent)
do $$
begin
  if to_regclass('public.delivery_dates') is not null then
    drop policy if exists "delivery_dates_read_tracking" on public.delivery_dates;
    create policy "delivery_dates_read_tracking" on public.delivery_dates for select using (public.has_tour_tracking_access());
  end if;
  if to_regclass('public.tours') is not null then
    drop policy if exists "tours_read_tracking" on public.tours;
    create policy "tours_read_tracking" on public.tours for select using (public.has_tour_tracking_access());
  end if;
  if to_regclass('public.tours_references') is not null then
    drop policy if exists "tours_references_read_tracking" on public.tours_references;
    create policy "tours_references_read_tracking" on public.tours_references for select using (public.has_tour_tracking_access());
  end if;
  if to_regclass('public.return_labels') is not null then
    drop policy if exists "rl_read_tracking" on public.return_labels;
    create policy "rl_read_tracking" on public.return_labels for select using (public.has_tour_tracking_access());
  end if;
end $$;
