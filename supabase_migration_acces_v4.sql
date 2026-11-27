-- Accès v4 : double authentification exigée COMPTE PAR COMPTE (choisie par l'administrateur). À lancer après la v3.
alter table public.users add column if not exists mfa_required boolean not null default false;

create or replace function public.users_protect_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.current_user_role()::text is distinct from 'admin' and (
       new.role is distinct from old.role or new.active is distinct from old.active
    or new.suppliers is distinct from old.suppliers
    or new.can_view_tour_tracking is distinct from old.can_view_tour_tracking
    or new.can_manage_loading_plan is distinct from old.can_manage_loading_plan
    or new.can_manage_carriers is distinct from old.can_manage_carriers
    or new.mfa_required is distinct from old.mfa_required) then
    raise exception 'Seul un administrateur peut modifier les accès';
  end if;
  return new;
end $$;

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
    if new.can_manage_carriers is distinct from old.can_manage_carriers then ch := ch || ('gestion des comptes transporteurs : ' || case when new.can_manage_carriers then 'accordée' else 'retirée' end); end if;
    if new.mfa_required is distinct from old.mfa_required then ch := ch || ('double authentification : ' || case when new.mfa_required then 'exigée' else 'non exigée' end); end if;
  end if;
  if array_length(ch, 1) is null then return new; end if;
  select email into actor_mail from public.users where id = auth.uid();
  insert into public.access_audit (actor, actor_email, user_id, user_email, change)
    values (auth.uid(), actor_mail, new.id, new.email, array_to_string(ch, ' ; '));
  return new;
end $$;

-- Vrai si le compte n'exige pas la double authentification, ou si la session est déjà validée par le code (aal2)
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not coalesce(mfa_required, false) from public.users where id = auth.uid()), true)
         or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
