#!/usr/bin/env bash
# Packs and publishes @yakfeed/sdk, @yakfeed/cli and @yakfeed/mcp.
#
# The one way the packages are published: the public client repository's publish workflow runs it
# against npm (a copy of this file, made by the mirror), and `pnpm packages:test` runs it against
# a throwaway local registry, so the test exercises the real thing. Build the packages first
# (`pnpm --filter ... build`).
#
#   publish-packages.sh <pack directory>
#
# Environment:
#   PACK_ONLY=true        pack and write SHA256SUMS, then stop (the workflow uploads them first)
#   PACKED=true           don't pack: publish the files already in the directory, after checking
#                         them against its SHA256SUMS
#   STAGE=true            npm stage publish: each version waits on npm for a maintainer's approval
#                         (with 2FA) before it's live. Needs npm 11.15.0 or later
#   DRY_RUN=true          --dry-run: shows what would be published or staged
#   PROVENANCE=true       --provenance (npm refuses it from a private repository)
#   NPM_CONFIG_REGISTRY   npm's own setting: where to publish, and where "already published?" looks
set -euo pipefail

dest=${1:?usage: publish-packages.sh <pack directory>}
packages=(packages/sdk apps/cli apps/mcp)
cd "$(dirname "$0")/../.."
mkdir -p "$dest"
dest=$(cd "$dest" && pwd)

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
# Each package's name, version and the file pnpm pack makes for it, read once.
names=() versions=() files=()
for pkg in "${packages[@]}"; do
  read -r name version < <(node -p "const p = require('./$pkg/package.json'); p.name + ' ' + p.version")
  names+=("$name") versions+=("$version") files+=("yakfeed-${name#@yakfeed/}-$version.tgz")
done

if [ "${PACKED:-false}" = "true" ]; then
  (cd "$dest" && sha256 -c SHA256SUMS)
else
  # pnpm pack applies each publishConfig (compiled exports and bins) and turns workspace:* into
  # the exact versions; npm then publishes the packed files as they are.
  for pkg in "${packages[@]}"; do
    (cd "$pkg" && pnpm pack --pack-destination "$dest")
  done
  (cd "$dest" && sha256 "${files[@]}" >SHA256SUMS)
  ls -l "$dest"
  cat "$dest/SHA256SUMS"
fi
[ "${PACK_ONLY:-false}" = "true" ] && exit 0

npm_version=$(npm --version)
echo "npm $npm_version"
command=(publish)
if [ "${STAGE:-false}" = "true" ]; then
  # Staged publishing arrived in npm 11.15.0; an older npm would publish directly or fail oddly.
  IFS=. read -r major minor _ <<<"$npm_version"
  if ! [ "$major" -gt 11 ] && ! { [ "$major" -eq 11 ] && [ "${minor%%[!0-9]*}" -ge 15 ]; }; then
    echo "npm $npm_version can't stage; it needs 11.15.0 or later" >&2
    exit 1
  fi
  command=(stage publish)
fi
flags=(--access public)
if [ "${DRY_RUN:-false}" = "true" ]; then flags+=(--dry-run); fi
if [ "${PROVENANCE:-false}" = "true" ]; then flags+=(--provenance); fi

# In dependency order (the CLI pins the SDK's exact version, the MCP server both), so they're
# approved in that order too. A version npm refuses (already staged, say) doesn't stop the rest:
# the run fails at the end and names it.
refused=()
for i in "${!packages[@]}"; do
  id="${names[$i]}@${versions[$i]}"
  if npm view "$id" version >/dev/null 2>&1; then
    echo "$id is already published; skipping"
    continue
  fi
  if ! npm "${command[@]}" "$dest/${files[$i]}" "${flags[@]}"; then
    refused+=("$id")
  fi
done
if [ ${#refused[@]} -gt 0 ]; then
  echo "npm refused: ${refused[*]}. If one is already staged, approve or reject it on npmjs.com, then run this again." >&2
  exit 1
fi
