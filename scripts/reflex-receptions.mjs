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
const JOB = 'reflex'
// Suivi d'exécution : une ligne par automatisme (table job_runs), affichée dans « Suivi des tournées »
const report = async (ok, msg) => { if (DRY_RUN) return; try { await sb.from('job_runs').upsert({ job: JOB, last_run: new Date().toISOString(), ok, message: String(msg || '').slice(0, 300) }) } catch {} }
const done = async msg => { await report(true, msg); process.exit(0) }
process.on('uncaughtException', e => { report(false, e?.message || e).finally(() => { console.error(e); process.exit(1) }) })

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
  let q = sb.from('return_labels').select('id, barcode, task_date, reflex_checked_at, item_name, item_description').ilike('reason', '%contre reprise%').is('reflex_reception', null).gte('task_date', fromDay)
  if (toDay) q = q.lte('task_date', toDay)
  const { data, error } = await q.limit(500)
  if (error) throw error
  const isDea = r => /(^|[^A-Z0-9])DEA([^A-Z0-9]|$)/i.test(`${r.item_name || ''} ${r.item_description || ''}`) // DEA : pas de n° de réception nécessaire
  for (const r of data || []) if (!recent(r) && !isDea(r)) items.push({ table: 'return_labels', id: r.id, bp: String(r.barcode).replace(/^7/, '').trim() })
}
// ── Retours attendus depuis plus de 3 jours : on contrôle d'abord dans REFLEX (« Recherche article new ») que le colis n'est pas revenu ;
//    s'il n'y est pas, demande « Autres » sur le BP : « Vérifier que le colis n'est pas revenu » (une seule par colis grâce à overdue_demande_id) ──
const OVERDUE_DAYS = 3, OVERDUE_FROM = '2026-11-16'
const lateGroups = new Map()
{
  const limit = addDays(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()), -OVERDUE_DAYS)
  const { data: late, error: le } = await sb.from('return_labels').select('id, barcode, reason, tour_code, task_date')
    .is('received_at', null).is('overdue_demande_id', null).gte('task_date', OVERDUE_FROM).lte('task_date', limit)
    .or('reflex_recv_status.is.null,reflex_recv_status.neq.receptionne').limit(500)
  if (le) console.log('Demandes de retard ignorées (migration supabase_migration_reflex_verification.sql lancée ?) :', le.message)
  else for (const l of late || []) {
    const bp = /contre reprise/i.test(l.reason || '') ? String(l.barcode).replace(/^7/, '').trim() : String(l.barcode).trim()
    if (!lateGroups.has(bp)) lateGroups.set(bp, [])
    lateGroups.get(bp).push(l)
  }
}
console.log(`${lateGroups.size} BP en retard de retour (> ${OVERDUE_DAYS} jours) à contrôler dans REFLEX`)
const lateCheck = [] // { bp, labels, found, date, error }

// ── Phase 2 : vérifier dans REFLEX que les colis dont la réception est accusée dans Superflash y sont bien réceptionnés ──
// Ligne la plus récente du BP dans REFLEX : colonne « Manquants » > 0 -> non réceptionné ; sinon -> réceptionné.
// À 18h (heure de Paris) ou après : toute réception accusée ici mais non réceptionnée dans REFLEX crée une demande « Réception REFLEX à réaliser ».
const VERIF_FROM = '2026-11-16'
const pHour = iso => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)))
const pDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso))
const nowIso = new Date().toISOString()
const after18 = pHour(nowIso) >= 18
const verifGroups = new Map()
{
  const { data, error } = await sb.from('return_labels')
    .select('id, barcode, reason, tour_code, task_date, received_at, reflex_recv_status, reflex_recv_checked_at, reflex_demande_id')
    .not('received_at', 'is', null).gte('task_date', VERIF_FROM).or('reflex_recv_status.is.null,reflex_recv_status.neq.receptionne').order('reflex_recv_checked_at', { ascending: true, nullsFirst: true }).limit(500)
  if (error) console.log('Vérification des réceptions ignorée (migration supabase_migration_reflex_verification.sql lancée ?) :', error.message)
  else for (const r of data || []) {
    // Tout BP pas encore « réceptionné » dans REFLEX est revérifié à chaque passage (il a pu être réceptionné depuis) ;
    // les moins récemment vérifiés passent en premier
    const bp = /contre reprise/i.test(r.reason || '') ? String(r.barcode).replace(/^7/, '').trim() : String(r.barcode).trim()
    if (!verifGroups.has(bp)) verifGroups.set(bp, [])
    verifGroups.get(bp).push(r)
  }
}
const verif = [...verifGroups].slice(0, 60).map(([bp, labels]) => ({ bp, labels }))
console.log(`${verif.length} BP à vérifier dans REFLEX (réception accusée dans Superflash)`)

const groups = new Map()
for (const it of items) { if (!groups.has(it.bp)) groups.set(it.bp, []); groups.get(it.bp).push(it) }
const todo = [...groups].slice(0, 40).map(([bp, its]) => ({ bp, items: its })) // 40 BP max par passage, la suite au passage suivant
console.log(`${todo.length} BP « livraison contre reprise » sans n° de réception ${label}`)
if (!todo.length && !verif.length && !lateGroups.size) await done('Rien à faire (aucun colis LCR en attente, aucune réception à vérifier, aucun retour en retard)')

// BROWSER_CHANNEL=chrome : utilise le Chrome installé sur le PC (évite de télécharger le navigateur de Playwright)
const browser = await chromium.launch({ ...(BROWSER_CHANNEL ? { channel: BROWSER_CHANNEL } : {}), ...(process.env.HEADED ? { headless: false, slowMo: 150 } : {}) })
const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1600, height: 900 } })
let page = await context.newPage()
// Si REFLEX ouvre l'écran dans une nouvelle fenêtre, on bascule dessus
context.on('page', async p => {
  await p.waitForLoadState('domcontentloaded').catch(() => {})
  console.log('  nouvelle fenêtre ouverte :', p.url())
  page = p
  // Si cette fenêtre se ferme (REFLEX en ouvre parfois une éphémère), on revient sur la dernière fenêtre encore ouverte
  p.on('close', () => {
    if (page !== p) return
    const open = context.pages().filter(x => !x.isClosed())
    if (open.length) { page = open[open.length - 1]; console.log('  fenêtre fermée : retour sur', page.url()) }
  })
})
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
  try {
    const q = page.locator('button', { hasText: /^Quitter$/ }).filter({ visible: true }).last()
    if (await q.count()) { await q.click().catch(() => {}); await sleep(800) }
  } catch (e) {
    // Page fermée : on reprend sur une fenêtre ouverte, sinon on arrête proprement (navigateur fermé)
    const open = context.pages().filter(x => !x.isClosed())
    if (!open.length) throw new Error('Navigateur fermé pendant l\'exécution (ne pas fermer la fenêtre REFLEX)')
    page = open[open.length - 1]
  }
}


// ── Contrôle complémentaire : écran « Recherche article new » ─────────────────────────────
// Si le BP remonte « manquant » / « introuvable » dans Réceptions, on cherche une ligne de
// l'utilisateur ARTICLE_USER (par défaut « Victor AMBLARD ») dont la date est >= au jour de l'accusé de réception.
const ARTICLE_USER = (process.env.ARTICLE_USER || 'Victor AMBLARD')
const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
// Dates lues : j/m/aa, jj/mm/aa, jj/mm/aaaa (séparateurs / . -), aaaa-mm-jj -> clé aaaammjj
const dateKeys = t => {
  const x = String(t || ''), out = [], p2 = n => String(n).padStart(2, '0')
  for (const m of x.matchAll(/(?<![\d\/.\-])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?![\d\/.\-])/g)) out.push((m[3].length === 2 ? '20' + m[3] : m[3]) + p2(m[2]) + p2(m[1]))
  for (const m of x.matchAll(/(?<![\d\/.\-])(\d{4})-(\d{2})-(\d{2})(?![\d\/.\-])/g)) out.push(m[1] + m[2] + m[3])
  return out
}

// Champs de saisie visibles (page + cadres), hors zone de recherche du menu (en haut à droite)
async function visibleInputIds() {
  const ids = []
  for (const fr of page.frames()) {
    const l = await fr.evaluate(() => [...document.querySelectorAll('input, textarea')].filter(i => { const r = i.getBoundingClientRect(); return i.getClientRects().length > 0 && r.width > 30 && !['hidden', 'checkbox', 'radio', 'button', 'submit', 'image'].includes(i.type) && !(r.y < 70 && r.x > window.innerWidth * 0.5) }).map(i => i.id || i.name || `${Math.round(i.getBoundingClientRect().x)}x${Math.round(i.getBoundingClientRect().y)}`)).catch(() => [])
    ids.push(...l)
  }
  return ids
}

async function openArticleSearch() {
  if ((await visibleInputIds()).length) return true
  const base = new Set(await visibleInputIds())
  const opened = async () => (await visibleInputIds()).some(id => !base.has(id))
  const waitOpen = async (secs = 12) => { for (let i = 0; i < secs; i++) { if (await opened()) return true; await sleep(1000) } return false }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const boxId = await page.evaluate(() => { const c = [...document.querySelectorAll('input[type=text], input:not([type])')].filter(i => { const r = i.getBoundingClientRect(); return i.offsetParent !== null && r.y < 70 && r.x > window.innerWidth * 0.5 && r.width > 40 }).sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0]; return c ? c.id || null : null })
    if (!boxId) { console.log('  zone de recherche en haut à droite introuvable'); return false }
    const inp = page.locator(`[id="${boxId}"]`)
    await inp.click().catch(() => {}); await inp.fill('').catch(() => {}); await inp.type('Recherche article', { delay: 80 }).catch(() => {})
    await sleep(2500)

    // 1) Liste de suggestions déroulante sous la zone de recherche
    const sugg = page.locator('.dijitComboBoxMenu .dijitMenuItem, .dijitMenuItem, [role=option]').filter({ visible: true })
    const sTexts = await sugg.evaluateAll(els => els.map(e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 70))).catch(() => [])
    console.log(`  suggestions (tentative ${attempt}) :`, JSON.stringify(sTexts.slice(0, 12)))
    const idx = sTexts.findIndex(t => /article\s+new/i.test(t))
    if (idx >= 0) {
      const it = sugg.nth(idx)
      await it.dblclick({ delay: 120 }).catch(() => {})
      if (await waitOpen()) { await sleep(1000); return true }
      await inp.click().catch(() => {}); await sleep(800)
      await it.click().catch(() => {}); await sleep(400); await page.keyboard.press('Enter')
      if (await waitOpen()) { await sleep(1000); return true }
    }
    // clavier : flèche bas jusqu'à l'entrée « article new » puis Entrée
    await inp.click().catch(() => {}); await inp.fill('').catch(() => {}); await inp.type('Recherche article new', { delay: 80 }).catch(() => {})
    await sleep(2000)
    await page.keyboard.press('ArrowDown').catch(() => {}); await sleep(300); await page.keyboard.press('Enter').catch(() => {})
    if (await waitOpen(8)) { await sleep(1000); return true }

    // 2) Arborescence du menu
    const tree = page.locator('.dijitTreeLabel', { hasText: /Recherche\s+Article\s+New/i }).filter({ visible: true })
    const n = await tree.count()
    for (let k = 0; k < n; k++) {
      const it = tree.nth(k)
      const b = await it.boundingBox().catch(() => null)
      if (!b) continue
      console.log(`  arborescence : « Recherche Article New » #${k} à (${Math.round(b.x)}, ${Math.round(b.y)}), tentative ${attempt}`)
      await it.scrollIntoViewIfNeeded().catch(() => {})
      const row = it.locator('xpath=ancestor-or-self::*[contains(@class,"dijitTreeRow")][1]')
      const target = (await row.count()) ? row.first() : it
      for (const mode of [1, 2, 3]) {
        if (mode === 1) await target.dblclick({ delay: 120 }).catch(() => {})
        else if (mode === 2) { await it.click().catch(() => {}); await sleep(400); await page.keyboard.press('Enter') }
        else await it.dblclick({ delay: 250 }).catch(() => {})
        if (await waitOpen(8)) { await sleep(1000); return true }
      }
    }
    await shot(`article-ouverture-${attempt}`)
    console.log(`  ouverture de Recherche Article New : tentative ${attempt} sans résultat ; champs visibles :`, JSON.stringify(await visibleInputIds()))
  }
  return false
}

// Retourne { found, date, rows } : found = une ligne de ARTICLE_USER datée >= minKey (aaaammjj)
async function articleSearchCheck(bp, minKey) {
  if (!(await openArticleSearch())) return { found: false, error: 'écran Recherche article new introuvable' }
  // Champ de saisie : on cherche dans la page ET dans les cadres intégrés (iframes), en excluant la zone de recherche du menu
  // (en haut à droite). On privilégie le champ dont le libellé (sur la même ligne) parle d'article / référence / code.
  const scan = fr => fr.evaluate(() => {
    const vis = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
    const labs = [...document.querySelectorAll('div.a-outputtext, label, span')].filter(vis).filter(e => e.children.length === 0 && e.textContent.trim()).map(e => ({ t: e.textContent.trim(), r: e.getBoundingClientRect() }))
    const inputs = [...document.querySelectorAll('input, textarea')].filter(i => vis(i) && !['hidden', 'checkbox', 'radio', 'button', 'submit', 'image'].includes(i.type))
    return {
      fields: inputs.map(i => {
        const r = i.getBoundingClientRect()
        const lab = labs.filter(l => Math.abs((l.r.y + l.r.height / 2) - (r.y + r.height / 2)) < 14 && l.r.x < r.x).sort((a, b) => b.r.x - a.r.x)[0]
        return { id: i.id, name: i.name || '', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), topRight: r.y < 70 && r.x > window.innerWidth * 0.5, label: lab ? lab.t : '', value: i.value || '' }
      }),
      texts: labs.slice(0, 30).map(l => l.t.slice(0, 40)),
    }
  }).catch(() => ({ fields: [], texts: [] }))
  let target = null, diag = []
  for (let attempt = 1; attempt <= 6 && !target; attempt++) {
    diag = []
    for (const fr of page.frames()) {
      const res = await scan(fr)
      diag.push({ frame: fr.url().slice(0, 80), fields: res.fields, texts: res.texts })
      const cands = res.fields.filter(f => !f.topRight && f.w > 40 && f.x >= 0 && f.y >= 0) // hors champs cachés (coordonnées négatives)
      const f = cands.find(f => /^BP\s+Article/i.test(f.label)) || cands.find(f => /article/i.test(f.label)) || cands.find(f => /r[ée]f[ée]rence|code|ean|gtin/i.test(f.label)) || cands[0]
      if (f && !target) target = { fr, f }
    }
    if (!target) await sleep(2000)
  }
  console.log('  Recherche article : champs/textes visibles :', JSON.stringify(diag.map(d => ({ frame: d.frame, fields: d.fields.slice(0, 8), texts: d.texts.slice(0, 20) }))))
  if (!target) { await shot(`article-champ-${bp}`); return { found: false, error: 'champ de saisie introuvable' } }
  console.log(`  Recherche article : champ retenu « ${target.f.label || target.f.name || target.f.id} »`)
  const input = target.f.id ? target.fr.locator(`[id="${target.f.id}"]`) : target.fr.locator('input').nth(0)
  await input.click(); await input.fill(''); await input.type(bp)
  await input.press('Enter').catch(() => {})
  const ok = target.fr.locator('button.a-default-button, button', { hasText: /^(OK|Rechercher|Recherche|Valider)$/ }).filter({ visible: true }).last()
  if (await ok.count()) await ok.dblclick().catch(() => {})
  await sleep(3500)
  const readAll = () => target.fr.evaluate(() => [...document.querySelectorAll('.dgrid-row')].filter(r => r.offsetParent !== null).map(r => [...r.querySelectorAll('td.dgrid-cell')].map(c => c.innerText.trim().replace(/\s+/g, ' '))))
  let rows = await readAll()
  for (let i = 0; i < 6 && !rows.length; i++) { await sleep(1500); rows = await readAll() }
  const who = norm(ARTICLE_USER)
  const mine = rows.filter(r => norm(r.join(' ')).includes(who))
  const best = mine.map(r => ({ r, key: dateKeys(r.join(' ')).sort().pop() || '' })).filter(x => x.key).sort((a, b) => a.key.localeCompare(b.key)).pop()
  console.log('  lignes de ' + ARTICLE_USER + ' :', JSON.stringify(mine.slice(0, 6)))
  if (!mine.length) console.log('  premières lignes :', JSON.stringify(rows.slice(0, 3)))
  console.log(`  Recherche article ${bp} : ${rows.length} ligne(s), ${mine.length} de « ${ARTICLE_USER} »${best ? `, plus récente ${best.key.slice(6)}/${best.key.slice(4, 6)}/${best.key.slice(0, 4)}` : ''}`)
  if (!rows.length) await shot(`article-vide-${bp}`)
  await closeResults()
  if (best && best.key >= minKey) return { found: true, date: `${best.key.slice(6)}/${best.key.slice(4, 6)}/${best.key.slice(0, 4)}`, rows: rows.length }
  return { found: false, rows: rows.length }
}

const out = [], vOut = []
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
      out.push({ items: row.items, reflex_reception: pick ? String(pick[5]).trim() : null, reflex_note: pick ? (lcr.length > 1 ? `${lcr.length} lignes LCR : la plus récente retenue` : null) : (cells.length ? 'Absence de ligne de réception' : 'Référence introuvable dans REFLEX') })
      await closeResults()
    } catch (e) { console.log(`BP ${bp} : erreur ${e.message}`); await shot(`erreur-${bp}`); await closeResults() }
  }
  // Phase 2 : vérification des réceptions accusées
  for (const v of verif) {
    const bp = v.bp
    try {
      await openSelection()
      await search(bp)
      let cells = await readRows(bp)
      for (let i = 0; i < 8 && !cells.length; i++) { await sleep(1500); cells = await readRows(bp) }
      const toKey = d => (d || '').split('/').reverse().join('')
      const dateOf = c => (c.find(x => /^\d{2}\/\d{2}\/\d{4}$/.test(x)) || '')
      const rows = cells.filter(c => dateOf(c)).sort((a, b) => toKey(dateOf(a)).localeCompare(toKey(dateOf(b))))
      const last = rows[rows.length - 1]
      let status = 'introuvable', line = null
      if (last) {
        const r = last.findIndex(x => x === bp || x.includes(bp))
        const manq = parseInt(last[r + 3]) || 0
        status = manq > 0 ? 'manquant' : 'receptionne'
        line = dateOf(last)
      }
      console.log(`Vérif BP ${bp} : ${rows.length} ligne(s), plus récente ${line || '—'} -> ${status}`)
      await closeResults()
      if (status !== 'receptionne') {
        // Contrôle complémentaire : ligne de Victor AMBLARD dans « Recherche article new », datée >= accusé de réception
        const minKey = v.labels.map(l => l.received_at ? pDay(l.received_at).replace(/-/g, '') : '').filter(Boolean).sort().pop() || '00000000'
        try {
          const alt = await articleSearchCheck(bp, minKey)
          if (alt.error) console.log(`  Recherche article ${bp} : ${alt.error}`)
          if (alt.found) { status = 'receptionne'; line = `${alt.date} (Recherche article)`; console.log(`Vérif BP ${bp} -> receptionne (Recherche article, ${ARTICLE_USER} le ${alt.date})`) }
        } catch (e) { console.log(`  Recherche article ${bp} : erreur ${e.message}`); await closeResults() }
      }
      vOut.push({ ...v, status, line })
    } catch (e) { console.log(`Vérif BP ${bp} : erreur ${e.message}`); await shot(`erreur-verif-${bp}`); await closeResults() }
  }
  // Retours en retard : le colis est-il déjà réceptionné dans REFLEX ? (ligne de ARTICLE_USER datée >= date de la tournée)
  for (const [bp, labels] of [...lateGroups].slice(0, 25)) {
    try {
      const minKey = labels.map(l => String(l.task_date).replace(/-/g, '')).sort().pop()
      const alt = await articleSearchCheck(bp, minKey)
      console.log(`Retour en retard ${bp} : ${alt.error ? 'contrôle REFLEX impossible (' + alt.error + ')' : alt.found ? 'déjà réceptionné dans REFLEX le ' + alt.date : 'non réceptionné dans REFLEX'}`)
      lateCheck.push({ bp, labels, found: !!alt.found, date: alt.date || null, error: alt.error || null })
    } catch (e) { console.log(`Retour en retard ${bp} : erreur ${e.message}`); await closeResults() }
  }
} catch (e) {
  await shot('erreur'); await browser.close(); throw e
}
await browser.close()

if (DRY_RUN) { console.log('DRY_RUN : rien écrit', JSON.stringify(out), JSON.stringify(vOut.map(v => ({ bp: v.bp, status: v.status }))), 'retards :', JSON.stringify(lateCheck.map(g => ({ bp: g.bp, found: g.found, date: g.date, error: g.error })))); process.exit(0) }
for (const o of out) {
  const patch = { reflex_checked_at: new Date().toISOString(), reflex_note: o.reflex_note }
  if (o.reflex_reception) patch.reflex_reception = o.reflex_reception
  for (const it of o.items) {
    const { error: ue } = await sb.from(it.table).update(patch).eq('id', it.id)
    if (ue) throw ue
  }
}
// Écriture des vérifications + demandes « Réception REFLEX à réaliser » (à partir de 18h)
let demandes = 0
if (vOut.length) {
  let creator = process.env.DEMANDE_USER_ID || null
  if (!creator && after18) creator = (await sb.from('users').select('id').eq('role', 'admin').limit(1)).data?.[0]?.id || null
  for (const v of vOut) {
    let demandeId = null
    const needDemande = after18 && v.status !== 'receptionne' && v.labels.some(l => !l.reflex_demande_id) && creator
    if (needDemande) {
      const tours = [...new Set(v.labels.map(l => `${l.tour_code || '—'} du ${l.task_date.split('-').reverse().join('.')}`))].join(', ')
      const { data: dem, error: de } = await sb.from('demandes').insert({
        type: 'reception_reflex', bp: [v.bp], photos: [], status: 'ouverte', created_by: creator,
        commentaire: `Réception accusée dans Superflash (${tours}) mais colis ${v.status === 'manquant' ? 'non réceptionné' : 'introuvable'} dans REFLEX à 18h : réception REFLEX à réaliser.`,
      }).select('id').single()
      if (de) console.log(`Demande non créée pour ${v.bp} : ${de.message}`); else { demandeId = dem.id; demandes++ }
    }
    for (const l of v.labels) {
      const { error: ve } = await sb.from('return_labels').update({
        reflex_recv_status: v.status, reflex_recv_checked_at: new Date().toISOString(), reflex_recv_line: v.line,
        ...(demandeId && !l.reflex_demande_id ? { reflex_demande_id: demandeId } : {}),
      }).eq('id', l.id)
      if (ve) throw ve
    }
  }
}
// Retours en retard : déjà réceptionnés dans REFLEX -> pas de demande, mais une défaillance (accusé de réception manquant) ; sinon demande « Vérifier que le colis n'est pas revenu »
let lateDemandes = 0, lateInReflex = 0
if (lateCheck.length) {
  const creator = process.env.DEMANDE_USER_ID || (await sb.from('users').select('id').eq('role', 'admin').limit(1)).data?.[0]?.id
  for (const g of lateCheck) {
    if (g.error) continue // contrôle REFLEX impossible : on réessaiera au prochain passage
    const ids = g.labels.map(l => l.id)
    const tours = [...new Set(g.labels.map(l => `${l.tour_code || '—'} du ${l.task_date.split('-').reverse().join('.')}`))].join(', ')
    if (g.found) {
      // Réceptionné dans REFLEX mais accusé de réception non fait dans Superflash -> défaillance (processus « Retour entrant »)
      const { error: fe } = await sb.from('defaillances').insert({
        type: 'autre', processus: 'Retour entrant', bp: [g.bp], photos: [], status: 'ouverte', created_by: creator,
        commentaire: `Colis réceptionné dans REFLEX (ligne ${ARTICLE_USER} du ${g.date}) mais accusé de réception non effectué dans Superflash. Retour attendu : ${tours}.`,
      })
      if (fe) { console.log(`Défaillance non créée pour ${g.bp} : ${fe.message}`); continue } // on réessaiera au prochain passage
      // Marqué « réceptionné dans REFLEX » : le colis sort des prochains contrôles (donc une seule défaillance par colis)
      await sb.from('return_labels').update({ reflex_recv_status: 'receptionne', reflex_recv_checked_at: new Date().toISOString(), reflex_recv_line: `${g.date} (Recherche article)` }).in('id', ids)
      lateInReflex++
      continue
    }
    const { data: dem, error: de } = await sb.from('demandes').insert({
      type: 'autre', bp: [g.bp], photos: [], status: 'ouverte', created_by: creator,
      commentaire: `Vérifier que le colis n'est pas revenu. Retour attendu (${tours}) non réceptionné depuis plus de ${OVERDUE_DAYS} jours (contrôlé dans REFLEX : pas de réception).`,
    }).select('id').single()
    if (de) { console.log(`Demande de retard non créée pour ${g.bp} : ${de.message}`); continue }
    lateDemandes++
    await sb.from('return_labels').update({ overdue_demande_id: dem.id }).in('id', ids)
  }
  console.log(`Retours en retard : ${lateDemandes} demande(s) créée(s), ${lateInReflex} déjà réceptionné(s) dans REFLEX (défaillance créée)`)
}
const okMsg = `${out.filter(o => o.reflex_reception).length}/${todo.length} n° de réception ; ${vOut.filter(v => v.status === 'receptionne').length}/${verif.length} réceptions vérifiées${demandes ? `, ${demandes} demande(s) créée(s)` : ''}${lateDemandes || lateInReflex ? `, retards : ${lateDemandes} demande(s), ${lateInReflex} défaillance(s)` : ''}`
console.log('OK : ' + okMsg)
await report(true, okMsg)
