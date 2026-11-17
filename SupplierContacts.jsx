import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Plus, Trash2, Mail, ToggleLeft, ToggleRight, Truck } from 'lucide-react'
import toast from 'react-hot-toast'

// Onglet « Mail transporteur » : adresses de contact par société de transport
// (table supplier_contacts, la clé "supplier" = tours_references.name_supplier)
export default function SupplierContacts() {
  const [contacts, setContacts] = useState([])
  const [knownSuppliers, setKnownSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ supplier: '', email: '', full_name: '' })
  const [adding, setAdding] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: c, error }, { data: refs }] = await Promise.all([
      supabase.from('supplier_contacts').select('*').order('supplier').order('created_at'),
      supabase.from('tours_references').select('name_supplier'),
    ])
    if (error) toast.error('Erreur de chargement : ' + error.message)
    setContacts(c || [])
    setKnownSuppliers([...new Set((refs || []).map(r => (r.name_supplier || '').trim()).filter(Boolean))].sort())
    setLoading(false)
  }

  // Sociétés = celles qui ont des contacts + celles connues dans les tournées de référence
  const groups = useMemo(() => {
    const map = {}
    knownSuppliers.forEach(s => { map[s] = [] })
    contacts.forEach(c => { (map[c.supplier] = map[c.supplier] || []).push(c) })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'fr'))
  }, [contacts, knownSuppliers])

  async function handleAdd() {
    const supplier = form.supplier.trim().toUpperCase()
    const email = form.email.trim().toLowerCase()
    if (!supplier) return toast.error('Choisissez une société.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('Email invalide.')
    setAdding(true)
    const { error } = await supabase.from('supplier_contacts').insert({
      supplier, email, full_name: form.full_name.trim() || null,
    })
    setAdding(false)
    if (error) return toast.error(error.code === '23505' ? 'Cet email existe déjà pour cette société.' : 'Erreur : ' + error.message)
    toast.success('Contact ajouté.')
    setForm(f => ({ ...f, email: '', full_name: '' }))
    load()
  }

  async function toggleActive(c) {
    const { error } = await supabase.from('supplier_contacts').update({ active: !c.active }).eq('id', c.id)
    if (error) return toast.error('Erreur')
    setContacts(prev => prev.map(x => x.id === c.id ? { ...x, active: !x.active } : x))
  }

  async function handleDelete(c) {
    if (!confirm(`Supprimer ${c.email} de ${c.supplier} ?`)) return
    const { error } = await supabase.from('supplier_contacts').delete().eq('id', c.id)
    if (error) return toast.error('Erreur lors de la suppression.')
    toast.success('Contact supprimé.')
    load()
  }

  return (
    <div className="page-body" style={{ maxWidth: 760 }}>
      <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
        <div className="card-header"><span className="card-title">Ajouter un contact</span></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              className="form-input" list="supplier-list" placeholder="Société *"
              value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
              style={{ flex: 1, minWidth: 150 }}
            />
            <datalist id="supplier-list">{groups.map(([s]) => <option key={s} value={s} />)}</datalist>
            <input
              className="form-input" placeholder="Email *"
              value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              style={{ flex: 1, minWidth: 170 }}
            />
            <input
              className="form-input" placeholder="Nom (optionnel)"
              value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              style={{ flex: 1, minWidth: 150 }}
            />
            <button className="btn btn-primary" onClick={handleAdd} disabled={adding || !form.supplier.trim() || !form.email.trim()}>
              <Plus size={15} /> Ajouter
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: 0 }}>
            Le nom de société doit correspondre au « name supplier » des tournées de référence.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="loading-center" style={{ padding: 32 }}><div className="spinner dark" /></div>
      ) : groups.length === 0 ? (
        <div className="empty-state" style={{ padding: 32 }}>
          <Truck size={32} className="empty-state-icon" />
          <p className="empty-state-title">Aucune société</p>
        </div>
      ) : groups.map(([supplier, list]) => (
        <div key={supplier} className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Truck size={15} /> {supplier}</span>
            <span className="badge badge-gray">{list.filter(c => c.active).length} actif{list.filter(c => c.active).length > 1 ? 's' : ''} / {list.length}</span>
          </div>
          {list.length === 0 ? (
            <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--gray-400)' }}>Aucun email pour cette société.</div>
          ) : list.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', opacity: c.active ? 1 : 0.5 }}>
              <Mail size={14} style={{ color: 'var(--gray-400)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--gray-800)' }}>{c.email}</div>
                {c.full_name && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{c.full_name}</div>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(c)} title={c.active ? 'Désactiver' : 'Activer'} style={{ color: c.active ? 'var(--green)' : 'var(--gray-400)' }}>
                {c.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(c)} style={{ color: 'var(--red)' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
