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
    const { data: profile } = await admin.from('users').select('id, role, can_manage_loading_plan').eq('id', u.user.id).single()
    const allowed = profile?.role === 'admin' || (profile?.role === 'partner' && profile?.can_manage_loading_plan === true)
    if (!allowed) return json({ error: 'Accès non autorisé' }, 403)

    const { delivery_date, table_html } = await req.json()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(delivery_date || '') || !table_html || !String(table_html).trim().startsWith('<table')) return json({ error: 'Paramètres invalides' }, 400)

    // Modèle du mail (objet, formule d'appel, texte avant le tableau, signature) : table loading_plan_mail_template
    const { data: tpl } = await admin.from('loading_plan_mail_template').select('*').eq('id', 1).maybeSingle()
    const T = {
      subject: tpl?.subject || 'PLAN DE CHARGEMENT/ CCV / ANTONY / {date}',
      greeting: tpl?.greeting ?? 'Bonjour,',
      intro: tpl?.intro ?? 'Plan de chargement CCV / Antony pour le {date_longue} :',
      signature: tpl?.signature ?? 'Cordialement',
    }
    const [y, m, d] = delivery_date.split('-')
    const vars: Record<string, string> = {
      date: `${d}.${m}.${y}`,
      date_longue: new Date(delivery_date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase(),
    }
    const fill = (txt: string, v: Record<string, string>) => String(txt || '').replace(/\{(date_longue|date)\}/g, (_, k) => v[k])
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const para = (txt: string) =>
      `<p>${esc(fill(txt, { ...vars, date_longue: '\u0000' })).replace(/\u0000/g, `<b>${esc(vars.date_longue)}</b>`).replace(/\n/g, '<br>')}</p>`
    const subject = fill(T.subject, vars)
    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${para(T.greeting)}${para(T.intro)}${table_html}${para(T.signature)}</div>`

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
