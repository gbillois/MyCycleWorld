#!/bin/sh
set -eu

# Fail the archive before distribution if the Bluetooth/game bridge tests fail.
if [ -n "${CI_PRIMARY_REPO_PATH:-}" ]; then
    ios_dir="$CI_PRIMARY_REPO_PATH/ios"
else
    script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
    ios_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
fi

test_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/mycycleworld-tests.XXXXXX")
trap 'rm -rf "$test_build_dir"' EXIT

echo "Running Swift tests for Bluetooth protocols and the iOS game bridge"
swift test --package-path "$ios_dir" --scratch-path "$test_build_dir"
