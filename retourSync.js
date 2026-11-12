import { supabase } from './supabase'

// Une tournée est « revenue » quand TOUS ses colis à retourner (table return_labels) ont reçu l'accusé de réception.
// Marque alors la tournée comme rentrée (heure de retour = dernière réception). Renvoie les ids de tournées mises à jour.
export async function syncTourReturns(day, onlyCodes = null) {
  const { data: labels } = await supabase.from('return_labels').select('tour_code, received_at').eq('task_date', day).not('tour_code', 'is', null)
  const byCode = {}
  for (const l of labels || []) (byCode[l.tour_code] = byCode[l.tour_code] || []).push(l)
  const done = Object.entries(byCode).filter(([c, ls]) => (!onlyCodes || onlyCodes.includes(c)) && ls.every(l => l.received_at))
  if (!done.length) return []
  const { data: dRow } = await supabase.from('delivery_dates').select('id').eq('delivery_date', day).maybeSingle()
  if (!dRow) return []
  const { data: tours } = await supabase.from('tours').select('id, name, heure_retour, tours_references(name)').eq('delivery_date_id', dRow.id)
  const updated = []
  for (const [code, ls] of done) {
    const t = (tours || []).find(x => (x.tours_references?.name || x.name) === code)
    if (!t || t.heure_retour) continue
    const last = ls.map(l => l.received_at).sort().pop()
    const { error } = await supabase.from('tours').update({ heure_retour: last, status: 'completed' }).eq('id', t.id)
    if (!error) updated.push(t.id)
  }
  return updated
}
