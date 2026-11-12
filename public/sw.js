// Service worker minimal : rend l'appli installable. Aucune donnée n'est mise en cache (les données Supabase restent toujours en direct).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', e => {
  // Navigation hors ligne : petite page de secours, sinon le réseau normal
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>Hors connexion</h2><p>Superflash a besoin d’une connexion internet. Réessayez.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
  }
})
