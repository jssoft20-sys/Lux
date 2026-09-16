#!/usr/bin/env python3
"""Copy built site + module sources into the git repo working tree (no rsync needed)."""
import os, shutil, sys, fnmatch
SP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = sys.argv[1] if len(sys.argv) > 1 else '/home/user/Lux'
KEEP_ROOT = {'.git', 'tools', 'src', 'dist', 'ads'}

# 1) built site at repo root: remove previous site files (except keep set), then copy
for name in os.listdir(REPO):
    if name in KEEP_ROOT: continue
    p = os.path.join(REPO, name)
    shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
for name in os.listdir(os.path.join(SP, 'site')):
    if name in ('server.log', '.server.pid'): continue
    src = os.path.join(SP, 'site', name); dst = os.path.join(REPO, name)
    shutil.copytree(src, dst) if os.path.isdir(src) else shutil.copy2(src, dst)

# 2) module sources: text files + seo assets, skip screenshots/scratch
TEXT = ('.html', '.css', '.js', '.mjs', '.py', '.sh', '.md', '.txt', '.xml', '.webmanifest', '.service', '.conf', '.yml')
SKIP_DIRS = ('shots', 'qa', 'gal-', 'review-', 'judge-', 'hero-v1', 'hero-v2-gen')
SKIP_FILES = ('*.orig.*', 'preview*.html', 'crop-*', 'it-*', 'zoom-*', 'how-*', 'dbg.mjs', '*.log', 'ov*.txt', '_preview-ico.png', 'ico-*.png', 'icon-256-src.png', 'lh*.json', 'hero-*.png', '*.png', 'test.html', 'check-overflow.mjs', 'interact.mjs', 'overflow-check.mjs', 'shot-*.mjs', 'render-*.mjs')
mods = os.path.join(REPO, 'src', 'modules')
if os.path.isdir(mods): shutil.rmtree(mods)
for root, dirs, files in os.walk(os.path.join(SP, 'build')):
    rel = os.path.relpath(root, os.path.join(SP, 'build'))
    dirs[:] = [d for d in dirs if not any(d.startswith(s) for s in SKIP_DIRS)]
    for f in files:
        keep = f.endswith(TEXT) or f == 'Dockerfile' or (rel == 'seo' and f.endswith(('.png', '.svg', '.ico')))
        if any(fnmatch.fnmatch(f, pat) for pat in SKIP_FILES) and not (rel == 'seo' and f in ('og-image.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png')):
            keep = False
        if rel == '.' : keep = False
        if not keep: continue
        d = os.path.join(mods, rel); os.makedirs(d, exist_ok=True)
        shutil.copy2(os.path.join(root, f), os.path.join(d, f))
base = os.path.join(REPO, 'src', 'base'); os.makedirs(base, exist_ok=True)
for f in ('base.css', 'fonts.css'):
    shutil.copy2(os.path.join(SP, 'site', 'assets', 'css', f), os.path.join(base, f))
for f in ('SPEC.md', 'CONTRACT.md', 'HERO_BRIEF.md'):
    shutil.copy2(os.path.join(SP, f), os.path.join(REPO, 'src', f))
ads_src = os.path.join(SP, 'ads')
if os.path.isdir(ads_src):
    ads_dst = os.path.join(REPO, 'ads')
    if os.path.isdir(ads_dst): shutil.rmtree(ads_dst)
    shutil.copytree(ads_src, ads_dst)
tools = os.path.join(REPO, 'tools'); os.makedirs(tools, exist_ok=True)
for f in os.listdir(os.path.join(SP, 'tools')):
    if f.endswith(('.py', '.mjs', '.sh', '.js')):
        shutil.copy2(os.path.join(SP, 'tools', f), os.path.join(tools, f))
print('synced')
