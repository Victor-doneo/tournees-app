-- Enregistrement des créneaux de chargement par admin ou partenaire « plan de chargement »
-- (un partenaire n'a que la lecture sur tours : un UPDATE direct était silencieusement ignoré par la RLS)
create or replace function public.save_loading_slots(slots jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.has_loading_plan_access() then
    raise exception 'Accès au plan de chargement requis';
  end if;
  update public.tours t set loading_slot = (s.value ->> 'slot')::time
  from jsonb_array_elements(slots) s
  where t.id::text = s.value ->> 'id';
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.save_loading_slots(jsonb) to authenticated;
