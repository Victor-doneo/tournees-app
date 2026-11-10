// Import automatique des heures d'arrivée prévues Urbantz -> tournées du prochain jour de livraison.
// Lancé par GitHub Actions (.github/workflows/urbantz-import.yml) à 10h30 heure de Paris.
// Variables d'environnement : URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Facultatif : DATE=YYYY-MM-DD (forcer la date), DRY_RUN=1 (ne rien écrire), FORCE=1 (ignorer le contrôle d'heure)
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const { URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATE, DRY_RUN, FORCE } = process.env
for (const [k, v] of Object.entries({ URBANTZ_EMAIL, URBANTZ_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) if (!v) throw new Error(`Secret manquant : ${k}`)

const parisParts = () => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]))
const now = parisParts()
const today = `${now.year}-${now.month}-${now.day}`
// Deux déclenchements UTC (été / hiver) : on ne travaille qu'à 10h, heure de Paris
if (!FORCE && !DATE && Number(now.hour) !== 10) { console.log(`Il est ${now.hour}h à Paris : import prévu à 10h, rien à faire.`); process.exit(0) }

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// 1) Prochain jour de livraison avec des tournées
let day = DATE, dateRow = null
if (day) {
  dateRow = (await sb.from('delivery_dates').select('id, delivery_date').eq('delivery_date', day).maybeSingle()).data
} else {
  const { data } = await sb.from('delivery_dates').select('id, delivery_date').gt('delivery_date', today).order('delivery_date').limit(5)
  for (const d of data || []) {
    const { count } = await sb.from('tours').select('id', { count: 'exact', head: true }).eq('delivery_date_id', d.id)
    if (count) { dateRow = d; break }
  }
}
if (!dateRow) throw new Error('Aucun jour de livraison avec des tournées trouvé')
day = dateRow.delivery_date
const { data: tours, error: te } = await sb.from('tours').select('id, name, tours_references(name)').eq('delivery_date_id', dateRow.id)
if (te) throw te
const codes = tours.map(t => t.tours_references?.name || t.name)
console.log(`Jour visé : ${day} (${tours.length} tournées dans l'application)`)

// 2) Urbantz : connexion puis lecture des tournées du jour (réponses « /mission? » du tableau de bord)
const browser = await chromium.launch()
const page = await (await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage()
const missions = []
page.on('response', async r => {
  if (r.url().includes('backend.urbantz.com/mission?') && r.url().includes(`date=${day}`)) {
    try { const j = await r.json(); if (Array.isArray(j)) missions.push(...j) } catch {}
  }
})
const target = `https://web.urbantz.com/platform/c-chez-vous/dashboard/rounds?from=${day}&mode=timeline`
try {
  await page.goto(target, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const pwd = page.locator('input[type="password"]').first()
  if (await pwd.isVisible().catch(() => false) || (await page.locator('input[type="email"], input[name="username"], input[name="email"]').first().isVisible().catch(() => false))) {
    console.log('Page de connexion détectée')
    const user = page.locator('input[type="email"], input[name="username"], input[name="email"], input[type="text"]').first()
    await user.fill(URBANTZ_EMAIL)
    if (!(await pwd.isVisible().catch(() => false))) { await page.keyboard.press('Enter'); await page.waitForTimeout(2000) } // connexion en deux étapes
    await page.locator('input[type="password"]').first().fill(URBANTZ_PASSWORD)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(6000)
    if (!page.url().includes('/dashboard')) await page.goto(target, { waitUntil: 'domcontentloaded' })
  }
  for (let i = 0; i < 20 && !missions.length; i++) await page.waitForTimeout(1500)
  if (!missions.length) throw new Error(`Aucune tournée lue dans Urbantz pour ${day} (connexion refusée, double authentification ou page changée ?)`)
} catch (e) {
  await page.screenshot({ path: 'urbantz-erreur.png', fullPage: true }).catch(() => {})
  await browser.close()
  throw e
}
await browser.close()

// 3) Rapprochement par code de tournée : « TA830camionMNS75 L… » -> « MNS75 »
const hhmm = iso => iso ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) : null
const matchCode = name => {
  const n = String(name || '').toUpperCase().replace(/^TA830CAMION/, '')
  return [...codes].sort((a, b) => b.length - a.length).find(c => { const i = n.indexOf(String(c).toUpperCase()); return i >= 0 && !/\d/.test(n[i + String(c).length] || '') }) || null
}
const found = {}
for (const m of missions) {
  const hub = (m.stops || []).find(s => s.type === 'hub'), first = (m.stops || []).find(s => s.type === 'delivery')
  const code = matchCode(m.name)
  if (code && first?.arriveTime) found[code] = { first: hhmm(first.arriveTime), hub: hhmm(hub?.arriveTime) }
}
const upd = tours.map(t => ({ t, u: found[t.tours_references?.name || t.name] })).filter(x => x.u)
console.log(`${missions.length} tournées Urbantz, ${upd.length}/${tours.length} tournées rapprochées`)
if (!upd.length) throw new Error('Aucune tournée rapprochée : vérifier les noms de tournées')
if (DRY_RUN) { console.log('DRY_RUN : rien écrit. Aperçu :', upd.slice(0, 5).map(x => `${x.t.tours_references?.name || x.t.name} ${x.u.first}`).join(', ')); process.exit(0) }

// 4) Écriture
for (const { t, u } of upd) {
  const { error } = await sb.from('tours').update({ urbantz_first_arrival: u.first, urbantz_hub_depart: u.hub || null }).eq('id', t.id)
  if (error) throw error
}
console.log(`OK : ${upd.length} tournées mises à jour pour le ${day}`)
