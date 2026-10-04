#!/bin/bash
# Archive MyCycleWorld et upload sur TestFlight
set -eo pipefail

# Log tout dans un fichier lisible
LOG="$HOME/Documents/testflight_log.txt"
exec > >(tee "$LOG") 2>&1
echo "=== Démarré le $(date) ==="

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$PROJECT_DIR/MyCycleWorld.xcodeproj"
SCHEME="MyCycleWorld"
ARCHIVE_PATH="/tmp/MyCycleWorld.xcarchive"
EXPORT_OPTIONS="$PROJECT_DIR/ExportOptions.plist"

echo "=================================================="
echo "  MyCycleWorld → TestFlight"
echo "=================================================="
echo ""
echo "📁 Projet : $PROJECT"
echo ""

# Nettoyer l'ancien archive si besoin
rm -rf "$ARCHIVE_PATH"

# Étape 1 : Archive (sortie complète pour diagnostiquer les erreurs)
echo "🔨 Archive en cours... (peut prendre 2-5 min)"
echo ""
xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=iOS" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=JQ4Z5PXR5K \
  -allowProvisioningUpdates \
  2>&1

ARCHIVE_EXIT=$?

if [ $ARCHIVE_EXIT -ne 0 ]; then
  echo ""
  echo "❌ ERREUR : L'archive a échoué (code $ARCHIVE_EXIT)"
  echo "Consultez le log ci-dessus pour les détails."
  read -p "Appuie sur Entrée pour fermer..."
  exit $ARCHIVE_EXIT
fi

if [ ! -d "$ARCHIVE_PATH" ]; then
  echo ""
  echo "❌ ERREUR : L'archive n'a pas été créée : $ARCHIVE_PATH"
  read -p "Appuie sur Entrée pour fermer..."
  exit 1
fi

echo ""
echo "✅ Archive terminée : $ARCHIVE_PATH"
echo ""

# Étape 2 : Export & Upload vers TestFlight
echo "🚀 Upload vers TestFlight..."
echo ""
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "/tmp/MyCycleWorld_export" \
  -allowProvisioningUpdates \
  2>&1

EXPORT_EXIT=$?

if [ $EXPORT_EXIT -ne 0 ]; then
  echo ""
  echo "❌ ERREUR : L'export/upload a échoué (code $EXPORT_EXIT)"
  read -p "Appuie sur Entrée pour fermer..."
  exit $EXPORT_EXIT
fi

echo ""
echo "=================================================="
echo " ✅ Upload TestFlight terminé !"
echo ""
echo " Les testeurs recevront une invitation à :"
echo "   • vincent@billois.com"
echo "   • gerome@billois.com"
echo ""
echo " (ajoute-les dans App Store Connect si pas encore fait)"
echo "=================================================="
echo ""
read -p "Appuie sur Entrée pour fermer..."
