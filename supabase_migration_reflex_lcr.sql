-- N° de réception REFLEX directement sur les colis « livraison contre reprise » issus de l'import PDF
-- À exécuter dans Supabase -> SQL Editor (APRÈS supabase_migration_reflex_reception.sql)
alter table public.parcels
  add column if not exists reflex_reception text,
  add column if not exists reflex_checked_at timestamptz,
  add column if not exists reflex_note text;
