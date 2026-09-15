#!/usr/bin/env python3
"""Integrator: assembles site/index.html from build modules, concatenates CSS/JS.

Usage: python3 tools/build.py [--hero hero-v2]
"""
import argparse, os, re, shutil, sys, json, hashlib, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.environ.get('BUILD_DIR') or os.path.join(ROOT, 'build')
SITE = os.environ.get('SITE_DIR') or os.path.join(ROOT, 'site')

ap = argparse.ArgumentParser()
ap.add_argument('--hero', default=os.environ.get('HERO', 'hero-v1'))
ap.add_argument('--no-inline-css', action='store_true')
args = ap.parse_args()

def read(path, required=True):
    if not os.path.exists(path):
        if required:
            sys.exit(f'MISSING: {path}')
        return ''
    with open(path, encoding='utf-8') as f:
        return f.read()

def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

hero_dir = os.path.join(BUILD, args.hero)

# ---- gather fragments
head = read(os.path.join(BUILD, 'seo', 'head.html'))
header = read(os.path.join(BUILD, 'chrome', 'header.html'))
footer = read(os.path.join(BUILD, 'chrome', 'footer.html'))
floating = read(os.path.join(BUILD, 'chrome', 'floating.html'))
hero = read(os.path.join(hero_dir, 'hero.html'))
sections_a = read(os.path.join(BUILD, 'sections-a', 'sections-a.html'))
calc = read(os.path.join(BUILD, 'calc', 'calc.html'))
sections_b = read(os.path.join(BUILD, 'sections-b', 'sections-b.html'))

# ---- CSS order: fonts → base → chrome → stage → sections-a → calc → sections-b
css_parts = [
    ('fonts', read(os.path.join(SITE, 'assets', 'css', 'fonts.css'))),
    ('base', read(os.path.join(SITE, 'assets', 'css', 'base.css'))),
    ('chrome', read(os.path.join(BUILD, 'chrome', 'chrome.css'))),
    ('stage', read(os.path.join(hero_dir, 'stage.css'))),
    ('sections-a', read(os.path.join(BUILD, 'sections-a', 'sections-a.css'))),
    ('calc', read(os.path.join(BUILD, 'calc', 'calc.css'))),
    ('sections-b', read(os.path.join(BUILD, 'sections-b', 'sections-b.css'))),
    ('overrides', read(os.path.join(BUILD, 'overrides', 'overrides.css'), required=False)),
]
# fonts.css uses ../fonts/ relative to assets/css/ — in the bundle at assets/css/site.css it is the same location, keep as is.
css = '\n'.join(f'/* ===== {name} ===== */\n{body.strip()}\n' for name, body in css_parts if body.strip())

# ---- JS order: main → chrome → stage → sections-a → calc → sections-b
js_parts = [
    ('main', read(os.path.join(BUILD, 'js', 'main.js'))),
    ('chrome', read(os.path.join(BUILD, 'chrome', 'chrome.js'), required=False)),
    ('stage', read(os.path.join(hero_dir, 'stage.js'), required=False)),
    ('sections-a', read(os.path.join(BUILD, 'sections-a', 'sections-a.js'), required=False)),
    ('calc', read(os.path.join(BUILD, 'calc', 'calc.js'))),
    ('sections-b', read(os.path.join(BUILD, 'sections-b', 'sections-b.js'), required=False)),
    ('overrides', read(os.path.join(BUILD, 'overrides', 'overrides.js'), required=False)),
]
js = '\n'.join(f'/* ===== {name} ===== */\n{body.strip()}\n' for name, body in js_parts if body.strip())

# ---- write bundles
css_path = os.path.join(SITE, 'assets', 'css', 'site.css')
js_path = os.path.join(SITE, 'assets', 'js', 'site.js')
write(css_path, css)
write(js_path, js)
# ---- minify in place (sources stay in build/); skip with NO_MINIFY=1
import subprocess
if not os.environ.get('NO_MINIFY'):
    try:
        subprocess.run(['cleancss', '-O1', '-o', css_path, css_path], check=True)
        subprocess.run(['terser', js_path, '--compress', '--mangle', '--comments', 'false', '-o', js_path], check=True)
        css = read(css_path); js = read(js_path)
    except Exception as e:  # noqa
        print('warn: minify skipped:', e)
css_hash = hashlib.md5(css.encode('utf-8')).hexdigest()[:8]
js_hash = hashlib.md5(js.encode('utf-8')).hexdigest()[:8]

# ---- copy static seo/deploy assets to site root
seo_dir = os.path.join(BUILD, 'seo')
for fn in ['robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'favicon.svg', 'favicon.ico',
           'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'og-image.png']:
    src = os.path.join(seo_dir, fn)
    if os.path.exists(src):
        shutil.copy2(src, os.path.join(SITE, fn))
    else:
        print('warn: seo asset missing', fn)

dep_dir = os.path.join(BUILD, 'deploy')
if os.path.isdir(dep_dir):
    for fn in ['server.py', 'start.sh', 'stop.sh', 'status.sh', 'restart.sh', 'README.md']:
        src = os.path.join(dep_dir, fn)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(SITE, fn))
    sub = os.path.join(dep_dir, 'deploy')
    if os.path.isdir(sub):
        dst = os.path.join(SITE, 'deploy')
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        shutil.copytree(sub, dst)
        if os.path.exists(os.path.join(sub, '404.html')):
            shutil.copy2(os.path.join(sub, '404.html'), os.path.join(SITE, '404.html'))
    for fn in ['start.sh', 'stop.sh', 'status.sh', 'restart.sh']:
        p = os.path.join(SITE, fn)
        if os.path.exists(p):
            os.chmod(p, 0o755)

# ---- assemble html
links = f'''<link rel="stylesheet" href="/assets/css/site.css?v={css_hash}">
<script defer src="/assets/js/site.js?v={js_hash}"></script>'''

counters = read(os.path.join(BUILD, 'overrides', 'counters.html'), required=False)

html = f'''<!doctype html>
<html lang="ru">
<head>
{head.strip()}
{links}
</head>
<body>
{header.strip()}
<main id="main">
{hero.strip()}
{sections_a.strip()}
{calc.strip()}
{sections_b.strip()}
</main>
{footer.strip()}
{floating.strip()}
{counters.strip()}
</body>
</html>
'''
write(os.path.join(SITE, 'index.html'), html)

# ---- report
def kb(p):
    return round(os.path.getsize(p) / 1024, 1)
print('hero:', args.hero)
print('index.html', kb(os.path.join(SITE, 'index.html')), 'KB')
print('site.css', kb(css_path), 'KB')
print('site.js', kb(js_path), 'KB')
# sanity checks
ids = re.findall(r'id="([^"]+)"', html)
dups = sorted({i for i in ids if ids.count(i) > 1})
if dups:
    print('DUPLICATE IDS:', dups)
h1 = len(re.findall(r'<h1[\s>]', html))
print('h1 count:', h1)
for anchor in ['top', 'hero', 'trust-strip', 'services', 'fleet', 'how', 'prices', 'calc', 'why', 'areas', 'reviews', 'faq', 'contacts']:
    if f'id="{anchor}"' not in html:
        print('MISSING ANCHOR:', anchor)
