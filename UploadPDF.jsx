import { useState, useRef } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { Upload, FileText, CheckCircle, AlertCircle, X, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

// ─── PDF.JS ───────────────────────────────────────────────────────────────────
function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      return resolve(window.pdfjsLib)
    }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      resolve(window.pdfjsLib)
    }
    script.onerror = reject
    document.head.appendChild(script)
  })
}

// ─── EXTRACTION TEXTE ─────────────────────────────────────────────────────────
async function extractTextFromPDF(file) {
  const pdfjsLib = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    const byY = {}
    for (const item of content.items) {
      const rawY = item.transform[5]
      const yKey = Object.keys(byY).find(k => Math.abs(k - rawY) <= 3)
      const y = yKey !== undefined ? yKey : Math.round(rawY)
      if (!byY[y]) byY[y] = []
      byY[y].push({ x: item.transform[4], str: item.str })
    }

    const sortedYs = Object.keys(byY).sort((a, b) => b - a)
    for (const y of sortedYs) {
      const items = byY[y].sort((a, b) => a.x - b.x)
      fullText += items.map(i => i.str).join(' ') + '\n'
    }
    fullText += '\f'
  }
  return fullText
}

// ─── NORMALISATION DU NOM DE TOURNÉE ─────────────────────────────────────────
function extractTourName(raw) {
  return raw
    .replace(/ta830camion(m\s+)?/i, '')
    .trim()
    .replace(/\s+/g, ' ')
}

// Normalise un nom pour comparaison (sans espaces, minuscules)
function normalize(str) {
  return str.replace(/\s+/g, '').toLowerCase()
}

// ─── PARSER ───────────────────────────────────────────────────────────────────
function parsePDFText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const tours = {}
  const seenTours = new Set()

  let currentTourName = null
  let inChargement = false
  let skip = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fullTourMatch = line.match(/TOURNEE\s+TA830(?:CAMION|camion)(m\s+)?(.+)/i)
    if (fullTourMatch) {
      const rawSuffix = (fullTourMatch[1] || '') + fullTourMatch[2]
      const name = extractTourName('ta830camion' + rawSuffix)

      if (seenTours.has(name)) {
        skip = true; currentTourName = null; inChargement = false
      } else {
        seenTours.add(name)
        currentTourName = name; skip = false; inChargement = false
        if (!tours[name]) tours[name] = { name, parcels: [], excluded: [] }
      }
      continue
    }

    const splitCamionMatch = line.match(/ta830camion(.+)/i)
    if (splitCamionMatch && !line.match(/TOURNEE/i)) {
      let namePart = splitCamionMatch[1].trim()

      const nextLine = (lines[i + 1] || '').trim()
      const isContinuation = nextLine.length > 0
        && nextLine.length < 60
        && !nextLine.match(/^(SOCIETE|NOM DU|POIDS|CHARGEMENT|LIVRAISON|Type|Référence|Créneau|Quantité|Imprimé|©|LETTRE|Emargement)/i)
        && !nextLine.match(/ta830camion/i)
        && !nextLine.match(/TOURNEE/i)
        && !nextLine.match(/^\d{9,15}$/)
        && !nextLine.match(/^\d+\s*\/\s*\d+$/)

      if (isContinuation) {
        namePart = namePart + ' ' + nextLine
        i++
      }

      const name = extractTourName('ta830camion' + namePart)

      if (seenTours.has(name)) {
        skip = true; currentTourName = null; inChargement = false
      } else {
        seenTours.add(name)
        currentTourName = name; skip = false; inChargement = false
        if (!tours[name]) tours[name] = { name, parcels: [], excluded: [] }
      }
      continue
    }

    if (skip || !currentTourName) continue

    if (line === 'CHARGEMENT') { inChargement = true; continue }

    if (line.match(/^\s*LIVRAISON\s*$/) && inChargement) {
      inChargement = false; currentTourName = null; continue
    }

    if (!inChargement || line === '\f') continue

    if (line.match(/Type\s+prestation/i) && line.match(/\bReprise\b/i) && !line.match(/Livraison contre reprise/i)) {
      const t = tours[currentTourName]
      if (t.parcels.length > 0) {
        const last = t.parcels.pop()
        t.excluded.push({ ...last, exclusionReason: 'Reprise' })
      }
      continue
    }
    if (line.match(/Type\s+prestation/i) && line.match(/Livraison contre reprise/i)) {
      const t = tours[currentTourName]
      if (t.parcels.length > 0) {
        t.parcels[t.parcels.length - 1].isLivraisonContreReprise = true
      }
      continue
    }

    if (line.match(/^(Type\s+prestation|Référence|Créneau|Quantité|Imprimé|POIDS|LETTRE DE VOITURE|Réserves|commentaires|©|Emargement)/i)) continue
    if (line.match(/^\d+\s*\/\s*\d+$/)) continue
    if (line.match(/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/)) continue

    if (!line.match(/LV[123]_/)) continue

    const lastBarcodeMatch = line.match(/(\d{9,15})\s*$/)
    if (!lastBarcodeMatch) continue

    const bc = lastBarcodeMatch[1]
    if (bc.length === 10 && bc.startsWith('0')) continue
    if (bc.match(/^0033/)) continue
    if (bc.match(/^33[67]/)) continue

    {
      const t = tours[currentTourName]
      const exists = t.parcels.some(p => p.barcode === bc)
        || t.excluded.some(p => p.barcode === bc)
      if (!exists) t.parcels.push({ barcode: bc })
    }
  }

  return Object.values(tours).filter(t => t.parcels.length > 0 || t.excluded.length > 0)
}

// ─── MATCHING avec reference_tours ───────────────────────────────────────────
// Retourne { matched: true, officialName } ou { matched: false, rawName }
function matchTourName(rawName, referenceList) {
  const normalizedRaw = normalize(rawName)
  const found = [...referenceList]
    .sort((a, b) => b.name.length - a.name.length) // priorité au plus long match
    .find(ref => normalizedRaw.includes(normalize(ref.name)))
  if (found) return { matched: true, officialName: found.name, referenceId: found.id }
  return { matched: false, rawName }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function UploadPDF() {
  const { profile } = useAuth()
  const [file, setFile] = useState(null)
  const [deliveryDate, setDeliveryDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef()

  // État pour la résolution manuelle des tournées sans match
  const [unmatchedTours, setUnmatchedTours] = useState([]) // [{ rawName, manualName, parcels, excluded }]
  const [pendingData, setPendingData] = useState(null) // données en attente de résolution
  const [resolving, setResolving] = useState(false)

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  function handleDrop(e) {
    e.preventDefault()
    setDragover(false)
    const f = e.dataTransfer.files[0]
    if (f?.type === 'application/pdf') setFile(f)
    else toast.error('Veuillez déposer un fichier PDF.')
  }

  async function handleUpload() {
    if (!file || !deliveryDate) return toast.error('Sélectionnez un fichier et une date.')
    setLoading(true)
    setResult(null)
    setUnmatchedTours([])
    setPendingData(null)

    try {
      setProgress('Envoi du fichier...')
      const safeName = file.name.normalize('NFD').replace(/[0300-036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')
      const path = `${deliveryDate}/${Date.now()}_${safeName}`
      const { error: uploadError } = await supabase.storage
        .from('tour-pdfs').upload(path, file)
      if (uploadError) throw new Error('Erreur upload : ' + uploadError.message)

      setProgress('Création de la date de livraison...')
      const { data: dateData, error: dateError } = await supabase
        .from('delivery_dates')
        .upsert({ delivery_date: deliveryDate }, { onConflict: 'delivery_date' })
        .select().single()
      if (dateError) throw new Error('Erreur date : ' + dateError.message)

      const { data: uploadRecord } = await supabase
        .from('pdf_uploads')
        .insert({
          delivery_date_id: dateData.id,
          uploaded_by: profile.id,
          filename: file.name,
          storage_path: path,
          status: 'processing',
        }).select().single()

      setProgress('Extraction du texte PDF...')
      const text = await extractTextFromPDF(file)

      setProgress('Analyse des tournées...')
      const parsedTours = parsePDFText(text)

      if (parsedTours.length === 0) throw new Error('Aucune tournée détectée dans ce PDF.')

      setProgress('Chargement des tournées de référence...')
      const { data: referenceList } = await supabase
        .from('tours_references')
        .select('id, name')


      // Matcher chaque tournée
      const matched = []
      const unmatched = []

      for (const tour of parsedTours) {
        const result = matchTourName(tour.name, referenceList || [])
        if (result.matched) {
          matched.push({ ...tour, finalName: result.officialName, referenceId: result.referenceId })
        } else {
          unmatched.push({ rawName: tour.name, manualName: '', parcels: tour.parcels, excluded: tour.excluded })
        }
      }

      // Si des tournées n'ont pas de match → demander input manuel
      if (unmatched.length > 0) {
        setUnmatchedTours(unmatched)
        setPendingData({ dateData, uploadRecord, matched })
        setLoading(false)
        setProgress('')
        return
      }

      // Sinon tout est matché → on insère directement
      await insertTours(matched, dateData, uploadRecord)

    } catch (err) {
      console.error('Erreur upload:', err)
      setResult({ success: false, error: err.message })
      toast.error('Erreur : ' + err.message)
    } finally {
      setLoading(false)
      setProgress('')
    }
  }

  async function handleResolveUnmatched() {
    // Vérifier que tous les inputs manuels sont remplis
    const missing = unmatchedTours.filter(t => !t.manualName.trim())
    if (missing.length > 0) {
      toast.error('Veuillez saisir un nom pour chaque tournée non reconnue.')
      return
    }

    setResolving(true)
    try {
      const resolvedTours = []
      for (const t of unmatchedTours) {
        const finalName = t.manualName.trim()
        // Créer la ligne dans tours_references
        const { data: refData } = await supabase
          .from('tours_references')
          .upsert({ name: finalName }, { onConflict: 'name' })
          .select('id').single()
        resolvedTours.push({
          name: t.rawName,
          finalName,
          referenceId: refData ? refData.id : null,
          parcels: t.parcels,
          excluded: t.excluded,
        })
      }

      const allTours = [...(pendingData.matched || []), ...resolvedTours]
      await insertTours(allTours, pendingData.dateData, pendingData.uploadRecord)
      setUnmatchedTours([])
      setPendingData(null)
    } catch (err) {
      console.error('Erreur résolution:', err)
      toast.error('Erreur : ' + err.message)
    } finally {
      setResolving(false)
    }
  }

  async function insertTours(tours, dateData, uploadRecord) {
    let totalTours = 0
    let totalParcels = 0

    for (const tour of tours) {
      const { data: tourData, error: tourError } = await supabase
        .from('tours')
        .upsert({
          delivery_date_id: dateData.id,
          name: tour.finalName,
          total_parcels: tour.parcels.length,
          excluded_parcels: tour.excluded.length,
          status: 'pending',
          reference_id: tour.referenceId || null,
        }, { onConflict: 'delivery_date_id,name' })
        .select().single()

      if (tourError) {
        console.warn(`Tournée ${tour.finalName} ignorée :`, tourError.message)
        continue
      }

      if (tour.parcels.length > 0) {
        await supabase.from('parcels').upsert(
          tour.parcels.map(p => ({
            tour_id: tourData.id,
            barcode: p.barcode,
            excluded: false,
            exclusion_reason: p.isLivraisonContreReprise ? 'Livraison contre reprise' : null,
          })),
          { onConflict: 'barcode', ignoreDuplicates: true }
        )
        totalParcels += tour.parcels.length
      }

      if (tour.excluded.length > 0) {
        await supabase.from('parcels').upsert(
          tour.excluded.map(p => ({
            tour_id: tourData.id,
            barcode: p.barcode,
            excluded: true,
            exclusion_reason: p.exclusionReason || 'Reprise',
          })),
          { onConflict: 'barcode', ignoreDuplicates: true }
        )
      }
      totalTours++
    }

    if (uploadRecord) {
      await supabase.from('pdf_uploads').update({
        status: 'done',
        tours_created: totalTours,
        parcels_created: totalParcels,
      }).eq('id', uploadRecord.id)
    }

    setResult({ success: true, tours: totalTours, parcels: totalParcels, details: tours.map(t => ({ name: t.finalName, parcels: t.parcels, excluded: t.excluded })) })
    toast.success(`Import terminé : ${totalTours} tournées, ${totalParcels} colis`)
  }

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Importer un PDF</h2>
        <p className="page-subtitle">Chargez une feuille de route pour créer les tournées automatiquement</p>
      </div>

      <div className="page-body" style={{ maxWidth: '680px' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Nouveau document</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            <div className="form-group">
              <label className="form-label">Date de livraison</label>
              <input
                type="date"
                className="form-input"
                value={deliveryDate || tomorrowStr}
                onChange={e => setDeliveryDate(e.target.value)}
              />
              <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                Exemple : si aujourd'hui on contrôle les tournées du 16 avril, sélectionnez le 16 avril.
              </span>
            </div>

            <div
              className={`upload-zone${dragover ? ' dragover' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragover(true) }}
              onDragLeave={() => setDragover(false)}
              onDrop={handleDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={e => setFile(e.target.files[0])}
              />
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'center' }}>
                  <FileText size={28} color="var(--accent)" />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{file.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                      {(file.size / 1024 / 1024).toFixed(2)} Mo
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setFile(null) }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="upload-zone-icon"><Upload size={36} /></div>
                  <div className="upload-zone-title">Déposez votre PDF ici</div>
                  <div className="upload-zone-sub">ou cliquez pour parcourir vos fichiers</div>
                </>
              )}
            </div>

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)' }}>
                <div className="spinner dark" style={{ borderTopColor: 'var(--accent)', borderColor: 'rgba(79,70,229,0.2)' }} />
                <span style={{ fontSize: '14px', color: 'var(--accent)' }}>{progress}</span>
              </div>
            )}

            {/* ── Résolution manuelle des tournées non matchées ── */}
            {unmatchedTours.length > 0 && (
              <div style={{
                padding: '16px 20px', borderRadius: 'var(--radius-sm)',
                background: '#fffbeb', border: '1px solid #fcd34d',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <AlertTriangle size={16} color="#d97706" />
                  <span style={{ fontWeight: 700, color: '#92400e', fontSize: 14 }}>
                    {unmatchedTours.length} tournée{unmatchedTours.length > 1 ? 's' : ''} non reconnue{unmatchedTours.length > 1 ? 's' : ''}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#92400e', marginBottom: 14 }}>
                  Ces tournées extraites du PDF ne correspondent à aucun nom officiel. Saisissez le nom correct pour chacune.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {unmatchedTours.map((t, idx) => (
                    <div key={idx} style={{ background: 'white', borderRadius: 'var(--radius-sm)', border: '1px solid #fcd34d', padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 6 }}>
                        Nom extrait du PDF :
                        <code style={{ marginLeft: 6, fontWeight: 700, color: 'var(--gray-700)', background: 'var(--gray-100)', padding: '1px 6px', borderRadius: 4 }}>
                          {t.rawName}
                        </code>
                        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--gray-400)' }}>
                          ({t.parcels.length} colis)
                        </span>
                      </div>
                      <input
                        className="form-input"
                        placeholder="Nom officiel de la tournée..."
                        value={t.manualName}
                        onChange={e => {
                          const updated = [...unmatchedTours]
                          updated[idx] = { ...updated[idx], manualName: e.target.value }
                          setUnmatchedTours(updated)
                        }}
                        style={{ fontSize: 13 }}
                      />
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleResolveUnmatched}
                  disabled={resolving}
                  style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}
                >
                  {resolving
                    ? <><div className="spinner" /> Importation...</>
                    : <><CheckCircle size={14} /> Confirmer et importer</>}
                </button>
              </div>
            )}

            {result && (
              <div style={{
                padding: '16px 20px', borderRadius: 'var(--radius-sm)',
                background: result.success ? 'var(--green-light)' : 'var(--red-light)',
                border: `1px solid ${result.success ? '#a7f3d0' : '#fca5a5'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: result.success ? '8px' : 0 }}>
                  {result.success
                    ? <CheckCircle size={18} color="#059669" />
                    : <AlertCircle size={18} color="#dc2626" />}
                  <span style={{ fontWeight: 600, color: result.success ? '#065f46' : '#991b1b', fontSize: '14px' }}>
                    {result.success ? 'Import réussi !' : 'Erreur lors de l\'import'}
                  </span>
                </div>
                {result.success ? (
                  <div style={{ fontSize: '13px', color: '#065f46', marginLeft: '28px' }}>
                    <div>{result.tours} tournées créées</div>
                    <div>{result.parcels} colis à scanner</div>
                    {result.details?.map(t => (
                      <div key={t.name} style={{ marginTop: '4px', opacity: 0.7 }}>
                        → {t.name} : {t.parcels.length} colis
                        {t.excluded.length > 0 && ` (${t.excluded.length} Reprises exclus)`}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: '#991b1b', marginLeft: '28px' }}>{result.error}</div>
                )}
              </div>
            )}

            {unmatchedTours.length === 0 && (
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={loading || !file}
                style={{ alignSelf: 'flex-start' }}
              >
                {loading
                  ? <><div className="spinner" /> Traitement...</>
                  : <><Upload size={15} /> Importer et analyser</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
