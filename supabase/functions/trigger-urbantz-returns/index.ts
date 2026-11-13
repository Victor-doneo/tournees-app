// Fonction Edge : lance à la demande un workflow GitHub (boutons « Forcer l'extraction » des colis à retourner et « Récupérer les heures Urbantz » du plan de chargement).
// Corps : { workflow: 'returns' | 'import', date?: 'AAAA-MM-JJ', auto?: true }
// Déployer avec « Verify JWT » désactivé (l'authentification est faite dans la fonction : utilisateur admin OU en-tête x-cron-secret = secret CRON_SECRET)
// Déploiement : supabase functions deploy trigger-urbantz-returns
// Secret à créer : GITHUB_DISPATCH_TOKEN = jeton GitHub « fine-grained » limité au dépôt Victor-doneo/tournees-app, permission Actions : Read and write
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // Appel automatique (pg_cron) : secret partagé CRON_SECRET ; sinon utilisateur connecté et administrateur
    const cronSecret = Deno.env.get('CRON_SECRET')
    const isCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    if (!isCron) {
      const { data: u } = await admin.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''))
      if (!u?.user) return json({ error: 'Non authentifié' }, 401)
      const { data: p } = await admin.from('users').select('role').eq('id', u.user.id).single()
      if (p?.role !== 'admin') return json({ error: 'Accès non autorisé' }, 403)
    }
    const gh = Deno.env.get('GITHUB_DISPATCH_TOKEN')
    if (!gh) return json({ error: 'Secret GITHUB_DISPATCH_TOKEN manquant dans Supabase' }, 500)
    const { date, workflow, auto } = await req.json().catch(() => ({}))
    const file = workflow === 'import' ? 'urbantz-import.yml' : 'urbantz-retours.yml'
    const inputs: Record<string, string> = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? { date } : {}
    if (auto === true) inputs.auto = 'true' // lancement planifié : le script respecte ses fenêtres horaires
    const r = await fetch(`https://api.github.com/repos/Victor-doneo/tournees-app/actions/workflows/${file}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gh}`, Accept: 'application/vnd.github+json', 'User-Agent': 'tournees-app' },
      body: JSON.stringify({ ref: 'main', inputs }),
    })
    if (!r.ok) return json({ error: `GitHub ${r.status} : ${(await r.text()).slice(0, 200)}` }, 502)
    return json({ ok: true })
  } catch (e) { return json({ error: String(e) }, 500) }
})
