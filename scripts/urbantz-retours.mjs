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
if (!FORCE && !DATE && (mins < 10 * 60 || mins > 20 * 60 + 45)) { console.log(`Il est ${p.hour}h${p.minute} à Paris : extraction prévue de 10h à 20h45, rien à faire.`); process.exit(0) }
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
// L'API Urbantz est passée de backend.urbantz.com à web.urbantz.com/api : on accepte les deux
const TASK_RE = /(backend\.urbantz\.com|web\.urbantz\.com\/api)\/tasks?(\?|\/?$)/
let firstReq = null
const apiCalls = new Map() // diagnostic : appels réseau (xhr/fetch) de la page Urbantz
page.on('request', r => {
  if (!firstReq && ['xhr', 'fetch'].includes(r.resourceType()) && TASK_RE.test(r.url())) firstReq = { url: r.url(), headers: r.headers() }
  if (['xhr', 'fetch'].includes(r.resourceType())) { const u = new URL(r.url()); const k = `${r.method()} ${u.host}${u.pathname}${u.search ? '?' + [...u.searchParams.keys()].join('&') : ''}`; apiCalls.set(k, (apiCalls.get(k) || 0) + 1) }
})
page.on('response', r => { const u = r.url(); if (/urbantz\.com/.test(u) && ['xhr', 'fetch'].includes(r.request().resourceType()) && r.status() >= 400) { const k = `STATUT ${r.status()} ${new URL(u).host}${new URL(u).pathname}`; apiCalls.set(k, (apiCalls.get(k) || 0) + 1) } })
let lastBatch = 0
const taskStatuses = [] // codes HTTP des appels /task (401/403 = connexion refusée)
const pageSnippet = async () => `URL ${page.url()} | texte : ${((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 250)}`
page.on('response', async r => {
  const u = r.url()
  if (TASK_RE.test(u) && ['xhr', 'fetch'].includes(r.request().resourceType())) {
    taskStatuses.push(r.status())
    try { const j = await r.json(); if (Array.isArray(j)) { lastBatch = j.length; for (const t of j) tasks.set(t._id || t.id, t) } } catch {}
  }
})
const urlFor = (d, n) => `https://web.urbantz.com/platform/c-chez-vous/tasks?mode=tasks&from=${d}&to=${d}&page=${n}&discarded=false&dateStyle=single&sort=when:up`
const url = n => urlFor(day, n)
try {
  await page.goto(url(0), { waitUntil: 'domcontentloaded' })
// Attente de la page de connexion OU des données (jusqu'à 20 s) : un délai fixe de 4 s manquait parfois le formulaire quand Urbantz répondait lentement
  for (let i = 0; i < 40; i++) {
    if (tasks.size) break
    if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) break
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(500)
  const pwd = page.locator('input[type="password"]').first()
  if (await pwd.isVisible().catch(() => false) || (await page.locator('input[type="email"], input[name="username"], input[name="email"]').first().isVisible().catch(() => false))) {
    console.log('Page de connexion détectée')
    await page.locator('input[type="email"], input[name="username"], input[name="email"], input[type="text"]').first().fill(URBANTZ_EMAIL)
    if (!(await pwd.isVisible().catch(() => false))) { await page.keyboard.press('Enter'); await page.waitForTimeout(2000) }
    await page.locator('input[type="password"]').first().fill(URBANTZ_PASSWORD)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(6000)
    console.log('Après la saisie des identifiants :', await pageSnippet())
    await page.goto(url(0), { waitUntil: 'domcontentloaded' })
  }
  for (let i = 0; i < 20 && !tasks.size; i++) await page.waitForTimeout(1500)
  if (!tasks.size) { console.log(`Aucune tâche Urbantz pour ${day} (jour férié ? connexion refusée ?) | codes HTTP des appels /task : ${JSON.stringify(taskStatuses)} | appels réseau de la page : ${JSON.stringify([...apiCalls].filter(([k]) => !/launchdarkly|sentry|google|amplitude|cdn-cgi|analytics/.test(k)).slice(0, 60))} | ${await pageSnippet()}`); await page.screenshot({ path: 'urbantz-erreur.png', fullPage: true }).catch(() => {}); if (FORCE || DATE) throw new Error('Aucune tâche lue') }
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
// Diagnostic note client : DEBUG_NOTIF=1 [DEBUG_TASK=<id ou n° de tâche>] -> cherche où Urbantz expose l'enquête de satisfaction (onglet Communications)
if (process.env.DEBUG_NOTIF && firstReq) {
  const headers = Object.fromEntries(Object.entries(firstReq.headers).filter(([k]) => !/^(host|content-length|connection|accept-encoding)$/i.test(k) && !k.startsWith(':')))
  const base = firstReq.url.split(/\/tasks?(\?|$)/)[0]
  const all = [...tasks.values()]
  const want = process.env.DEBUG_TASK
  const t = (want && all.find(x => [x._id, x.id, x.taskId, x.number].some(v => v && String(v).includes(want)))) || all.find(x => /DELIVERED|COMPLETED/i.test(JSON.stringify(x.log || []))) || all[0]
  const tid = t?._id || t?.id
  console.log(`DEBUG NOTIF tâche ${tid} (${t?.taskId || t?.number || ''}) | clés : ${Object.keys(t || {}).join(',').slice(0, 600)}`)
  const grep = (o, pa, out) => { if (o == null) return; if (typeof o === 'string') { if (/survey|enqu[eê]te|satisf|rating|note/i.test(pa + ' ' + o)) out.push(`${pa}=${o.slice(0, 80)}`) } else if (typeof o === 'object') for (const [k, v] of Object.entries(o)) grep(v, pa + '.' + k, out) }
  const own = []; grep(t, '', own); console.log('DEBUG NOTIF champs « enquête » dans la tâche de la liste :', JSON.stringify(own.slice(0, 15)))
  for (const path of [`/task/${tid}`, `/task/${tid}/notifications`, `/task/${tid}/communications`, `/task/${tid}/timeline`, `/task/${tid}/messages`, `/notification?task=${tid}`, `/notifications?task=${tid}`, `/notification?taskId=${tid}`, `/communication?task=${tid}`, `/message?task=${tid}`, `/survey?task=${tid}`]) {
    try {
      const resp = await page.context().request.get(base + path, { headers })
      const txt = await resp.text()
      const hits = []; try { grep(JSON.parse(txt), '', hits) } catch {}
      console.log(`DEBUG NOTIF ${path} -> HTTP ${resp.status()}, ${txt.length} car. | ${txt.slice(0, 160).replace(/\s+/g, ' ')} | enquête : ${JSON.stringify(hits.slice(0, 8))}`)
    } catch (e) { console.log(`DEBUG NOTIF ${path} : erreur ${e.message}`) }
  }
  // /notifications existe (HTTP 400 = paramètre attendu) : message complet puis variantes de paramètres
  for (const q of ['', `?task=${tid}`, `?taskId=${tid}`, `?tasks=${tid}`, `?id=${tid}`, `?entityId=${tid}`, `?resource=${tid}`, `?target=${tid}`, `?task=${t?.taskId}`, `?taskId=${t?.taskId}`, `?objectId=${tid}`, `?type=task&id=${tid}`, `?entity=task&entityId=${tid}`, `?resourceType=task&resourceId=${tid}`]) {
    try {
      const resp = await page.context().request.get(base + '/notifications' + q, { headers })
      const txt = await resp.text(); const hits = []; try { grep(JSON.parse(txt), '', hits) } catch {}
      console.log(`DEBUG NOTIF /notifications${q} -> HTTP ${resp.status()}, ${txt.length} car. | ${txt.slice(0, 700).replace(/\s+/g, ' ')} | enquête : ${JSON.stringify(hits.slice(0, 6))}`)
    } catch (e) { console.log(`DEBUG NOTIF /notifications${q} : erreur ${e.message}`) }
  }
  // appels réseau émis par la page de la tâche ouverte dans l'interface
  const seen = []
  page.on('response', r => { const u = r.url(); if (/urbantz/.test(u) && ['xhr', 'fetch'].includes(r.request().resourceType())) seen.push(u.replace(/^https?:\/\/[^/]+/, '')) })
  try {
    await page.goto(`https://web.urbantz.com/dashboard/tasks?taskId=${tid}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000)
    await page.getByText(/communications/i).first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(4000)
    console.log('DEBUG NOTIF appels de la page tâche :', JSON.stringify([...new Set(seen)].filter(u => !/launchdarkly|sentry|amplitude/.test(u)).slice(0, 40)))
  } catch (e) { console.log('DEBUG NOTIF page tâche : ' + e.message) }
}
await browser.close()

// Heure de départ réelle du dépôt par tournée : événement « départ » du journal des colis (identique sur tous les colis d'une tournée)
{
  const byRound = new Map()
  for (const t of tasks.values()) { const c = matchCode(t.roundName); if (c) { if (!byRound.has(c)) byRound.set(c, []); byRound.get(c).push(t) } }
  const sec = w => new Date(w).toISOString().slice(0, 19)
  const departs = new Map(), scans = new Map()
  for (const [code, ts] of byRound) {
    const entries = t => [...(Array.isArray(t.log) ? t.log : []), ...(t.items || []).flatMap(i => Array.isArray(i.log) ? i.log : [])].filter(e => e && e.when)
    const named = ts.flatMap(entries).filter(e => /depart/i.test(JSON.stringify(e)))
    let when = named.length ? named.map(e => e.when).sort()[0] : null, how = 'journal « départ »'
    if (!when) { // à défaut : dernier événement commun à (presque) tous les colis de la tournée
      const cnt = new Map()
      for (const t of ts) for (const w of new Set(entries(t).map(e => sec(e.when)))) cnt.set(w, (cnt.get(w) || 0) + 1)
      const shared = [...cnt].filter(([, n]) => ts.length >= 3 && n >= 0.8 * ts.length).map(([w]) => w).sort()
      when = shared.length ? shared[shared.length - 1] + 'Z' : null; how = 'dernier événement commun'
    }
    if (when) departs.set(code, { when, how })
    // Premier scan : première action « to progress ASSIGNED / status PREPARED » du jour parmi les journaux de toutes les tâches de la tournée
    const dayOf = w => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(w))
    const all = ts.flatMap(entries)
    // Journal des colis : { when, to: 'PREPARED', by } (l'écran Urbantz l'affiche « to progress ASSIGNED status PREPARED ») ; par: non nul = fait par un utilisateur
    const prep = all.filter(e => e.to === 'PREPARED' && dayOf(e.when) === day)
    scans.set(code, { when: prep.length ? prep.map(e => e.when).sort()[0] : null, n: all.length })
  }
  const hm = w => new Date(w).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
  console.log(`Départs dépôt Urbantz : ${departs.size}/${byRound.size} tournées`, [...departs].slice(0, 6).map(([c, d]) => `${c} ${hm(d.when)} (${d.how})`).join(', '))
  const okScans = [...scans].filter(([, v]) => v.when)
  console.log(`Premiers scans Urbantz : ${okScans.length}/${byRound.size} tournées (entrées de journal lues : ${[...scans.values()].reduce((a, v) => a + v.n, 0)})`, okScans.slice(0, 6).map(([c, v]) => `${c} ${hm(v.when)}`).join(', '))
  if (!DRY_RUN && dRow && okScans.length) {
    const { data: trs2, error: e2 } = await sb.from('tours').select('id, name, urbantz_premier_scan, tours_references(name)').eq('delivery_date_id', dRow.id)
    if (e2) console.log('Premiers scans non enregistrés (migration supabase_migration_premier_scan.sql lancée ?)')
    else for (const t of trs2 || []) { const v = scans.get(t.tours_references?.name || t.name); if (v?.when && !t.urbantz_premier_scan) await sb.from('tours').update({ urbantz_premier_scan: v.when }).eq('id', t.id) }
  }
  if (!DRY_RUN && dRow && departs.size) {
    const { data: trs } = await sb.from('tours').select('id, name, urbantz_depart_reel, tours_references(name)').eq('delivery_date_id', dRow.id)
    if (trs) for (const t of trs) { const d = departs.get(t.tours_references?.name || t.name); if (d && !t.urbantz_depart_reel) await sb.from('tours').update({ urbantz_depart_reel: d.when }).eq('id', t.id) }
    else console.log('Départs dépôt non enregistrés (migration supabase_migration_depart_reel.sql lancée ?)')
  }
}

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
// Rattrapage : étiquettes sans tournée reconnue (tournée importée dans l'application après leur lecture) -> on retente le rapprochement
{
  const { data: orph } = await sb.from('return_labels').select('id, task_date, round_name').is('tour_code', null).not('round_name', 'is', null).gte('task_date', new Date(Date.parse(day + 'T12:00:00Z') - 14 * 864e5).toISOString().slice(0, 10))
  const byDate = new Map()
  for (const l of orph || []) { if (!byDate.has(l.task_date)) byDate.set(l.task_date, []); byDate.get(l.task_date).push(l) }
  let fixed = 0
  for (const [d, ls] of byDate) {
    const { data: dd } = await sb.from('delivery_dates').select('id').eq('delivery_date', d).maybeSingle()
    if (!dd) continue
    const { data: tt } = await sb.from('tours').select('name, tours_references(name)').eq('delivery_date_id', dd.id)
    const dayCodes = (tt || []).map(t => t.tours_references?.name || t.name)
    for (const l of ls) {
      const n = String(l.round_name || '').toUpperCase().replace(/^TA830CAMION/, '')
      const c = [...dayCodes].sort((a, b) => b.length - a.length).find(c => { const i = n.indexOf(String(c).toUpperCase()); return i >= 0 && !/\d/.test(n[i + String(c).length] || '') })
      if (c) { if (!DRY_RUN) await sb.from('return_labels').update({ tour_code: c }).eq('id', l.id); fixed++ }
    }
  }
  if (fixed) console.log(`${fixed} étiquette(s) rattachée(s) à une tournée${DRY_RUN ? ' (simulation)' : ''}`)
}
console.log('OK')
await report(true, `${rows.size} colis à retourner pour le ${day}`)
