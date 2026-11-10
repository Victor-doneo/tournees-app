-- Migration : nouveau type de demande « Ajout non planifié en retour »
-- À exécuter dans Supabase → SQL Editor
do $$
declare c record; has_enum boolean;
begin
  -- Cas 1 : le type est contraint par un CHECK -> on le remplace
  for c in
    select conname from pg_constraint
    where conrelid = 'public.demandes'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%securisation%'
      and pg_get_constraintdef(oid) not ilike '%array_length%'
  loop
    execute format('alter table public.demandes drop constraint %I', c.conname);
    execute $q$alter table public.demandes add constraint demandes_type_check
      check (type in ('securisation','ajout_non_planifie','ajout_non_planifie_retour','recherche_colis','autre'))$q$;
  end loop;
end $$;

-- Cas 2 : si le type est un enum, décommentez et lancez seul :
-- alter type demande_type add value if not exists 'ajout_non_planifie_retour';
