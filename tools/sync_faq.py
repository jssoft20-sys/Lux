#!/usr/bin/env python3
"""Sync FAQPage JSON-LD in build/seo/head.html with the FAQ <details> in build/sections-b/sections-b.html."""
import re, json, html, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sec = open(os.path.join(ROOT, 'build/sections-b/sections-b.html'), encoding='utf-8').read()
head_path = os.path.join(ROOT, 'build/seo/head.html')
head = open(head_path, encoding='utf-8').read()

def text(s):
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()

items = []
for m in re.finditer(r'<details[^>]*>(.*?)</details>', sec, re.S):
    block = m.group(1)
    q = re.search(r'<summary[^>]*>(.*?)</summary>', block, re.S)
    if not q:
        continue
    question = text(q.group(1))
    answer = text(block[q.end():])
    if question and answer:
        items.append({'@type': 'Question', 'name': question, 'acceptedAnswer': {'@type': 'Answer', 'text': answer}})
print('FAQ items found:', len(items))
for it in items:
    print(' -', it['name'])

m = re.search(r'<script type="application/ld\+json">(.*?)</script>', head, re.S)
if not m:
    sys.exit('no JSON-LD in head.html')
data = json.loads(m.group(1))
graph = data.get('@graph', [data])
found = False
for node in graph:
    if node.get('@type') == 'FAQPage':
        node['mainEntity'] = items
        found = True
if not found:
    sys.exit('no FAQPage node')
new = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
head = head[:m.start(1)] + new + head[m.end(1):]
open(head_path, 'w', encoding='utf-8').write(head)
print('head.html FAQPage synced')
