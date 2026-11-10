// Modèle du mail « plan de chargement » : mêmes règles que la fonction Edge send-loading-plan
export const DEFAULT_TEMPLATE = {
  subject: 'PLAN DE CHARGEMENT/ CCV / ANTONY / {date}',
  greeting: 'Bonjour,',
  intro: 'Plan de chargement CCV / Antony pour le {date_longue} :',
  signature: 'Cordialement',
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function dateVars(isoDate) {
  const [y, m, d] = isoDate.split('-')
  const long = new Date(isoDate + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
  return { date: `${d}.${m}.${y}`, date_longue: long }
}

const fill = (txt, vars) => String(txt || '').replace(/\{(date_longue|date)\}/g, (_, k) => vars[k])

export function renderSubject(t, isoDate) { return fill(t.subject, dateVars(isoDate)) }

// La date en toutes lettres est mise en gras ; le texte est échappé, les retours à la ligne conservés
export function renderBody(t, isoDate, tableHtml) {
  const v = dateVars(isoDate)
  const para = txt => `<p>${esc(fill(txt, { ...v, date_longue: '\u0000' })).replace(/\u0000/g, `<b>${esc(v.date_longue)}</b>`).replace(/\n/g, '<br>')}</p>`
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${para(t.greeting)}${para(t.intro)}${tableHtml}${para(t.signature)}</div>`
}
