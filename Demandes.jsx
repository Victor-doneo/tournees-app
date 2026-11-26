import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from './supabase'
import { ageLabel, ageInWorkingDays, MAX_FILES, acceptFiles, makePending, uploadAttachment, PendingFile, StoredFile } from './attachments'
import { useAuth } from './AuthContext'
import { useDemandeNotifications, markDemandeRead, markAllDemandesRead, fetchRecentNotifications } from './demandeNotifications'
import toast from 'react-hot-toast'
import {
  Plus, X, Star, Package, ShieldAlert, PackagePlus, Search, MessageSquare,
  CheckCircle2, Send, ClipboardList, Paperclip, Bell,
} from 'lucide-react'

const PHOTO_BUCKET = 'demandes-photos'
const MAX_PHOTOS = MAX_FILES

export const TYPES = {
  securisation: { label: 'Sécurisation', badge: 'badge-red', icon: ShieldAlert },
  ajout_non_planifie: { label: 'Ajout non planifié dans une tournée', badge: 'badge-orange', icon: PackagePlus },
  ajout_non_planifie_retour: { label: 'Ajout non planifié en retour', badge: 'badge-purple', icon: PackagePlus },
  reception_reflex: { label: 'Réception REFLEX à réaliser', badge: 'badge-orange', icon: PackagePlus },
  nps: { label: 'NPS', badge: 'badge-red', icon: Star },
  recherche_colis: { label: 'Recherche de colis', badge: 'badge-blue', icon: Search },
  autre: { label: 'Autres demandes', badge: 'badge-gray', icon: MessageSquare },
}

const BP_REQUIRED_TYPES = ['securisation', 'ajout_non_planifie', 'ajout_non_planifie_retour', 'recherche_colis', 'reception_reflex']

export const STATUS_META = {
  ouverte: { label: 'Ouverte', badge: 'badge-orange' },
  resolue: { label: 'Résolue', badge: 'badge-green' },
  annulee: { label: 'Annulée', badge: 'badge-red' },
  cloturee: { label: 'Clôturée', badge: 'badge-gray' },
}

// Affectation : DONEO (interne, bleu) ou Partenaire (rose)
export const ASSIGN_META = {
  doneo: { label: 'DONEO', bg: '#dbeafe', color: '#1e40af' },
  partenaire: { label: 'Partenaire', bg: '#fce7f3', color: '#9d174d' },
}
export function AssignBadge({ value }) {
  const m = ASSIGN_META[value] || ASSIGN_META.doneo
  return <span className="badge" style={{ background: m.bg, color: m.color }}>{m.label}</span>
}

export default function Demandes() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const basePath = profile?.role === 'admin' ? '/admin' : profile?.role === 'operator' ? '/operator' : '/partner'

  const canCreate = true
  const canValidate = profile?.role === 'admin' || profile?.role === 'partner'
  const canLinkToSearch = false // les BP ne sont plus cliquables : simple texte à copier-coller

  const notifs = useDemandeNotifications()
  const [demandes, setDemandes] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ouverte')
  const [bpSearch, setBpSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selected, setSelected] = useState(null)
  const [showNotifs, setShowNotifs] = useState(false)
  const [history, setHistory] = useState([])

  const filteredDemandes = bpSearch.trim()
    ? demandes.filter(d => (d.bp || []).some(bp => bp.toLowerCase().includes(bpSearch.trim().toLowerCase())))
    : demandes

  useEffect(() => { fetchDemandes() }, [statusFilter])
  // Une nouvelle réponse est arrivée : on rafraîchit la liste sans écran de chargement
  useEffect(() => { if (notifs.total > 0) fetchDemandes(true) }, [notifs.total])

  // Ouvrir automatiquement une demande si ?open=<id> est présent (venant de la recherche colis)
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || selected?.id === openId) return
    const d = demandes.find(d => d.id === openId)
    if (d) { setSelected(d); return }
    // Demande absente du filtre courant (ex. résolue) : on va la chercher directement
    supabase
      .from('demandes')
      .select('*, created_by_user:created_by(full_name, email), resolved_by_user:resolved_by(full_name, email)')
      .eq('id', openId).maybeSingle()
      .then(({ data }) => { if (data) setSelected(data) })
  }, [searchParams, demandes])

  async function toggleNotifs() {
    const next = !showNotifs
    setShowNotifs(next)
    if (next) setHistory(await fetchRecentNotifications())
  }

  function openFromNotif(n) {
    setShowNotifs(false)
    setSelected(null)
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('open', n.demande_id); return p })
  }

  async function fetchDemandes(silent = false) {
    if (!silent) setLoading(true)
    let query = supabase
      .from('demandes')
      .select('*, created_by_user:created_by(full_name, email), resolved_by_user:resolved_by(full_name, email)')
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    const { data, error } = await query
    if (error) {
      toast.error('Erreur de chargement : ' + error.message)
      setDemandes([])
    } else {
      setDemandes(data || [])
    }
    setLoading(false)
  }

  function openDetail(d) {
    setSelected(d)
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('open', d.id)
      return p
    })
  }

  function closeDetail() {
    setSelected(null)
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.delete('open')
      return p
    })
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Suivi des tâches</h2>
            <p className="page-subtitle">Sécurisation, ajouts non planifiés, recherches de colis et autres demandes</p>
          </div>
          {canCreate && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
              <button className="btn btn-secondary" onClick={toggleNotifs}>
                <Bell size={15} /> Notifications{notifs.total > 0 ? ` (${notifs.total})` : ''}
              </button>
              {showNotifs && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, width: 400, maxWidth: '90vw', maxHeight: 460, overflowY: 'auto', background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.15)', zIndex: 50 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}>
                    <strong style={{ fontSize: 13 }}>Notifications récentes</strong>
                    {notifs.total > 0 && (
                      <button className="btn btn-sm btn-secondary" onClick={async () => { await markAllDemandesRead(); setHistory(await fetchRecentNotifications()) }}>
                        Tout marquer comme lu
                      </button>
                    )}
                  </div>
                  {history.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Aucune notification</div>
                  ) : history.map(n => (
                    <div key={n.id} onClick={() => openFromNotif(n)} style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', cursor: 'pointer', background: n.read_at ? undefined : 'rgba(239,68,68,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--gray-500)' }}>
                        <span>{n.actor?.full_name || n.actor?.email || '—'} · {n.kind === 'statut' ? 'statut modifié' : n.kind === 'nouvelle' ? 'nouvelle demande' : 'a répondu'}</span>
                        <span style={{ whiteSpace: 'nowrap' }}>{new Date(n.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: n.read_at ? 400 : 600, marginTop: 2 }}>
                        {n.demande ? `${(TYPES[n.demande.type] || TYPES.autre).label}${(n.demande.bp || []).length ? ' · ' + n.demande.bp.slice(0, 2).join(', ') + (n.demande.bp.length > 2 ? '…' : '') : ''}` : 'Demande supprimée'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--gray-600)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.kind === 'statut' ? `Nouveau statut : ${(STATUS_META[n.message] || {}).label || n.message}` : n.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                <Plus size={15} /> Nouvelle demande
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { value: 'ouverte', label: 'Ouvertes' },
            { value: 'resolue', label: 'Résolues' },
            { value: 'annulee', label: 'Annulées' },
            { value: 'cloturee', label: 'Clôturées' },
            { value: 'all', label: 'Toutes' },
          ].map(f => (
            <button
              key={f.value}
              className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}

          <div style={{ position: 'relative', marginLeft: 'auto', width: '260px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-300)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: '32px' }}
              placeholder="Rechercher par numéro de BP"
              value={bpSearch}
              onChange={e => setBpSearch(e.target.value)}
            />
          </div>
        </div>

        {bpSearch.trim() && (
          <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginTop: '-12px', marginBottom: '16px' }}>
            {filteredDemandes.length} tâche{filteredDemandes.length > 1 ? 's' : ''} rattachée{filteredDemandes.length > 1 ? 's' : ''} au BP « {bpSearch.trim()} »
          </p>
        )}

        <div className="card">
          {loading ? (
            <div className="loading-center"><div className="spinner dark" /></div>
          ) : filteredDemandes.length === 0 ? (
            <div className="empty-state">
              <ClipboardList size={36} className="empty-state-icon" />
              <p className="empty-state-title">{bpSearch.trim() ? 'Aucune tâche pour ce BP' : 'Aucune demande'}</p>
              <p className="empty-state-sub">
                {bpSearch.trim() ? 'Vérifiez le numéro et réessayez.' : 'Les demandes créées apparaîtront ici.'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>BP</th>
                    <th>Commentaire</th>
                    <th>Statut</th>
                    <th>Affectée à</th>
                    <th>Créée par</th>
                    <th>Date</th>
                    <th title="Jours écoulés depuis l'émission, week-ends exclus">Ancienneté</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDemandes.map(d => {
                    const t = TYPES[d.type] || TYPES.autre
                    const unread = notifs.byDemande[d.id] || 0
                    return (
                      <tr key={d.id} style={{ cursor: 'pointer', background: unread ? 'rgba(239,68,68,0.06)' : undefined, fontWeight: unread ? 600 : undefined }} onClick={() => openDetail(d)}>
                        <td>
                          <span className={`badge ${t.badge}`}>{t.label}</span>
                          {unread > 0 && (
                            <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                              {unread > 1 ? `${unread} nouveautés` : 'Nouveau'}
                            </span>
                          )}
                        </td>
                        <td>
                          {(d.bp || []).length === 0 ? (
                            <span style={{ color: 'var(--gray-300)' }}>—</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {d.bp.map(bp => canLinkToSearch ? (
                                <Link
                                  key={bp}
                                  to={`${basePath}/search-parcel?barcode=${encodeURIComponent(bp)}`}
                                  onClick={e => e.stopPropagation()}
                                  style={{ textDecoration: 'none' }}
                                >
                                  <code style={{
                                    fontFamily: 'monospace', fontSize: '12px', background: 'var(--blue-light)',
                                    color: '#1e40af', padding: '2px 8px', borderRadius: '4px',
                                  }}>
                                    {bp}
                                  </code>
                                </Link>
                              ) : (
                                <code key={bp} onClick={e => e.stopPropagation()} style={{
                                  userSelect: 'text', cursor: 'text', fontFamily: 'monospace', fontSize: '12px', background: 'var(--gray-100)',
                                  padding: '2px 8px', borderRadius: '4px',
                                }}>
                                  {bp}
                                </code>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--gray-600)' }}>
                          {d.commentaire || <span style={{ color: 'var(--gray-300)' }}>—</span>}
                          {(d.photos || []).length > 0 && (
                            <span title={`${d.photos.length} fichier(s)`} style={{ marginLeft: 8, color: 'var(--gray-400)', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
                              <Paperclip size={12} /> {d.photos.length}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${(STATUS_META[d.status] || STATUS_META.ouverte).badge}`}>
                            {(STATUS_META[d.status] || STATUS_META.ouverte).label}
                          </span>
                        </td>
                        <td><AssignBadge value={d.assigned_to} /></td>
                        <td style={{ fontSize: '13px' }}>{d.created_by_user?.full_name || d.created_by_user?.email || '—'}</td>
                        <td style={{ fontSize: '13px', color: 'var(--gray-500)' }}>
                          {new Date(d.created_at).toLocaleString('fr-FR')}
                        </td>
                        <td style={{ fontSize: '13px', whiteSpace: 'nowrap', fontWeight: 600, color: ageInWorkingDays(d) >= 5 && d.status === 'ouverte' ? 'var(--red)' : 'var(--gray-600)' }}>{ageInWorkingDays(d)} j</td>
                        <td style={{ color: 'var(--gray-300)' }}>›</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateDemandeModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchDemandes() }}
        />
      )}

      {selected && (
        <DemandeDetailModal
          demande={selected}
          basePath={basePath}
          canValidate={canValidate}
          canLinkToSearch={canLinkToSearch}
          onClose={closeDetail}
          onChanged={() => { fetchDemandes() }}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Modale de création
// ─────────────────────────────────────────────────────────────
function CreateDemandeModal({ onClose, onCreated }) {
  const { user } = useAuth()
  const [type, setType] = useState('securisation')
  const [bpInput, setBpInput] = useState('')
  const [bpList, setBpList] = useState([])
  const [commentaire, setCommentaire] = useState('')
  const [photos, setPhotos] = useState([]) // [{ file, preview }]
  const [assignedTo, setAssignedTo] = useState('doneo')
  const [saving, setSaving] = useState(false)

  const bpRequired = BP_REQUIRED_TYPES.includes(type)

  function handlePhotoChange(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // permet de re-sélectionner la même photo
    if (files.length === 0) return
    const room = MAX_PHOTOS - photos.length
    const accepted = acceptFiles(files, room)
    setPhotos(prev => [...prev, ...accepted.map(makePending)])
  }

  function removePhoto(index) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  function addBp() {
    const value = bpInput.trim()
    if (!value) return
    if (!bpList.includes(value)) setBpList(list => [...list, value])
    setBpInput('')
  }

  function removeBp(value) {
    setBpList(list => list.filter(v => v !== value))
  }

  function handleBpKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addBp()
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (bpRequired && bpList.length === 0) {
      toast.error('Au moins un numéro de colis (BP) est requis pour ce type de demande')
      return
    }
    setSaving(true)

    // L'id est généré ici pour ranger les photos dans un dossier à son nom
    // et n'insérer la demande qu'une fois les photos envoyées (pas de demande orpheline).
    const demandeId = crypto.randomUUID()
    const photoPaths = []
    try {
      for (let i = 0; i < photos.length; i++) {
        photoPaths.push(await uploadAttachment(PHOTO_BUCKET, `${demandeId}`, photos[i].file, i))
      }
    } catch (err) {
      setSaving(false)
      toast.error('Erreur lors de l\'envoi des fichiers : ' + (err.message || err))
      return
    }

    const { error } = await supabase.from('demandes').insert({
      id: demandeId,
      type,
      bp: bpList,
      commentaire: commentaire.trim() || null,
      photos: photoPaths,
      status: 'ouverte',
      assigned_to: assignedTo,
      created_by: user.id,
    })
    setSaving(false)
    if (error) {
      toast.error('Erreur : ' + error.message)
      return
    }
    photos.forEach(p => URL.revokeObjectURL(p.preview))
    toast.success('Demande créée')
    onCreated()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className="modal-title">Nouvelle demande</h3>
            <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Type de demande</label>
              <select className="form-input" value={type} onChange={e => setType(e.target.value)}>
                {Object.entries(TYPES).map(([key, t]) => (
                  <option key={key} value={key}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Affecter à</label>
              <select className="form-input" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                <option value="doneo">DONEO</option>
                <option value="partenaire">Partenaire</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">
                BP (numéro{bpList.length > 1 ? 's' : ''} de colis){bpRequired && <span style={{ color: 'var(--red)' }}> *</span>}
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="form-input"
                  placeholder="Scanner ou saisir un numéro puis Entrée"
                  value={bpInput}
                  onChange={e => setBpInput(e.target.value)}
                  onKeyDown={handleBpKeyDown}
                />
                <button type="button" className="btn btn-secondary" onClick={addBp}>Ajouter</button>
              </div>
              {bpList.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                  {bpList.map(bp => (
                    <span key={bp} className="badge badge-blue" style={{ gap: '6px' }}>
                      <code style={{ fontFamily: 'monospace' }}>{bp}</code>
                      <X size={12} style={{ cursor: 'pointer' }} onClick={() => removeBp(bp)} />
                    </span>
                  ))}
                </div>
              )}
              {bpRequired && (
                <p style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                  Obligatoire pour ce type de demande.
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Commentaire</label>
              <textarea
                className="form-input"
                rows={4}
                placeholder="Détails de la demande..."
                value={commentaire}
                onChange={e => setCommentaire(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Photos et fichiers (facultatif)</label>
              {photos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  {photos.map((p, i) => <PendingFile key={p.id} item={p} size={72} onRemove={() => removePhoto(i)} />)}
                </div>
              )}
              {photos.length < MAX_PHOTOS && (
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Paperclip size={14} /> Ajouter des fichiers
                  <input type="file" multiple onChange={handlePhotoChange} style={{ display: 'none' }} />
                </label>
              )}
              <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: 6 }}>
                {photos.length}/{MAX_PHOTOS} — photos, PDF, Excel, Word… (20 Mo max chacun). Sur téléphone, vous pouvez prendre la photo directement.
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><div className="spinner" /> {photos.length > 0 ? 'Envoi des fichiers...' : 'Création...'}</> : 'Créer la demande'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Modale de détail (réponses + validation)
// ─────────────────────────────────────────────────────────────
function DemandeDetailModal({ demande, basePath, canValidate, canLinkToSearch, onClose, onChanged }) {
  const { user, profile } = useAuth()
  const [reponses, setReponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [status, setStatus] = useState(demande.status)
  const [assigned, setAssigned] = useState(demande.assigned_to || 'doneo')
  const [photoUrls, setPhotoUrls] = useState([])
  const [replyPhotos, setReplyPhotos] = useState([]) // photos en cours de saisie : [{ file, preview }]
  const [replyPhotoUrls, setReplyPhotoUrls] = useState({}) // chemin -> lien temporaire, pour les réponses déjà envoyées

  const t = TYPES[demande.type] || TYPES.autre

  useEffect(() => { fetchReponses(); markDemandeRead(demande.id) }, [demande.id])

  // Une réponse arrive pendant que la demande est ouverte : on l'affiche et on la marque comme lue
  const notifs = useDemandeNotifications()
  const unreadHere = notifs.byDemande[demande.id] || 0
  useEffect(() => {
    if (unreadHere > 0) { fetchReponses(true); markDemandeRead(demande.id) }
  }, [unreadHere])

  // Le bucket est privé : on génère des liens temporaires (1 h) pour afficher les photos.
  useEffect(() => {
    const paths = demande.photos || []
    if (paths.length === 0) { setPhotoUrls([]); return }
    supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600).then(({ data, error }) => {
      if (error) return toast.error('Fichiers indisponibles : ' + error.message)
      setPhotoUrls((data || []).filter(d => d.signedUrl).map(d => ({ path: d.path, url: d.signedUrl })))
    })
  }, [demande.id])

  async function fetchReponses(silent = false) {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('demande_reponses')
      .select('*, author:author_id(full_name, email, role)')
      .eq('demande_id', demande.id)
      .order('created_at', { ascending: true })
    setReponses(data || [])
    setLoading(false)

    // Liens temporaires (1 h) pour les photos jointes aux réponses
    const paths = (data || []).flatMap(r => r.photos || [])
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
      const map = {}
      ;(signed || []).forEach(s => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl })
      setReplyPhotoUrls(map)
    }
  }

  function handleReplyPhotoChange(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    const room = MAX_PHOTOS - replyPhotos.length
    const accepted = acceptFiles(files, room)
    setReplyPhotos(prev => [...prev, ...accepted.map(makePending)])
  }

  function removeReplyPhoto(index) {
    setReplyPhotos(prev => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!message.trim() && replyPhotos.length === 0) return
    setSending(true)

    const photoPaths = []
    try {
      for (let i = 0; i < replyPhotos.length; i++) {
        photoPaths.push(await uploadAttachment(PHOTO_BUCKET, `${demande.id}/reponses`, replyPhotos[i].file, i))
      }
    } catch (err) {
      setSending(false)
      return toast.error('Erreur lors de l\'envoi des fichiers : ' + (err.message || err))
    }

    const { error } = await supabase.from('demande_reponses').insert({
      demande_id: demande.id,
      author_id: user.id,
      message: message.trim(), // peut être vide si la réponse ne contient que des photos
      photos: photoPaths,
    })
    setSending(false)
    if (error) return toast.error('Erreur : ' + error.message)
    replyPhotos.forEach(p => URL.revokeObjectURL(p.preview))
    setReplyPhotos([])
    setMessage('')
    fetchReponses()
  }

  async function setDemandeStatus(newStatus, successMessage, { clearResolved = false } = {}) {
    setResolving(true)
    const payload = clearResolved
      ? { status: newStatus, resolved_by: null, resolved_at: null }
      : { status: newStatus, resolved_by: user.id, resolved_at: new Date().toISOString() }
    const { error } = await supabase.from('demandes').update(payload).eq('id', demande.id)
    setResolving(false)
    if (error) return toast.error('Erreur : ' + error.message)
    toast.success(successMessage)
    setStatus(newStatus)
    onChanged()
  }

  async function changeAssign(v) {
    const { error } = await supabase.from('demandes').update({ assigned_to: v }).eq('id', demande.id)
    if (error) return toast.error('Erreur : ' + error.message)
    setAssigned(v)
    toast.success(`Demande affectée à ${ASSIGN_META[v].label}`)
    onChanged()
  }

  const handleValidate = () => setDemandeStatus('resolue', 'Demande marquée comme réalisée')
  const handleCancel = () => setDemandeStatus('annulee', 'Demande annulée')
  const handleClose = () => setDemandeStatus('cloturee', 'Demande clôturée')
  const handleReopen = () => setDemandeStatus('ouverte', 'Demande rouverte', { clearResolved: true })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`badge ${t.badge}`}>{t.label}</span>
              <span className={`badge ${(STATUS_META[status] || STATUS_META.ouverte).badge}`}>
                {(STATUS_META[status] || STATUS_META.ouverte).label}
              </span>
              <AssignBadge value={assigned} />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="modal-body">
          {canValidate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="form-label" style={{ margin: 0 }}>Affectée à</label>
              <select className="form-input" style={{ width: 'auto' }} value={assigned} onChange={e => changeAssign(e.target.value)}>
                <option value="doneo">DONEO</option>
                <option value="partenaire">Partenaire</option>
              </select>
            </div>
          )}
          {demande.bp?.length > 0 && (
            <div>
              <label className="form-label">BP concernés</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                {demande.bp.map(bp => canLinkToSearch ? (
                  <Link key={bp} to={`${basePath}/search-parcel?barcode=${encodeURIComponent(bp)}`} style={{ textDecoration: 'none' }}>
                    <code style={{
                      fontFamily: 'monospace', fontSize: '13px', background: 'var(--blue-light)',
                      color: '#1e40af', padding: '3px 10px', borderRadius: '4px', display: 'inline-flex',
                      alignItems: 'center', gap: '4px',
                    }}>
                      <Package size={12} /> {bp}
                    </code>
                  </Link>
                ) : (
                  <code key={bp} style={{ fontFamily: 'monospace', fontSize: '13px', background: 'var(--gray-100)', padding: '3px 10px', borderRadius: '4px' }}>
                    {bp}
                  </code>
                ))}
              </div>
            </div>
          )}

          {demande.commentaire && (
            <div>
              <label className="form-label">Commentaire</label>
              <p style={{ fontSize: '14px', color: 'var(--gray-700)', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
                {demande.commentaire}
              </p>
            </div>
          )}

          {photoUrls.length > 0 && (
            <div>
              <label className="form-label">Fichiers ({photoUrls.length})</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                {photoUrls.map(f => <StoredFile key={f.path} path={f.path} url={f.url} size={96} />)}
              </div>
            </div>
          )}

          <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
            Créée par {demande.created_by_user?.full_name || demande.created_by_user?.email || '—'} le{' '}
            {new Date(demande.created_at).toLocaleString('fr-FR')} ({ageLabel({ ...demande, status })})
            {status !== 'ouverte' && demande.resolved_at && (
              <> · {STATUS_META[status]?.label || 'Mise à jour'} par {demande.resolved_by_user?.full_name || demande.resolved_by_user?.email || '—'} le {new Date(demande.resolved_at).toLocaleString('fr-FR')}</>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: '14px' }}>
            <label className="form-label">Réponses</label>
            {loading ? (
              <div className="loading-center" style={{ padding: '12px 0' }}><div className="spinner dark" /></div>
            ) : reponses.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--gray-400)', marginTop: '6px' }}>Aucune réponse pour le moment.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px', maxHeight: '220px', overflowY: 'auto' }}>
                {reponses.map(r => (
                  <div key={r.id} style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>
                        {r.author?.full_name || r.author?.email || 'Utilisateur'}
                        {r.author?.role === 'partner' && <span className="badge badge-purple" style={{ marginLeft: '6px', fontSize: '10px' }}>Partenaire</span>}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>
                        {new Date(r.created_at).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    {r.message && (
                      <p style={{ fontSize: '13px', color: 'var(--gray-700)', whiteSpace: 'pre-wrap' }}>{r.message}</p>
                    )}
                    {(r.photos || []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: r.message ? 8 : 0 }}>
                        {r.photos.map(path => <StoredFile key={path} path={path} url={replyPhotoUrls[path]} size={72} />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleSendMessage} style={{ marginTop: '12px' }}>
              {replyPhotos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  {replyPhotos.map((p, i) => <PendingFile key={p.id} item={p} size={56} onRemove={() => removeReplyPhoto(i)} />)}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <textarea
                  className="form-input"
                  placeholder="Écrire une réponse... (Entrée = retour à la ligne)"
                  rows={2}
                  style={{ resize: 'vertical', minHeight: 40 }}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
                {replyPhotos.length < MAX_PHOTOS && (
                  <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }} title="Joindre un fichier">
                    <Paperclip size={14} />
                    <input type="file" multiple onChange={handleReplyPhotoChange} style={{ display: 'none' }} />
                  </label>
                )}
                <button type="submit" className="btn btn-secondary" disabled={sending || (!message.trim() && replyPhotos.length === 0)}>
                  {sending ? <div className="spinner dark" /> : <Send size={14} />}
                </button>
              </div>
            </form>
          </div>
        </div>

        {canValidate && (
          <div className="modal-footer" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
            {status === 'ouverte' ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { if (confirm('Annuler cette demande ?')) handleCancel() }}
                  disabled={resolving}
                  style={{ color: 'var(--red)' }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { if (confirm('Clôturer cette demande ?')) handleClose() }}
                  disabled={resolving}
                >
                  Clôturer
                </button>
                <button type="button" className="btn btn-primary" onClick={handleValidate} disabled={resolving}>
                  {resolving ? <><div className="spinner" /> ...</> : <><CheckCircle2 size={15} /> Marquer comme réalisée</>}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={handleReopen} disabled={resolving}>
                {resolving ? '...' : 'Rouvrir la demande'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
