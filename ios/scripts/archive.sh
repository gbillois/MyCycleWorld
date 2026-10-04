#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Override these only if using a different Apple Developer team / registered Bundle ID.
TEAM_ID="${TEAM_ID:-JQ4Z5PXR5K}"
BUNDLE_ID="${BUNDLE_ID:-com.gbillois.MyCycleWorld}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
ARCHIVE_PATH="${ARCHIVE_PATH:-$PWD/build/MyCycleWorld.xcarchive}"
DERIVED_PATH="${DERIVED_PATH:-/tmp/mycycleworld-release-derived}"
xcodebuild -project MyCycleWorld.xcodeproj -scheme MyCycleWorld \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_PATH" -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" archive
open "$ARCHIVE_PATH"
