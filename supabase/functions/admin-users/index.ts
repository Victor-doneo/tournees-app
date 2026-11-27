// Fonction Edge : gestion des comptes par un administrateur (création, mot de passe, suppression).
// Le rôle est posé côté serveur (jamais lu depuis les métadonnées d'inscription), ce qui permet de désactiver les inscriptions libres
// (Supabase > Authentication > Providers > Email > « Allow new users to sign up » désactivé).
// Corps : { action: 'create' | 'set_password' | 'delete', ... }. Appelée avec le jeton de l'administrateur connecté.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const ROLES = ['admin', 'operator', 'partner', 'carrier']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: { user: caller } } = await admin.auth.getUser(token)
    if (!caller) return json({ error: 'Non authentifié' }, 401)
    const { data: me } = await admin.from('users').select('role, active').eq('id', caller.id).maybeSingle()
    if (!me || me.role !== 'admin' || me.active === false) return json({ error: 'Réservé aux administrateurs' }, 403)

    const b = await req.json()
    if (b.action === 'create') {
      const email = String(b.email || '').trim().toLowerCase()
      if (!email || !b.password || String(b.password).length < 8) return json({ error: 'Email et mot de passe (8 caractères minimum) requis' }, 400)
      if (!ROLES.includes(b.role)) return json({ error: 'Rôle invalide' }, 400)
      const suppliers = b.role === 'carrier' ? (Array.isArray(b.suppliers) ? b.suppliers.map(String) : []) : []
      if (b.role === 'carrier' && !suppliers.length) return json({ error: 'Un compte transporteur doit être rattaché à au moins un fournisseur' }, 400)
      const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { full_name: b.full_name || '' } })
      if (ce || !created?.user) return json({ error: ce?.message || 'Création impossible' }, 400)
      const row = {
        id: created.user.id, email, full_name: b.full_name || '', role: b.role, active: true, suppliers,
        can_view_tour_tracking: b.role === 'partner' ? !!b.can_view_tour_tracking : false,
        can_manage_loading_plan: b.role === 'partner' ? !!b.can_manage_loading_plan : false,
      }
      const { error: ue } = await admin.from('users').upsert(row, { onConflict: 'id' })
      if (ue) return json({ error: 'Compte créé mais profil non enregistré : ' + ue.message }, 500)
      return json({ ok: true, id: created.user.id })
    }
    if (b.action === 'set_password') {
      if (!b.user_id || !b.password || String(b.password).length < 8) return json({ error: 'Mot de passe (8 caractères minimum) requis' }, 400)
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: b.password })
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }
    if (b.action === 'delete') {
      if (!b.user_id || b.user_id === caller.id) return json({ error: 'Suppression impossible' }, 400)
      await admin.from('users').update({ active: false }).eq('id', b.user_id)
      const { error } = await admin.auth.admin.deleteUser(b.user_id)
      return error ? json({ error: error.message + ' (le compte a été désactivé)' }, 400) : json({ ok: true })
    }
    return json({ error: 'Action inconnue' }, 400)
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500) }
})
