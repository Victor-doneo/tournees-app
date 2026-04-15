import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { ArrowLeft, Package, CheckCircle, AlertTriangle, Wifi, WifiOff } from 'lucide-react'

const POPUP_DURATION = 2500

const SCAN_RESULTS = {
  ok: {
    label: 'Colis conforme',
    sub: 'Présent sur cette tournée',
    cls: 'ok',
    icon: '✓',
    color: '#059669',
  },
  already_scanned: {
    label: 'Colis déjà scanné',
    sub: 'Ce colis a déjà été contrôlé',
    cls: 'already',
    icon: '↺',
    color: '#2563eb',
  },
  unknown: {
    label: 'Colis inconnu',
    sub: 'Ce code-barres n\'est pas reconnu',
    cls: 'unknown',
    icon: '?',
    color: '#d97706',
  },
  wrong_tour: {
    label: 'Anomalie — mauvaise tournée',
    sub: 'Ce colis appartient à une autre tournée',
    cls: 'wrong',
    icon: '⚠',
    color: '#dc2626',
  },
}

export default function ScanPage() {
  const { tourId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [tour, setTour] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [popup, setPopup] = useState(null)
  const [lastScans, setLastScans] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [online, setOnline] = useState(navigator.onLine)

  const inputRef = useRef(null)
  const popupTimer = useRef(null)
  const bufferTimer = useRef(null)

  // Surveiller la connexion réseau
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Charger la tournée
  useEffect(() => {
    fetchTour()
  }, [tourId])

  // Maintenir le focus sur l'input (TC51 envoie les caractères comme un clavier)
  useEffect(() => {
    const keepFocus = () => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus()
      }
    }
    const interval = setInterval(keepFocus, 300)
    inputRef.current?.focus()
    return () => clearInterval(interval)
  }, [])

  // Écouter les scans en temps réel via Supabase realtime
  useEffect(() => {
    if (!tourId) return
    const channel = supabase
      .channel(`tour-${tourId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'scan_events',
        filter: `tour_id=eq.${tourId}`,
      }, () => {
        fetchSummary()
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [tourId])

  async function fetchTour() {
    const { data: tourData } = await supabase
      .from('tours')
      .select('*')
      .eq('id', tourId)
      .single()

    const { data: summaryData } = await supabase
      .from('tour_scan_summary')
      .select('*')
      .eq('tour_id', tourId)
      .single()

    // Charger les derniers scans
    const { data: recentScans } = await supabase
      .from('scan_events')
      .select('*, users(full_name)')
      .eq('tour_id', tourId)
      .order('scanned_at', { ascending: false })
      .limit(10)

    setTour(tourData)
    setSummary(summaryData)
    setLastScans(recentScans || [])
    setLoading(false)
  }

  async function fetchSummary() {
    const { data } = await supabase
      .from('tour_scan_summary')
      .select('*')
      .eq('tour_id', tourId)
      .single()
    setSummary(data)

    const { data: recentScans } = await supabase
      .from('scan_events')
      .select('*, users(full_name)')
      .eq('tour_id', tourId)
      .order('scanned_at', { ascending: false })
      .limit(10)
    setLastScans(recentScans || [])
  }

  // Traitement du scan
  const processScan = useCallback(async (barcode) => {
    if (!barcode || barcode.length < 5) return

    // 1. Chercher le colis dans la base
    const { data: parcel } = await supabase
      .from('parcels')
      .select('*, tours(id, name)')
      .eq('barcode', barcode)
      .single()

    let resultType
    let parcelId = null

    if (!parcel) {
      // Colis complètement inconnu
      resultType = 'unknown'
    } else if (parcel.excluded) {
      // Colis de type Reprise → traité comme inconnu (pas censé être là)
      resultType = 'unknown'
      parcelId = parcel.id
    } else if (parcel.tour_id !== tourId) {
      // Colis connu mais mauvaise tournée
      resultType = 'wrong_tour'
      parcelId = parcel.id
    } else {
      // Colis de la bonne tournée — vérifier s'il a déjà été scanné
      const { data: existingScan } = await supabase
        .from('scan_events')
        .select('id')
        .eq('tour_id', tourId)
        .eq('parcel_id', parcel.id)
        .in('result_type', ['ok', 'already_scanned'])
        .limit(1)
        .single()

      resultType = existingScan ? 'already_scanned' : 'ok'
      parcelId = parcel.id
    }

    // 2. Enregistrer le scan en base
    await supabase.from('scan_events').insert({
      tour_id: tourId,
      parcel_id: parcelId,
      user_id: profile.id,
      barcode_scanned: barcode,
      result_type: resultType,
    })

    // 3. Afficher la popup
    showPopup(resultType, barcode)

    // 4. Rafraîchir le résumé
    fetchSummary()
  }, [tourId, profile])

  function showPopup(type, barcode) {
    if (popupTimer.current) clearTimeout(popupTimer.current)
    setPopup({ type, barcode })
    popupTimer.current = setTimeout(() => setPopup(null), POPUP_DURATION)
  }

  // Gestion de l'input du TC51
  // Le TC51 envoie les caractères un par un puis \n ou \r à la fin
  function handleInputChange(e) {
    const val = e.target.value
    setInputValue(val)

    // Détection auto : si le TC51 envoie un \n, on traite immédiatement
    if (val.includes('\n') || val.includes('\r')) {
      const barcode = val.replace(/[\n\r]/g, '').trim()
      if (barcode.length >= 5) {
        processScan(barcode)
        setInputValue('')
      }
      return
    }

    // Sinon, on attend 150ms sans nouveau caractère (fin de scan rapide)
    if (bufferTimer.current) clearTimeout(bufferTimer.current)
    bufferTimer.current = setTimeout(() => {
      const barcode = val.trim()
      if (barcode.length >= 5) {
        processScan(barcode)
        setInputValue('')
      }
    }, 150)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const barcode = inputValue.trim()
      if (barcode.length >= 5) {
        if (bufferTimer.current) clearTimeout(bufferTimer.current)
        processScan(barcode)
        setInputValue('')
      }
    }
  }

  if (loading) return (
    <div className="loading-center" style={{ height: '100%' }}>
      <div className="spinner dark" />
    </div>
  )

  const scanned = summary?.scanned_count || 0
  const total = summary?.total_parcels || 0
  const missing = summary?.missing_count || 0
  const anomalies = (summary?.wrong_tour_count || 0) + (summary?.unknown_count || 0)
  const pct = total > 0 ? Math.round((scanned / total) * 100) : 0

  return (
    <div className="scan-page">
      {/* Input invisible toujours focusé — reçoit les scans TC51 */}
      <input
        ref={inputRef}
        className="scanner-input"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Popup résultat scan */}
      {popup && (
        <div className={`scan-overlay ${SCAN_RESULTS[popup.type].cls}`}>
          <div className="scan-overlay-icon">{SCAN_RESULTS[popup.type].icon}</div>
          <div>
            <div className="scan-overlay-title">{SCAN_RESULTS[popup.type].label}</div>
            <div className="scan-overlay-sub">
              {SCAN_RESULTS[popup.type].sub}
              <span style={{ display: 'block', opacity: 0.7, fontSize: '11px', marginTop: '2px', fontFamily: 'monospace' }}>
                {popup.barcode}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="scan-header">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/operator')}>
          <ArrowLeft size={15} /> Retour
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--gray-800)', letterSpacing: '-0.3px' }}>
            {tour?.name}
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--gray-400)' }}>
            Contrôle en cours — scannez les colis
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: online ? 'var(--green)' : 'var(--red)' }}>
          {online ? <Wifi size={14} /> : <WifiOff size={14} />}
          {online ? 'Connecté' : 'Hors ligne'}
        </div>
      </div>

      {/* Compteurs principaux */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
        {/* Scannés */}
        <div className="scan-counter" style={{ borderTop: `3px solid var(--accent)` }}>
          <div>
            <span className="scan-counter-value">{scanned}</span>
            <span className="scan-counter-total"> / {total}</span>
          </div>
          <div className="scan-counter-label">Colis scannés</div>
          <div style={{ width: '100%', marginTop: '8px' }}>
            <div className="progress-bar">
              <div
                className={`progress-fill ${pct === 100 ? 'green' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px', textAlign: 'right' }}>
              {pct}%
            </div>
          </div>
        </div>

        {/* Manquants */}
        <div className="scan-counter" style={{ borderTop: `3px solid ${missing > 0 ? 'var(--red)' : 'var(--green)'}` }}>
          <div className="scan-counter-value" style={{ color: missing > 0 ? 'var(--red)' : 'var(--green)' }}>
            {missing}
          </div>
          <div className="scan-counter-label">Colis manquants</div>
          {missing === 0 && scanned > 0 && (
            <div style={{ marginTop: '6px' }}>
              <CheckCircle size={16} color="var(--green)" />
            </div>
          )}
        </div>

        {/* Anomalies */}
        <div className="scan-counter" style={{ borderTop: `3px solid ${anomalies > 0 ? 'var(--orange)' : 'var(--gray-200)'}` }}>
          <div className="scan-counter-value" style={{ color: anomalies > 0 ? 'var(--orange)' : 'var(--gray-300)' }}>
            {anomalies}
          </div>
          <div className="scan-counter-label">Anomalies</div>
          {anomalies > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '4px' }}>
              {summary?.wrong_tour_count || 0} mauvaise tournée · {summary?.unknown_count || 0} inconnus
            </div>
          )}
        </div>
      </div>

      {/* Zone de scan visuelle */}
      <div
        style={{
          background: 'var(--white)',
          borderRadius: 'var(--radius)',
          border: '2px dashed var(--gray-200)',
          padding: '24px',
          textAlign: 'center',
          cursor: 'text',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'border-color 0.2s',
          borderColor: popup ? SCAN_RESULTS[popup.type]?.color : undefined,
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <Package size={32} color="var(--gray-200)" />
        <p style={{ fontSize: '14px', color: 'var(--gray-400)', fontWeight: 500 }}>
          Zone de scan active
        </p>
        <p style={{ fontSize: '12px', color: 'var(--gray-300)' }}>
          Scannez un code-barres avec le TC51
        </p>
        {inputValue && (
          <div style={{
            marginTop: '8px', fontFamily: 'monospace', fontSize: '18px',
            color: 'var(--accent)', fontWeight: 600, letterSpacing: '2px',
          }}>
            {inputValue}
          </div>
        )}
      </div>

      {/* Historique des derniers scans */}
      {lastScans.length > 0 && (
        <div className="card" style={{ maxHeight: '240px', overflow: 'hidden' }}>
          <div className="card-header" style={{ padding: '14px 20px' }}>
            <span className="card-title" style={{ fontSize: '13px' }}>Derniers scans</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '180px' }}>
            <table>
              <tbody>
                {lastScans.map(s => {
                  const r = SCAN_RESULTS[s.result_type]
                  return (
                    <tr key={s.id}>
                      <td style={{ width: 28 }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 22, height: 22, borderRadius: '50%',
                          background: r?.color + '20', color: r?.color,
                          fontSize: '13px', fontWeight: 700,
                        }}>
                          {r?.icon}
                        </span>
                      </td>
                      <td>
                        <code style={{ fontSize: '12px', color: 'var(--gray-600)' }}>{s.barcode_scanned}</code>
                      </td>
                      <td>
                        <span style={{ fontSize: '12px', color: r?.color, fontWeight: 500 }}>{r?.label}</span>
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--gray-400)', textAlign: 'right' }}>
                        {new Date(s.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
