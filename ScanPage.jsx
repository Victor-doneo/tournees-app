import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { ArrowLeft, Package, CheckCircle, Wifi, WifiOff, Keyboard, AlertTriangle } from 'lucide-react'

const POPUP_DURATION = 2500

const SCAN_RESULTS = {
  ok: { label: 'Colis conforme', sub: 'Présent sur cette tournée', cls: 'ok', icon: '✓', color: '#059669' },
  already_scanned: { label: 'Colis déjà scanné', sub: 'Ce colis a déjà été contrôlé', cls: 'already', icon: '↺', color: '#2563eb' },
  unknown: { label: 'Colis inconnu', sub: 'Code-barres non reconnu', cls: 'unknown', icon: '?', color: '#d97706' },
  wrong_tour: { label: 'Mauvaise tournée', sub: 'Colis sur une autre tournée', cls: 'wrong', icon: '⚠', color: '#dc2626' },
}

const TABS = [
  { id: 'scan', label: 'Scan' },
  { id: 'colis', label: 'Colis' },
  { id: 'scanned', label: 'Scannés' },
  { id: 'missing', label: 'Manquants' },
  { id: 'anomalies', label: 'Anomalies' },
]

export default function ScanPage() {
  const { tourId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [tour, setTour] = useState(null)
  const [loading, setLoading] = useState(true)
  const [popup, setPopup] = useState(null)
  const [manualInput, setManualInput] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [scanInput, setScanInput] = useState('')
  const [activeTab, setActiveTab] = useState('scan')

  const [totalParcels, setTotalParcels] = useState(0)
  const [allParcels, setAllParcels] = useState([])
  const [scannedBarcodes, setScannedBarcodes] = useState(new Set())
  const [scannedList, setScannedList] = useState([])
  const [wrongTourList, setWrongTourList] = useState([])

  const scanInputRef = useRef(null)
  const manualInputRef = useRef(null)
  const popupTimer = useRef(null)
  const bufferTimer = useRef(null)
  const tourIdRef = useRef(tourId)
  tourIdRef.current = tourId

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    if (manualMode) return
    const keepFocus = () => {
      if (scanInputRef.current && document.activeElement !== scanInputRef.current) {
        scanInputRef.current.focus()
      }
    }
    const interval = setInterval(keepFocus, 300)
    if (scanInputRef.current) scanInputRef.current.focus()
    return () => clearInterval(interval)
  }, [manualMode])

  useEffect(() => {
    if (manualMode && manualInputRef.current) {
      setTimeout(() => manualInputRef.current.focus(), 50)
    }
  }, [manualMode])

  useEffect(() => {
    async function init() {
      const { data: tourData } = await supabase
        .from('tours').select('*').eq('id', tourId).single()
      setTour(tourData)
      if (tourData) setTotalParcels(tourData.total_parcels || 0)

      const { data: parcels } = await supabase
        .from('parcels')
        .select('barcode')
        .eq('tour_id', tourId)
        .eq('excluded', false)
        .order('barcode')
      if (parcels) setAllParcels(parcels)

      const { data: existingScans } = await supabase
        .from('scan_events')
        .select('barcode_scanned, result_type, scanned_at')
        .eq('tour_id', tourId)
        .order('scanned_at', { ascending: false })

      if (existingScans && existingScans.length > 0) {
        const okBarcodes = new Set()
        const okList = []
        const wrongList = []

        for (const scan of existingScans) {
          if (scan.result_type === 'ok' || scan.result_type === 'already_scanned') {
            const bc = scan.barcode_scanned
            if (!okBarcodes.has(bc)) {
              okBarcodes.add(bc)
              if (scan.result_type === 'ok') {
                okList.push({ barcode: bc, scanned_at: scan.scanned_at })
              }
            }
          } else if (scan.result_type === 'wrong_tour') {
            wrongList.push({ barcode: scan.barcode_scanned, scanned_at: scan.scanned_at })
          }
        }

        setScannedBarcodes(okBarcodes)
        setScannedList(okList)
        setWrongTourList(wrongList)
      }

      setLoading(false)
    }
    init()
  }, [tourId])

  const processScan = useCallback(async (barcode) => {
    const bc = barcode.trim()
    if (!bc || bc.length < 5) return

    const id = tourIdRef.current

    try {
      // Chercher le colis
      const { data: parcel, error: parcelError } = await supabase
        .from('parcels')
        .select('id, tour_id, excluded, barcode, tours(name)')
        .eq('barcode', bc)
        .single()

      let resultType, parcelId = null
      let realTourName = null

      if (!parcel) {
        resultType = 'unknown'
      } else if (parcel.excluded) {
        resultType = 'unknown'
        parcelId = parcel.id
      } else if (parcel.tour_id !== id) {
        resultType = 'wrong_tour'
        parcelId = parcel.id
        realTourName = parcel.tours ? parcel.tours.name : null
      } else {
        resultType = scannedBarcodes.has(bc) ? 'already_scanned' : 'ok'
        parcelId = parcel.id
      }

      // Log pour debug
      const insertData = {
        tour_id: id,
        parcel_id: parcelId,
        user_id: profile ? profile.id : null,
        barcode_scanned: bc,
        result_type: resultType,
      }
      console.log('INSERT DATA:', insertData)

      if (!profile || !profile.id) {
        console.error('ERREUR: profile ou profile.id est null', profile)
        return
      }

      const { error: insertError } = await supabase
        .from('scan_events')
        .insert(insertData)

      if (insertError) {
        console.error('INSERT ERROR:', insertError)
        return
      }

      console.log('INSERT OK')

      // Mettre à jour l'état local
      if (resultType === 'ok') {
        setScannedBarcodes(prev => new Set([...prev, bc]))
        setScannedList(prev => [{ barcode: bc, scanned_at: new Date().toISOString() }, ...prev])
      } else if (resultType === 'wrong_tour') {
        setWrongTourList(prev => [{
          barcode: bc,
          scanned_at: new Date().toISOString(),
          real_tour: realTourName,
        }, ...prev])
      }

      if (popupTimer.current) clearTimeout(popupTimer.current)
      setPopup({ type: resultType, barcode: bc, tourName: realTourName })
      popupTimer.current = setTimeout(() => setPopup(null), POPUP_DURATION)

    } catch (err) {
      console.error('processScan EXCEPTION:', err)
    }
  }, [scannedBarcodes, profile])

  function handleScanInput(e) {
    const val = e.target.value
    setScanInput(val)
    if (val.includes('\n') || val.includes('\r')) {
      const bc = val.replace(/[\n\r]/g, '').trim()
      if (bc.length >= 5) { processScan(bc); setScanInput('') }
      return
    }
    if (bufferTimer.current) clearTimeout(bufferTimer.current)
    bufferTimer.current = setTimeout(() => {
      const bc = val.trim()
      if (bc.length >= 5) { processScan(bc); setScanInput('') }
    }, 150)
  }

  function handleScanKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const bc = scanInput.trim()
      if (bc.length >= 5) {
        if (bufferTimer.current) clearTimeout(bufferTimer.current)
        processScan(bc); setScanInput('')
      }
    }
  }

  function handleManualSubmit() {
    const bc = manualInput.trim()
    if (bc.length >= 5) {
      processScan(bc)
      setManualInput('')
      if (manualInputRef.current) manualInputRef.current.focus()
    }
  }

  if (loading) return <div className="loading-center" style={{ height: '100%' }}><div className="spinner dark" /></div>

  const scanned = scannedBarcodes.size
  const missing = Math.max(0, totalParcels - scanned)
  const anomalies = wrongTourList.length
  const pct = totalParcels > 0 ? Math.round((scanned / totalParcels) * 100) : 0
  const missingParcels = allParcels.filter(p => !scannedBarcodes.has(p.barcode))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>

      <input
        ref={scanInputRef}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
        value={scanInput}
        onChange={handleScanInput}
        onKeyDown={handleScanKeyDown}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        inputMode="none" tabIndex={-1} aria-hidden="true"
      />

      {popup && (
        <div className={'scan-overlay ' + SCAN_RESULTS[popup.type].cls}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>{SCAN_RESULTS[popup.type].icon}</div>
          <div>
            <div className="scan-overlay-title">{SCAN_RESULTS[popup.type].label}</div>
            <div className="scan-overlay-sub">
              {popup.type === 'wrong_tour' && popup.tourName
                ? 'Appartient à : ' + popup.tourName
                : SCAN_RESULTS[popup.type].sub}
              <span style={{ display: 'block', opacity: 0.7, fontSize: 11, marginTop: 2, fontFamily: 'monospace' }}>{popup.barcode}</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--white)', borderBottom: '1px solid var(--gray-100)', flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }} onClick={() => navigate(profile?.role === 'admin' ? '/admin/tours' : '/operator')}>
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(13px, 3.5vw, 18px)', color: 'var(--gray-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tour && tour.name}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {online ? <Wifi size={13} color="var(--green)" /> : <WifiOff size={13} color="var(--red)" />}
          {activeTab === 'scan' && (
            <button
              className={'btn btn-sm ' + (manualMode ? 'btn-primary' : 'btn-secondary')}
              style={{ padding: '5px 8px' }}
              onClick={() => { setManualMode(!manualMode); setManualInput('') }}
            >
              <Keyboard size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Compteurs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '10px 14px 0', flexShrink: 0 }}>
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid var(--accent)', padding: '10px 8px', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(20px, 5.5vw, 34px)', lineHeight: 1, color: 'var(--gray-800)' }}>
            {scanned}<span style={{ fontSize: 'clamp(10px, 2.5vw, 14px)', color: 'var(--gray-300)', fontWeight: 400 }}>/{totalParcels}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--gray-400)', margin: '3px 0' }}>Scannés</div>
          <div style={{ height: 3, background: 'var(--gray-100)', borderRadius: 100, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: pct === 100 ? 'var(--green)' : 'var(--accent)', width: pct + '%', transition: 'width 0.4s', borderRadius: 100 }} />
          </div>
        </div>

        <div onClick={() => missing > 0 && setActiveTab('missing')} style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid ' + (missing > 0 ? 'var(--red)' : 'var(--green)'), padding: '10px 8px', textAlign: 'center', boxShadow: 'var(--shadow-sm)', cursor: missing > 0 ? 'pointer' : 'default' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(20px, 5.5vw, 34px)', lineHeight: 1, color: missing > 0 ? 'var(--red)' : 'var(--green)' }}>{missing}</div>
          <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 3 }}>Manquants</div>
          {missing === 0 && scanned > 0 && <CheckCircle size={12} color="var(--green)" />}
        </div>

        <div onClick={() => anomalies > 0 && setActiveTab('anomalies')} style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid ' + (anomalies > 0 ? 'var(--red)' : 'var(--gray-200)'), padding: '10px 8px', textAlign: 'center', boxShadow: 'var(--shadow-sm)', cursor: anomalies > 0 ? 'pointer' : 'default' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(20px, 5.5vw, 34px)', lineHeight: 1, color: anomalies > 0 ? 'var(--red)' : 'var(--gray-300)' }}>{anomalies}</div>
          <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 3 }}>Anomalies</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '10px 14px 0', borderBottom: '1px solid var(--gray-200)', flexShrink: 0 }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          const hasBadge = tab.id === 'anomalies' && anomalies > 0
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: 1, padding: '8px 4px', border: 'none', borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent', background: 'none', fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--accent)' : 'var(--gray-400)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'var(--font-body)' }}>
              {tab.label}
              {hasBadge && <span style={{ background: 'var(--red)', color: 'white', borderRadius: 100, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>{anomalies}</span>}
            </button>
          )
        })}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>

        {/* TAB SCAN */}
        {activeTab === 'scan' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {manualMode ? (
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '2px solid var(--accent)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Keyboard size={13} /> Saisie manuelle
                </div>
                <input
                  ref={manualInputRef}
                  className="form-input"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleManualSubmit()
                    if (e.key === 'Escape') { setManualMode(false); setManualInput('') }
                  }}
                  placeholder="Numéro de colis"
                  inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                  style={{ fontSize: 18, fontFamily: 'monospace', letterSpacing: 1, textAlign: 'center' }}
                />
                <button className="btn btn-primary w-full" onClick={handleManualSubmit} disabled={manualInput.trim().length < 5} style={{ justifyContent: 'center' }}>
                  Valider
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setManualMode(false); setManualInput('') }} style={{ alignSelf: 'center', color: 'var(--gray-400)', fontSize: 12 }}>
                  ← Retour au scan TC51
                </button>
              </div>
            ) : (
              <div
                style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '2px dashed ' + (popup ? SCAN_RESULTS[popup.type].color : 'var(--gray-200)'), padding: '24px 16px', textAlign: 'center', cursor: 'text', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 100, transition: 'border-color 0.2s' }}
                onClick={() => scanInputRef.current && scanInputRef.current.focus()}
              >
                <Package size={24} color="var(--gray-200)" />
                <p style={{ fontSize: 13, color: 'var(--gray-400)', fontWeight: 500, margin: 0 }}>Zone de scan active</p>
                <p style={{ fontSize: 11, color: 'var(--gray-300)', margin: 0 }}>Scannez avec le TC51</p>
                {scanInput && <div style={{ fontFamily: 'monospace', fontSize: 18, color: 'var(--accent)', fontWeight: 600, letterSpacing: 2 }}>{scanInput}</div>}
              </div>
            )}

            {scannedList.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--gray-700)' }}>Derniers scans</span>
                  <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{scannedList.length}</span>
                </div>
                {scannedList.slice(0, 5).map((s, idx) => (
                  <div key={s.barcode + idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid var(--gray-100)' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: '#05996920', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>✓</span>
                    <code style={{ fontSize: 12, color: 'var(--gray-600)', flex: 1 }}>{s.barcode}</code>
                    <span style={{ fontSize: 10, color: 'var(--gray-400)', flexShrink: 0 }}>{new Date(s.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB COLIS — tous les colis de la tournée avec statut */}
        {activeTab === 'colis' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--gray-700)' }}>Tous les colis</span>
              <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{allParcels.length} colis</span>
            </div>
            {allParcels.length === 0
              ? <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucun colis</div>
              : allParcels.map(p => {
                const isScanned = scannedBarcodes.has(p.barcode)
                return (
                  <div key={p.barcode} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', background: isScanned ? '#f0fdf4' : undefined }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      background: isScanned ? '#05996920' : 'var(--red-light)',
                      color: isScanned ? '#059669' : 'var(--red)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                    }}>
                      {isScanned ? '✓' : '✗'}
                    </span>
                    <code style={{ fontSize: 12, color: 'var(--gray-600)', flex: 1 }}>{p.barcode}</code>
                    <span style={{ fontSize: 11, fontWeight: 500, color: isScanned ? '#059669' : 'var(--gray-300)', flexShrink: 0 }}>
                      {isScanned ? 'Scanné' : 'En attente'}
                    </span>
                  </div>
                )
              })
            }
          </div>
        )}

        {/* TAB SCANNÉS */}
        {activeTab === 'scanned' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--gray-700)' }}>Colis confirmés</span>
              <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{scannedList.length} / {totalParcels}</span>
            </div>
            {scannedList.length === 0
              ? <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucun colis scanné</div>
              : scannedList.map((s, idx) => (
                <div key={s.barcode + idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--gray-100)' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: '#05996920', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>✓</span>
                  <code style={{ fontSize: 12, color: 'var(--gray-600)', flex: 1 }}>{s.barcode}</code>
                  <span style={{ fontSize: 10, color: 'var(--gray-400)', flexShrink: 0 }}>{new Date(s.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
              ))
            }
          </div>
        )}

        {/* TAB MANQUANTS */}
        {activeTab === 'missing' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between', background: missing > 0 ? 'var(--red-light)' : 'var(--green-light)' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: missing > 0 ? '#991b1b' : '#065f46' }}>Colis manquants</span>
              <span style={{ fontSize: 11, color: missing > 0 ? '#991b1b' : '#065f46', fontWeight: 500 }}>{missing}</span>
            </div>
            {missingParcels.length === 0
              ? <div style={{ padding: '24px', textAlign: 'center', color: 'var(--green)', fontSize: 13, fontWeight: 500 }}>Tous les colis sont scannés ✓</div>
              : missingParcels.map(p => (
                <div key={p.barcode} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--gray-100)' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: 'var(--red-light)', color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>✗</span>
                  <code style={{ fontSize: 12, color: 'var(--gray-600)', flex: 1 }}>{p.barcode}</code>
                </div>
              ))
            }
          </div>
        )}

        {/* TAB ANOMALIES */}
        {activeTab === 'anomalies' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: anomalies > 0 ? 'var(--red-light)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={13} color={anomalies > 0 ? 'var(--red)' : 'var(--gray-400)'} />
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: anomalies > 0 ? '#991b1b' : 'var(--gray-700)' }}>Colis sur mauvaise tournée</span>
              </div>
              <span style={{ fontSize: 11, color: anomalies > 0 ? '#991b1b' : 'var(--gray-400)', fontWeight: 500 }}>{anomalies}</span>
            </div>
            {wrongTourList.length === 0
              ? <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucune anomalie détectée</div>
              : wrongTourList.map((s, idx) => (
                <div key={s.barcode + idx} style={{ padding: '10px 12px', borderBottom: '1px solid var(--gray-100)', background: '#fff5f5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: 'var(--red-light)', color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>⚠</span>
                    <code style={{ fontSize: 12, color: 'var(--gray-800)', flex: 1, fontWeight: 600 }}>{s.barcode}</code>
                    <span style={{ fontSize: 10, color: 'var(--gray-400)', flexShrink: 0 }}>{new Date(s.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  </div>
                  {s.real_tour && (
                    <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4, marginLeft: 28 }}>Appartient à : {s.real_tour}</div>
                  )}
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  )
}
