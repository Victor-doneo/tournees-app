-- N° de réception REFLEX pour les livraisons contre reprise (colis « 7 + BP »)
alter table public.return_labels
  add column if not exists reflex_reception text,
  add column if not exists reflex_checked_at timestamptz,
  add column if not exists reflex_note text;
