-- ═══════════════════════════════════════════════════════════════
-- Migration : heures prévisionnelles Urbantz sur les tournées (référence du plan de chargement)
-- À exécuter dans Supabase → SQL Editor (APRÈS supabase_migration_plan_acces_partenaires.sql)
-- ═══════════════════════════════════════════════════════════════
alter table public.tours add column if not exists urbantz_first_arrival time;   -- 1re arrivée prévue chez le client
alter table public.tours add column if not exists urbantz_hub_depart   time;   -- départ prévu de l'entrepôt

-- Mise à jour réservée au plan de chargement : n'écrit que ces deux colonnes, pour les tournées de la journée donnée
-- p_rows : [{ "id": "<uuid de la tournée>", "first": "06:23", "hub": "05:52" }, ...]
create or replace function public.set_urbantz_times(p_date date, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if not public.has_loading_plan_access() then
    raise exception 'Accès non autorisé';
  end if;
  update public.tours t
     set urbantz_first_arrival = nullif(r.first, '')::time,
         urbantz_hub_depart    = nullif(r.hub, '')::time
    from jsonb_to_recordset(p_rows) as r(id text, first text, hub text),
         public.delivery_dates d
   where t.id::text = r.id and d.id = t.delivery_date_id and d.delivery_date = p_date;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.set_urbantz_times(date, jsonb) to authenticated;
