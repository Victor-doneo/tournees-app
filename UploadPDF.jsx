import { useState, useRef } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'

// ─── PDF PARSER ───────────────────────────────────────────────────────────────
// Parse le texte brut extrait du PDF pour en tirer tournées + colis.
// Stratégie : on utilise l'API Claude vision via Anthropic pour OCR/parsing
// car le PDF est text-based, on peut l'envoyer directement.

async function parsePDFText(text) {
  const lines = text.split('\n')
  const tours = {}
  let currentTourName = null
  let inChargementSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Détection du nom de tournée : ligne contenant "CAMION" ou "camion"
    const tourMatch = line.match(/TOURNEE\s+TA830(?:CAMION|camion)(.+)/i)
    if (tourMatch) {
      // Nettoie le nom : prend la partie après CAMION
      let rawName = tourMatch[1].trim()
      // Supprime les infos après un espace si trop long (départements, zones)
      // On garde le nom brut complet comme clé
      currentTourName = rawName

      if (!tours[currentTourName]) {
        tours[currentTourName] = {
          name: currentTourName,
          parcels: [],
          excluded: [],
          inChargement: false,
        }
      }
      inChargementSection = false
      continue
    }

    // Cas particulier : nom de tournée sur ligne suivante (MNS1alfortville)
    if (line.match(/^ta830camion/i) && !line.includes('TOURNEE')) {
      const rawName = line.replace(/^ta830camion/i, '').trim()
      currentTourName = rawName
      if (!tours[currentTourName]) {
        tours[currentTourName] = { name: currentTourName, parcels: [], excluded: [], inChargement: false }
      }
      continue
    }

    if (!currentTourName) continue

    // Détecter section CHARGEMENT (on veut uniquement cette section)
    if (line === 'CHARGEMENT') {
      inChargementSection = true
      tours[currentTourName].inChargement = true
      continue
    }

    // Détecter section LIVRAISON → arrêter de parser cette tournée
    if (line === 'LIVRAISON' && inChargementSection) {
      inChargementSection = false
      currentTourName = null
      continue
    }

    if (!inChargementSection) continue

    // Détecter type de prestation "Reprise"
    if (line.startsWith('Type prestation') && line.includes('Reprise')) {
      // Le colis précédent est une Reprise → on le marque
      if (tours[currentTourName].parcels.length > 0) {
        const last = tours[currentTourName].parcels.pop()
        tours[currentTourName].excluded.push({ ...last, exclusionReason: 'Reprise' })
      }
      continue
    }

    // Détecter un numéro de colis : nombre de 9-15 chiffres en fin de ligne
    // Le numéro est toujours le dernier élément sur la ligne du client
    const barcodeMatch = line.match(/(\d{9,15})\s*$/)
    if (barcodeMatch && !line.startsWith('Type') && !line.startsWith('Référence') && !line.startsWith('Créneau')) {
      const barcode = barcodeMatch[1]
      // Éviter les doublons dans la même tournée
      const alreadyIn = tours[currentTourName].parcels.some(p => p.barcode === barcode)
        || tours[currentTourName].excluded.some(p => p.barcode === barcode)
      if (!alreadyIn) {
        tours[currentTourName].parcels.push({ barcode })
      }
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

  // Date par défaut = demain (contrôle J-1)
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
      // 1. Uploader le PDF dans Supabase Storage
      setProgress('Envoi du fichier...')
      const path = `${deliveryDate}/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('tour-pdfs')
        .upload(path, file)
      if (uploadError) throw new Error('Erreur upload : ' + uploadError.message)

      // 2. Créer ou récupérer la delivery_date
      setProgress('Création de la date de livraison...')
      const { data: dateData, error: dateError } = await supabase
        .from('delivery_dates')
        .upsert({ delivery_date: deliveryDate }, { onConflict: 'delivery_date' })
        .select()
        .single()
      if (dateError) throw new Error('Erreur date : ' + dateError.message)

      // 3. Enregistrer l'upload
      const { data: uploadRecord, error: uploadRecordError } = await supabase
        .from('pdf_uploads')
        .insert({
          delivery_date_id: dateData.id,
          uploaded_by: profile.id,
          filename: file.name,
          storage_path: path,
          status: 'processing',
        })
        .select()
        .single()
      if (uploadRecordError) throw new Error('Erreur enregistrement : ' + uploadRecordError.message)

      // 4. Lire le PDF et extraire le texte via FileReader
      setProgress('Extraction du texte du PDF...')
      const text = await extractTextFromPDF(file)

      // 5. Parser le texte
      setProgress('Analyse des tournées...')
      const parsedTours = await parsePDFText(text)

      if (parsedTours.length === 0) throw new Error('Aucune tournée détectée dans ce PDF.')

      // 6. Insérer les tournées et colis en base
      setProgress(`Insertion de ${parsedTours.length} tournées...`)
      let totalTours = 0
      let totalParcels = 0

      for (const tour of parsedTours) {
        // Créer ou mettre à jour la tournée
        const { data: tourData, error: tourError } = await supabase
          .from('tours')
          .upsert({
            delivery_date_id: dateData.id,
            name: tour.name,
            total_parcels: tour.parcels.length,
            excluded_parcels: tour.excluded.length,
            status: 'pending',
          }, { onConflict: 'delivery_date_id,name' })
          .select()
          .single()

        if (tourError) {
          console.warn(`Tournée ${tour.name} ignorée:`, tourError.message)
          continue
        }

        // Insérer les colis à scanner
        if (tour.parcels.length > 0) {
          const parcelsToInsert = tour.parcels.map(p => ({
            tour_id: tourData.id,
            barcode: p.barcode,
            excluded: false,
          }))
          const { error: parcelsError } = await supabase
            .from('parcels')
            .upsert(parcelsToInsert, { onConflict: 'barcode', ignoreDuplicates: true })
          if (!parcelsError) totalParcels += tour.parcels.length
        }

        // Insérer les colis exclus (Reprise)
        if (tour.excluded.length > 0) {
          const excludedToInsert = tour.excluded.map(p => ({
            tour_id: tourData.id,
            barcode: p.barcode,
            excluded: true,
            exclusion_reason: p.exclusionReason || 'Reprise',
          }))
          await supabase.from('parcels').upsert(excludedToInsert, { onConflict: 'barcode', ignoreDuplicates: true })
        }

        totalTours++
      }

      // 7. Mettre à jour le statut de l'upload
      await supabase.from('pdf_uploads').update({
        status: 'done',
        tours_created: totalTours,
        parcels_created: totalParcels,
      }).eq('id', uploadRecord.id)

      setResult({ success: true, tours: totalTours, parcels: totalParcels, details: parsedTours })
      toast.success(`Import terminé : ${totalTours} tournées, ${totalParcels} colis`)

    } catch (err) {
      console.error(err)
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

            {/* Date */}
            <div className="form-group">
              <label className="form-label">Date de livraison (tournées du lendemain)</label>
              <input
                type="date"
                className="form-input"
                value={deliveryDate || tomorrowStr}
                onChange={e => setDeliveryDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
              <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                Exemple : si aujourd'hui on contrôle les tournées du 16 avril, sélectionnez le 16 avril.
              </span>
            </div>

            {/* Upload zone */}
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
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={e => { e.stopPropagation(); setFile(null) }}
                  >
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

            {/* Progress */}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)' }}>
                <div className="spinner dark" style={{ borderTopColor: 'var(--accent)', borderColor: 'rgba(79,70,229,0.2)' }} />
                <span style={{ fontSize: '14px', color: 'var(--accent)' }}>{progress}</span>
              </div>
            )}

            {/* Result */}
            {result && (
              <div style={{
                padding: '16px 20px',
                borderRadius: 'var(--radius-sm)',
                background: result.success ? 'var(--green-light)' : 'var(--red-light)',
                border: `1px solid ${result.success ? '#a7f3d0' : '#fca5a5'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: result.success ? '8px' : 0 }}>
                  {result.success
                    ? <CheckCircle size={18} color="#059669" />
                    : <AlertCircle size={18} color="#dc2626" />
                  }
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

// Extraction de texte PDF côté client via FileReader (lecture brute)
// Pour les PDFs textuels comme celui-ci, on peut lire le flux texte
async function extractTextFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const buffer = e.target.result
      const bytes = new Uint8Array(buffer)
      let text = ''
      // Décodage UTF-8 / Latin-1 du flux PDF
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]
        if (b >= 32 && b < 127) text += String.fromCharCode(b)
        else if (b === 10 || b === 13) text += '\n'
      }
      // Extraction des chaînes entre parenthèses (format PDF Tj/TJ)
      const matches = []
      const re = /\(([^)]{1,200})\)\s*Tj/g
      let m
      while ((m = re.exec(text)) !== null) {
        matches.push(m[1])
      }
      // Si on a extrait du texte, l'utiliser ; sinon utiliser le texte brut
      const result = matches.length > 100 ? matches.join('\n') : text
      resolve(result)
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}
