// Fonction Edge : mail « ANOMALIES RETOUR TOURNÉES », envoyé à part du rapport des préparations.
// Trois rubriques (rien n'est envoyé s'il n'y a aucune anomalie) :
//   1. Tournées qui devaient rentrer et ne sont pas rentrées (1re livraison <= 06h00, avec colis à retourner, hors samedi) pour le jour demandé
//   2. Tournées rentrées AUJOURD'HUI (même si elles datent d'un autre jour) avec des colis à retourner sans accusé de réception
//   3. Colis attendus toujours non réceptionnés depuis plus de OVERDUE_DAYS jours, avec leur tournée
// Seules les tournées à partir du 16/11/2026 sont prises en compte.
// Corps (facultatif) : { date?: 'AAAA-MM-JJ' } (défaut : aujourd'hui, heure de Paris).
// Appelée par l'application juste après l'envoi du rapport (Tours.jsx), avec la session de l'administrateur ; x-cron-secret accepté aussi.
// Secrets : RESEND_API_KEY, FROM_EMAIL (déjà configurés). Destinataires : table email_recipients (active = true).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FROM_DATE = '2026-11-16'   // premier jour pris en compte
const OVERDUE_DAYS = 3           // colis non réceptionné depuis plus de N jours -> signalé
const FIRST_DELIVERY_LIMIT = 6 * 60 // 06h00 : une tournée dont la 1re livraison est à 06h00 ou avant doit rentrer le jour même

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fr = (d: string) => d.split('-').reverse().join('.')
const toMin = (v?: string | null) => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
const parisDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso))
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const TD = 'padding:6px 10px;border:1px solid #ddd;vertical-align:top'

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
    const today = parisDay(new Date().toISOString())
    const day = /^\d{4}-\d{2}-\d{2}$/.test(body?.date || '') ? body.date : today
    if (day < FROM_DATE) return json({ day, anomalies: 0, sent: 0, note: `Avant le ${FROM_DATE}` })

    // Colis à retourner depuis FROM_DATE et tournées concernées
    const { data: labels } = await admin.from('return_labels').select('task_date, tour_code, barcode, customer_name, reason, received_at').gte('task_date', FROM_DATE).lte('task_date', day).limit(5000)
    const { data: tours } = await admin.from('tours').select('id, name, heure_retour, heure_premiere_livraison, tours_references(name), delivery_dates!inner(delivery_date)')
      .gte('delivery_dates.delivery_date', FROM_DATE).lte('delivery_dates.delivery_date', day).limit(5000)
    const byTour: Record<string, any[]> = {}
    for (const l of labels || []) (byTour[`${l.task_date}|${l.tour_code || '—'}`] ||= []).push(l)
    const info = (t: any) => {
      const code = t.tours_references?.name || t.name, dt = t.delivery_dates?.delivery_date
      const ls = byTour[`${dt}|${code}`] || []
      return { code, dt, ls, missing: ls.filter((l) => !l.received_at), retour: t.heure_retour as string | null, hpl: toMin(t.heure_premiere_livraison) }
    }

    // 1. Tournées du jour qui devaient rentrer et ne sont pas rentrées (pas le samedi)
    const isSaturday = new Date(day + 'T12:00:00Z').getUTCDay() === 6
    const notBack = isSaturday ? [] : (tours || []).map(info).filter((a) => a.dt === day && !a.retour && a.ls.length > 0 && a.hpl != null && a.hpl <= FIRST_DELIVERY_LIMIT)

    // 2. Tournées rentrées aujourd'hui (quelle que soit leur date) avec des colis non réceptionnés
    const incomplete = (tours || []).map(info).filter((a) => a.retour && parisDay(a.retour) === day && a.ls.length > 0 && a.missing.length > 0)

    // 3. Colis non réceptionnés depuis plus de OVERDUE_DAYS jours (tournée du 16/11 ou après)
    const limit = addDays(day, -OVERDUE_DAYS)
    const overdue = (tours || []).map(info).filter((a) => a.dt <= limit && a.missing.length > 0)

    const total = notBack.length + incomplete.length + overdue.length
    if (!total) return json({ day, anomalies: 0, sent: 0 })

    const { data: rec } = await admin.from('email_recipients').select('email').eq('active', true)
    const to = (rec || []).map((r) => r.email)
    if (!to.length) return json({ error: 'Aucun destinataire actif (table email_recipients)' }, 400)

    const colis = (a: any) => a.missing.map((l: any) => `${esc(l.barcode)} (${esc(l.customer_name || '')}${l.reason ? ' – ' + esc(l.reason) : ''})`).join('<br>')
    const table = (head: string[], rows: string[]) => `<table style="border-collapse:collapse"><tr>${head.map((h) => `<th style="${TD};text-align:left">${h}</th>`).join('')}</tr>${rows.join('')}</table>`
    const sections: string[] = []
    if (notBack.length) sections.push(`<h3>Tournées qui devaient rentrer et ne sont pas rentrées (${notBack.length})</h3>${table(['Tournée', '1re livraison', 'Colis à retourner'], notBack.map((a) => `<tr><td style="${TD}"><b>${esc(a.code)}</b></td><td style="${TD}">${String(Math.floor(a.hpl! / 60)).padStart(2, '0')}:${String(a.hpl! % 60).padStart(2, '0')}</td><td style="${TD}">${a.ls.length} colis, dont ${a.missing.length} non réceptionné(s)</td></tr>`))}`)
    if (incomplete.length) sections.push(`<h3>Tournées rentrées aujourd'hui avec des colis non réceptionnés (${incomplete.length})</h3>${table(['Tournée', 'Retour', 'Réception', 'Colis non réceptionnés'], incomplete.map((a) => `<tr><td style="${TD}"><b>${esc(a.code)}</b><br>du ${fr(a.dt)}</td><td style="${TD}">rentrée à ${hhmm(a.retour!)}</td><td style="${TD}">${a.ls.length - a.missing.length}/${a.ls.length} colis</td><td style="${TD}">${colis(a)}</td></tr>`))}`)
    if (overdue.length) sections.push(`<h3>Colis non réceptionnés depuis plus de ${OVERDUE_DAYS} jours (${overdue.length} tournée(s))</h3>${table(['Tournée', 'Colis non réceptionnés'], overdue.map((a) => `<tr><td style="${TD}"><b>${esc(a.code)}</b><br>du ${fr(a.dt)}</td><td style="${TD}">${colis(a)}</td></tr>`))}`)

    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt"><p>Bonjour,</p><p>Anomalies de retour des tournées au ${fr(day)} :</p>${sections.join('')}<p>Cordialement,<br>Superflash</p></div>`
    const subject = `ANOMALIES RETOUR TOURNÉES / CCV / ${fr(day)} (${total})`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Superflash <${Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'}>`, to, subject, html }),
    })
    if (!res.ok) return json({ error: "Échec de l'envoi : " + (await res.text()) }, 502)
    return json({ day, anomalies: total, sent: to.length })
  } catch (e) { return json({ error: String(e?.message || e) }, 500) }
})
