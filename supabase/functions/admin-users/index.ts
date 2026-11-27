// Fonction Edge : gestion des comptes (création, fournisseurs, activation, mot de passe, suppression).
// - Administrateur : tout.
// - CCHEZVOUS (partner) avec le droit « gestion des comptes transporteurs » : uniquement les comptes TRANSPORTEUR (carrier).
// Le rôle est posé côté serveur (jamais lu depuis les métadonnées d'inscription) : les inscriptions libres peuvent être désactivées
// (Supabase > Authentication > Providers > Email > « Allow new users to sign up » désactivé).
// Corps : { action: 'create' | 'update_carrier' | 'set_password' | 'delete', ... }. Appelée avec le jeton de l'utilisateur connecté.
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
    const { data: me } = await admin.from('users').select('email, role, active, can_manage_carriers').eq('id', caller.id).maybeSingle()
    if (!me || me.active === false) return json({ error: 'Compte inactif' }, 403)
    const isAdmin = me.role === 'admin'
    const isCarrierManager = me.role === 'partner' && me.can_manage_carriers === true
    if (!isAdmin && !isCarrierManager) return json({ error: 'Droit insuffisant' }, 403)

    const log = (userId: string, email: string, change: string) =>
      admin.from('access_audit').insert({ actor: caller.id, actor_email: me.email, user_id: userId, user_email: email, change })
    // Un gestionnaire de comptes transporteurs ne touche qu'à des comptes carrier
    const target = async (id: string) => {
      const { data: t } = await admin.from('users').select('id, email, role').eq('id', id).maybeSingle()
      if (!t) return { error: json({ error: 'Compte introuvable' }, 404) }
      if (!isAdmin && t.role !== 'carrier') return { error: json({ error: 'Tu ne peux gérer que les comptes transporteur' }, 403) }
      return { t }
    }
    const b = await req.json()

    if (b.action === 'create') {
      const email = String(b.email || '').trim().toLowerCase()
      if (!email || !b.password || String(b.password).length < 8) return json({ error: 'Email et mot de passe (8 caractères minimum) requis' }, 400)
      const role = isAdmin ? b.role : 'carrier'
      if (!ROLES.includes(role)) return json({ error: 'Rôle invalide' }, 400)
      const suppliers = role === 'carrier' ? (Array.isArray(b.suppliers) ? b.suppliers.map(String) : []) : []
      if (role === 'carrier' && !suppliers.length) return json({ error: 'Un compte transporteur doit être rattaché à au moins un fournisseur' }, 400)
      const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { full_name: b.full_name || '' } })
      if (ce || !created?.user) return json({ error: ce?.message || 'Création impossible' }, 400)
      const row = {
        id: created.user.id, email, full_name: b.full_name || '', role, active: true, suppliers,
        can_view_tour_tracking: isAdmin && role === 'partner' ? !!b.can_view_tour_tracking : false,
        can_manage_loading_plan: isAdmin && role === 'partner' ? !!b.can_manage_loading_plan : false,
        can_manage_carriers: isAdmin && role === 'partner' ? !!b.can_manage_carriers : false,
      }
      const { error: ue } = await admin.from('users').upsert(row, { onConflict: 'id' })
      if (ue) return json({ error: 'Compte créé mais profil non enregistré : ' + ue.message }, 500)
      await log(created.user.id, email, `compte créé par ${me.email} (${role}${suppliers.length ? ' : ' + suppliers.join(', ') : ''})`)
      return json({ ok: true, id: created.user.id })
    }

    if (b.action === 'update_carrier') {
      const r = await target(b.user_id); if (r.error) return r.error
      if (r.t.role !== 'carrier') return json({ error: 'Ce compte n\'est pas un transporteur' }, 400)
      const patch: Record<string, unknown> = {}
      if (Array.isArray(b.suppliers)) patch.suppliers = b.suppliers.map(String)
      if (typeof b.active === 'boolean') patch.active = b.active
      if (!Object.keys(patch).length) return json({ error: 'Rien à modifier' }, 400)
      const { error } = await admin.from('users').update(patch).eq('id', b.user_id)
      if (error) return json({ error: error.message }, 400)
      await log(b.user_id, r.t.email, `modifié par ${me.email} : ${JSON.stringify(patch)}`)
      return json({ ok: true })
    }

    if (b.action === 'set_password') {
      if (!b.password || String(b.password).length < 8) return json({ error: 'Mot de passe (8 caractères minimum) requis' }, 400)
      const r = await target(b.user_id); if (r.error) return r.error
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: b.password })
      if (error) return json({ error: error.message }, 400)
      await log(b.user_id, r.t.email, `mot de passe réinitialisé par ${me.email}`)
      return json({ ok: true })
    }

    if (b.action === 'delete') {
      if (b.user_id === caller.id) return json({ error: 'Suppression impossible' }, 400)
      const r = await target(b.user_id); if (r.error) return r.error
      await admin.from('users').update({ active: false }).eq('id', b.user_id)
      const { error } = await admin.auth.admin.deleteUser(b.user_id)
      if (error) return json({ error: error.message + ' (le compte a été désactivé)' }, 400)
      await log(b.user_id, r.t.email, `compte supprimé par ${me.email}`)
      return json({ ok: true })
    }
    return json({ error: 'Action inconnue' }, 400)
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500) }
})
