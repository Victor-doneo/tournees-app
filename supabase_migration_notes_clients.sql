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
