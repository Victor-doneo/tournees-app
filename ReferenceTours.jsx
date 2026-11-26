import { useEffect, useState } from 'react'
import { useUnrecognizedRounds } from './unrecognizedRounds'
import { supabase } from './supabase'
import { Plus, Trash2, BookMarked } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ReferenceTours() {
  const unrecognized = useUnrecognizedRounds()
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [nameSupplier, setNameSupplier] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => { fetchRefs() }, [])

  async function fetchRefs() {
    setLoading(true)
    const { data } = await supabase
      .from('tours_references')
      .select('*')
      .order('name')
    setRefs(data || [])
    setLoading(false)
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return toast.error('Saisissez un nom de tournée.')
    setAdding(true)
    const { error } = await supabase.from('tours_references').insert({
      name,
      name_supplier: nameSupplier.trim() || null,
    })
    if (error) {
      toast.error(error.code === '23505' ? 'Ce nom existe déjà.' : 'Erreur lors de l\'ajout.')
    } else {
      toast.success(`"${name}" ajouté.`)
      setNewName('')
      setNameSupplier('')
      fetchRefs()
    }
    setAdding(false)
  }

  async function handleDelete(id, name) {
    if (!confirm(`Supprimer "${name}" ?`)) return
    const { error } = await supabase.from('tours_references').delete().eq('id', id)
    if (error) toast.error('Erreur lors de la suppression.')
    else { toast.success(`"${name}" supprimé.`); fetchRefs() }
  }

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Tournées de référence</h2>
        <p className="page-subtitle">Gérez la liste des noms officiels utilisés lors de l'import PDF</p>
      </div>

      <div className="page-body" style={{ maxWidth: '640px' }}>
        {unrecognized.length > 0 && (
          <div className="card" style={{ padding: 14, marginBottom: 16, borderLeft: '4px solid var(--red)' }}>
            <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>{unrecognized.length} tournée(s) Urbantz non reconnue(s) depuis le 16/11</div>
            <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 8 }}>Ces colis à retourner n'ont pas pu être rattachés à une tournée : ajoutez la référence correspondante ci-dessous (ou vérifiez l'import du PDF du jour). Le rattachement se fait au prochain passage Urbantz.</div>
            {unrecognized.map(u => <div key={u.name} style={{ fontSize: 13 }}><b>{u.name}</b> : {u.count} colis · {u.days.map(d => d.split('-').reverse().slice(0, 2).join('/')).join(', ')}</div>)}
          </div>
        )}

        {/* Formulaire ajout */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <span className="card-title">Ajouter un nom officiel</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                className="form-input"
                placeholder="Nom officiel (ex : MNS75, TKN SOL...)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                style={{ flex: 1, minWidth: 160 }}
              />
              <input
                className="form-input"
                placeholder="Nom fournisseur (optionnel)"
                value={nameSupplier}
                onChange={e => setNameSupplier(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={adding || !newName.trim()}
              >
                <Plus size={15} />
                Ajouter
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: 0 }}>
              Le matching se fait sans espaces (ex : "MNS 75" = "MNS75").
            </p>
          </div>
        </div>

        {/* Liste */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">Noms officiels</span>
            <span className="badge badge-gray">{refs.length}</span>
          </div>

          {loading ? (
            <div className="loading-center" style={{ padding: 32 }}>
              <div className="spinner dark" />
            </div>
          ) : refs.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <BookMarked size={32} className="empty-state-icon" />
              <p className="empty-state-title">Aucune référence</p>
              <p className="empty-state-sub">Ajoutez des noms officiels de tournées ci-dessus.</p>
            </div>
          ) : (
            refs.map(ref => (
              <div key={ref.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 16px', borderBottom: '1px solid var(--gray-100)',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--gray-800)' }}>
                    {ref.name}
                  </span>
                  {ref.name_supplier && (
                    <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                      Fournisseur : {ref.name_supplier}
                    </span>
                  )}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDelete(ref.id, ref.name)}
                  title="Supprimer"
                  style={{ color: 'var(--red)' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>

      </div>
    </>
  )
}
