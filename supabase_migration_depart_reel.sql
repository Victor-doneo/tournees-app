-- Heure de départ réelle du dépôt (journal Urbantz), affichée dans « Suivi des tournées »
alter table public.tours add column if not exists urbantz_depart_reel timestamptz;
