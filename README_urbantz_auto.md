# Import automatique des heures Urbantz à 8h

1. **Clé API Urbantz** : Urbantz → Administration → Plateforme → Général → copier la « API key ».
2. **Secret Supabase** : Edge Functions → Secrets → ajouter `URBANTZ_API_KEY` (la clé). Ne la partagez pas dans une conversation.
3. **Déployer** la fonction `import-urbantz-times` (Edge Functions → Via Editor, coller `supabase/functions/import-urbantz-times/index.ts`).
4. **Essai à blanc** : appeler la fonction avec `{ "dry_run": true, "date": "2026-11-12" }` (Edge Functions → la fonction → Test). La réponse indique combien de tournées Urbantz et de tournées de l'application correspondent, et les noms de champs reçus (`sample_keys`). Si `matched` vaut 0, envoyer cette réponse pour ajuster la fonction.
5. **Planification** : Integrations → Cron → Create job → type « Supabase Edge Function » → `import-urbantz-times`, deux horaires `0 6 * * *` et `0 7 * * *` (UTC). La fonction ne travaille qu'à 8h heure de Paris (été comme hiver).
