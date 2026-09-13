#!/usr/bin/env python3
"""Shrink generated stage.css: drop per-stop timing functions where a keyframe block uses a single
easing everywhere, and move that easing onto the animation declarations that use the block.
Also trims whitespace. Usage: shrink_css.py in.css out.css"""
import re, sys

src, dst = sys.argv[1], sys.argv[2]
css = open(src, encoding='utf-8').read()
orig = len(css)

# 1) find keyframe blocks (balanced braces)
def find_blocks(text):
    out = []
    for m in re.finditer(r'@keyframes\s+([\w-]+)\s*\{', text):
        start = m.end()
        depth = 1
        i = start
        while i < len(text) and depth:
            if text[i] == '{': depth += 1
            elif text[i] == '}': depth -= 1
            i += 1
        out.append((m.group(1), m.start(), start, i - 1))
    return out

uniform = {}
pieces = []
last = 0
for name, s, body_s, body_e in find_blocks(css):
    body = css[body_s:body_e]
    tfs = re.findall(r';?\s*animation-timing-function:([^;}]+)', body)
    stops = body.count('%{')
    if tfs and len(set(t.strip() for t in tfs)) == 1 and len(tfs) >= max(2, stops - 1):
        tf = tfs[0].strip()
        body2 = re.sub(r';?\s*animation-timing-function:[^;}]+', '', body)
        uniform[name] = tf
        pieces.append(css[last:body_s]); pieces.append(body2); last = body_e
pieces.append(css[last:])
css = ''.join(pieces)

# 2) patch animation declarations: `animation: name 22s linear infinite` -> replace 'linear' (or add) with tf
def patch_decl(m):
    decl = m.group(0)
    for name, tf in uniform.items():
        if re.search(r'(?<![\w-])' + re.escape(name) + r'(?![\w-])', decl):
            # replace an existing timing keyword, or insert after name
            if re.search(r'\b(linear|ease|ease-in|ease-out|ease-in-out)\b|cubic-bezier\([^)]*\)|steps\([^)]*\)', decl):
                decl = re.sub(r'\b(linear|ease-in-out|ease-in|ease-out|ease)\b|cubic-bezier\([^)]*\)|steps\([^)]*\)', tf, decl, count=1)
            else:
                decl = re.sub(r'(?<![\w-])' + re.escape(name) + r'(?![\w-])', name + ' ' + tf, decl, count=1)
    return decl
css = re.sub(r'animation\s*:[^;}]+', patch_decl, css)

# 3) whitespace trim (keep comments header)
css = re.sub(r'\n{3,}', '\n\n', css)
open(dst, 'w', encoding='utf-8').write(css)
print(f'{orig} -> {len(css)} bytes; uniform keyframes: {len(uniform)}')
