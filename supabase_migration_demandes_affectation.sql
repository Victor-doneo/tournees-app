-- Affectation des demandes : 'doneo' (interne, bleu) ou 'partenaire' (rose)
alter table public.demandes add column if not exists assigned_to text not null default 'doneo';
alter table public.demandes drop constraint if exists demandes_assigned_to_check;
alter table public.demandes add constraint demandes_assigned_to_check check (assigned_to in ('doneo', 'partenaire'));
