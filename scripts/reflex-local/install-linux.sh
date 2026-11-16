#!/usr/bin/env bash
# Installation de l'extraction REFLEX sur un serveur Linux (Ubuntu/Debian) à adresse IP fixe.
# À lancer en root, une seule fois :
#   curl -fsSL https://raw.githubusercontent.com/Victor-doneo/tournees-app/main/scripts/reflex-local/install-linux.sh | sudo bash
# Relançable sans risque (met à jour l'installation, conserve la configuration existante).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }

DIR=/opt/superflash-reflex
USER_SVC=superflash

echo "== Paquets et fuseau horaire (Europe/Paris) =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates cron tzdata
timedatectl set-timezone Europe/Paris 2>/dev/null || ln -sf /usr/share/zoneinfo/Europe/Paris /etc/localtime

echo "== Node.js 22 =="
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== Utilisateur et dossier =="
id "$USER_SVC" >/dev/null 2>&1 || useradd -r -m -d "$DIR" -s /usr/sbin/nologin "$USER_SVC"
mkdir -p "$DIR"
chown -R "$USER_SVC":"$USER_SVC" "$DIR"

echo "== Playwright + Chromium =="
cd "$DIR"
sudo -u "$USER_SVC" bash -c "cd $DIR && [ -f package.json ] || npm init -y >/dev/null; npm i playwright@1.49.0 @supabase/supabase-js@2 2>&1 | tail -2"
PLAYWRIGHT_BROWSERS_PATH="$DIR/browsers" "$DIR/node_modules/.bin/playwright" install --with-deps chromium
chown -R "$USER_SVC":"$USER_SVC" "$DIR"

echo "== Configuration (secrets) =="
if [ ! -f "$DIR/.env" ]; then
  ask() { local v; read -r -p "$1" v < /dev/tty; echo "$v"; }
  asks() { local v; read -r -s -p "$1" v < /dev/tty; echo >&2; echo "$v"; }
  RU=$(ask "Identifiant REFLEX : ")
  RP=$(asks "Mot de passe REFLEX (saisie masquée) : ")
  SU=$(ask "Adresse du projet Supabase (https://xxxx.supabase.co) : ")
  SK=$(asks "Clé service_role Supabase (saisie masquée) : ")
  cat > "$DIR/.env" <<ENV
REFLEX_USER=$RU
REFLEX_PASSWORD=$RP
SUPABASE_URL=$SU
SUPABASE_SERVICE_ROLE_KEY=$SK
PLAYWRIGHT_BROWSERS_PATH=$DIR/browsers
ENV
  chown "$USER_SVC":"$USER_SVC" "$DIR/.env"; chmod 600 "$DIR/.env"
else
  echo "Fichier .env déjà présent : conservé."
fi

echo "== Script de lancement et planning =="
cat > "$DIR/run-reflex.sh" <<'RUN'
#!/usr/bin/env bash
# Récupère la dernière version du script puis l'exécute (un seul lancement à la fois)
cd /opt/superflash-reflex
exec 9>.lock; flock -n 9 || { echo "$(date '+%F %T') déjà en cours"; exit 0; }
echo "=== $(date '+%F %T') ==="
curl -fsSL https://raw.githubusercontent.com/Victor-doneo/tournees-app/main/scripts/reflex-receptions.mjs -o reflex-receptions.mjs || echo "téléchargement du script impossible : version précédente utilisée"
node --env-file=.env reflex-receptions.mjs
RUN
chmod +x "$DIR/run-reflex.sh"; chown "$USER_SVC":"$USER_SVC" "$DIR/run-reflex.sh"
touch /var/log/superflash-reflex.log; chown "$USER_SVC":"$USER_SVC" /var/log/superflash-reflex.log

# Toutes les 5 min de 7h à 20h (heure de Paris), du lundi au samedi : le script s'arrête aussitôt s'il n'y a rien à traiter,
# donc les nouveaux colis LCR sont repris quelques minutes après leur apparition dans l'application
cat > /etc/cron.d/superflash-reflex <<CRON
SHELL=/bin/bash
*/5 7-19 * * 1-6 $USER_SVC $DIR/run-reflex.sh >> /var/log/superflash-reflex.log 2>&1
CRON
chmod 644 /etc/cron.d/superflash-reflex
cat > /etc/logrotate.d/superflash-reflex <<LR
/var/log/superflash-reflex.log { weekly rotate 4 compress missingok notifempty copytruncate }
LR
systemctl enable --now cron >/dev/null 2>&1 || service cron start || true

echo
echo "=============================================================="
echo " Installation terminée."
echo " ADRESSE IP DE SORTIE DU SERVEUR (à faire autoriser dans REFLEX) :"
echo "   $(curl -fsS https://api.ipify.org || echo 'inconnue')"
echo " Test manuel (après autorisation de l'IP) :"
echo "   sudo -u $USER_SVC $DIR/run-reflex.sh"
echo " Journal : tail -f /var/log/superflash-reflex.log"
echo "=============================================================="
