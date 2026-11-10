-- ═══════════════════════════════════════════════════════════════
-- Migration : page « Défaillances »
-- À exécuter dans Supabase → SQL Editor
-- (à lancer APRÈS supabase_migration_demandes_photos.sql : il crée le bucket
--  'demandes-photos' et la fonction public.current_user_role())
-- ═══════════════════════════════════════════════════════════════

-- 1) Défaillances
create table if not exists public.defaillances (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('litige', 'autre')),
  processus     text,
  bp            text[] not null default '{}',
  zone_id       bigint,          -- zone du plan entrepôt (sans clé étrangère : le plan peut être redessiné)
  zone_label    text,            -- libellé mémorisé (#N — tournée) au moment du signalement
  commentaire   text,
  photos        text[] not null default '{}',
  status        text not null default 'ouverte'
                check (status in ('ouverte', 'resolue', 'annulee', 'cloturee')),
  created_by    uuid references public.users(id),
  resolved_by   uuid references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  -- Litige : au moins un BP obligatoire
  constraint defaillances_litige_bp check (type <> 'litige' or coalesce(array_length(bp, 1), 0) > 0),
  -- Autre : processus obligatoire
  constraint defaillances_autre_processus check (type <> 'autre' or processus is not null)
);

-- 2) Réponses
create table if not exists public.defaillance_reponses (
  id             uuid primary key default gen_random_uuid(),
  defaillance_id uuid not null references public.defaillances(id) on delete cascade,
  author_id      uuid references public.users(id),
  message        text not null default '',
  photos         text[] not null default '{}',
  created_at     timestamptz not null default now()
);

create index if not exists defaillances_bp_idx on public.defaillances using gin (bp);
create index if not exists defaillances_status_idx on public.defaillances (status);
create index if not exists defaillances_created_idx on public.defaillances (created_at desc);
create index if not exists defaillance_reponses_def_idx on public.defaillance_reponses (defaillance_id);

-- 3) updated_at automatique
create or replace function public.defaillances_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists defaillances_updated_at on public.defaillances;
create trigger defaillances_updated_at
  before update on public.defaillances
  for each row execute function public.defaillances_set_updated_at();

-- 4) Droits (RLS) : lecture pour tout compte connecté, écriture admin + partenaire
alter table public.defaillances enable row level security;
alter table public.defaillance_reponses enable row level security;

drop policy if exists "defaillances_select" on public.defaillances;
create policy "defaillances_select" on public.defaillances
  for select using (auth.role() = 'authenticated');

drop policy if exists "defaillances_insert" on public.defaillances;
create policy "defaillances_insert" on public.defaillances
  for insert with check (public.current_user_role() in ('admin', 'partner'));

drop policy if exists "defaillances_update" on public.defaillances;
create policy "defaillances_update" on public.defaillances
  for update using (public.current_user_role() in ('admin', 'partner'))
  with check (public.current_user_role() in ('admin', 'partner'));

drop policy if exists "defaillance_reponses_select" on public.defaillance_reponses;
create policy "defaillance_reponses_select" on public.defaillance_reponses
  for select using (auth.role() = 'authenticated');

drop policy if exists "defaillance_reponses_insert" on public.defaillance_reponses;
create policy "defaillance_reponses_insert" on public.defaillance_reponses
  for insert with check (public.current_user_role() in ('admin', 'partner'));

-- 5) Lecture du plan de l'entrepôt par tous les comptes connectés
--    (nécessaire pour que le partenaire puisse choisir une zone sur le plan).
--    Ces policies s'AJOUTENT à celles qui existent déjà ; elles ne donnent que la lecture.
do $$
begin
  if to_regclass('public.warehouse_zones') is not null then
    drop policy if exists "warehouse_zones_read_authenticated" on public.warehouse_zones;
    create policy "warehouse_zones_read_authenticated" on public.warehouse_zones
      for select using (auth.role() = 'authenticated');
  end if;
  if to_regclass('public.zone_assignments') is not null then
    drop policy if exists "zone_assignments_read_authenticated" on public.zone_assignments;
    create policy "zone_assignments_read_authenticated" on public.zone_assignments
      for select using (auth.role() = 'authenticated');
  end if;
  if to_regclass('public.warehouse_settings') is not null then
    drop policy if exists "warehouse_settings_read_authenticated" on public.warehouse_settings;
    create policy "warehouse_settings_read_authenticated" on public.warehouse_settings
      for select using (auth.role() = 'authenticated');
  end if;
  if to_regclass('public.tours_references') is not null then
    drop policy if exists "tours_references_read_authenticated" on public.tours_references;
    create policy "tours_references_read_authenticated" on public.tours_references
      for select using (auth.role() = 'authenticated');
  end if;
end $$;

-- Les photos (dossier defaillances/<id>/…) vont dans le bucket privé 'demandes-photos' :
-- les droits de stockage déjà créés (lecture : connectés, envoi : admin + partenaire) s'appliquent.

-- ═══════════════════════════════════════════════════════════════
