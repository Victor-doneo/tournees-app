// Récupération des colis À RETOURNER dans Urbantz (Tâches > Items) en fin de journée.
// Règles : item « Livraison impossible » (NOT_DELIVERED) -> retour ;
//          item collecté / partiellement collecté (PICKED_UP...) -> retour sauf si « DEA » dans le nom/description.
// Lancé par GitHub Actions (.github/workflows/urbantz-retours.yml) toutes les 30 min de 11h30 à 15h30, heure de Paris (ou à la demande).
// Env : URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ; facultatif DATE, DRY_RUN, FORCE
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const { URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATE, DRY_RUN, FORCE } = process.env
for (const [k, v] of Object.entries({ URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) if (!v) throw new Error(`Secret manquant : ${k}`)

const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]))
const day = DATE || `${p.year}-${p.month}-${p.day}`
const mins = Number(p.hour) * 60 + Number(p.minute)
if (!FORCE && !DATE && (mins < 11 * 60 + 25 || mins > 15 * 60 + 50)) { console.log(`Il est ${p.hour}h${p.minute} à Paris : extraction prévue de 11h30 à 15h30, rien à faire.`); process.exit(0) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Codes de tournées de l'application (rapprochement facultatif avec le nom Urbantz)
const { data: dRow } = await sb.from('delivery_dates').select('id').eq('delivery_date', day).maybeSingle()
let codes = []
// Livraisons contre reprise du jour (onglet Reprises, issues des PDF), hors DEA : un BL « X » livré doit ressortir en collecté sous « 7X »
const lcr = new Set()
if (dRow) {
  const { data } = await sb.from('tours').select('name, tours_references(name)').eq('delivery_date_id', dRow.id); codes = (data || []).map(t => t.tours_references?.name || t.name)
  const { data: ps, error: pe } = await sb.from('parcels').select('barcode, dea, tours!inner(delivery_date_id)').eq('exclusion_reason', 'Livraison contre reprise').eq('tours.delivery_date_id', dRow.id)
  if (pe) throw pe
  for (const p of ps || []) if (!p.dea && p.barcode) lcr.add(String(p.barcode).trim())
}
console.log(`${lcr.size} livraisons contre reprise dans l'application pour le ${day}`)
const matchCode = name => {
  const n = String(name || '').toUpperCase().replace(/^TA830CAMION/, '')
  return [...codes].sort((a, b) => b.length - a.length).find(c => { const i = n.indexOf(String(c).toUpperCase()); return i >= 0 && !/\d/.test(n[i + String(c).length] || '') }) || null
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage()
const tasks = new Map()
let firstReq = null
page.on('request', r => { if (!firstReq && r.url().includes('backend.urbantz.com/task?')) firstReq = { url: r.url(), headers: r.headers() } })
let lastBatch = 0
page.on('response', async r => {
  const u = r.url()
  if (u.includes('backend.urbantz.com/task?')) {
    try { const j = await r.json(); if (Array.isArray(j)) { lastBatch = j.length; for (const t of j) tasks.set(t._id || t.id, t) } } catch {}
  }
})
const url = n => `https://web.urbantz.com/platform/c-chez-vous/tasks?mode=tasks&from=${day}&to=${day}&page=${n}&discarded=false&dateStyle=single&sort=when:up`
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
} catch (e) {
  await page.screenshot({ path: 'urbantz-erreur.png', fullPage: true }).catch(() => {})
  await browser.close()
  throw e
}
await browser.close()

// Règles de sélection
const isDea = it => /(^|[^A-Z0-9])DEA([^A-Z0-9]|$)/i.test(`${it.name || ''} ${it.description || ''} ${JSON.stringify(it.metadata || {})}`)
const stat = {}, rows = new Map()
let lcrCount = 0
for (const t of tasks.values()) {
  for (const it of t.items || []) {
    stat[it.status] = (stat[it.status] || 0) + 1
    if (!it.barcode) continue
    let reason = null, outCode = it.barcode
    const bc = String(it.barcode).trim()
    if (it.status === 'NOT_DELIVERED') reason = 'Livraison impossible'
    else if (/PICKED_UP/.test(it.status || '') && !/^NOT_/.test(it.status)) reason = isDea(it) ? null : (it.status === 'PICKED_UP' ? 'Collecté' : 'Partiellement collecté')
    // Livraison contre reprise livrée : elle doit apparaître en « collecté » sous le numéro 7 + numéro du colis livré
    if (!reason && it.status === 'DELIVERED' && lcr.has(bc)) { reason = 'Collecté (livraison contre reprise)'; outCode = '7' + bc; lcrCount++ }
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
console.log(`${tasks.size} tâches, statuts items :`, JSON.stringify(stat))
console.log(`dont ${lcrCount} livraison(s) contre reprise livrée(s) ajoutée(s) en collecté`)
console.log(`${rows.size} colis à retourner pour le ${day}`)
if (DRY_RUN) { console.log('DRY_RUN : rien écrit.'); process.exit(0) }
if (rows.size) {
  const { error } = await sb.from('return_labels').upsert([...rows.values()], { onConflict: 'task_date,barcode' })
  if (error) throw error
}
console.log('OK')
