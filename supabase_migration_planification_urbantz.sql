-- ═══════════════════════════════════════════════════════════════
-- Planification fiable (Supabase pg_cron) des extractions Urbantz.
-- GitHub retarde ou saute ses tâches planifiées : c'est Supabase qui appelle la fonction toutes les 30 min.
-- À faire AVANT : déployer la fonction trigger-urbantz-returns (Verify JWT désactivé) et créer les secrets
--   GITHUB_DISPATCH_TOKEN (jeton GitHub, Actions : Read and write) et CRON_SECRET (une longue chaîne aléatoire de ton choix).
-- Remplacer ci-dessous  <REF>  (référence du projet, ex. abcd1234) et  <CRON_SECRET>  (la même valeur que le secret).
-- Les heures de pg_cron sont en UTC ; les scripts ne travaillent que dans leurs plages (heure de Paris) et ignorent ce qui est déjà fait.
-- ═══════════════════════════════════════════════════════════════
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('urbantz-heures-plan', 'urbantz-colis-retour');

-- Heures d'arrivée du plan de chargement : toutes les 30 min, 10h-13h Paris, lundi-samedi
select cron.schedule('urbantz-heures-plan', '10,40 8-11 * * 1-6', $$
  select net.http_post(
    url := 'https://<REF>.supabase.co/functions/v1/trigger-urbantz-returns',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body := '{"workflow":"import","auto":true}'::jsonb);
$$);

-- Colis à retourner : toutes les 30 min, 11h30-15h30 Paris, lundi-samedi
select cron.schedule('urbantz-colis-retour', '0,30 9-14 * * 1-6', $$
  select net.http_post(
    url := 'https://<REF>.supabase.co/functions/v1/trigger-urbantz-returns',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body := '{"workflow":"returns","auto":true}'::jsonb);
$$);

-- Vérifier : select jobname, schedule, active from cron.job;
-- Historique : select * from cron.job_run_details order by start_time desc limit 10;
