-- ═══════════════════════════════════════════════════════════════
-- Migration : notifications sur les réponses aux demandes
-- À exécuter dans Supabase → SQL Editor
--
-- Qui est notifié ?
--   • une réponse est ajoutée à une demande  → le créateur de la demande
--     + toutes les personnes ayant déjà répondu (sauf l'auteur de la réponse)
--     + tous les admins si l'auteur de la réponse est un partenaire
--   • le statut d'une demande change (réalisée, annulée, clôturée, rouverte)
--     → le créateur + les personnes ayant répondu (sauf celui qui a changé le statut)
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.demande_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  demande_id  uuid not null references public.demandes(id) on delete cascade,
  kind        text not null default 'reponse',      -- 'reponse' | 'statut'
  actor_id    uuid,                                  -- qui a répondu / changé le statut
  message     text,                                  -- extrait de la réponse ou nouveau statut
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists demande_notifications_user_unread_idx
  on public.demande_notifications (user_id) where read_at is null;
create index if not exists demande_notifications_demande_idx
  on public.demande_notifications (demande_id);

alter table public.demande_notifications enable row level security;

-- Chacun ne voit / ne met à jour (marquer comme lu) que ses propres notifications.
drop policy if exists "demande_notif_select" on public.demande_notifications;
create policy "demande_notif_select" on public.demande_notifications
  for select using (user_id = auth.uid());

drop policy if exists "demande_notif_update" on public.demande_notifications;
create policy "demande_notif_update" on public.demande_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Aucune policy d'insertion : seuls les déclencheurs ci-dessous (security definer) écrivent.

-- ── Réponse ajoutée à une demande ───────────────────────────────
create or replace function public.notify_demande_reponse()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author_role text;
begin
  select role into v_author_role from public.users where id = new.author_id;

  insert into public.demande_notifications (user_id, demande_id, kind, actor_id, message)
  select r.user_id, new.demande_id, 'reponse', new.author_id,
         left(coalesce(nullif(trim(new.message), ''), 'Photo(s) jointe(s)'), 200)
  from (
    select d.created_by as user_id from public.demandes d where d.id = new.demande_id
    union
    select dr.author_id from public.demande_reponses dr where dr.demande_id = new.demande_id
    union
    select u.id from public.users u where v_author_role = 'partner' and u.role = 'admin'
  ) r
  where r.user_id is not null
    and r.user_id <> new.author_id;

  return new;
end $$;

drop trigger if exists trg_notify_demande_reponse on public.demande_reponses;
create trigger trg_notify_demande_reponse
  after insert on public.demande_reponses
  for each row execute function public.notify_demande_reponse();

-- ── Changement de statut d'une demande ──────────────────────────
create or replace function public.notify_demande_statut()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.demande_notifications (user_id, demande_id, kind, actor_id, message)
    select r.user_id, new.id, 'statut', auth.uid(), new.status
    from (
      select new.created_by as user_id
      union
      select dr.author_id from public.demande_reponses dr where dr.demande_id = new.id
    ) r
    where r.user_id is not null
      and r.user_id is distinct from auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_demande_statut on public.demandes;
create trigger trg_notify_demande_statut
  after update of status on public.demandes
  for each row execute function public.notify_demande_statut();

-- ── Nouvelle demande : prévient tous les admins (sauf le créateur) ──
create or replace function public.notify_demande_creation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.demande_notifications (user_id, demande_id, kind, actor_id, message)
  select u.id, new.id, 'nouvelle', new.created_by,
         left(coalesce(nullif(trim(new.commentaire), ''), 'Nouvelle demande'), 200)
  from public.users u
  where u.role = 'admin'
    and u.id is distinct from new.created_by;
  return new;
end $$;

drop trigger if exists trg_notify_demande_creation on public.demandes;
create trigger trg_notify_demande_creation
  after insert on public.demandes
  for each row execute function public.notify_demande_creation();

-- ═══════════════════════════════════════════════════════════════
