-- Plan de chargement : mémorise créneau ET quai de chaque tournée (le plan enregistré est réaffiché tel quel),
-- et permet l'enregistrement à l'admin comme au partenaire « plan de chargement » (un partenaire n'a que la lecture sur tours).
alter table public.tours add column if not exists loading_slot time;
alter table public.tours add column if not exists loading_quai integer;

create or replace function public.save_loading_slots(slots jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.has_loading_plan_access() then
    raise exception 'Accès au plan de chargement requis';
  end if;
  update public.tours t set loading_slot = (s.value ->> 'slot')::time, loading_quai = nullif(s.value ->> 'quai', '')::integer
  from jsonb_array_elements(slots) s
  where t.id::text = s.value ->> 'id';
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.save_loading_slots(jsonb) to authenticated;
