-- Groupages (mail quotidien « Préparation du jour ») : n° de groupage, transporteur, date de chargement,
-- + saisie admin : heure de présentation du camion, fin de déchargement, photo de la CMR.
create table if not exists public.groupages (
  id uuid primary key default gen_random_uuid(),
  groupage text not null,
  date_chargement date not null,
  transporteur text,
  poids numeric,
  heure_presentation time,
  fin_dechargement time,
  cmr_photo_path text,
  source text not null default 'mail',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- numéro de réception = groupage + JJMM de la date de chargement
  numero_reception text generated always as (groupage || lpad(extract(day from date_chargement)::int::text, 2, '0') || lpad(extract(month from date_chargement)::int::text, 2, '0')) stored,
  unique (groupage, date_chargement)
);
create index if not exists groupages_date_idx on public.groupages (date_chargement);

alter table public.groupages enable row level security;
drop policy if exists groupages_admin on public.groupages;
create policy groupages_admin on public.groupages for all to authenticated
  using (public.my_active_role() = 'admin') with check (public.my_active_role() = 'admin');

-- Photos des CMR (bucket privé, accès administrateur)
insert into storage.buckets (id, name, public) values ('cmr-photos', 'cmr-photos', false) on conflict (id) do nothing;
drop policy if exists cmr_photos_admin on storage.objects;
create policy cmr_photos_admin on storage.objects for all to authenticated
  using (bucket_id = 'cmr-photos' and public.my_active_role() = 'admin')
  with check (bucket_id = 'cmr-photos' and public.my_active_role() = 'admin');
