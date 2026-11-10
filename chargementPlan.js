// Plan de chargement : règle de priorité
//   1) heure de première arrivée prévue dans Urbantz (« eta », à la minute) quand elle est importée,
//      sinon heure de première livraison du PDF (la plus tôt d'abord)
//   2) éloignement d'Antony (92160) du code postal de la première livraison (le plus lointain d'abord) :
//      - mode « temps » (par défaut) : temps de trajet estimé, calibré sur les trajets réels d'Urbantz
//      - mode « distance » : distance à vol d'oiseau
//      une LV1 (chauffeur seul, chargement plus long) compte pour « lv1Min » minutes (ou « lv1Km » km) de plus
//   3) capacité : 9 quais par créneau ; au-delà, la tournée passe au créneau suivant
// Les quais sont placés au hasard dans chaque créneau.
// Les créneaux de chargement autorisés restent ceux de l'heure du PDF (SLOT_RULES) ; l'arrivée Urbantz sert à l'ordre.

// Code de tournée d'un nom de tournée Urbantz, ex. « TA830camionMNS75 L… » -> « MNS75 » (le code le plus long contenu dans le nom)
export function matchRoundCode(roundName, codes) {
  const n = String(roundName || '').toUpperCase().replace(/^TA830CAMION/, '')
  return [...codes].sort((a, b) => b.length - a.length)
    .find(c => { const i = n.indexOf(String(c).toUpperCase()); return i >= 0 && !/\d/.test(n[i + String(c).length] || '') }) || null
}

export const QUAIS = [3, 6, 7, 8, 9, 10, 11, 12, 13]
export const SITE_CP = '92160' // Antony

// Créneaux de départ habituels selon l'heure de première livraison (minutes), déduits de l'historique de juillet à novembre 2026
export const SLOT_RULES = {
  360: [330, 360],        // 06:00 -> 05:30 ou 06:00
  480: [360, 390],        // 08:00 -> 06:00 ou 06:30
  660: [600, 630],        // 11:00 -> 10:00 ou 10:30
  780: [720, 750, 780],   // 13:00 -> 12:00, 12:30, 13:00
  810: [720, 750, 780],   // 13:30
  855: [780, 810],        // 14:15
}

export const fmtMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const parseHM = s => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

// ── Temps de trajet estimé ──────────────────────────────────────────────────────────────────
// Calibré sur 553 tournées réelles relevées dans Urbantz (5 octobre → 9 novembre 2026) : trajet entre le départ
// de l'entrepôt et la 1re livraison = durée fixe + minutes par km (à vol d'oiseau), selon la zone de destination.
// Erreur moyenne : 3,7 min (contre 12 min pour l'ancien modèle de vitesses et 8,7 min pour une durée constante).
export const ZONES = {
  paris:  { fixed: 0.8,  perKm: 2.68 },   // ≤ 6,5 km du centre de Paris
  petite: { fixed: 9.8,  perKm: 1.73 },   // 6,5 – 17 km du centre de Paris
  grande: { fixed: 10.5, perKm: 1.25 },   // au-delà (aussi utilisé pour les destinations lointaines, peu observées)
}
// Effet de l'heure d'arrivée sur le trajet (médiane observée, ±10 % : le trafic pèse peu sur ces créneaux matinaux)
export const HOUR_FACTOR = { 5: 0.96, 6: 0.96, 7: 0.98, 8: 1.03, 9: 1.02, 10: 0.95, 11: 0.9, 12: 0.97, 13: 1.0, 14: 1.08, 15: 1.12, 16: 1.12 }
const PARIS = [48.8566, 2.3522]
const kmBetween = (a, b) => {
  const p = Math.PI / 180, h = Math.sin(((b[0] - a[0]) * p) / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(((b[1] - a[1]) * p) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
// zone d'après les coordonnées [lat, lon] du code postal de destination
export function zoneOf(latlon) {
  if (!latlon) return 'petite'
  const d = kmBetween(PARIS, latlon)
  return d <= 6.5 ? 'paris' : d <= 17 ? 'petite' : 'grande'
}
// Minutes de trajet vers la 1re livraison (heure « hpl » en minutes depuis minuit) ; null si distance inconnue
export function travelMinutes(distKm, latlon, hpl) {
  if (distKm == null) return null
  const z = ZONES[zoneOf(latlon)]
  const f = hpl == null ? 1 : (HOUR_FACTOR[Math.min(16, Math.max(5, Math.floor(hpl / 60)))] ?? 1)
  return (z.fixed + z.perKm * distKm) * f
}

export function distanceKm(coords, cp) {
  const a = coords[SITE_CP], b = coords[cp]
  if (!a || !b) return null
  const R = 6371, p = Math.PI / 180
  const h = Math.sin(((b[0] - a[0]) * p) / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(((b[1] - a[1]) * p) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function allowedFor(hpl, rules) {
  const keys = Object.keys(rules).map(Number)
  const h = hpl ?? keys[0]
  const k = keys.reduce((best, x) => (Math.abs(x - h) < Math.abs(best - h) ? x : best), keys[0])
  return rules[k]
}

function rng(seed) { // petit générateur reproductible
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function shuffleQuais(plan, seed) {
  const rand = rng(seed)
  const bySlot = {}
  plan.forEach(t => { (bySlot[t.slot] ||= []).push(t) })
  const out = {}
  Object.values(bySlot).forEach(list => {
    const q = [...QUAIS]
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [q[i], q[j]] = [q[j], q[i]] }
    list.forEach((t, i) => { out[t.id] = q[i] ?? null })
  })
  return plan.map(t => ({ ...t, quai: out[t.id] }))
}

// tours : [{ id, name, hpl (minutes|null), lv1 (bool), dist (km|null), ... }]
export function generatePlan(tours, { mode = 'time', lv1Km = 5, lv1Min = 10, capacity = 9, rules = SLOT_RULES, seed = 1 } = {}) {
  const t = tours.map(x => ({
    ...x,
    score: mode === 'time' ? (x.trip ?? 0) + (x.lv1 ? lv1Min : 0) : (x.dist ?? 0) + (x.lv1 ? lv1Km : 0),
    allowed: allowedFor(x.hpl, rules),
    slot: null,
    overflow: false,
  }))
  const ref = x => x.eta ?? x.hpl ?? 9999 // référence : arrivée prévue Urbantz, à défaut heure du PDF
  const prio = (a, b) => ref(a) - ref(b) || b.score - a.score || a.name.localeCompare(b.name)
  t.sort(prio)

  const count = {}
  let pending = [...t]
  const slots = [...new Set(t.flatMap(x => x.allowed))].sort((a, b) => a - b)
  for (const s of slots) {
    const cand = pending.filter(x => x.allowed.includes(s))
    // les tournées dont c'est le dernier créneau possible passent d'abord
    cand.sort((a, b) => (Math.max(...a.allowed) === s ? 0 : 1) - (Math.max(...b.allowed) === s ? 0 : 1) || prio(a, b))
    for (const x of cand.slice(0, capacity)) { x.slot = s; count[s] = (count[s] || 0) + 1 }
    pending = pending.filter(x => x.slot == null)
  }
  for (const x of pending) { // débordement : créneau suivant disponible
    let s = Math.max(...x.allowed)
    while ((count[s] || 0) >= capacity) s += 30
    x.slot = s; x.overflow = true; count[s] = (count[s] || 0) + 1
  }
  return shuffleQuais(t, seed).sort((a, b) => a.slot - b.slot || prio(a, b))
}
