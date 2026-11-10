// Fonction Edge : importe les heures d'arrivée prévues d'Urbantz dans les tournées du PROCHAIN jour de livraison.
// À appeler chaque jour à 8h (heure de Paris) par une tâche planifiée Supabase (voir README_urbantz_auto.md).
// Secrets requis : URBANTZ_API_KEY (Urbantz → Administration → Plateforme → Général)
// Options du corps JSON : { "date": "2026-11-12" } pour forcer une date, { "dry_run": true } pour ne rien écrire et voir ce qui serait fait.
// ⚠ Non testée sur l'API publique Urbantz v2 : en dry_run, la réponse contient « sample_keys » pour ajuster les noms de champs si besoin.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const parisNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hhmm = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) : null

// « TA830camionMNS75 L… » -> « MNS75 » : le code de tournée le plus long contenu dans le nom (suivi d'autre chose qu'un chiffre)
function matchRoundCode(roundName: string, codes: string[]) {
  const n = String(roundName || '').toUpperCase().replace(/^TA830CAMION/, '')
  return [...codes].sort((a, b) => b.length - a.length).find((c) => {
    const i = n.indexOf(c.toUpperCase()); return i >= 0 && !/\d/.test(n[i + c.length] || '')
  }) || null
}
const pick = (o: any, keys: string[]) => { for (const k of keys) if (o?.[k]) return o[k]; return null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // Accès : appel avec la clé service (tâche planifiée) ou administrateur connecté
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      const { data: u } = await admin.auth.getUser(token)
      const { data: p } = u?.user ? await admin.from('users').select('role').eq('id', u.user.id).single() : { data: null }
      if (p?.role !== 'admin') return json({ error: 'Accès non autorisé' }, 403)
    }
    const body = await req.json().catch(() => ({}))
    const dryRun = body?.dry_run === true
    const now = parisNow()
    // La tâche est planifiée à 06h et 07h UTC (été / hiver) : on ne travaille qu'à 8h, heure de Paris
    if (!body?.date && !dryRun && now.getHours() !== 8) return json({ skipped: `Il est ${now.getHours()}h à Paris, import prévu à 8h` })

    // Prochain jour de livraison (après aujourd'hui) qui a des tournées
    let day = body?.date as string | undefined
    let dateRow: { id: string | number; delivery_date: string } | null = null
    if (day) {
      const { data } = await admin.from('delivery_dates').select('id, delivery_date').eq('delivery_date', day).maybeSingle(); dateRow = data
    } else {
      const { data } = await admin.from('delivery_dates').select('id, delivery_date').gt('delivery_date', ymd(now)).order('delivery_date').limit(5)
      for (const d of data || []) {
        const { count } = await admin.from('tours').select('id', { count: 'exact', head: true }).eq('delivery_date_id', d.id)
        if (count) { dateRow = d; break }
      }
    }
    if (!dateRow) return json({ error: 'Aucun jour de livraison avec des tournées trouvé' }, 404)
    day = dateRow.delivery_date

    const { data: tours } = await admin.from('tours').select('id, name, tours_references(name)').eq('delivery_date_id', dateRow.id)
    const codes = (tours || []).map((t: any) => t.tours_references?.name || t.name)

    // Urbantz v2 : liste des tournées du jour (ajuster le chemin / les paramètres selon la doc https://docs.urbantz.com/rounds)
    const res = await fetch(`https://api.urbantz.com/v2/rounds?date=${day}&pageSize=200`, { headers: { 'x-api-key': Deno.env.get('URBANTZ_API_KEY') || '' } })
    if (!res.ok) return json({ error: `Urbantz a répondu ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502)
    const raw = await res.json()
    const rounds: any[] = Array.isArray(raw) ? raw : (raw.data || raw.rounds || raw.items || [])
    if (!rounds.length) return json({ error: 'Aucune tournée Urbantz pour cette date', date: day }, 404)

    const found: Record<string, { first: string; hub: string }> = {}
    for (const r of rounds) {
      const stops: any[] = r.stops || r.tasks || []
      const hub = stops.find((s) => s.type === 'hub' || s.stopType === 1)
      const first = stops.find((s) => s.type === 'delivery' || s.stopType === 0)
      const code = matchRoundCode(r.name, codes)
      const f = first && hhmm(pick(first, ['arriveTime', 'eta', 'arrival', 'expectedArrival', 'estimatedArrival']))
      if (code && f) found[code] = { first: f, hub: (hub && hhmm(pick(hub, ['departTime', 'arriveTime', 'startTime']))) || '' }
    }
    const upd = (tours || []).map((t: any) => { const u = found[t.tours_references?.name || t.name]; return u ? { id: String(t.id), first: u.first, hub: u.hub } : null }).filter(Boolean)
    const summary = { date: day, urbantz_rounds: rounds.length, tours: (tours || []).length, matched: upd.length, sample_keys: Object.keys(rounds[0] || {}), sample_stop_keys: Object.keys((rounds[0]?.stops || [])[0] || {}) }
    if (dryRun || !upd.length) return json({ dry_run: dryRun, ...summary, preview: upd.slice(0, 5) })

    for (const u of upd as any[]) {
      await admin.from('tours').update({ urbantz_first_arrival: u.first, urbantz_hub_depart: u.hub || null }).eq('id', u.id)
    }
    return json({ updated: upd.length, ...summary })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
