// Pour chaque colis « livraison contre reprise » (numéro 7 + BP), cherche dans REFLEX (Réceptions > Référence réception = BP sans le 7)
// la ligne dont le code motif est LCR et enregistre son numéro de réception dans return_labels.reflex_reception.
// Env : REFLEX_USER, REFLEX_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ; facultatif DATE, DRY_RUN
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const { REFLEX_USER, REFLEX_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATE, DRY_RUN, BROWSER_CHANNEL } = process.env
for (const [k, v] of Object.entries({ REFLEX_USER, REFLEX_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) if (!v) { console.log(`Secret manquant : ${k} — étape ignorée`); process.exit(0) }

const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]))
const day = DATE || `${p.year}-${p.month}-${p.day}`
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const { data: todo, error } = await sb.from('return_labels').select('id, barcode').eq('task_date', day).ilike('reason', '%contre reprise%').is('reflex_reception', null)
if (error) throw error
console.log(`${todo.length} colis « livraison contre reprise » sans n° de réception pour le ${day}`)
if (!todo.length) process.exit(0)

// BROWSER_CHANNEL=chrome : utilise le Chrome installé sur le PC (évite de télécharger le navigateur de Playwright)
const browser = await chromium.launch(BROWSER_CHANNEL ? { channel: BROWSER_CHANNEL } : {})
const page = await (await browser.newContext({ locale: 'fr-FR', viewport: { width: 1600, height: 900 } })).newPage()
const shot = async n => page.screenshot({ path: `reflex-${n}.png`, fullPage: true }).catch(() => {})
const sleep = ms => page.waitForTimeout(ms)

async function login() {
  await page.goto('https://ereflex.cchezvous.fr/reflex/env/production', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name=user]').fill(REFLEX_USER)
  await page.locator('input[name=password]').fill(REFLEX_PASSWORD)
  await page.locator('a').first().dblclick() // la connexion demande un double clic sur la flèche
  await page.waitForSelector('input[name=user]', { state: 'detached', timeout: 30000 })
  await sleep(4000)
  console.log('Connecté à REFLEX')
}

// Ouvre « Réceptions » (menu principal -> Réception -> Réceptions)
async function openSelection() {
  const label = page.locator('div.a-outputtext', { hasText: /^Référence réception$/ })
  if (await label.filter({ visible: true }).count()) return
  if (!(await page.locator('.dijitTreeLabel', { hasText: /^Réceptions$/ }).first().isVisible().catch(() => false))) { await page.mouse.click(27, 18); await sleep(1500) }
  for (let i = 0; i < 3 && !(await label.filter({ visible: true }).count()); i++) {
    await page.locator('.dijitTreeLabel', { hasText: /^Réceptions$/ }).first().dblclick({ force: true }).catch(() => {})
    await sleep(3000)
  }
  if (!(await label.filter({ visible: true }).count())) throw new Error("Écran « Sélection des réceptions » introuvable")
}

// Saisit la référence dans le champ situé sur la même ligne que le libellé « Référence réception »
async function search(bp) {
  const id = await page.evaluate(() => {
    const vis = e => e.offsetParent !== null
    const labs = [...document.querySelectorAll('div.a-outputtext')].filter(e => vis(e) && e.textContent.trim() === 'Référence réception')
    const lab = labs[labs.length - 1]; const ly = lab.getBoundingClientRect().y
    const cand = [...document.querySelectorAll('input')].filter(i => vis(i) && Math.abs(i.getBoundingClientRect().y - ly) < 10 && i.getBoundingClientRect().x > lab.getBoundingClientRect().x)
    return cand.length ? cand[0].id : null
  })
  if (!id) throw new Error('Champ Référence réception introuvable')
  const input = page.locator(`[id="${id}"]`)
  await input.click(); await input.fill(''); await input.type(bp)
  const ok = page.locator('button.a-default-button', { hasText: /^OK$/ }).filter({ visible: true }).last()
  await ok.dblclick()
  await sleep(3500)
}

// Lecture des lignes du tableau (dgrid) : jour, date, ate, code motif, quai, réception, référence...
async function readRows(bp) {
  return page.evaluate(bp => [...document.querySelectorAll('.dgrid-row')].filter(r => r.offsetParent !== null).map(r => [...r.querySelectorAll('td.dgrid-cell')].map(c => c.innerText.trim().replace(/\s+/g, ' '))).filter(c => c.some(x => x === bp)), bp)
}

async function closeResults() {
  const q = page.locator('button', { hasText: /^Quitter$/ }).filter({ visible: true }).last()
  if (await q.count()) { await q.click().catch(() => {}); await sleep(800) }
}

const out = []
try {
  await login()
  for (const row of todo) {
    const bp = String(row.barcode).replace(/^7/, '')
    try {
      await openSelection()
      await search(bp)
      const cells = await readRows(bp)
      // colonnes : 0 jour, 1 date, 2 ate, 3 code motif, 4 quai, 5 réception, 6 référence
      const lcr = cells.filter(c => /^LCR$/i.test(c[3] || ''))
      const toKey = d => (d || '').split('/').reverse().join('')
      lcr.sort((a, b) => toKey(a[1]).localeCompare(toKey(b[1])))
      const pick = lcr[lcr.length - 1]
      console.log(`BP ${bp} : ${cells.length} réception(s), ${lcr.length} LCR -> ${pick ? pick[5] : 'aucune'}`)
      out.push({ id: row.id, reflex_reception: pick ? String(pick[5]).trim() : null, reflex_note: pick ? (lcr.length > 1 ? `${lcr.length} lignes LCR : la plus récente retenue` : null) : (cells.length ? 'Aucune ligne LCR dans REFLEX' : 'Référence introuvable dans REFLEX') })
      await closeResults()
    } catch (e) { console.log(`BP ${bp} : erreur ${e.message}`); await shot(`erreur-${bp}`); await closeResults() }
  }
} catch (e) {
  await shot('erreur'); await browser.close(); throw e
}
await browser.close()

if (DRY_RUN) { console.log('DRY_RUN : rien écrit', JSON.stringify(out)); process.exit(0) }
for (const o of out) {
  const patch = { reflex_checked_at: new Date().toISOString(), reflex_note: o.reflex_note }
  if (o.reflex_reception) patch.reflex_reception = o.reflex_reception
  const { error: ue } = await sb.from('return_labels').update(patch).eq('id', o.id)
  if (ue) throw ue
}
console.log(`OK : ${out.filter(o => o.reflex_reception).length}/${todo.length} n° de réception enregistrés`)
