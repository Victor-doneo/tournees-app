-- Heure du premier scan (première action ASSIGNED / PREPARED du jour dans Urbantz), affichée dans « Suivi des tournées »
alter table public.tours add column if not exists urbantz_premier_scan timestamptz;
