import { useEffect, useState, useRef } from 'react'
import { supabase } from './supabase'
import { Edit3, Eye, Trash2, RotateCcw, Upload, Copy, ZoomIn, ZoomOut, X as XIcon } from 'lucide-react'
import toast from 'react-hot-toast'

const CANVAS_W = 1200
const CANVAS_H = 800
const MIN_ZONE_SIZE = 30

export default function WarehousePlan() {
  const canvasRef = useRef(null)
  const fileRef = useRef(null)

  const [mode, setMode] = useState('view')
  const [zones, setZones] = useState([])
  const [assignments, setAssignments] = useState({})
  const [groupDates, setGroupDates] = useState([])
  const [availableDates, setAvailableDates] = useState([])
  const [tourSlots, setTourSlots] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [bgDataUrl, setBgDataUrl] = useState(null)
  const [bgUploading, setBgUploading] = useState(false)

  const [drawing, setDrawing] = useState(false)
  const [dragZone, setDragZone] = useState(null)
  const [startPos, setStartPos] = useState(null)
  const [currentRect, setCurrentRect] = useState(null)
  const [selectedZone, setSelectedZone] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [scale, setScale] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadZones(), loadDates(), loadBg()])
    setLoading(false)
  }

  async function loadBg() {
    const { data } = await supabase
      .from('warehouse_settings')
      .select('bg_url')
      .single()
    if (data?.bg_url) setBgDataUrl(data.bg_url)
  }

  async function loadDates() {
    const { data } = await supabase
      .from('delivery_dates')
      .select('id, delivery_date')
      .order('delivery_date', { ascending: false })
    setAvailableDates(data || [])
  }

  async function loadZones() {
    const { data: zonesData } = await supabase.from('warehouse_zones').select('*').order('id')
    const { data: assignData } = await supabase
      .from('zone_assignments')
      .select('zone_id, reference_id, date_label, tours_references(id, name)')

    const assignMap = {}
    for (const a of (assignData || [])) {
      if (a.tours_references) {
        assignMap[a.zone_id] = {
          refId: a.tours_references.id,
          refName: a.tours_references.name,
          dateLabel: a.date_label || null,
        }
      }
    }
    setZones(zonesData || [])
    setAssignments(assignMap)
  }

  useEffect(() => {
    if (groupDates.length === 0) { setTourSlots([]); return }
    loadTourSlots()
  }, [groupDates])

  async function loadTourSlots() {
    const { data: tours } = await supabase
      .from('tours')
      .select('name, reference_id, delivery_date_id, tours_references(id, name), delivery_dates(delivery_date)')
      .in('delivery_date_id', groupDates)

    if (!tours) return

    const slots = []
    const refDateSeen = {}

    for (const t of tours) {
      if (!t.tours_references) continue
      const key = `${t.tours_references.id}_${t.delivery_date_id}`
      if (refDateSeen[key]) continue
      refDateSeen[key] = true

      const dateStr = t.delivery_dates?.delivery_date || ''
      const dateLabel = dateStr
        ? new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
        : ''

      slots.push({
        refId: t.tours_references.id,
        refName: t.tours_references.name,
        date: t.delivery_date_id,
        dateLabel,
        slotKey: key,
      })
    }

    const refCount = {}
    for (const s of slots) refCount[s.refId] = (refCount[s.refId] || 0) + 1
    for (const s of slots) s.showDate = refCount[s.refId] > 1

    setTourSlots(slots)
  }

  useEffect(() => {
    const assignedKeys = new Set(
      Object.values(assignments).map(a => `${a.refId}_${a.dateLabel || ''}`)
    )
    const unassignedSlots = tourSlots.filter(s => {
      const key = `${s.refId}_${s.showDate ? s.dateLabel : ''}`
      return !assignedKeys.has(key)
    })
    setUnassigned(unassignedSlots)
  }, [assignments, tourSlots])

  async function autoAssign() {
    const freeZones = zones.filter(z => !assignments[z.id])
    const toAssign = [...unassigned]
    const newAssignments = {}

    for (let i = 0; i < Math.min(freeZones.length, toAssign.length); i++) {
      const zone = freeZones[i]
      const slot = toAssign[i]
      await supabase.from('zone_assignments').upsert({
        zone_id: zone.id,
        reference_id: slot.refId,
        date_label: slot.showDate ? slot.dateLabel : null,
      }, { onConflict: 'zone_id' })
      newAssignments[zone.id] = {
        refId: slot.refId,
        refName: slot.refName,
        dateLabel: slot.showDate ? slot.dateLabel : null,
      }
    }

    setAssignments(prev => ({ ...prev, ...newAssignments }))
    toast.success(`${Object.keys(newAssignments).length} tournées assignées`)
  }

  // ── IMAGE DE FOND ─────────────────────────────────────────────────────────────
  async function handleBgUpload(e) {
    const f = e.target.files[0]
    if (!f) return
    setBgUploading(true)
    try {
      const ext = f.name.split('.').pop()
      const path = `bg/warehouse-bg.${ext}`
      const { error: upError } = await supabase.storage
        .from('warehouse-bg')
        .upload(path, f, { upsert: true })

      if (upError) {
        toast.error('Erreur upload : ' + upError.message)
        return
      }

      const { data: urlData } = supabase.storage
        .from('warehouse-bg')
        .getPublicUrl(path)

      const url = urlData.publicUrl + '?t=' + Date.now()
      setBgDataUrl(url)

      await supabase
        .from('warehouse_settings')
        .update({ bg_url: urlData.publicUrl, updated_at: new Date().toISOString() })
        .not('id', 'is', null)

      toast.success('Image de fond sauvegardée !')
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    } finally {
      setBgUploading(false)
      e.target.value = ''
    }
  }

  // ── DESSIN ────────────────────────────────────────────────────────────────────
  function getCanvasPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    }
  }

  function handleMouseDown(e, zoneId) {
    if (mode !== 'edit') return
    const pos = getCanvasPos(e)
    if (zoneId) {
      const zone = zones.find(z => z.id === zoneId)
      if (zone) {
        e.stopPropagation()
        setDragZone({ zoneId, offsetX: pos.x - zone.x, offsetY: pos.y - zone.y })
      }
      return
    }
    setDrawing(true)
    setStartPos(pos)
    setCurrentRect({ x: pos.x, y: pos.y, width: 0, height: 0 })
  }

  function handleMouseMove(e) {
    if (mode !== 'edit') return
    const pos = getCanvasPos(e)
    if (dragZone) {
      setZones(prev => prev.map(z =>
        z.id === dragZone.zoneId
          ? { ...z, x: Math.round(pos.x - dragZone.offsetX), y: Math.round(pos.y - dragZone.offsetY) }
          : z
      ))
      return
    }
    if (!drawing) return
    setCurrentRect({
      x: Math.min(startPos.x, pos.x),
      y: Math.min(startPos.y, pos.y),
      width: Math.abs(pos.x - startPos.x),
      height: Math.abs(pos.y - startPos.y),
    })
  }

  async function handleMouseUp() {
    if (mode !== 'edit') return
    if (dragZone) {
      const zone = zones.find(z => z.id === dragZone.zoneId)
      if (zone) {
        await supabase.from('warehouse_zones').update({ x: zone.x, y: zone.y }).eq('id', zone.id)
      }
      setDragZone(null)
      return
    }
    if (!drawing) return
    setDrawing(false)
    if (currentRect?.width > MIN_ZONE_SIZE && currentRect?.height > MIN_ZONE_SIZE) {
      const { data, error } = await supabase.from('warehouse_zones').insert({
        x: Math.round(currentRect.x),
        y: Math.round(currentRect.y),
        width: Math.round(currentRect.width),
        height: Math.round(currentRect.height),
      }).select().single()
      if (!error && data) {
        setZones(prev => [...prev, data])
        toast.success('Zone créée')
      }
    }
    setCurrentRect(null)
    setStartPos(null)
  }

  async function duplicateZone(zone) {
    const { data, error } = await supabase.from('warehouse_zones').insert({
      x: zone.x + zone.width + 10,
      y: zone.y,
      width: zone.width,
      height: zone.height,
    }).select().single()
    if (!error && data) {
      setZones(prev => [...prev, data])
      toast.success('Zone dupliquée')
    }
  }

  async function deleteZone(zoneId) {
    await supabase.from('zone_assignments').delete().eq('zone_id', zoneId)
    await supabase.from('warehouse_zones').delete().eq('id', zoneId)
    setZones(prev => prev.filter(z => z.id !== zoneId))
    setAssignments(prev => { const n = { ...prev }; delete n[zoneId]; return n })
    setSelectedZone(null)
    toast.success('Zone supprimée')
  }

  // ── DRAG & DROP ASSIGNATION ───────────────────────────────────────────────────
  async function handleDropOnZone(zoneId, slot) {
    const oldZoneId = Object.keys(assignments).find(k => {
      const a = assignments[k]
      return a.refId === slot.refId && a.dateLabel === (slot.showDate ? slot.dateLabel : null)
    })
    if (oldZoneId && parseInt(oldZoneId) !== zoneId) {
      await supabase.from('zone_assignments').delete().eq('zone_id', oldZoneId)
    }
    await supabase.from('zone_assignments').upsert({
      zone_id: zoneId,
      reference_id: slot.refId,
      date_label: slot.showDate ? slot.dateLabel : null,
    }, { onConflict: 'zone_id' })

    setAssignments(prev => {
      const n = { ...prev }
      if (oldZoneId) delete n[parseInt(oldZoneId)]
      n[zoneId] = {
        refId: slot.refId,
        refName: slot.refName,
        dateLabel: slot.showDate ? slot.dateLabel : null,
      }
      return n
    })
  }

  async function removeAssignment(zoneId) {
    await supabase.from('zone_assignments').delete().eq('zone_id', zoneId)
    setAssignments(prev => { const n = { ...prev }; delete n[zoneId]; return n })
  }

  function addDateToGroup(dateId) {
    if (!dateId || groupDates.includes(dateId)) return
    setGroupDates(prev => [...prev, dateId])
  }

  function removeDateFromGroup(dateId) {
    setGroupDates(prev => prev.filter(id => id !== dateId))
  }

  function formatDate(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Plan de l'entrepôt</h2>
            <p className="page-subtitle">Assignez les tournées aux zones de stockage</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
            {mode === 'view' && unassigned.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={autoAssign}>
                <RotateCcw size={13} /> Auto-assigner ({unassigned.length})
              </button>
            )}
            <button
              className={'btn btn-sm ' + (mode === 'edit' ? 'btn-primary' : 'btn-secondary')}
              onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
            >
              {mode === 'edit' ? <><Eye size={13} /> Mode vue</> : <><Edit3 size={13} /> Mode édition</>}
            </button>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Sélecteur de dates */}
          <div className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--gray-700)' }}>Dates du groupe</span>
              <span className="badge badge-gray">{groupDates.length} date{groupDates.length > 1 ? 's' : ''}</span>
            </div>
            <div style={{ padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {groupDates.map(id => {
                const d = availableDates.find(x => x.id === id)
                return d ? (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                    {formatDate(d.delivery_date)}
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }} onClick={() => removeDateFromGroup(id)}>
                      <XIcon size={12} color="var(--accent)" />
                    </button>
                  </span>
                ) : null
              })}
              <select
                className="form-input"
                style={{ fontSize: 12, cursor: 'pointer', width: 'auto', minWidth: 160 }}
                value=""
                onChange={e => { if (e.target.value) { addDateToGroup(e.target.value); e.target.value = '' } }}
              >
                <option value="">+ Ajouter une date...</option>
                {availableDates.filter(d => !groupDates.includes(d.id)).map(d => (
                  <option key={d.id} value={d.id}>{formatDate(d.delivery_date)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {mode === 'edit' && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={bgUploading}
                >
                  <Upload size={13} />
                  {bgUploading ? 'Upload...' : 'Image de fond'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleBgUpload}
                />
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                  Cliquez-glissez pour créer une zone · Glissez une zone pour la déplacer
                </span>
              </>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setScale(s => Math.min(s + 0.1, 2))}><ZoomIn size={13} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => setScale(s => Math.max(s - 0.1, 0.4))}><ZoomOut size={13} /></button>
              <span style={{ fontSize: 12, color: 'var(--gray-400)', alignSelf: 'center' }}>{Math.round(scale * 100)}%</span>
            </div>
          </div>

          {/* Canvas */}
          <div style={{ overflow: 'auto', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', background: 'var(--gray-50)' }}>
            <div
              ref={canvasRef}
              style={{
                position: 'relative',
                width: CANVAS_W,
                height: CANVAS_H,
                cursor: mode === 'edit' ? 'crosshair' : 'default',
                userSelect: 'none',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                backgroundImage: bgDataUrl
                  ? `url(${bgDataUrl})`
                  : 'repeating-linear-gradient(0deg, transparent, transparent 39px, #e5e7eb 39px, #e5e7eb 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, #e5e7eb 39px, #e5e7eb 40px)',
                backgroundSize: bgDataUrl ? '100% 100%' : 'auto',
              }}
              onMouseDown={e => handleMouseDown(e, null)}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                if (drawing) { setDrawing(false); setCurrentRect(null) }
                if (dragZone) setDragZone(null)
              }}
            >
              {zones.map(zone => {
                const assign = assignments[zone.id]
                const isSelected = selectedZone === zone.id
                const isDragTarget = dragOver === zone.id

                return (
                  <div
                    key={zone.id}
                    style={{
                      position: 'absolute',
                      left: zone.x, top: zone.y,
                      width: zone.width, height: zone.height,
                      border: `2px solid ${isDragTarget ? 'var(--accent)' : isSelected ? '#f59e0b' : assign ? '#059669' : 'var(--gray-300)'}`,
                      borderRadius: 4,
                      background: isDragTarget ? 'rgba(99,102,241,0.15)' : assign ? 'rgba(5,150,105,0.12)' : 'rgba(255,255,255,0.6)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      cursor: mode === 'edit' ? 'move' : 'pointer',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.15s, background 0.15s',
                      overflow: 'hidden',
                    }}
                    onMouseDown={e => handleMouseDown(e, zone.id)}
                    onClick={e => { e.stopPropagation(); if (mode === 'edit') setSelectedZone(isSelected ? null : zone.id) }}
                    onDragOver={e => { e.preventDefault(); setDragOver(zone.id) }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={e => {
                      e.preventDefault(); setDragOver(null)
                      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
                      handleDropOnZone(zone.id, data)
                    }}
                  >
                    {assign ? (
                      <>
                        <span style={{
                          fontSize: Math.max(9, Math.min(14, zone.width / 7)),
                          fontFamily: 'var(--font-display)', fontWeight: 700,
                          color: '#065f46', textAlign: 'center', padding: '0 4px',
                          lineHeight: 1.2, wordBreak: 'break-word',
                        }}>
                          {assign.refName}
                        </span>
                        {assign.dateLabel && (
                          <span style={{ fontSize: 9, color: '#059669', marginTop: 2, textAlign: 'center' }}>
                            ({assign.dateLabel})
                          </span>
                        )}
                        {mode === 'view' && (
                          <button
                            style={{ position: 'absolute', top: 2, right: 2, background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4, padding: 2 }}
                            onClick={e => { e.stopPropagation(); removeAssignment(zone.id) }}
                          >
                            <XIcon size={10} color="#dc2626" />
                          </button>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--gray-300)' }}>vide</span>
                    )}

                    {mode === 'edit' && isSelected && (
                      <>
                        <button
                          style={{ position: 'absolute', top: -10, right: -10, background: '#dc2626', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
                          onClick={e => { e.stopPropagation(); deleteZone(zone.id) }}
                        >
                          <Trash2 size={10} color="white" />
                        </button>
                        <button
                          style={{ position: 'absolute', top: -10, left: -10, background: 'var(--accent)', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
                          onClick={e => { e.stopPropagation(); duplicateZone(zone) }}
                        >
                          <Copy size={10} color="white" />
                        </button>
                      </>
                    )}
                  </div>
                )
              })}

              {currentRect?.width > 5 && (
                <div style={{
                  position: 'absolute',
                  left: currentRect.x, top: currentRect.y,
                  width: currentRect.width, height: currentRect.height,
                  border: '2px dashed var(--accent)', background: 'rgba(99,102,241,0.1)',
                  borderRadius: 4, pointerEvents: 'none',
                }} />
              )}
            </div>
          </div>

          <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--gray-500)' }}>
              <span style={{ width: 12, height: 12, background: 'rgba(5,150,105,0.12)', border: '2px solid #059669', borderRadius: 2, display: 'inline-block' }} /> Assignée
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--gray-500)' }}>
              <span style={{ width: 12, height: 12, background: 'rgba(255,255,255,0.6)', border: '2px solid var(--gray-300)', borderRadius: 2, display: 'inline-block' }} /> Vide
            </div>
            <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 'auto' }}>
              {zones.length} zones · {Object.keys(assignments).length} assignées
            </span>
          </div>
        </div>

        {/* Panneau tournées */}
        <div style={{ width: 220, flexShrink: 0 }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--gray-700)' }}>
                Tournées à placer
              </span>
              <span className="badge badge-gray" style={{ marginLeft: 8 }}>{unassigned.length}</span>
            </div>

            {groupDates.length === 0 ? (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 12 }}>
                Sélectionnez des dates ci-dessus
              </div>
            ) : unassigned.length === 0 ? (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 12 }}>
                ✓ Toutes assignées
              </div>
            ) : (
              <div style={{ padding: '8px', maxHeight: 500, overflowY: 'auto' }}>
                {unassigned.map(slot => (
                  <div
                    key={slot.slotKey}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify(slot))}
                    style={{
                      padding: '7px 10px', marginBottom: 6,
                      background: 'var(--accent-light)', border: '1px solid var(--accent)',
                      borderRadius: 'var(--radius-sm)', cursor: 'grab',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
                      ⠿ {slot.refName}
                    </div>
                    {slot.showDate && (
                      <div style={{ fontSize: 10, color: 'var(--accent)', opacity: 0.7, marginTop: 1 }}>
                        ({slot.dateLabel})
                      </div>
                    )}
                  </div>
                ))}
                <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4, textAlign: 'center' }}>
                  Glissez vers une zone
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
