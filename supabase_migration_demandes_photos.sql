-- ═══════════════════════════════════════════════════════════════
-- Migration : photos sur les demandes
-- À exécuter dans Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1) Colonne contenant les chemins des photos dans le stockage
alter table public.demandes
  add column if not exists photos text[] not null default '{}';

-- 2) Bucket de stockage PRIVÉ (les photos s'affichent via des liens temporaires)
insert into storage.buckets (id, name, public)
values ('demandes-photos', 'demandes-photos', false)
on conflict (id) do nothing;

-- 3) Droits d'accès au bucket
--    - lecture : tout compte connecté
--    - envoi   : admin et partenaire (comme la création de demande)
drop policy if exists "demandes_photos_select" on storage.objects;
create policy "demandes_photos_select" on storage.objects
  for select using (bucket_id = 'demandes-photos' and auth.role() = 'authenticated');

drop policy if exists "demandes_photos_insert" on storage.objects;
create policy "demandes_photos_insert" on storage.objects
  for insert with check (
    bucket_id = 'demandes-photos'
    and public.current_user_role() in ('admin', 'partner')
  );

-- ═══════════════════════════════════════════════════════════════
