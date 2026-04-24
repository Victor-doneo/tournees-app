import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Plus, Minus, Equal, RefreshCw, X } from 'lucide-react'

export default function PreparationTournees() {
  const [availableDates, setAvailableDates] = useState([])
  const [groupA, setGroupA] = useState([])
  const [groupB, setGroupB] = useState([])
  const [toursA, setToursA] = useState([])
  const [toursB, setToursB] = useState([])
  const [compared, setCompared] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingDates, setLoadingDates] = useState(true)

  useEffect(() => { fetchDates() }, [])

  async function fetchDates() {
    setLoadingDates(true)
    const { data } = await supabase
      .from('delivery_dates')
      .select('id, delivery_date')
      .order('delivery_date', { ascending: false })
    setAvailableDates(data || [])
    setLoadingDates(false)
  }

  function formatDate(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short'
    })
  }

  function addToGroup(group, setGroup, dateId) {
    if (!dateId) return
    // dateId est une string venant du select, on compare en string
    if (group.includes(dateId)) return
    setGroup([...group, dateId])
    setCompared(false)
  }

  function removeFromGroup(group, setGroup, dateId) {
    setGroup(group.filter(id => id !== dateId))
    setCompared(false)
  }

  async function compare() {
    if (groupA.length === 0 || groupB.length === 0) return
    setLoading(true)
    setCompared(false)

    const [resA, resB] = await Promise.all([
      supabase.from('tours').select('name').in('delivery_date_id', groupA),
      supabase.from('tours').select('name').in('delivery_date_id', groupB),
    ])

    const namesA = [...new Set((resA.data || []).map(t => t.name))].sort()
    const namesB = [...new Set((resB.data || []).map(t => t.name))].sort()

    setToursA(namesA)
    setToursB(namesB)
    setCompared(true)
    setLoading(false)
  }

  const setA = new Set(toursA)
  const setB = new Set(toursB)
  const added = toursB.filter(n => !setA.has(n))
  const removed = toursA.filter(n => !setB.has(n))
  const unchanged = toursA.filter(n => setB.has(n))

  function GroupSelector({ group, setGroup, label }) {
    return (
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--gray-700)' }}>{label}</span>
          <span className="badge badge-gray">{group.length} date{group.length > 1 ? 's' : ''}</span>
        </div>

        {group.map(id => {
          const d = availableDates.find(x => String(x.id) === String(id))
          return d ? (
            <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid var(--gray-100)', background: '#f5f5ff' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>{formatDate(d.delivery_date)}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => removeFromGroup(group, setGroup, id)} style={{ padding: '2px 6px' }}>
                <X size={12} />
              </button>
            </div>
          ) : null
        })}

        <div style={{ padding: '10px 16px' }}>
          <select
            className="form-input"
            style={{ fontSize: 13, cursor: 'pointer' }}
            value=""
            onChange={e => {
              if (e.target.value) addToGroup(group, setGroup, e.target.value)
              e.target.value = ''
            }}
          >
            <option value="">+ Ajouter une date...</option>
            {availableDates
              .filter(d => !group.includes(String(d.id)))
              .map(d => (
                <option key={d.id} value={String(d.id)}>{formatDate(d.delivery_date)}</option>
              ))
            }
          </select>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Préparation des tournées</h2>
        <p className="page-subtitle">Comparez les tournées entre deux groupes de dates</p>
      </div>

      <div className="page-body">
        {loadingDates ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <GroupSelector group={groupA} setGroup={setGroupA} label="Ancienne préparation" />
              <GroupSelector group={groupB} setGroup={setGroupB} label="Nouvelle préparation" />
            </div>

            <button
              className="btn btn-primary"
              onClick={compare}
              disabled={loading || groupA.length === 0 || groupB.length === 0}
              style={{ marginBottom: 24 }}
            >
              {loading ? <><div className="spinner" /> Comparaison...</> : <><RefreshCw size={14} /> Comparer</>}
            </button>

            {compared && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
                  <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid #059669', padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: '#059669' }}>{added.length}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>Ajoutées</div>
                  </div>
                  <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid var(--red)', padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--red)' }}>{removed.length}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>Retirées</div>
                  </div>
                  <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid var(--gray-300)', padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--gray-600)' }}>{unchanged.length}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>Communes</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                  <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: '#f0fdf4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Plus size={14} color="#059669" />
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: '#065f46' }}>Ajoutées</span>
                      </div>
                      <span style={{ background: '#059669', color: 'white', borderRadius: 100, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>{added.length}</span>
                    </div>
                    {added.length === 0
                      ? <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucune tournée ajoutée</div>
                      : added.map(name => (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669', flexShrink: 0 }} />
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#059669' }}>{name}</span>
                        </div>
                      ))
                    }
                  </div>

                  <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--red-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Minus size={14} color="var(--red)" />
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: '#991b1b' }}>Retirées</span>
                      </div>
                      <span style={{ background: 'var(--red)', color: 'white', borderRadius: 100, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>{removed.length}</span>
                    </div>
                    {removed.length === 0
                      ? <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucune tournée retirée</div>
                      : removed.map(name => (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 }} />
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--red)' }}>{name}</span>
                        </div>
                      ))
                    }
                  </div>

                  <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Equal size={14} color="var(--gray-400)" />
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--gray-700)' }}>Communes</span>
                      </div>
                      <span style={{ background: 'var(--gray-400)', color: 'white', borderRadius: 100, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>{unchanged.length}</span>
                    </div>
                    {unchanged.length === 0
                      ? <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucune tournée commune</div>
                      : unchanged.map(name => (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gray-300)', flexShrink: 0 }} />
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--gray-600)' }}>{name}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
