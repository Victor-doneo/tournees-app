-- ═══════════════════════════════════════════════════════════════════════════════
-- Accès v2 : rôle « Transporteur » (carrier), rattachement par fournisseur, comptes inactifs bloqués,
-- modifications d'accès réservées aux administrateurs, journal des modifications.
-- Les partenaires s'appellent CCHEZVOUS dans l'interface (la valeur interne reste 'partner').
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) Rôle « carrier » : la colonne role est de type enum (user_role), la valeur doit être ajoutée AVANT, séparément :
--      alter type public.user_role add value if not exists 'carrier';
--    (à lancer seul, dans une exécution à part, puis lancer ce fichier)
alter table public.users add column if not exists suppliers text[] not null default '{}';

-- 2) Fonctions d'accès : un compte inactif n'a plus aucun accès
create or replace function public.my_active_role()
returns text language sql stable security definer set search_path = public as $$
  select case when active is distinct from false then role else null end from public.users where id = auth.uid()
$$;
create or replace function public.my_suppliers()
returns text[] language sql stable security definer set search_path = public as $$
  select case when role = 'carrier' and active is distinct from false then suppliers else '{}'::text[] end
  from public.users where id = auth.uid()
$$;
create or replace function public.has_tour_tracking_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active is distinct from false and (role = 'admin' or (role = 'partner' and can_view_tour_tracking))
                   from public.users where id = auth.uid()), false)
$$;
create or replace function public.has_loading_plan_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active is distinct from false and (role = 'admin' or (role = 'partner' and can_manage_loading_plan))
                   from public.users where id = auth.uid()), false)
$$;

-- 3) Seul un administrateur (ou le SQL Editor / la fonction serveur) modifie rôle, accès, fournisseurs, statut
create or replace function public.users_protect_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.current_user_role() is distinct from 'admin' and (
       new.role is distinct from old.role or new.active is distinct from old.active
    or new.suppliers is distinct from old.suppliers
    or new.can_view_tour_tracking is distinct from old.can_view_tour_tracking
    or new.can_manage_loading_plan is distinct from old.can_manage_loading_plan) then
    raise exception 'Seul un administrateur peut modifier les accès';
  end if;
  return new;
end $$;
drop trigger if exists users_protect_access on public.users;
create trigger users_protect_access before update on public.users for each row execute function public.users_protect_access();

-- 4) Journal des modifications d'accès
create table if not exists public.access_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_email text,
  user_id uuid,
  user_email text,
  change text not null
);
alter table public.access_audit enable row level security;
drop policy if exists "access_audit_admin_read" on public.access_audit;
create policy "access_audit_admin_read" on public.access_audit for select using (public.current_user_role() = 'admin');

create or replace function public.users_audit_access()
returns trigger language plpgsql security definer set search_path = public as $$
declare ch text[] := '{}'; actor_mail text;
begin
  if tg_op = 'INSERT' then
    ch := array['création (' || coalesce(new.role::text, '?') || ')'];
  else
    if new.role is distinct from old.role then ch := ch || ('rôle ' || old.role::text || ' → ' || new.role::text); end if;
    if new.active is distinct from old.active then ch := ch || (case when new.active then 'compte activé' else 'compte désactivé' end); end if;
    if new.suppliers is distinct from old.suppliers then ch := ch || ('fournisseurs : ' || coalesce(array_to_string(new.suppliers, ', '), '')); end if;
    if new.can_view_tour_tracking is distinct from old.can_view_tour_tracking then ch := ch || ('suivi des tournées : ' || case when new.can_view_tour_tracking then 'accordé' else 'retiré' end); end if;
    if new.can_manage_loading_plan is distinct from old.can_manage_loading_plan then ch := ch || ('plan de chargement : ' || case when new.can_manage_loading_plan then 'accordé' else 'retiré' end); end if;
  end if;
  if array_length(ch, 1) is null then return new; end if;
  select email into actor_mail from public.users where id = auth.uid();
  insert into public.access_audit (actor, actor_email, user_id, user_email, change)
    values (auth.uid(), actor_mail, new.id, new.email, array_to_string(ch, ' ; '));
  return new;
end $$;
drop trigger if exists users_audit_access on public.users;
create trigger users_audit_access after insert or update on public.users for each row execute function public.users_audit_access();

-- 5) Transporteur : lecture de SES données uniquement (rattachement par fournisseur de la tournée de référence)
do $$
begin
  if to_regclass('public.tours_references') is not null then
    drop policy if exists "tours_references_read_carrier" on public.tours_references;
    create policy "tours_references_read_carrier" on public.tours_references for select
      using (name_supplier = any (public.my_suppliers()));
  end if;
  if to_regclass('public.delivery_dates') is not null then
    drop policy if exists "delivery_dates_read_carrier" on public.delivery_dates;
    create policy "delivery_dates_read_carrier" on public.delivery_dates for select
      using (coalesce(array_length(public.my_suppliers(), 1), 0) > 0);
  end if;
  if to_regclass('public.tours') is not null then
    drop policy if exists "tours_read_carrier" on public.tours;
    create policy "tours_read_carrier" on public.tours for select
      using (exists (select 1 from public.tours_references r where r.id = tours.reference_id and r.name_supplier = any (public.my_suppliers())));
  end if;
  if to_regclass('public.return_labels') is not null then
    drop policy if exists "rl_read_carrier" on public.return_labels;
    create policy "rl_read_carrier" on public.return_labels for select
      using (exists (select 1 from public.tours_references r where r.name = return_labels.tour_code and r.name_supplier = any (public.my_suppliers())));
  end if;
  if to_regclass('public.delivery_ratings') is not null then
    drop policy if exists "dr_read_carrier" on public.delivery_ratings;
    create policy "dr_read_carrier" on public.delivery_ratings for select
      using (exists (select 1 from public.tours_references r where r.name = delivery_ratings.tour_code and r.name_supplier = any (public.my_suppliers())));
  end if;
end $$;
