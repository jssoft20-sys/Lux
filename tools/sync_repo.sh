#!/usr/bin/env bash
# Copies built site + sources into the git repo working tree
set -euo pipefail
SP="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${1:-/home/user/Lux}"
# built site at repo root
rsync -a --delete --exclude '.git' --exclude 'server.log' --exclude '.server.pid' "$SP/site/" "$REPO/" --exclude 'tools' --exclude 'src' --exclude 'dist' --exclude 'SPEC.md' --exclude 'CONTRACT.md' --exclude 'HERO_BRIEF.md'
# module sources (text only + seo assets)
mkdir -p "$REPO/src"
rsync -a --delete --prune-empty-dirs \
  --include '*/' --include '*.html' --include '*.css' --include '*.js' --include '*.mjs' --include '*.py' --include '*.sh' --include '*.md' --include '*.txt' --include '*.xml' --include '*.webmanifest' --include '*.service' --include '*.conf' --include '*.yml' --include 'Dockerfile' \
  --include 'seo/*.png' --include 'seo/*.svg' --include 'seo/*.ico' \
  --exclude 'shots/**' --exclude 'qa*/**' --exclude 'gal-*/**' --exclude 'review-*/**' --exclude 'judge-*/**' --exclude 'hero-v1/**' --exclude 'hero-v2-gen/**' --exclude '*.orig.*' --exclude 'preview*.html' --exclude 'crop-*' --exclude 'it-*' --exclude 'zoom-*' --exclude 'how-*' --exclude 'dbg.mjs' --exclude '*.log' --exclude 'ov*.txt' --exclude '_preview-ico.png' --exclude 'ico-*.png' --exclude 'icon-256-src.png' \
  --exclude '*' \
  "$SP/build/" "$REPO/src/modules/"
mkdir -p "$REPO/src/base"
cp "$SP/site/assets/css/base.css" "$SP/site/assets/css/fonts.css" "$REPO/src/base/"
cp "$SP/SPEC.md" "$SP/CONTRACT.md" "$SP/HERO_BRIEF.md" "$REPO/src/"
mkdir -p "$REPO/tools"
cp "$SP"/tools/*.py "$SP"/tools/*.mjs "$SP"/tools/*.sh "$SP"/tools/*.js "$REPO/tools/" 2>/dev/null || true
echo synced
