-- ═══════════════════════════════════════════════════════════════
-- Migration : checklist de fin de journée (avant validation du contrôle)
-- À exécuter dans Supabase → SQL Editor
-- (nécessite la fonction public.current_user_role(), créée avec les demandes)
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.checklist_checks (
  delivery_date date not null,
  item_key      text not null,
  checked_by    uuid references public.users(id),
  checked_at    timestamptz not null default now(),
  primary key (delivery_date, item_key)
);

alter table public.checklist_checks enable row level security;

drop policy if exists "checklist_select" on public.checklist_checks;
create policy "checklist_select" on public.checklist_checks
  for select using (public.current_user_role() = 'admin');

drop policy if exists "checklist_insert" on public.checklist_checks;
create policy "checklist_insert" on public.checklist_checks
  for insert with check (public.current_user_role() = 'admin');

drop policy if exists "checklist_delete" on public.checklist_checks;
create policy "checklist_delete" on public.checklist_checks
  for delete using (public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════
