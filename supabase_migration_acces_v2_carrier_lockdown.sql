-- ═══════════════════════════════════════════════════════════════════════════════
-- Verrou « Transporteur » : un compte transporteur ne voit QUE les données de ses fournisseurs.
-- Les politiques d'accès existantes sont permissives (elles s'additionnent : un « lecture pour tout compte connecté » existant
-- laissait voir toutes les données). On ajoute donc des politiques RESTRICTIVES, qui s'appliquent en plus, quelles que soient les autres.
-- À lancer APRÈS supabase_migration_acces_v2.sql. Sans effet pour les autres rôles.
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.my_active_role()
returns text language sql stable security definer set search_path = public as $$
  select case when active is distinct from false then role::text else null end from public.users where id = auth.uid()
$$;

do $$
declare t record; cond text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    -- écritures : jamais pour un transporteur
    execute format('drop policy if exists carrier_block_write on public.%I', t.relname);
    execute format('create policy carrier_block_write on public.%I as restrictive for all to authenticated using (true) with check ((select public.my_active_role()) is distinct from %L)', t.relname, 'carrier');
    -- lecture : bloquée, sauf tables autorisées filtrées par fournisseur
    cond := case t.relname
      when 'tours' then 'exists (select 1 from public.tours_references r where r.id = tours.reference_id and r.name_supplier = any (public.my_suppliers()))'
      when 'tours_references' then 'name_supplier = any (public.my_suppliers())'
      when 'delivery_dates' then 'coalesce(array_length(public.my_suppliers(), 1), 0) > 0'
      when 'return_labels' then 'exists (select 1 from public.tours_references r where r.name = return_labels.tour_code and r.name_supplier = any (public.my_suppliers()))'
      when 'delivery_ratings' then 'exists (select 1 from public.tours_references r where r.name = delivery_ratings.tour_code and r.name_supplier = any (public.my_suppliers()))'
      when 'users' then 'id = auth.uid()'
      else 'false' end;
    execute format('drop policy if exists carrier_block_read on public.%I', t.relname);
    execute format('create policy carrier_block_read on public.%I as restrictive for select to authenticated using ((select public.my_active_role()) is distinct from %L or (%s))', t.relname, 'carrier', cond);
  end loop;
end $$;
