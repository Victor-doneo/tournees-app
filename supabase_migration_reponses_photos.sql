-- ═══════════════════════════════════════════════════════════════
-- Migration : photos dans les réponses aux demandes
-- À exécuter dans Supabase → SQL Editor
-- (à lancer APRÈS supabase_migration_demandes_photos.sql, qui crée le bucket)
-- ═══════════════════════════════════════════════════════════════

-- Chemins des photos jointes à une réponse (même bucket privé que les demandes)
alter table public.demande_reponses
  add column if not exists photos text[] not null default '{}';

-- Aucune nouvelle policy de stockage n'est nécessaire : les photos des réponses
-- sont rangées dans le même bucket 'demandes-photos' (dossier <id_demande>/reponses/),
-- donc les droits déjà créés (lecture : comptes connectés, envoi : admin + partenaire) s'appliquent.

-- ═══════════════════════════════════════════════════════════════
