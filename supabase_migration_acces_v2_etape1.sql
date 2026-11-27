-- Étape 1 : à lancer SEUL, puis lancer supabase_migration_acces_v2.sql dans une exécution séparée
alter type public.user_role add value if not exists 'carrier';
