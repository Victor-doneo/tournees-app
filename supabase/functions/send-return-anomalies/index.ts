// Fonction Edge : envoie chaque jour par mail les anomalies de retour des tournées
//   = tournées marquées « rentrées » alors que des colis à retourner n'ont pas d'accusé de réception (tournée rentrée avec moins de colis que prévu).
//   Les tournées sans colis à retourner ne sont jamais signalées.
// Corps (facultatif) : { date?: 'AAAA-MM-JJ' }  (défaut : aujourd'hui, heure de Paris) ; les 14 jours précédents sont inclus. Rien n'est envoyé s'il n'y a aucune anomalie.
// Appelée automatiquement par l'application juste après l'envoi du rapport (validation du contrôle, Tours.jsx) avec la session de l'administrateur.
// Authentification dans la fonction : administrateur OU en-tête x-cron-secret = secret CRON_SECRET (facultatif)
// Déploiement : supabase functions deploy send-return-anomalies
// Secrets utilisés : RESEND_API_KEY, FROM_EMAIL (déjà configurés pour les autres mails)
// Destinataires : table email_recipients (ceux du rapport journalier), colonne active = true
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const cronSecret = Deno.env.get('CRON_SECRET')
    const isCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    if (!isCron) {
      const { data: u } = await admin.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''))
      if (!u?.user) return json({ error: 'Non authentifié' }, 401)
      const { data: p } = await admin.from('users').select('role').eq('id', u.user.id).single()
      if (p?.role !== 'admin') return json({ error: 'Accès non autorisé' }, 403)
    }
    const body = await req.json().catch(() => ({}))
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
    const day = /^\d{4}-\d{2}-\d{2}$/.test(body?.date || '') ? body.date : today

    // Fenêtre : les 14 jours jusqu'à la date demandée (jours passés compris), tant que des colis restent non réceptionnés
    const dFrom = new Date(day + 'T12:00:00Z'); dFrom.setUTCDate(dFrom.getUTCDate() - 14)
    const from = dFrom.toISOString().slice(0, 10)
    const { data: tours } = await admin.from('tours').select('id, name, heure_retour, tours_references(name), delivery_dates!inner(delivery_date)')
      .gte('delivery_dates.delivery_date', from).lte('delivery_dates.delivery_date', day).not('heure_retour', 'is', null).limit(5000)
    const { data: labels } = await admin.from('return_labels').select('task_date, tour_code, barcode, customer_name, reason, received_at').gte('task_date', from).lte('task_date', day).limit(5000)

    const byTour: Record<string, any[]> = {}
    for (const l of labels || []) (byTour[`${l.task_date}|${l.tour_code || '—'}`] ||= []).push(l)
    const anomalies: any[] = []
    for (const t of tours || []) {
      const code = (t as any).tours_references?.name || t.name
      const dt = (t as any).delivery_dates?.delivery_date
      const ls = byTour[`${dt}|${code}`] || []
      const missing = ls.filter((l) => !l.received_at)
      if (ls.length && missing.length) anomalies.push({ code, dt, retour: t.heure_retour, total: ls.length, recus: ls.length - missing.length, missing })
    }
    anomalies.sort((a, b) => b.dt.localeCompare(a.dt) || a.code.localeCompare(b.code))
    if (!anomalies.length) return json({ day, anomalies: 0, sent: 0 })

    const { data: rec } = await admin.from('email_recipients').select('email').eq('active', true)
    const to = (rec || []).map((r) => r.email)
    if (!to.length) return json({ error: 'Aucun destinataire actif (table email_recipients)' }, 400)

    const [y, m, d] = day.split('-')
    const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
    const rows = anomalies.map((a) => `<tr><td style="padding:6px 10px;border:1px solid #ddd"><b>${esc(a.code)}</b><br>${a.dt.split('-').reverse().join('.')}</td><td style="padding:6px 10px;border:1px solid #ddd">rentrée à ${hhmm(a.retour)}</td><td style="padding:6px 10px;border:1px solid #ddd">${a.recus}/${a.total} colis réceptionnés</td><td style="padding:6px 10px;border:1px solid #ddd">${a.missing.map((l: any) => `${esc(l.barcode)} (${esc(l.customer_name || '')}${l.reason ? ' – ' + esc(l.reason) : ''})`).join('<br>')}</td></tr>`).join('')
    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt"><p>Bonjour,</p><p><b>${anomalies.length}</b> tournée(s) rentrée(s) (jusqu'au ${d}.${m}.${y}, 14 jours précédents compris) ont des colis à retourner sans accusé de réception :</p><table style="border-collapse:collapse"><tr><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Tournée</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Retour</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Réception</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Colis non réceptionnés</th></tr>${rows}</table><p>Cordialement,<br>Superflash</p></div>`
    const subject = `ANOMALIES RETOUR TOURNÉES / CCV / ${d}.${m}.${y} (${anomalies.length})`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Superflash <${Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'}>`, to, subject, html }),
    })
    if (!res.ok) return json({ error: "Échec de l'envoi : " + (await res.text()) }, 502)
    return json({ day, anomalies: anomalies.length, sent: to.length })
  } catch (e) { return json({ error: String(e?.message || e) }, 500) }
})
