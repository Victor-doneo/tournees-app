// Tournées Urbantz non reconnues : colis à retourner (depuis le 16/11/2026) dont le nom de tournée ne correspond à aucune tournée de l'application
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

export const UNRECOGNIZED_FROM = '2026-11-16'

export async function fetchUnrecognizedRounds() {
  const { data, error } = await supabase.from('return_labels').select('round_name, task_date')
    .is('tour_code', null).not('round_name', 'is', null).gte('task_date', UNRECOGNIZED_FROM).limit(5000)
  if (error) return []
  const map = {}
  for (const l of data || []) {
    const k = String(l.round_name).replace(/\s+/g, ' ').trim()
    const e = (map[k] = map[k] || { name: k, count: 0, days: new Set() })
    e.count++; e.days.add(l.task_date)
  }
  return Object.values(map).map(e => ({ name: e.name, count: e.count, days: [...e.days].sort() })).sort((a, b) => b.count - a.count)
}

export function useUnrecognizedRounds() {
  const { user } = useAuth()
  const [rounds, setRounds] = useState([])
  useEffect(() => {
    if (!user) return
    let stop = false
    const load = async () => { const r = await fetchUnrecognizedRounds(); if (!stop) setRounds(r) }
    load()
    const t = setInterval(load, 60000)
    return () => { stop = true; clearInterval(t) }
  }, [user?.id])
  return rounds
}
