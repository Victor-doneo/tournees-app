# CCV — Application de contrôle des tournées

## Stack technique
- **Frontend** : React 18 + Vite
- **Backend** : Supabase (PostgreSQL + Auth + Storage + Realtime)
- **Hébergement** : Netlify

---

## Installation locale

### Prérequis
- Node.js 18+ installé → https://nodejs.org
- Un compte Netlify → https://netlify.com
- Le projet Supabase déjà configuré (schéma SQL appliqué ✓)

### 1. Installer les dépendances
```bash
cd tournees-app
npm install
```

### 2. Vérifier le fichier .env
Le fichier `.env` est déjà configuré avec tes clés Supabase :
```
VITE_SUPABASE_URL=https://vuulkjelkqeevxujegva.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 3. Lancer en local
```bash
npm run dev
```
L'application tourne sur → http://localhost:5173

---

## Déploiement sur Netlify

### Option A — Via l'interface Netlify (recommandé)

1. Push le projet sur GitHub :
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TON_COMPTE/tournees-app.git
git push -u origin main
```

2. Sur https://netlify.com :
   - New site → Import from Git → GitHub
   - Sélectionne le repo `tournees-app`
   - Build command : `npm run build`
   - Publish directory : `dist`
   - Clique **Deploy site**

3. Ajoute les variables d'environnement dans Netlify :
   - Site settings → Environment variables
   - `VITE_SUPABASE_URL` = `https://vuulkjelkqeevxujegva.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `eyJ...`

4. Redéploie (Deploys → Trigger deploy)

### Option B — Via Netlify CLI
```bash
npm install -g netlify-cli
netlify login
netlify init
npm run build
netlify deploy --prod
```

---

## Configuration Supabase post-déploiement

Une fois l'URL Netlify connue (ex: `https://ccv-tournees.netlify.app`), ajoute-la dans Supabase :

**Authentication → URL Configuration**
- Site URL : `https://ccv-tournees.netlify.app`
- Redirect URLs : `https://ccv-tournees.netlify.app/**`

---

## Création du premier opérateur

Dans Supabase → Authentication → Users → Add user :
- Email + mot de passe
- Le compte est créé avec le rôle `operator` par défaut

Pour créer un opérateur depuis l'interface admin de l'app :
→ Menu "Utilisateurs" → "Nouvel utilisateur"

---

## Utilisation

### Côté Admin
1. **Importer un PDF** → Sélectionner la date de livraison + uploader la feuille de route
2. **Dashboard** → Voir l'avancement en temps réel
3. **Tournées** → Archiver/désarchiver manuellement
4. **Recherche colis** → Retrouver n'importe quel colis par son barcode
5. **Recherche tournées** → Voir l'historique complet des scans

### Côté Opérateur (TC51)
1. Se connecter avec son compte
2. Sélectionner la tournée à contrôler
3. Scanner les colis — la page est active automatiquement, pas besoin d'appuyer sur Entrée
4. Les popups s'affichent en temps réel :
   - 🟢 **Vert** = Colis conforme
   - 🔵 **Bleu** = Colis déjà scanné
   - 🟠 **Orange** = Colis inconnu
   - 🔴 **Rouge** = Mauvaise tournée

### Archivage automatique
Les tournées sont archivées automatiquement à J+1 à 2h du matin.
Pour activer le cron, exécuter dans Supabase SQL Editor :
```sql
SELECT cron.schedule('auto-archive-tours', '0 2 * * *', 'SELECT public.auto_archive_tours()');
```
(Nécessite Supabase Pro ou l'extension pg_cron activée)

---

## Parsing PDF — Notes importantes

Le parser extrait automatiquement :
- **Nom de tournée** : après `CAMION` ou `camion` dans la ligne `TOURNEE TA830...`
- **Section CHARGEMENT uniquement** (pas LIVRAISON pour éviter les doublons)
- **Colis exclus** : type de prestation `Reprise` → marqués comme exclus, non comptés
- **Barcode** : nombre de 9 à 15 chiffres en fin de ligne client

Si un PDF a une structure différente, le parser peut être ajusté dans `src/pages/admin/UploadPDF.jsx`.

---

## Structure du projet

```
src/
├── contexts/
│   └── AuthContext.jsx       # Auth Supabase + profil utilisateur
├── lib/
│   └── supabase.js           # Client Supabase
├── pages/
│   ├── LoginPage.jsx         # Page de connexion
│   ├── admin/
│   │   ├── AdminLayout.jsx   # Sidebar + layout admin
│   │   ├── Dashboard.jsx     # Stats du jour
│   │   ├── Tours.jsx         # Liste des tournées
│   │   ├── UploadPDF.jsx     # Import + parsing PDF
│   │   ├── Users.jsx         # Gestion utilisateurs
│   │   ├── SearchParcel.jsx  # Recherche par barcode
│   │   └── SearchTours.jsx   # Historique par tournée
│   └── operator/
│       ├── OperatorLayout.jsx # Layout opérateur
│       ├── OperatorHome.jsx   # Sélection tournée
│       └── ScanPage.jsx       # Interface de scan TC51
├── App.jsx                   # Router principal
├── main.jsx                  # Point d'entrée
└── index.css                 # Design system complet
```
