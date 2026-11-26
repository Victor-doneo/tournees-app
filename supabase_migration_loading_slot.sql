-- Créneau de chargement de la tournée (issu du plan de chargement envoyé), affiché dans « Suivi des tournées »
alter table public.tours add column if not exists loading_slot time;
