-- ═══════════════════════════════════════════════════════════════
-- Migration : adresses de contact par société de transport
-- À exécuter dans Supabase → SQL Editor (après avoir ajouté tours_references.name_supplier)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.supplier_contacts (
  id         uuid primary key default gen_random_uuid(),
  supplier   text not null,            -- même valeur que tours_references.name_supplier
  email      text not null,
  full_name  text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (supplier, email)
);
create index if not exists supplier_contacts_supplier_idx on public.supplier_contacts (supplier);

alter table public.supplier_contacts enable row level security;
drop policy if exists "sc_admin_all" on public.supplier_contacts;
create policy "sc_admin_all" on public.supplier_contacts
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
-- (lecture par les fonctions Edge avec la clé service)

insert into public.supplier_contacts (supplier, email, full_name) values
  ('ADEMO',                    'ademotransport@gmail.com',    'ADEMO'),
  ('TKN TRANSPORT',            'yjdaini@transkn.fr',          'Youssef JDAINI'),
  ('TKN TRANSPORT',            'ybouterfas@transkn.fr',       'ybouterfas'),
  ('TRANSPORT DU GRAND PARIS', 'ltdgp93@outlook.com',         'chedli oughanem'),
  ('MNS TRANSPORT',            'mnslogistic93@gmail.com',     'mnslogistic93'),
  ('SOLUTRANS',                'solutrans.express94@gmail.com','Solutrans Express')
on conflict (supplier, email) do nothing;

-- À compléter : sociétés de YOUSSEF TAYEB (yousseftayeb202@gmail.com) et Kamel Zribi (kamelzribi83@gmail.com)
-- insert into public.supplier_contacts (supplier, email, full_name) values
--   ('<SOCIETE>', 'yousseftayeb202@gmail.com', 'YOUSSEF TAYEB'),
--   ('<SOCIETE>', 'kamelzribi83@gmail.com', 'Kamel Zribi');
