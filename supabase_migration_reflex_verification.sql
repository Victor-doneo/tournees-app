-- Vérification dans REFLEX des colis dont la réception est accusée dans Superflash + demandes « Réception REFLEX à réaliser »
-- À exécuter dans Supabase → SQL Editor
alter table public.return_labels
  add column if not exists reflex_recv_status text,            -- receptionne | manquant | introuvable
  add column if not exists reflex_recv_checked_at timestamptz,
  add column if not exists reflex_recv_line text,              -- date de la ligne REFLEX retenue (la plus récente)
  add column if not exists reflex_demande_id uuid,             -- demande « Réception REFLEX » créée (une seule par colis)
  add column if not exists overdue_demande_id uuid;            -- demande « Vérifier que le colis n'est pas revenu » (retour attendu > 3 jours)

-- Nouveau type de demande
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
    execute $q$alter table public.demandes add constraint demandes_type_check
      check (type in ('securisation','ajout_non_planifie','ajout_non_planifie_retour','recherche_colis','reception_reflex','autre'))$q$;
  end loop;
end $$;
-- Si le type est un enum, lancer seul : alter type demande_type add value if not exists 'reception_reflex';
