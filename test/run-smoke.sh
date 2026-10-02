#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
omarchy_shell="${OMARCHY_PATH:-/usr/share/omarchy}/shell"
stage_root=$(mktemp -d)
state_root=${SMOOTH_SETTLEMENT_STATE_ROOT:-$(mktemp -d)}
cache_root=${SMOOTH_SETTLEMENT_CACHE_ROOT:-$(mktemp -d)}

cleanup() {
  rm -rf "$stage_root"
}
trap cleanup EXIT

for module in Commons Ui; do
  if [[ ! -d "$omarchy_shell/$module" ]]; then
    printf 'Missing Omarchy QML module: %s\n' "$omarchy_shell/$module" >&2
    exit 1
  fi
  ln -s "$omarchy_shell/$module" "$stage_root/$module"
done

cp "$repo_root"/*.qml "$repo_root"/*.js "$stage_root/"
mkdir -p "$stage_root/test"
cp "$repo_root/test/SmokeHarness.qml" "$repo_root/test/smoke-script.json" "$stage_root/test/"
printf 'import QtQuick\nimport "test"\n\nSmokeHarness {}\n' >"$stage_root/shell.qml"

printf 'REV=%s\nSTATE_ROOT=%s\nCACHE_ROOT=%s\n' \
  "$(git -C "$repo_root" rev-parse HEAD)" "$state_root" "$cache_root"

SMOOTH_SETTLEMENT_SMOKE=1 \
  XDG_STATE_HOME="$state_root" \
  XDG_CACHE_HOME="$cache_root" \
  quickshell -p "$stage_root"
