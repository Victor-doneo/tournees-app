// Plan de chargement : règle de priorité
//   1) heure de première livraison (la plus tôt d'abord)
//   2) éloignement d'Antony (92160) du code postal de la première livraison (le plus lointain d'abord) :
//      - mode « temps » (par défaut) : temps de trajet estimé avec le trafic moyen de l'heure du trajet
//      - mode « distance » : distance à vol d'oiseau
//      une LV1 (chauffeur seul, chargement plus long) compte pour « lv1Min » minutes (ou « lv1Km » km) de plus
//   3) capacité : 9 quais par créneau ; au-delà, la tournée passe au créneau suivant
// Les quais sont placés au hasard dans chaque créneau.

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

// ── Temps de trajet estimé selon le trafic moyen ────────────────────────────────────────────
// Modèle simple et réglable (pas de données de trafic en direct) :
//   durée = distance à vol d'oiseau / vitesse fluide de la zone × (1 + amplitude de la zone × congestion de l'heure)
// Zones d'après le département du code postal ; vitesses « à vol d'oiseau » (le détour des routes est inclus).
export const ZONES = {
  paris:  { speed: 24, amp: 0.8 },   // 75
  petite: { speed: 32, amp: 0.7 },   // 92, 93, 94
  grande: { speed: 48, amp: 0.6 },   // 77, 78, 91, 95
  loin:   { speed: 70, amp: 0.4 },   // autres départements
}
// Congestion moyenne par heure (0 = fluide, 1 = heure de pointe) en Île-de-France, jours ouvrés
export const TRAFFIC_PROFILE = {
  0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0.05, 6: 0.35, 7: 0.85, 8: 1, 9: 0.7, 10: 0.35, 11: 0.2, 12: 0.25,
  13: 0.2, 14: 0.25, 15: 0.4, 16: 0.75, 17: 1, 18: 0.9, 19: 0.45, 20: 0.15, 21: 0.05, 22: 0, 23: 0,
}
export function zoneOf(cp) {
  const d = String(cp || '').padStart(5, '0').slice(0, 2)
  if (d === '75') return 'paris'
  if (['92', '93', '94'].includes(d)) return 'petite'
  if (['77', '78', '91', '95'].includes(d)) return 'grande'
  return 'loin'
}
const congestion = minutes => { // interpolation linéaire entre heures pleines
  const m = ((minutes % 1440) + 1440) % 1440, h = Math.floor(m / 60), f = (m % 60) / 60
  return TRAFFIC_PROFILE[h] * (1 - f) + TRAFFIC_PROFILE[(h + 1) % 24] * f
}
// Minutes de trajet pour arriver à la 1re livraison à l'heure « hpl » (minutes depuis minuit) ; trafic pris au milieu du trajet
export function travelMinutes(distKm, cp, hpl) {
  if (distKm == null) return null
  const z = ZONES[zoneOf(cp)]
  const free = (distKm / z.speed) * 60
  if (hpl == null) return free * (1 + z.amp * 0.3)
  let t = free
  for (let i = 0; i < 4; i++) t = free * (1 + z.amp * congestion(hpl - t / 2))
  return t
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
  const prio = (a, b) => (a.hpl ?? 9999) - (b.hpl ?? 9999) || b.score - a.score || a.name.localeCompare(b.name)
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
