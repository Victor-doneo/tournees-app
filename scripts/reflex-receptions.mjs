// Pour chaque colis « livraison contre reprise » (numéro 7 + BP), cherche dans REFLEX (Réceptions > Référence réception = BP sans le 7)
// la ligne dont le code motif est LCR et enregistre son numéro de réception dans return_labels.reflex_reception.
// DAYS=14 : traite aussi les 14 derniers jours (rattrapage). Env : REFLEX_USER, REFLEX_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ; facultatif DATE, DRY_RUN
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const { REFLEX_USER, REFLEX_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATE, DAYS, DRY_RUN, BROWSER_CHANNEL } = process.env
for (const [k, v] of Object.entries({ REFLEX_USER, REFLEX_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) if (!v) { console.log(`Secret manquant : ${k} — étape ignorée`); process.exit(0) }

const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]))
const day = DATE || `${p.year}-${p.month}-${p.day}`
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Sources : 1) colis LCR de l'import PDF (table parcels, jours à venir inclus)  2) étiquettes de retour (return_labels)
// Un même BP n'est cherché qu'une fois dans REFLEX ; le numéro est écrit dans toutes les lignes concernées.
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const manual = !!(DATE || DAYS)
const fromDay = DATE ? DATE : DAYS ? addDays(day, -Number(DAYS)) : day
const toDay = DATE ? DATE : DAYS ? day : null // sans option : du jour à tous les jours à venir
const label = toDay ? (fromDay === toDay ? `pour le ${fromDay}` : `du ${fromDay} au ${toDay}`) : `à partir du ${fromDay}`
const recent = r => !manual && r.reflex_checked_at && Date.now() - new Date(r.reflex_checked_at).getTime() < 60 * 60 * 1000 // pas de nouvel essai avant 1 h
const items = []
{
  let q = sb.from('parcels').select('id, barcode, reflex_checked_at, tours!inner(delivery_dates!inner(delivery_date))')
    .eq('exclusion_reason', 'Livraison contre reprise').eq('dea', false).is('reflex_reception', null).gte('tours.delivery_dates.delivery_date', fromDay)
  if (toDay) q = q.lte('tours.delivery_dates.delivery_date', toDay)
  const { data, error } = await q.limit(500)
  if (error) console.log('Colis LCR du PDF ignorés (migration supabase_migration_reflex_lcr.sql lancée ?) :', error.message)
  else for (const r of data || []) if (!recent(r)) items.push({ table: 'parcels', id: r.id, bp: String(r.barcode).trim() })
}
{
  let q = sb.from('return_labels').select('id, barcode, task_date, reflex_checked_at').ilike('reason', '%contre reprise%').is('reflex_reception', null).gte('task_date', fromDay)
  if (toDay) q = q.lte('task_date', toDay)
  const { data, error } = await q.limit(500)
  if (error) throw error
  for (const r of data || []) if (!recent(r)) items.push({ table: 'return_labels', id: r.id, bp: String(r.barcode).replace(/^7/, '').trim() })
}
const groups = new Map()
for (const it of items) { if (!groups.has(it.bp)) groups.set(it.bp, []); groups.get(it.bp).push(it) }
const todo = [...groups].slice(0, 40).map(([bp, its]) => ({ bp, items: its })) // 40 BP max par passage, la suite au passage suivant
console.log(`${todo.length} BP « livraison contre reprise » sans n° de réception ${label}`)
if (!todo.length) process.exit(0)

// BROWSER_CHANNEL=chrome : utilise le Chrome installé sur le PC (évite de télécharger le navigateur de Playwright)
const browser = await chromium.launch({ ...(BROWSER_CHANNEL ? { channel: BROWSER_CHANNEL } : {}), ...(process.env.HEADED ? { headless: false, slowMo: 150 } : {}) })
const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1600, height: 900 } })
let page = await context.newPage()
// Si REFLEX ouvre l'écran dans une nouvelle fenêtre, on bascule dessus
context.on('page', async p => { await p.waitForLoadState('domcontentloaded').catch(() => {}); console.log('  nouvelle fenêtre ouverte :', p.url()); page = p })
const shot = async n => page.screenshot({ path: `reflex-${n}.png`, fullPage: true }).catch(() => {})
const sleep = ms => page.waitForTimeout(ms)

async function login() {
  await page.goto('https://ereflex.cchezvous.fr/reflex/env/production', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name=user]').fill(REFLEX_USER)
  await page.locator('input[name=password]').fill(REFLEX_PASSWORD)
  // La connexion demande un double clic sur la flèche verte, située juste à droite du champ du mot de passe
  const box = await page.locator('input[name=password]').boundingBox()
  for (const dx of [24, 18, 30, 12, 36]) {
    await page.mouse.dblclick(box.x + box.width + dx, box.y + box.height / 2)
    const gone = await page.waitForSelector('input[name=user]', { state: 'detached', timeout: 6000 }).then(() => true).catch(() => false)
    if (gone) break
  }
  if (await page.locator('input[name=user]').count()) {
    await page.locator('input[name=password]').press('Enter')
    await page.waitForSelector('input[name=user]', { state: 'detached', timeout: 15000 }).catch(() => {})
  }
  if (await page.locator('input[name=user]').count()) throw new Error('Connexion REFLEX refusée (identifiants, adresse IP non autorisée ou flèche non trouvée)')
  await sleep(6000)
  console.log('Connecté à REFLEX')
}

// Ouvre « Réceptions » (menu principal -> onglet Réception -> Réceptions)
async function openSelection() {
  const label = { count: () => page.locator('div.a-outputtext', { hasText: /Référence\s+réception/ }).filter({ visible: true }).count() }
  if (await label.count()) return
  // Méthode 1 : zone de recherche de menu en haut à droite -> taper « Réception » puis cliquer sur l'entrée HFRE00
  for (let attempt = 1; attempt <= 3 && !(await label.count()); attempt++) {
    const box = await page.evaluate(() => { const c = [...document.querySelectorAll('input[type=text], input:not([type])')].filter(i => { const r = i.getBoundingClientRect(); return i.offsetParent !== null && r.y < 70 && r.x > window.innerWidth * 0.5 && r.width > 40 }).sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0]; return c ? c.id || null : null })
    if (!box) { console.log('  zone de recherche en haut à droite introuvable'); break }
    const inp = page.locator(`[id="${box}"]`)
    await inp.click().catch(() => {}); await inp.fill('').catch(() => {}); await inp.type('Réception', { delay: 80 }).catch(() => {})
    await sleep(2500)
    const hit = page.getByText(/HFRE00/).filter({ visible: true }).first()
    if (await hit.count()) {
      console.log(`  recherche menu : entrée trouvée (tentative ${attempt})`)
      await hit.dblclick().catch(() => {})
      for (let i = 0; i < 25 && !(await label.count()); i++) await sleep(1000)
      if (await label.count()) { await sleep(500); return }
      await hit.click().catch(() => {}); await sleep(3000)
      if (await label.count()) { await sleep(500); return }
    } else {
      console.log('  recherche menu : aucune entrée HFRE00 ; textes proposés :', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.dijitMenuItem, .dijitReset[role=option], [role=option], li')].filter(e => e.offsetParent !== null).map(e => e.textContent.trim().slice(0, 50)).slice(0, 12))))
      await shot(`recherche-menu-${attempt}`)
    }
  }
  if (await label.count()) return
  const treeItem = () => page.locator('.dijitTreeLabel', { hasText: /^Réceptions$/ }).filter({ visible: true }).first()
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (!(await treeItem().count())) {
      // Icône du menu principal (chariot bleu, en haut à gauche) : on la cherche dans la page, sinon position fixe
      const cands = await page.evaluate(() => [...document.querySelectorAll('button, [role=button], .dijitButton, img, span, div')].filter(e => { const r = e.getBoundingClientRect(); return e.offsetParent !== null && r.y < 40 && r.x < 70 && r.width > 8 && r.width < 70 && r.height > 8 && r.height < 40 }).map(e => { const r = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className).slice(0, 60), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }))
      if (attempt === 1) console.log('  éléments en haut à gauche :', JSON.stringify(cands.slice(0, 8)))
      const pick = cands.find(c => c.tag === 'BUTTON') || cands.find(c => /button/i.test(c.cls)) || cands[0]
      if (pick) await page.mouse.dblclick(pick.x, pick.y); else await page.mouse.dblclick(27, 18) // REFLEX : double clic nécessaire partout
      await sleep(2000)
      const acc = page.locator('.dijitAccordionText', { hasText: /^Réception$/ }).filter({ visible: true }).first()
      if (await acc.count()) { await acc.dblclick().catch(() => {}); await sleep(1500) }
    }
    const items = page.locator('.dijitTreeLabel', { hasText: /^Réceptions$/ }).filter({ visible: true })
    const n = await items.count()
    for (let k = 0; k < n && !(await label.count()); k++) {
      const it = items.nth(k)
      const b = await it.boundingBox().catch(() => null)
      if (!b) continue
      console.log(`  élément « Réceptions » #${k} à (${Math.round(b.x)}, ${Math.round(b.y)}), tentative ${attempt}`)
      await it.scrollIntoViewIfNeeded().catch(() => {})
      const row = it.locator('xpath=ancestor-or-self::*[contains(@class,"dijitTreeRow")][1]')
      const target = (await row.count()) ? row : it
      const mode = attempt % 4
      if (mode === 1) await target.dblclick({ delay: 120 }).catch(() => {})
      else if (mode === 2) { await it.click().catch(() => {}); await sleep(400); await page.keyboard.press('Enter') }
      else if (mode === 3) await it.dblclick({ delay: 200 }).catch(() => {})
      else { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await sleep(80); await page.mouse.up(); await sleep(120); await page.mouse.down(); await sleep(80); await page.mouse.up() }
      for (let i = 0; i < 25 && !(await label.count()); i++) await sleep(1000) // le réseau peut être lent
      if (await label.count()) { await sleep(500); return }
      await shot(`menu-${attempt}-${k}`)
    }
    console.log(`  ouverture de Réceptions : tentative ${attempt} sans résultat`)
  }
  await shot('menu')
  console.log('  textes visibles :', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.dijitTreeLabel, .dijitAccordionText, .dijitMenuItemLabel')].filter(e => e.offsetParent !== null).map(e => e.textContent.trim()).slice(0, 25))))
  throw new Error("Écran « Sélection des réceptions » introuvable")
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
  return page.evaluate(bp => [...document.querySelectorAll('.dgrid-row')].filter(r => r.offsetParent !== null).map(r => [...r.querySelectorAll('td.dgrid-cell')].map(c => c.innerText.trim().replace(/\s+/g, ' '))).filter(c => c.some(x => x === bp || x.includes(bp))), bp)
}

async function closeResults() {
  const q = page.locator('button', { hasText: /^Quitter$/ }).filter({ visible: true }).last()
  if (await q.count()) { await q.click().catch(() => {}); await sleep(800) }
}

const out = []
try {
  await login()
  for (const row of todo) {
    const bp = row.bp
    try {
      await openSelection()
      await search(bp)
      let cells = await readRows(bp)
      for (let i = 0; i < 8 && !cells.length; i++) { await sleep(1500); cells = await readRows(bp) } // résultats parfois lents
      if (!cells.length) {
        await shot(`resultat-${bp}`)
        console.log('  aucune ligne ne correspond ; lignes visibles :', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.dgrid-row')].filter(r => r.offsetParent !== null).slice(0, 5).map(r => [...r.querySelectorAll('td.dgrid-cell')].map(c => c.innerText.trim().replace(/\s+/g, ' '))))))
      }
      console.log('  lignes trouvées :', JSON.stringify(cells))
      // Colonnes repérées par leur contenu (le nombre de colonnes avant « Jour » varie selon l'affichage) :
      // code motif = cellule « LCR », réception = cellule juste avant la référence (= le BP), date = jj/mm/aaaa
      const refIdx = c => c.findIndex(x => x === bp || x.includes(bp))
      const dateOf = c => (c.find(x => /^\d{2}\/\d{2}\/\d{4}$/.test(x)) || '')
      const recOf = c => { const i = refIdx(c); return i > 0 ? c[i - 1] : '' }
      const lcr = cells.filter(c => c.some(x => /^LCR$/i.test(x)) && /^\d+$/.test(recOf(c)))
      const toKey = d => (d || '').split('/').reverse().join('')
      lcr.sort((a, b) => toKey(dateOf(a)).localeCompare(toKey(dateOf(b))))
      const pickRow = lcr[lcr.length - 1]
      const pick = pickRow ? [, , , , , recOf(pickRow)] : null
      console.log(`BP ${bp} : ${cells.length} réception(s), ${lcr.length} LCR -> ${pick ? pick[5] : 'aucune'}`)
      out.push({ items: row.items, reflex_reception: pick ? String(pick[5]).trim() : null, reflex_note: pick ? (lcr.length > 1 ? `${lcr.length} lignes LCR : la plus récente retenue` : null) : (cells.length ? 'Aucune ligne LCR dans REFLEX' : 'Référence introuvable dans REFLEX') })
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
  for (const it of o.items) {
    const { error: ue } = await sb.from(it.table).update(patch).eq('id', it.id)
    if (ue) throw ue
  }
}
console.log(`OK : ${out.filter(o => o.reflex_reception).length}/${todo.length} n° de réception enregistrés`)
