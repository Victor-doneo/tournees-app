import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const today = new Date().toISOString().split('T')[0]

    // Récupérer le mode test et la date validée
    let isTest = false
    let isDryRun = false
    let validatedDate = null
    try {
      const text = await req.text()
      console.log('RAW TEXT:', text)
      if (text) {
        const body = JSON.parse(text)
        isTest = body?.test === true
        isDryRun = body?.dry_run === true
        validatedDate = body?.date || null
      }
    } catch (e) {
      console.log('Body parse error:', e.message)
    }
    console.log('isTest:', isTest, 'isDryRun:', isDryRun, 'validatedDate:', validatedDate)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    // 1. Anomalies de réception du jour
    const { data: anomalies } = await supabase
      .from('anomalies_reception')
      .select('id, date_saisie, numero_groupage, type_anomalie, commentaire, created_at, users(full_name)')
      .eq('date_saisie', today)
      .order('numero_groupage')

    // 2. Tournées en retard (delivery_date = today)
    const { data: toursRetardRaw } = await supabase
      .from('tours')
      .select('id, name, retard, tours_references(name), delivery_dates(delivery_date)')
      .eq('retard', true)
    const toursRetard = (toursRetardRaw || []).filter(t => t.delivery_dates?.delivery_date === today)

    // 3. Tournées non rentrées du jour (heure_retour IS NULL + heure_premiere_livraison 06:00 ou 08:00) ET avec des colis attendus
    const { data: todayDateData } = await supabase
      .from('delivery_dates')
      .select('id')
      .eq('delivery_date', today)
      .maybeSingle()

    let toursRetour = []
    if (todayDateData) {
      const { data: toursNonRentreesRaw } = await supabase
        .from('tours')
        .select('id, name, heure_retour, heure_premiere_livraison, tours_references(name), delivery_dates(delivery_date)')
        .is('heure_retour', null)
        .in('heure_premiere_livraison', ['06:00', '08:00'])
        .eq('delivery_date_id', todayDateData.id)
      toursRetour = toursNonRentreesRaw || []
      // Ne garder que les tournées avec des colis attendus (colis à retourner du jour : collectes, livraisons impossibles, LCR)
      const { data: expectedLabels, error: labelsErr } = await supabase
        .from('return_labels')
        .select('tour_code')
        .eq('task_date', today)
      if (!labelsErr) {
        const withParcels = new Set((expectedLabels || []).map(l => l.tour_code))
        toursRetour = toursRetour.filter(t => withParcels.has(t.tours_references?.name || t.name))
      }
      console.log('toursNonRentrees:', toursRetour.length)
    }

    // 4. Manquants
    let tourIds = []
    console.log('today:', today, 'isTest:', isTest, 'validatedDate:', validatedDate)

    if (isTest) {
      // En mode test : tournées completed dont la date > today
      const { data: nextDateData } = await supabase
        .from('delivery_dates')
        .select('id')
        .gt('delivery_date', today)
      const nextDateIds = (nextDateData || []).map(d => d.id)
      if (nextDateIds.length > 0) {
        const { data: testTourIds } = await supabase
          .from('tours')
          .select('id, name, tours_references(name), delivery_dates(delivery_date)')
          .eq('status', 'completed')
          .in('delivery_date_id', nextDateIds)
        tourIds = testTourIds || []
      }
    } else if (validatedDate) {
      // En mode normal : tournées de la date validée uniquement
      const { data: dateData } = await supabase
        .from('delivery_dates')
        .select('id')
        .eq('delivery_date', validatedDate)
        .maybeSingle()
      
      if (dateData) {
        const { data: validatedTourIds } = await supabase
          .from('tours')
          .select('id, name, tours_references(name), delivery_dates(delivery_date)')
          .eq('status', 'completed')
          .eq('delivery_date_id', dateData.id)
        tourIds = validatedTourIds || []
      }
    }
    console.log('tourIds count:', tourIds.length)

    let manquants = []
    if (tourIds.length > 0) {
      const { data: parcelsManquants } = await supabase
        .from('parcels')
        .select('barcode, tour_id')
        .in('tour_id', tourIds.map(t => t.id))
        .eq('reception_status', 'Non réceptionné')
        .eq('excluded', false)
      manquants = parcelsManquants || []
      console.log('manquants count:', manquants.length, 'tourIds used:', tourIds.map(t => t.id))
    }

    // 5. Destinataires
    const { data: recipients } = await supabase
      .from('email_recipients')
      .select('email, full_name')
      .eq('active', true)

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ message: 'Aucun destinataire actif' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    // Grouper anomalies par date + groupage
    const anomaliesByDate = (anomalies || []).reduce((acc, a) => {
      const dateStr = new Date(a.date_saisie + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      if (!acc[dateStr]) acc[dateStr] = {}
      if (!acc[dateStr][a.numero_groupage]) acc[dateStr][a.numero_groupage] = []
      acc[dateStr][a.numero_groupage].push(a)
      return acc
    }, {})

    // Grouper manquants par tournée
    const tourById = Object.fromEntries((tourIds || []).map(t => [t.id, t]))
    const manquantsByTour = manquants.reduce((acc, p) => {
      const t = tourById[p.tour_id]
      const tourName = t?.tours_references?.name || t?.name || 'Inconnue'
      const dateStr = t?.delivery_dates?.delivery_date
        ? new Date(t.delivery_dates.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
        : ''
      const key = `${tourName} (${dateStr})`
      if (!acc[key]) acc[key] = []
      acc[key].push(p.barcode)
      return acc
    }, {})

    function typeBadgeColor(type) {
      const map = {
        'Comportement chauffeur': '#7c3aed',
        'Difficultés de déchargement': '#d97706',
        'Retard': '#dc2626',
        'Remorque décrochée': '#0284c7',
        'Réception informatique manquante': '#059669',
      }
      return map[type] || '#6b7280'
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; margin: 0; padding: 20px; background: #ffffff; font-size: 14px; line-height: 1.6; }
    .container { max-width: 650px; margin: 0 auto; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 14px; font-weight: bold; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
    th { text-align: left; padding: 6px 10px; background: #f3f4f6; color: #374151; font-weight: 600; border: 1px solid #e5e7eb; }
    td { padding: 6px 10px; border: 1px solid #e5e7eb; color: #374151; vertical-align: top; }
    .empty { color: #9ca3af; font-size: 13px; }
    .date-label { font-weight: bold; color: #1d4ed8; margin: 10px 0 4px; }
    .groupage-label { font-weight: bold; color: #374151; margin: 8px 0 4px; font-size: 13px; }
    .footer { margin-top: 32px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
    code { font-family: monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="container">
    <p>Bonjour,</p>
    <p>Veuillez trouver ci-dessous le rapport de fin de journée du <strong style="text-transform:capitalize;">${dateLabel}</strong>.</p>

    <div class="section">
      <div class="section-title">⚠️ Anomalies de réception — ${(anomalies || []).length}</div>
      ${Object.keys(anomaliesByDate).length === 0
        ? '<p class="empty">Aucune anomalie aujourd&#39;hui.</p>'
        : Object.entries(anomaliesByDate).map(([dateStr, groupages]) => `
          <div style="margin-bottom: 12px;">
            <div class="date-label">📅 ${dateStr}</div>
            ${Object.entries(groupages).map(([groupage, items]) => `
              <div class="groupage-label">Groupage #${groupage}</div>
              <table>
                <tr><th>Type</th><th>Commentaire</th><th>Heure</th><th>Par</th></tr>
                ${items.map(a => `
                  <tr>
                    <td><span style="background:${typeBadgeColor(a.type_anomalie)}20;color:${typeBadgeColor(a.type_anomalie)};padding:2px 8px;border-radius:100px;font-size:11px;font-weight:600;">${a.type_anomalie}</span></td>
                    <td>${a.commentaire || '—'}</td>
                    <td>${new Date(a.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>${a.users?.full_name || '—'}</td>
                  </tr>
                `).join('')}
              </table>
            `).join('')}
          </div>
        `).join('')
      }
    </div>

    <div class="section">
      <div class="section-title">🕐 Tournées en retard — ${toursRetard.length}</div>
      ${toursRetard.length === 0
        ? '<p class="empty">Aucun retard aujourd&#39;hui.</p>'
        : `<table>
            <tr><th>Tournée</th><th>Date</th></tr>
            ${toursRetard.map(t => `
              <tr>
                <td>${t.tours_references?.name || t.name}</td>
                <td>${t.delivery_dates?.delivery_date ? new Date(t.delivery_dates.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR') : '—'}</td>
              </tr>
            `).join('')}
          </table>`
      }
    </div>

    <div class="section">
      <div class="section-title">⚠️ Tournées non rentrées — ${toursRetour.length}</div>
      ${toursRetour.length === 0
        ? '<p class="empty">Aucune tournée avec des colis attendus non rentrée.</p>'
        : `<table>
            <tr><th>Tournée</th><th>Date</th><th>1ère livraison</th></tr>
            ${toursRetour.map(t => `
              <tr>
                <td>${t.tours_references?.name || t.name}</td>
                <td>${t.delivery_dates?.delivery_date ? new Date(t.delivery_dates.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR') : '—'}</td>
                <td>${t.heure_premiere_livraison || '—'}</td>
              </tr>
            `).join('')}
          </table>`
      }
    </div>

    <div class="section">
      <div class="section-title">📦 Colis non réceptionnés — ${manquants.length}</div>
      ${Object.keys(manquantsByTour).length === 0
        ? '<p class="empty">Aucun colis non réceptionné.</p>'
        : Object.entries(manquantsByTour).map(([tourName, barcodes]) => `
          <div style="margin-bottom: 12px;">
            <div class="groupage-label">${tourName} — ${barcodes.length} colis</div>
            <table>
              <tr><th>Barcode</th></tr>
              ${barcodes.map(bc => `<tr><td><code>${bc}</code></td></tr>`).join('')}
            </table>
          </div>
        `).join('')
      }
    </div>

    <div class="footer">
      <p>Bien cordialement,<br><br><strong>Équipe DONEO</strong></p>
      <p style="font-size:11px;color:#9ca3af;">Ce message est généré automatiquement par Superflash. Merci de ne pas y répondre directement.</p>
    </div>
  </div>
</body>
</html>`

    // En mode dry_run, on retourne les données sans envoyer le mail
    if (isDryRun) {
      return new Response(JSON.stringify({
        dry_run: true,
        anomalies: anomalies?.length || 0,
        retards: toursRetard?.length || 0,
        toursNonRentrees: toursRetour?.length || 0,
        toursNonRentreesDetails: toursRetour?.map(t => t.tours_references?.name || t.name),

        manquants: manquants.length,
        today,
        validatedDate,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'
    const now = new Date()
    const dateShort = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Superflash <${fromEmail}>`,
        to: recipients.map(r => r.email),
        subject: `CCV - Rapport de fin de journée - ${dateShort}`,
        html,
      }),
    })

    const emailResult = await emailResponse.json()

    if (!emailResponse.ok) {
      throw new Error(`Resend error: ${JSON.stringify(emailResult)}`)
    }

    return new Response(JSON.stringify({ 
      success: true, 
      sent_to: recipients.length,
      anomalies: anomalies?.length || 0,
      retards: toursRetard.length,
      retours: toursRetour.length,
      manquants: manquants.length,
      test: isTest,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})