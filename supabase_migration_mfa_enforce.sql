-- OPTIONNEL — verrou base de données de la double authentification : un compte « 2FA exigée » ne lit/écrit RIEN tant que sa session
-- n'a pas validé le code (même en contournant l'écran de l'application). À lancer APRÈS supabase_migration_acces_v4.sql,
-- une fois testé qu'un compte « 2FA exigée » peut se connecter normalement. Sans effet pour les autres comptes.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists mfa_gate on public.%I', t.relname);
    if t.relname = 'users' then -- sa propre fiche reste lisible pour afficher l'écran d'activation
      execute format('create policy mfa_gate on public.%I as restrictive for all to authenticated using (public.mfa_ok() or id = auth.uid()) with check (public.mfa_ok())', t.relname);
    else
      execute format('create policy mfa_gate on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t.relname);
    end if;
  end loop;
end $$;
