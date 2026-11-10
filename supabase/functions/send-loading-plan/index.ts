// Fonction Edge : envoie le PLAN DE CHARGEMENT aux destinataires actifs (table loading_plan_recipients).
// Déploiement : supabase functions deploy send-loading-plan
// Secrets utilisés : RESEND_API_KEY et FROM_EMAIL (les mêmes que send-daily-report, donc déjà configurés)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: u } = await admin.auth.getUser(token)
    if (!u?.user) return json({ error: 'Non authentifié' }, 401)
    const { data: profile } = await admin.from('users').select('id, role').eq('id', u.user.id).single()
    if (profile?.role !== 'admin') return json({ error: 'Réservé aux administrateurs' }, 403)

    const { delivery_date, html } = await req.json()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(delivery_date || '') || !html) return json({ error: 'Paramètres invalides' }, 400)
    const [y, m, d] = delivery_date.split('-')
    const subject = `PLAN DE CHARGEMENT/ CCV / ANTONY / ${d}.${m}.${y}` // objet imposé

    const { data: recipients } = await admin.from('loading_plan_recipients').select('email').eq('active', true)
    const to = (recipients || []).map((r) => r.email)
    if (!to.length) return json({ error: 'Aucun destinataire actif' }, 400)

    // ── Envoi ──
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Superflash <${Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'}>`, to, subject, html }),
    })
    if (!res.ok) return json({ error: 'Échec de l\'envoi : ' + (await res.text()) }, 502)

    await admin.from('loading_plan_sends').insert({ delivery_date, subject, recipients_count: to.length, sent_by: profile.id })
    return json({ sent_to: to.length, subject })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
