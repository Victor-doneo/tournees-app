import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Plus, Minus, Equal, RefreshCw } from 'lucide-react'

export default function PreparationTournees() {
  const [loading, setLoading] = useState(true)
  const [todayTours, setTodayTours] = useState([])
  const [yesterdayTours, setYesterdayTours] = useState([])
  const [todayDate, setTodayDate] = useState('')
  const [yesterdayDate, setYesterdayDate] = useState('')

  useEffect(() => { fetchComparison() }, [])

  async function fetchComparison() {
    setLoading(true)

    // Récupérer les 2 dernières dates de livraison disponibles
    const { data: dates } = await supabase
      .from('delivery_dates')
      .select('id, delivery_date')
      .order('delivery_date', { ascending: false })
      .limit(2)

    if (!dates || dates.length < 2) {
      setLoading(false)
      return
    }

    const today = dates[0]
    const yesterday = dates[1]
    setTodayDate(today.delivery_date)
    setYesterdayDate(yesterday.delivery_date)

    // Récupérer les tournées des 2 dates
    const { data: todayData } = await supabase
      .from('tours')
      .select('name')
      .eq('delivery_date_id', today.id)
      .order('name')

    const { data: yesterdayData } = await supabase
      .from('tours')
      .select('name')
      .eq('delivery_date_id', yesterday.id)
      .order('name')

    setTodayTours(todayData || [])
    setYesterdayTours(yesterdayData || [])
    setLoading(false)
  }

  const todayNames = new Set(todayTours.map(t => t.name))
  const yesterdayNames = new Set(yesterdayTours.map(t => t.name))

  const added = todayTours.filter(t => !yesterdayNames.has(t.name))
  const removed = yesterdayTours.filter(t => !todayNames.has(t.name))
  const unchanged = todayTours.filter(t => yesterdayNames.has(t.name))

  function formatDate(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long'
    })
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Préparation des tournées</h2>
            <p className="page-subtitle">Comparaison entre la veille et le jour J</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchComparison} style={{ paddingTop: 4 }}>
            <RefreshCw size={14} />
            Actualiser
          </button>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : todayDate && yesterdayDate ? (
          <>
            {/* Résumé */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
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
                <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>Inchangées</div>
              </div>
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid var(--accent)', padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--accent)' }}>{todayTours.length}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>Total aujourd'hui</div>
              </div>
            </div>

            {/* Dates */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>
                <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>Veille :</span> {formatDate(yesterdayDate)} ({yesterdayTours.length} tournées)
              </div>
              <span style={{ color: 'var(--gray-300)' }}>→</span>
              <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>
                <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>Aujourd'hui :</span> {formatDate(todayDate)} ({todayTours.length} tournées)
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>

              {/* Tournées ajoutées */}
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: '#f0fdf4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Plus size={14} color="#059669" />
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: '#065f46' }}>Tournées ajoutées</span>
                  </div>
                  <span style={{ background: '#059669', color: 'white', borderRadius: 100, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>{added.length}</span>
                </div>
                {added.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucune tournée ajoutée</div>
                ) : (
                  added.map(t => (
                    <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderBottom: '1px solid var(--gray-100)', background: '#f0fdf420' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--gray-800)' }}>{t.name}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Tournées retirées */}
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--red-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Minus size={14} color="var(--red)" />
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: '#991b1b' }}>Tournées retirées</span>
                  </div>
                  <span style={{ background: 'var(--red)', color: 'white', borderRadius: 100, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>{removed.length}</span>
                </div>
                {removed.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucune tournée retirée</div>
                ) : (
                  removed.map(t => (
                    <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--gray-800)', textDecoration: 'line-through', opacity: 0.6 }}>{t.name}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Tournées inchangées */}
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Equal size={14} color="var(--gray-400)" />
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--gray-700)' }}>Inchangées</span>
                  </div>
                  <span style={{ background: 'var(--gray-400)', color: 'white', borderRadius: 100, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>{unchanged.length}</span>
                </div>
                {unchanged.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucune tournée commune</div>
                ) : (
                  unchanged.map(t => (
                    <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gray-300)', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--gray-600)' }}>{t.name}</span>
                    </div>
                  ))
                )}
              </div>

            </div>
          </>
        ) : (
          <div className="card">
            <div className="empty-state">
              <p className="empty-state-title">Pas assez de données</p>
              <p className="empty-state-sub">Il faut au moins 2 dates de livraison pour comparer.</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
