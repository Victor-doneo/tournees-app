-- Accusé de réception des colis à retourner
alter table public.return_labels
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references public.users(id);
