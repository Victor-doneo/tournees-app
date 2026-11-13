# Installation de l'extraction REFLEX sur CE PC (adresse IP de la box déjà autorisée dans REFLEX).
# À lancer UNE fois : clic droit > « Exécuter avec PowerShell ». Prérequis : Node.js 22 ou plus (https://nodejs.org).
$ErrorActionPreference = 'Stop'
$dir = 'C:\superflash-reflex'
New-Item -ItemType Directory -Force $dir | Out-Null
Set-Location $dir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js n'est pas installé : installez la version LTS depuis https://nodejs.org puis relancez." }
if ([int]((node -v) -replace 'v(\d+)\..*','$1') -lt 22) { throw "Node.js 22 ou plus est requis (version actuelle : $(node -v))." }

if (-not (Test-Path 'package.json')) { npm init -y | Out-Null }
npm i playwright@1.49.0 @supabase/supabase-js@2
npx playwright install chromium

# Fichier de configuration (secrets) : à remplir une fois
if (-not (Test-Path '.env')) {
@"
REFLEX_USER=
REFLEX_PASSWORD=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
"@ | Set-Content -Encoding ASCII '.env'
  Write-Host "Ouvrez $dir\.env et renseignez les 4 valeurs, puis relancez ce script."
  notepad "$dir\.env"
}

# Script de lancement : récupère la dernière version du script puis l'exécute
@'
@echo off
cd /d C:\superflash-reflex
powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/Victor-doneo/tournees-app/main/scripts/reflex-receptions.mjs -OutFile reflex-receptions.mjs"
node --env-file=.env reflex-receptions.mjs >> reflex.log 2>&1
'@ | Set-Content -Encoding ASCII 'run-reflex.bat'

# Tâche planifiée : toutes les 30 min de 11h30 à 15h30, du lundi au samedi (heure du PC)
$action = New-ScheduledTaskAction -Execute "$dir\run-reflex.bat"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday -At '11:30'
$rep = (New-ScheduledTaskTrigger -Once -At '11:30' -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 4)).Repetition
$trigger.Repetition = $rep
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Superflash REFLEX' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Tâche « Superflash REFLEX » créée. Test immédiat : double-cliquez sur $dir\run-reflex.bat puis lisez $dir\reflex.log"
