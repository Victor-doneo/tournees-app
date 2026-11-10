# Import automatique des heures Urbantz à 10h30 (GitHub Actions)

Le robot tourne chez GitHub (ordinateur éteint, aucun problème) : il se connecte à Urbantz, lit les heures d'arrivée prévues
du prochain jour de livraison et les écrit dans l'application. Du lundi au samedi à 10h30, heure de Paris.

## Mise en place (compte GitHub victor-doneo, dépôt tournees-app)
1. **Compte Urbantz dédié en lecture seule** (recommandé), ou à défaut votre compte. Sans double authentification.
2. Dépôt → Settings → Secrets and variables → Actions → **New repository secret**, quatre secrets :
   - `URBANTZ_EMAIL` et `URBANTZ_PASSWORD` : identifiants Urbantz
   - `SUPABASE_URL` : l'adresse du projet Supabase de l'application
   - `SUPABASE_SERVICE_ROLE_KEY` : Supabase → Project Settings → API → clé « service_role » (secrète : jamais dans une conversation)
3. Avoir lancé la migration `supabase_migration_urbantz_heures.sql`.
4. **Essai à blanc** : onglet Actions → « Import des heures Urbantz » → Run workflow → date `2026-11-12`, cocher « Essai à blanc ».
   Le journal doit indiquer « 20/20 tournées rapprochées ». En cas d'échec, une capture d'écran est jointe au run (artefact `urbantz-erreur`) :
   la décrire ou l'envoyer (masquer l'identifiant) pour ajuster la connexion.
5. Si l'essai est bon, relancer sans « Essai à blanc » : il écrit. Ensuite c'est automatique.

⚠ Non testé : la connexion à Urbantz est automatisée sur leur page web (pas d'API officielle), elle peut échouer si la page
de connexion est inhabituelle, si une double authentification est activée ou si Urbantz change son interface.
