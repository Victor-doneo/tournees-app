import toast from 'react-hot-toast'
import { code128Svg } from './code128'

export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function labelHtml(r) {
  return `<div class="label">
    <div class="top"><b>${esc(r.tour_code || r.round_name || '')}</b><span>${esc(new Date(r.task_date + 'T12:00:00').toLocaleDateString('fr-FR'))}</span></div>
    <div class="bc">${code128Svg(r.barcode)}</div>
    <div class="code">${esc(r.barcode)}</div>
    <div class="item">${esc(r.item_name || '')}<br><small>${esc((r.item_description || '').slice(0, 90))}</small></div>
    <div class="cust"><b>${esc(r.customer_name || '')}</b><br>${esc(r.address || '')}<br>${esc([r.zip, r.city].filter(Boolean).join(' '))}${r.customer_phone ? '<br>Tél. ' + esc(r.customer_phone) : ''}</div>
    <div class="reason">${esc(r.reason || '')}</div>
  </div>`
}

export function printLabels(rows) {
  const w = window.open('', '_blank')
  if (!w) return toast.error('Autorisez les fenêtres pop-up pour imprimer')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Étiquettes retour</title><style>
    @page{size:100mm 150mm;margin:0}
    body{margin:0;font-family:Arial,sans-serif}
    .label{box-sizing:border-box;width:100mm;height:150mm;padding:6mm;page-break-after:always;display:flex;flex-direction:column;gap:3mm}
    .top{display:flex;justify-content:space-between;font-size:16pt}
    .bc{height:28mm}.bc svg{width:100%;height:28mm}
    .code{text-align:center;font:bold 16pt monospace;letter-spacing:1px}
    .item{font-size:12pt}.item small{font-size:9pt;color:#333}
    .cust{font-size:13pt;border:1.5px solid #000;padding:3mm;flex:1}
    .reason{text-align:center;font:bold 14pt Arial;border:2px solid #000;padding:2mm}
  </style></head><body>${rows.map(labelHtml).join('')}<script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`)
  w.document.close()
}

