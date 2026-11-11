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
if (dRow) { const { data } = await sb.from('tours').select('name, tours_references(name)').eq('delivery_date_id', dRow.id); codes = (data || []).map(t => t.tours_references?.name || t.name) }
const matchCode = name => {
  const n = String(name || '').toUpperCase().replace(/^TA830CAMION/, '')
  return [...codes].sort((a, b) => b.length - a.length).find(c => { const i = n.indexOf(String(c).toUpperCase()); return i >= 0 && !/\d/.test(n[i + String(c).length] || '') }) || null
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage()
const tasks = new Map()
let lastBatch = 0
page.on('response', async r => {
  const u = r.url()
  if (u.includes('backend.urbantz.com/task?')) {
    try { const j = await r.json(); if (Array.isArray(j)) { lastBatch = j.length; for (const t of j) tasks.set(t._id || t.id, t) } } catch {}
  }
})
const url = n => `https://web.urbantz.com/platform/c-chez-vous/tasks?mode=tasks&from=${day}&to=${day}&status=PICKED_UP,PARTIAL_PICKED_UP,PARTIAL_DELIVERED,NOT_DELIVERED&page=${n}&discarded=false&dateStyle=single&sort=when:up`
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
  // pages suivantes (100 tâches par page)
  for (let n = 1; n < 30 && lastBatch >= 100; n++) {
    lastBatch = 0
    await page.goto(url(n), { waitUntil: 'domcontentloaded' })
    for (let i = 0; i < 12 && !lastBatch; i++) await page.waitForTimeout(1000)
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
for (const t of tasks.values()) {
  for (const it of t.items || []) {
    stat[it.status] = (stat[it.status] || 0) + 1
    if (!it.barcode) continue
    let reason = null
    if (it.status === 'NOT_DELIVERED') reason = 'Livraison impossible'
    else if (/PICKED_UP/.test(it.status || '') && !/^NOT_/.test(it.status)) reason = isDea(it) ? null : (it.status === 'PICKED_UP' ? 'Collecté' : 'Partiellement collecté')
    if (!reason) continue
    const loc = t.location || {}
    rows.set(`${day}|${it.barcode}`, {
      task_date: day, round_name: t.roundName || null, tour_code: matchCode(t.roundName), task_id: t.taskId || t.id || null,
      barcode: it.barcode, item_name: it.name || null, item_description: it.description || null, item_status: it.status, reason,
      customer_name: t.contact?.person || null, customer_phone: t.contact?.phone || null,
      address: [loc.number, loc.street].filter(Boolean).join(' ') || loc.address || null, zip: loc.zip || null, city: loc.city || null,
    })
  }
}
console.log(`${tasks.size} tâches, statuts items :`, JSON.stringify(stat))
console.log(`${rows.size} colis à retourner pour le ${day}`)
if (DRY_RUN) { console.log('DRY_RUN : rien écrit.'); process.exit(0) }
if (rows.size) {
  const { error } = await sb.from('return_labels').upsert([...rows.values()], { onConflict: 'task_date,barcode' })
  if (error) throw error
}
console.log('OK')
