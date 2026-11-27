// Fonction Edge : réception du mail quotidien « Préparation du jour » (tableau collé en IMAGE).
// Deux façons de l'appeler :
//  1) Resend « réception d'e-mails » (le mail est transféré à l'adresse de réception Resend) : webhook email.received, URL de la forme
//     .../functions/v1/groupages-inbound?s=<INGEST_SECRET> ; la fonction récupère les pièces jointes via l'API Resend (secret RESEND_API_KEY).
//  2) Power Automate (POST JSON) avec l'en-tête  x-ingest-secret: <INGEST_SECRET>.
//     Corps : { subject, receivedDateTime, attachments: [{ name, contentType, contentBytes(base64) }] }
// L'image du tableau est lue par Claude (vision) -> lignes { groupage, transporteur, date_chargement, poids } -> table groupages
// (upsert par groupage + date de chargement ; la saisie admin — heures, CMR — n'est jamais écrasée).
// Secrets à définir (Supabase > Edge Functions > Secrets) : INGEST_SECRET, ANTHROPIC_API_KEY (option : ANTHROPIC_MODEL).
// À déployer avec « Verify JWT » DÉSACTIVÉ (l'authentification se fait par le secret).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)
  const secret = Deno.env.get('INGEST_SECRET')
  const given = req.headers.get('x-ingest-secret') || new URL(req.url).searchParams.get('s')
  if (!secret || given !== secret) return json({ error: 'Non autorisé' }, 401)
  try {
    const b = await req.json()
    let atts: { name?: string; contentType?: string; contentBytes?: string }[] = Array.isArray(b.attachments) ? b.attachments : []
    if (b.type === 'email.received') {
      // webhook Resend : seules les métadonnées sont fournies, on télécharge les images
      const subj = String(b.data?.subject || '')
      if (!/pr[ée]paration du jour/i.test(subj)) return json({ ignored: 'objet sans rapport', subject: subj })
      const key = Deno.env.get('RESEND_API_KEY') || ''
      const lr = await fetch(`https://api.resend.com/emails/receiving/${b.data.email_id}/attachments`, { headers: { Authorization: `Bearer ${key}` } })
      if (!lr.ok) return json({ error: 'Pièces jointes Resend illisibles', detail: (await lr.text()).slice(0, 300) }, 502)
      const lj = await lr.json()
      const list: { filename?: string; content_type?: string; download_url?: string }[] = Array.isArray(lj) ? lj : (lj.data?.data || lj.data || [])
      atts = []
      for (const a of list) {
        if (!/^image\//i.test(a.content_type || '') || !a.download_url) continue
        const fr = await fetch(a.download_url); if (!fr.ok) continue
        const buf = new Uint8Array(await fr.arrayBuffer()); let bin = ''
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        atts.push({ name: a.filename, contentType: a.content_type, contentBytes: btoa(bin) })
      }
      b.subject = subj
    }
    // le tableau est la plus grosse image (les logos et icônes de signature sont petits)
    const imgs = atts.filter(a => /^image\/(png|jpe?g|webp|gif)/i.test(a.contentType || '') && a.contentBytes)
      .sort((x, y) => (y.contentBytes!.length) - (x.contentBytes!.length))
    if (!imgs.length) return json({ error: 'Aucune image dans le mail' }, 400)
    const img = imgs[0]

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5',
        max_tokens: 4000,
        tools: [{
          name: 'enregistrer_lignes',
          description: 'Enregistre les lignes du tableau',
          input_schema: {
            type: 'object',
            properties: { lignes: { type: 'array', items: { type: 'object', properties: {
              date_chargement: { type: 'string', description: 'Première colonne (CharDeDat), au format AAAA-MM-JJ' },
              groupage: { type: 'string', description: 'Colonne « Num. Groupage », chiffres exacts' },
              transporteur: { type: 'string', description: 'Colonne « Nom du transporteur », en majuscules telles qu\'écrites' },
              poids: { type: 'number', description: 'Colonne « Tot.EUT », nombre (virgule décimale -> point)' },
            }, required: ['date_chargement', 'groupage', 'transporteur'] } } },
            required: ['lignes'],
          },
        }],
        tool_choice: { type: 'tool', name: 'enregistrer_lignes' },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: (img.contentType || 'image/png').split(';')[0], data: img.contentBytes } },
          { type: 'text', text: 'Capture d\'un tableau de préparation. Pour CHAQUE ligne de données, relève : la date de la première colonne (CharDeDat, jj/mm/aaaa), le numéro de groupage, le nom du transporteur et le poids (Tot.EUT). Recopie les valeurs exactement, sans rien inventer ; ignore la ligne de filtres sous l\'en-tête.' },
        ] }],
      }),
    })
    if (!r.ok) return json({ error: 'Lecture de l\'image impossible', detail: (await r.text()).slice(0, 500) }, 502)
    const out = await r.json()
    const lignes: { date_chargement: string; groupage: string; transporteur: string; poids?: number }[] =
      out.content?.find((c: { type: string }) => c.type === 'tool_use')?.input?.lignes || []

    // regroupement par groupage + date (un groupage = un transporteur ; plusieurs lignes = poids additionnés)
    const m = new Map<string, { groupage: string; date_chargement: string; transporteur: string; poids: number }>()
    for (const l of lignes) {
      const g = String(l.groupage || '').replace(/\D/g, '')
      const d = String(l.date_chargement || '').slice(0, 10)
      if (!g || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
      const k = `${g}|${d}`
      const cur = m.get(k) || { groupage: g, date_chargement: d, transporteur: String(l.transporteur || '').trim(), poids: 0 }
      cur.poids += Number(l.poids) || 0
      if (!cur.transporteur) cur.transporteur = String(l.transporteur || '').trim()
      m.set(k, cur)
    }
    const rows = [...m.values()].map(x => ({ ...x, poids: Math.round(x.poids * 100) / 100, source: 'mail', updated_at: new Date().toISOString() }))
    if (!rows.length) return json({ error: 'Aucune ligne lue', subject: b.subject }, 422)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // upsert : seules transporteur et poids sont mises à jour, jamais heures ni CMR
    const { error } = await sb.from('groupages').upsert(rows, { onConflict: 'groupage,date_chargement' })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, groupages: rows.length, rows })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
