// Récupération des colis À RETOURNER dans Urbantz (Tâches > Items) en fin de journée.
// Règles : item « Livraison impossible » (NOT_DELIVERED) -> retour ;
//          item collecté / partiellement collecté (PICKED_UP...) -> retour sauf si « DEA » dans le nom/description.
// Lancé par GitHub Actions (.github/workflows/urbantz-retours.yml) de 10h à 18h, heure de Paris (ou à la demande).
// Env : URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ; facultatif DATE, DRY_RUN, FORCE
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const { URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATE, DRY_RUN, FORCE } = process.env
for (const [k, v] of Object.entries({ URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) if (!v) throw new Error(`Secret manquant : ${k}`)

const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]))
const day = DATE || `${p.year}-${p.month}-${p.day}`
const mins = Number(p.hour) * 60 + Number(p.minute)
if (!FORCE && !DATE && (mins < 10 * 60 || mins > 18 * 60)) { console.log(`Il est ${p.hour}h${p.minute} à Paris : extraction prévue de 10h à 18h, rien à faire.`); process.exit(0) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const JOB = 'urbantz_retours'
// Suivi d'exécution : une ligne par automatisme (table job_runs), affichée dans « Suivi des tournées »
const report = async (ok, msg) => { if (DRY_RUN) return; try { await sb.from('job_runs').upsert({ job: JOB, last_run: new Date().toISOString(), ok, message: String(msg || '').slice(0, 300) }) } catch {} }
const done = async msg => { await report(true, msg); process.exit(0) }
process.on('uncaughtException', e => { report(false, e?.message || e).finally(() => { console.error(e); process.exit(1) }) })

// Codes de tournées de l'application (rapprochement facultatif avec le nom Urbantz)
const { data: dRow } = await sb.from('delivery_dates').select('id').eq('delivery_date', day).maybeSingle()
let codes = []
// Livraisons contre reprise du jour (onglet Reprises, issues des PDF), hors DEA : un BL « X » livré doit ressortir en collecté sous « 7X »
const lcr = new Set()
const lcrReception = new Map() // n° de réception REFLEX déjà trouvé à l'import du PDF
if (dRow) {
  const { data } = await sb.from('tours').select('name, tours_references(name)').eq('delivery_date_id', dRow.id); codes = (data || []).map(t => t.tours_references?.name || t.name)
  const { data: ps, error: pe } = await sb.from('parcels').select('barcode, dea, tours!inner(delivery_date_id)').eq('exclusion_reason', 'Livraison contre reprise').eq('tours.delivery_date_id', dRow.id)
  if (pe) throw pe
  for (const p of ps || []) if (!p.dea && p.barcode) lcr.add(String(p.barcode).trim())
  const { data: rx, error: rxe } = await sb.from('parcels').select('barcode, reflex_reception, tours!inner(delivery_date_id)').eq('exclusion_reason', 'Livraison contre reprise').eq('tours.delivery_date_id', dRow.id).not('reflex_reception', 'is', null)
  if (!rxe) for (const p of rx || []) lcrReception.set(String(p.barcode).trim(), p.reflex_reception) // colonne absente = migration non lancée : on ignore
}
console.log(`${lcr.size} livraisons contre reprise dans l'application pour le ${day}`)
const matchCode = name => {
  const n = String(name || '').toUpperCase().replace(/^TA830CAMION/, '')
  return [...codes].sort((a, b) => b.length - a.length).find(c => { const i = n.indexOf(String(c).toUpperCase()); return i >= 0 && !/\d/.test(n[i + String(c).length] || '') }) || null
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage()
const tasks = new Map()
const prevDays = [] // { d, nd: Set des colis encore non livrés ce jour-là, n }
let firstReq = null
page.on('request', r => { if (!firstReq && r.url().includes('backend.urbantz.com/task?')) firstReq = { url: r.url(), headers: r.headers() } })
let lastBatch = 0
page.on('response', async r => {
  const u = r.url()
  if (u.includes('backend.urbantz.com/task?')) {
    try { const j = await r.json(); if (Array.isArray(j)) { lastBatch = j.length; for (const t of j) tasks.set(t._id || t.id, t) } } catch {}
  }
})
const urlFor = (d, n) => `https://web.urbantz.com/platform/c-chez-vous/tasks?mode=tasks&from=${d}&to=${d}&page=${n}&discarded=false&dateStyle=single&sort=when:up`
const url = n => urlFor(day, n)
try {
  await page.goto(url(0), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const pwd = page.locator('input[type="password"]').first()
  if (await pwd.isVisible().catch(() => false) || (await page.locator('input[type="email"], input[name="username"], input[name="email"]').first().isVisible().catch(() => false))) {
    console.log('Page de connexion détectée')
    await page.locator('input[type="email"], input[name="username"], input[name="email"], input[type="text"]').first().fill(URBANTZ_EMAIL)
    if (!(await pwd.isVisible().catch(() => false))) { await page.keyboard.press('Enter'); await page.waitForTimeout(2000) }
    await page.locator('input[type="password"]').first().fill(URBANTZ_PASSWORD)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(6000)
    await page.goto(url(0), { waitUntil: 'domcontentloaded' })
  }
  for (let i = 0; i < 20 && !tasks.size; i++) await page.waitForTimeout(1500)
  if (!tasks.size) { console.log(`Aucune tâche Urbantz pour ${day} (jour férié ? connexion refusée ?)`); if (FORCE || DATE) throw new Error('Aucune tâche lue') }
  // pages suivantes (100 tâches par page) : appels directs à l'API avec les mêmes en-têtes que la page
  console.log(`page 0 : ${lastBatch} tâches`)
  if (lastBatch >= 100 && firstReq) {
    const headers = Object.fromEntries(Object.entries(firstReq.headers).filter(([k]) => !/^(host|content-length|connection|accept-encoding)$/i.test(k) && !k.startsWith(':')))
    for (let n = 1; n < 30; n++) {
      const u = new URL(firstReq.url); u.searchParams.set('page', String(n))
      const resp = await page.context().request.get(u.toString(), { headers })
      const j = resp.ok() ? await resp.json().catch(() => []) : []
      console.log(`page ${n} : ${Array.isArray(j) ? j.length : 'erreur ' + resp.status()} tâches`)
      if (!Array.isArray(j) || !j.length) break
      for (const t of j) tasks.set(t._id || t.id, t)
      if (j.length < 100) break
    }
  }
  // Jours précédents dont des colis « Livraison impossible » ne sont pas encore soldés : on relit la liste du jour.
  // Un BP qui n'y figure plus parmi les colis non livrés a été livré (2e passage) -> il sort de la tournée.
  if (!DATE) {
    const mainTasks = new Map(tasks)
    const fromD = [ '2026-11-16', new Date(new Date(`${day}T12:00:00Z`).getTime() - 14 * 864e5).toISOString().slice(0, 10) ].sort().pop()
    const { data: pd, error: pde } = await sb.from('return_labels').select('task_date').eq('reason', 'Livraison impossible').lt('task_date', day).gte('task_date', fromD)
      .or('received_at.is.null,reflex_recv_status.is.null,reflex_recv_status.not.in.(receptionne,livre)')
    if (pde) console.log('Jours précédents : requête en erreur :', pde.message)
    const prevList = [...new Set((pd || []).map(r => r.task_date))].sort().slice(-7)
    console.log(`Jours précédents à relire (depuis ${fromD}) : ${prevList.length ? prevList.join(', ') : 'aucun'}`)
    for (const d of prevList) {
      try {
        tasks.clear(); firstReq = null; lastBatch = 0
        await page.goto(urlFor(d, 0), { waitUntil: 'domcontentloaded' })
        for (let i = 0; i < 20 && !tasks.size; i++) await page.waitForTimeout(1500)
        if (!tasks.size) { console.log(`Jour précédent ${d} : aucune tâche lue, ignoré`); continue }
        if (lastBatch >= 100 && firstReq) {
          const headers = Object.fromEntries(Object.entries(firstReq.headers).filter(([k]) => !/^(host|content-length|connection|accept-encoding)$/i.test(k) && !k.startsWith(':')))
          for (let n = 1; n < 30; n++) {
            const u = new URL(firstReq.url); u.searchParams.set('page', String(n))
            const resp = await page.context().request.get(u.toString(), { headers })
            const j = resp.ok() ? await resp.json().catch(() => []) : []
            if (!Array.isArray(j) || !j.length) break
            for (const t of j) tasks.set(t._id || t.id, t)
            if (j.length < 100) break
          }
        }
        const dl = new Set(), nd = new Set()
        for (const t of tasks.values()) for (const it of t.items || []) if (it.barcode && it.status === 'DELIVERED') dl.add(String(it.barcode).trim())
        for (const t of tasks.values()) for (const it of t.items || []) if (it.barcode && it.status === 'NOT_DELIVERED' && !dl.has(String(it.barcode).trim())) nd.add(String(it.barcode).trim())
        prevDays.push({ d, nd, n: tasks.size })
        console.log(`Jour précédent ${d} : ${tasks.size} tâches, ${nd.size} colis encore non livrés`)
      } catch (e) { console.log(`Jour précédent ${d} : erreur ${e.message}`) }
    }
    tasks.clear(); for (const [k, v] of mainTasks) tasks.set(k, v)
  }
} catch (e) {
  await page.screenshot({ path: 'urbantz-erreur.png', fullPage: true }).catch(() => {})
  await browser.close()
  throw e
}
await browser.close()

// Règles de sélection
const isDea = it => /(^|[^A-Z0-9])DEA([^A-Z0-9]|$)/i.test(`${it.name || ''} ${it.description || ''} ${JSON.stringify(it.metadata || {})}`)
const stat = {}, rows = new Map()
// Colis livrés (DELIVERED) dans n'importe quelle tâche du jour : une livraison ratée puis livrée au 2e passage n'est plus un colis à retourner
const delivered = new Set()
for (const t of tasks.values()) for (const it of t.items || []) if (it.barcode && it.status === 'DELIVERED') delivered.add(String(it.barcode).trim())
let recovered = 0
let lcrCount = 0
for (const t of tasks.values()) {
  for (const it of t.items || []) {
    stat[it.status] = (stat[it.status] || 0) + 1
    if (!it.barcode) continue
    let reason = null, outCode = it.barcode
    const bc = String(it.barcode).trim()
    if (it.status === 'NOT_DELIVERED') { if (delivered.has(bc)) { recovered++; continue } reason = 'Livraison impossible' }
    else if (/PICKED_UP/.test(it.status || '') && !/^NOT_/.test(it.status)) reason = isDea(it) ? null : (it.status === 'PICKED_UP' ? 'Collecté' : 'Partiellement collecté')
    // Livraison contre reprise livrée : elle doit apparaître en « collecté » sous le numéro 7 + numéro du colis livré
    if (!reason && it.status === 'DELIVERED' && lcr.has(bc) && !isDea(it)) { reason = 'Collecté (livraison contre reprise)'; outCode = '7' + bc; lcrCount++ }
    if (!reason) continue
    const loc = t.location || {}
    rows.set(`${day}|${outCode}`, {
      task_date: day, round_name: t.roundName || null, tour_code: matchCode(t.roundName), task_id: t.taskId || t.id || null,
      barcode: outCode, item_name: it.name || null, item_description: it.description || null, item_status: it.status, reason,
      customer_name: t.contact?.person || null, customer_phone: t.contact?.phone || null,
      address: [loc.number, loc.street].filter(Boolean).join(' ') || loc.address || null, zip: loc.zip || null, city: loc.city || null,
    })
  }
}
// Diagnostic : BP=<n° de colis> affiche toutes les tâches et items Urbantz qui contiennent ce numéro
if (process.env.BP) {
  const bp = String(process.env.BP).trim()
  let n = 0
  for (const t of tasks.values()) {
    if (!JSON.stringify(t).includes(bp)) continue
    n++
    console.log(`DIAG tâche ${t.taskId || t.id} | tournée ${t.roundName || '—'} | statut tâche ${t.status || t.state || '—'} | client ${t.contact?.person || '—'}`)
    for (const it of t.items || []) if (JSON.stringify(it).includes(bp)) console.log(`   item barcode=${it.barcode} statut=${it.status} nom=${it.name || ''} | déjà dans « livrés » : ${delivered.has(String(it.barcode).trim())} | retenu à retourner : ${rows.has(`${day}|${String(it.barcode).trim()}`)}`)
  }
  console.log(`DIAG ${bp} : ${n} tâche(s) le ${day}`)
  const { data: lab } = await sb.from('return_labels').select('task_date, barcode, reason, tour_code, item_status, received_at, created_at').or(`barcode.eq.${bp},barcode.eq.7${bp}`).order('task_date')
  console.log('DIAG étiquettes en base :', JSON.stringify(lab))
}
console.log(`${tasks.size} tâches, statuts items :`, JSON.stringify(stat))
console.log(`dont ${lcrCount} livraison(s) contre reprise livrée(s) ajoutée(s) en collecté`)
console.log(`${rows.size} colis à retourner pour le ${day} (${recovered} livraison(s) ratée(s) finalement livrée(s) au 2e passage, ignorée(s))`)
// Rapprochement : un BP « Livraison impossible » qui n'apparaît plus parmi les colis non livrés du jour est un colis livré (2e passage)
//  -> étiquette supprimée ; si elle était déjà accusée de réception, conservée et marquée « livre » (plus de contrôle REFLEX ni de retour attendu)
const resolveLabels = async (d, notDelivered) => {
  const { data: labs } = await sb.from('return_labels').select('id, barcode, received_at, reflex_recv_status').eq('task_date', d).eq('reason', 'Livraison impossible')
  const gone = (labs || []).filter(r => !notDelivered.has(String(r.barcode).trim()))
  const del = gone.filter(r => !r.received_at).map(r => r.id)
  const keep = gone.filter(r => r.received_at && r.reflex_recv_status !== 'receptionne' && r.reflex_recv_status !== 'livre').map(r => r.id)
  if (DRY_RUN) { console.log(`${d} (simulation) : ${del.length} étiquette(s) seraient supprimée(s)${del.length ? ' : ' + gone.filter(r => !r.received_at).map(r => r.barcode).join(', ') : ''} ; ${keep.length} accusée(s) seraient marquée(s) « livré »${keep.length ? ' : ' + gone.filter(r => keep.includes(r.id)).map(r => r.barcode).join(', ') : ''}`); return }
  if (del.length) { const { error: de } = await sb.from('return_labels').delete().in('id', del); if (de) throw de }
  if (keep.length) { const { error: ke } = await sb.from('return_labels').update({ reflex_recv_status: 'livre', reflex_recv_checked_at: new Date().toISOString(), reflex_recv_line: 'Livré (Urbantz)' }).in('id', keep); if (ke) throw ke }
  console.log(`${d} : ${del.length} étiquette(s) supprimée(s), ${keep.length} accusée(s) marquée(s) « livré » (colis qui n'apparaissent plus parmi les non livrés)`)
}
if (DRY_RUN) {
  if (tasks.size) await resolveLabels(day, new Set([...rows.values()].filter(r => r.reason === 'Livraison impossible').map(r => r.barcode)))
  for (const x of prevDays) await resolveLabels(x.d, x.nd)
  console.log('DRY_RUN : rien écrit.'); process.exit(0)
}
if (rows.size) {
  const { error } = await sb.from('return_labels').upsert([...rows.values()], { onConflict: 'task_date,barcode' })
  if (error) throw error
  // Reprend le n° de réception REFLEX trouvé à l'import du PDF (sans écraser une valeur déjà présente)
  for (const [bc, rec] of lcrReception) {
    if (!rows.has(`${day}|7${bc}`)) continue
    await sb.from('return_labels').update({ reflex_reception: rec }).eq('task_date', day).eq('barcode', '7' + bc).is('reflex_reception', null)
  }
}
if (tasks.size) await resolveLabels(day, new Set([...rows.values()].filter(r => r.reason === 'Livraison impossible').map(r => r.barcode)))
for (const x of prevDays) await resolveLabels(x.d, x.nd)
console.log('OK')
await report(true, `${rows.size} colis à retourner pour le ${day}`)
