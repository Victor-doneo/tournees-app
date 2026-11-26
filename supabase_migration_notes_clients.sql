-- Notes de l'enquête de satisfaction client (Urbantz : metadata.EnqueteGlobale / EnqueteCommentaire), une ligne par tâche
create table if not exists public.delivery_ratings (
  task_id text primary key,
  task_date date not null,
  tour_code text,
  task_ref text,
  score numeric not null,
  comment text,
  updated_at timestamptz not null default now()
);
create index if not exists delivery_ratings_date_idx on public.delivery_ratings (task_date);
alter table public.delivery_ratings enable row level security;
drop policy if exists "dr_read" on public.delivery_ratings;
create policy "dr_read" on public.delivery_ratings for select using (public.has_tour_tracking_access());

-- Codes-barres (BP) de la tâche, pour retrouver les colis d'une mauvaise note
alter table public.delivery_ratings add column if not exists barcodes text[];

-- Demande « NPS » créée pour les avis de 1 ou 2 étoiles (une seule par tâche)
alter table public.delivery_ratings add column if not exists demande_id uuid;
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.demandes'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%securisation%'
      and pg_get_constraintdef(oid) not ilike '%array_length%'
  loop
    execute format('alter table public.demandes drop constraint %I', c.conname);
  end loop;
  alter table public.demandes add constraint demandes_type_check
    check (type in ('securisation','ajout_non_planifie','ajout_non_planifie_retour','recherche_colis','reception_reflex','nps','autre'));
end $$;
-- Si le type est un enum, lancer seul : alter type demande_type add value if not exists 'nps';
