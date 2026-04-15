import { useState, useRef } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react'
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

    // Regrouper les items par position Y (même Y = même ligne visuelle)
    const byY = {}
    for (const item of content.items) {
      const y = Math.round(item.transform[5])
      if (!byY[y]) byY[y] = []
      byY[y].push({ x: item.transform[4], str: item.str })
    }

    // Trier Y décroissant (haut → bas), X croissant (gauche → droite)
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
// Extrait et nettoie le nom après le préfixe ta830camion (insensible à la casse)
// Gère aussi le suffixe parasite "m " dans "ta830camionm MNS75"
function extractTourName(raw) {
  // Supprimer le préfixe ta830camion (toutes variantes de casse)
  // + éventuel caractère parasite unique après (ex: "m " dans "ta830camionm MNS75")
  let name = raw.replace(/ta830camion[a-z]?\s*/i, '').trim()
  // Normaliser les espaces multiples
  name = name.replace(/\s+/g, ' ').trim()
  return name
}

// ─── PARSER PRINCIPAL ─────────────────────────────────────────────────────────
function parsePDFText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const tours = {}
  // Set des noms normalisés déjà vus → évite de parser la section LIVRAISON
  const seenTours = new Set()

  let currentTourName = null
  let inChargement = false
  let skip = false           // true = on est dans une section LIVRAISON à ignorer
  let waitingForNameContinuation = false // true = le nom est sur la ligne suivante

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ── CAS 1 : Ligne normale "SOCIETE DE TRANSPORT ... TOURNEE TA830camionXXX" ──
    const fullTourMatch = line.match(/TOURNEE\s+TA830(?:CAMION|camion)[a-z]?\s*(.+)/i)
    if (fullTourMatch) {
      waitingForNameContinuation = false
      const name = extractTourName('ta830camion' + fullTourMatch[1])

      if (seenTours.has(name)) {
        skip = true; currentTourName = null; inChargement = false
      } else {
        seenTours.add(name)
        currentTourName = name; skip = false; inChargement = false
        if (!tours[name]) tours[name] = { name, parcels: [], excluded: [] }
      }
      continue
    }

    // ── CAS 2 : Ligne "SOCIETE DE TRANSPORT ... TOURNEE" SANS le nom (MNS1) ──
    // Le nom est sur la ligne précédente ou suivante
    if (line.match(/TOURNEE\s*$/) && !line.match(/ta830camion/i)) {
      // Le nom était sur la ligne d'avant (déjà traité en CAS 3 ci-dessous)
      // ou sera sur la ligne suivante → on attend
      waitingForNameContinuation = false
      continue
    }

    // ── CAS 3 : Ligne contenant "ta830camion" SANS "TOURNEE" (MNS1 split) ──
    const splitCamionMatch = line.match(/ta830camion[a-z]?\s*(.+)/i)
    if (splitCamionMatch && !line.match(/TOURNEE/i)) {
      let namePart = splitCamionMatch[1].trim()

      // Regarder si la ligne suivante est une continuation du nom
      // (courte, pas un mot-clé connu, pas un barcode)
      const nextLine = (lines[i + 1] || '').trim()
      const isContinuation = nextLine.length > 0
        && nextLine.length < 60
        && !nextLine.match(/^(SOCIETE|NOM DU|POIDS|CHARGEMENT|LIVRAISON|Type|Référence|Créneau|Quantité|Imprimé|©)/i)
        && !nextLine.match(/ta830camion/i)
        && !nextLine.match(/TOURNEE/i)
        && !nextLine.match(/^\d{9,15}$/)
        && !nextLine.match(/^\d+\s*\/\s*\d+$/)

      if (isContinuation) {
        namePart = namePart + ' ' + nextLine
        i++ // sauter la ligne de continuation
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

    // ── Sections ──
    if (line === 'CHARGEMENT') { inChargement = true; continue }
    if (line.match(/^\s*LIVRAISON\s*$/) && inChargement) {
      inChargement = false; currentTourName = null; continue
    }
    if (!inChargement || line === '\f') continue

    // ── Reprise : marquer le dernier colis comme exclu ──
    if (line.match(/Type\s+prestation/i) && line.match(/Reprise/i)) {
      const t = tours[currentTourName]
      if (t.parcels.length > 0) {
        const last = t.parcels.pop()
        t.excluded.push({ ...last, exclusionReason: 'Reprise' })
      }
      continue
    }

    // ── Ignorer les lignes de métadonnées ──
    if (line.match(/^(Type\s+prestation|Référence|Créneau|Quantité|Imprimé|POIDS|LETTRE DE VOITURE|Réserves|commentaires|©)/i)) continue
    if (line.match(/^\d+\s*\/\s*\d+$/)) continue             // numéro de page
    if (line.match(/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/)) continue // créneau horaire

    // ── Détection barcode : groupes de 9-15 chiffres ──
    const barcodeRegex = /\b(\d{9,15})\b/g
    let m
    while ((m = barcodeRegex.exec(line)) !== null) {
      const bc = m[1]
      // Filtrer téléphones et codes postaux
      if (bc.length === 10 && bc.startsWith('0')) continue
      if (bc.match(/^0033/)) continue
      if (bc.match(/^336\d|^337\d/)) continue
      if (bc.length === 5) continue

      const t = tours[currentTourName]
      const exists = t.parcels.some(p => p.barcode === bc)
        || t.excluded.some(p => p.barcode === bc)
      if (!exists) t.parcels.push({ barcode: bc })
    }
  }

  return Object.values(tours).filter(t => t.parcels.length > 0 || t.excluded.length > 0)
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

    try {
      setProgress('Envoi du fichier...')
      const path = `${deliveryDate}/${Date.now()}_${file.name}`
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

      console.log('Tournées parsées:', parsedTours.map(t => ({
        name: t.name, colis: t.parcels.length, reprises: t.excluded.length
      })))

      if (parsedTours.length === 0) throw new Error('Aucune tournée détectée dans ce PDF.')

      setProgress(`Insertion de ${parsedTours.length} tournées...`)
      let totalTours = 0
      let totalParcels = 0

      for (const tour of parsedTours) {
        const { data: tourData, error: tourError } = await supabase
          .from('tours')
          .upsert({
            delivery_date_id: dateData.id,
            name: tour.name,
            total_parcels: tour.parcels.length,
            excluded_parcels: tour.excluded.length,
            status: 'pending',
          }, { onConflict: 'delivery_date_id,name' })
          .select().single()

        if (tourError) { console.warn(`Tournée ${tour.name} ignorée:`, tourError.message); continue }

        if (tour.parcels.length > 0) {
          await supabase.from('parcels').upsert(
            tour.parcels.map(p => ({ tour_id: tourData.id, barcode: p.barcode, excluded: false })),
            { onConflict: 'barcode', ignoreDuplicates: true }
          )
          totalParcels += tour.parcels.length
        }

        if (tour.excluded.length > 0) {
          await supabase.from('parcels').upsert(
            tour.excluded.map(p => ({
              tour_id: tourData.id, barcode: p.barcode,
              excluded: true, exclusion_reason: p.exclusionReason || 'Reprise',
            })),
            { onConflict: 'barcode', ignoreDuplicates: true }
          )
        }
        totalTours++
      }

      if (uploadRecord) {
        await supabase.from('pdf_uploads').update({
          status: 'done', tours_created: totalTours, parcels_created: totalParcels,
        }).eq('id', uploadRecord.id)
      }

      setResult({ success: true, tours: totalTours, parcels: totalParcels, details: parsedTours })
      toast.success(`Import terminé : ${totalTours} tournées, ${totalParcels} colis`)

    } catch (err) {
      console.error('Erreur upload:', err)
      setResult({ success: false, error: err.message })
      toast.error('Erreur : ' + err.message)
    } finally {
      setLoading(false)
      setProgress('')
    }
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

            {result && (
              <div style={{
                padding: '16px 20px', borderRadius: 'var(--radius-sm)',
                background: result.success ? 'var(--green-light)' : 'var(--red-light)',
                border: `1px solid ${result.success ? '#a7f3d0' : '#fca5a5'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: result.success ? '8px' : 0 }}>
                  {result.success ? <CheckCircle size={18} color="#059669" /> : <AlertCircle size={18} color="#dc2626" />}
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

            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={loading || !file}
              style={{ alignSelf: 'flex-start' }}
            >
              {loading ? <><div className="spinner" /> Traitement...</> : <><Upload size={15} /> Importer et analyser</>}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
