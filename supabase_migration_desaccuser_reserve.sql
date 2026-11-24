-- Seul maxime@doneo.co peut annuler un accusé de réception (received_at non nul -> nul) depuis l'application.
-- Les scripts (clé service) et l'éditeur SQL ne sont pas concernés (auth.uid() est nul).
create or replace function public.guard_unreceive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.received_at is not null and new.received_at is null and auth.uid() is not null then
    if coalesce((select lower(email) from public.users where id = auth.uid()), '') <> 'maxime@doneo.co' then
      raise exception 'Seul maxime@doneo.co peut annuler un accusé de réception';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_unreceive on public.return_labels;
create trigger trg_guard_unreceive
  before update of received_at on public.return_labels
  for each row execute function public.guard_unreceive();

-- Même règle pour le retour d'une tournée (heure_retour non nulle -> nulle)
create or replace function public.guard_unconfirm_tour()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.heure_retour is not null and new.heure_retour is null and auth.uid() is not null then
    if coalesce((select lower(email) from public.users where id = auth.uid()), '') <> 'maxime@doneo.co' then
      raise exception 'Seul maxime@doneo.co peut annuler le retour d''une tournée';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_unconfirm_tour on public.tours;
create trigger trg_guard_unconfirm_tour
  before update of heure_retour on public.tours
  for each row execute function public.guard_unconfirm_tour();
