-- ═══════════════════════════════════════════════════════════════
-- Migration : code postal de la première livraison de chaque tournée
-- À exécuter dans Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════
alter table public.tours
  add column if not exists code_postal_premiere_livraison text;

-- Si la vue tour_scan_summary doit aussi l'afficher, elle devra être recréée avec cette colonne
-- (non nécessaire pour l'appli actuelle : elle lit la colonne directement dans « tours »).
-- ═══════════════════════════════════════════════════════════════
