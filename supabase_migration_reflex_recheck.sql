-- Bouton « Revérifier dans REFLEX » (Colis non rapatriés) : remet à zéro la date du dernier contrôle des colis demandés,
-- le script du droplet les reprend en priorité au passage suivant (toutes les 5 min).
create or replace function public.request_reflex_recheck(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.has_tour_tracking_access() then raise exception 'Accès refusé'; end if;
  update public.return_labels set reflex_recv_checked_at = null
   where id = any (p_ids) and received_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.request_reflex_recheck(uuid[]) from public;
grant execute on function public.request_reflex_recheck(uuid[]) to authenticated;
