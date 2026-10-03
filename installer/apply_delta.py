"""PayGo 1.13.9.71 — build the new files in a staging directory from the files on this server.

    python3 apply_delta.py <APP dir> <STAGE dir>

Nothing under <APP> is written. Every source file must have exactly the expected hash (1.13.9.40,
or 1.13.9.41 for optima_live.py); every built file must have exactly the expected hash — otherwise
the script stops and names the file. Prints a JSON summary on success.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

PKG = Path(__file__).resolve().parent
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def apply_unified(original: bytes, diff_text: str) -> bytes:
    """Apply a git unified diff to one file; every context/removed line must match exactly."""
    src = original.decode("utf-8").splitlines(keepends=True)
    out: list[str] = []
    pos = 0
    lines = diff_text.splitlines(keepends=True)
    i = 0
    while i < len(lines) and not lines[i].startswith("@@"):
        i += 1
    while i < len(lines):
        m = HUNK.match(lines[i])
        if not m:
            raise ValueError(f"bad hunk header: {lines[i]!r}")
        start = int(m.group(1)) - 1 if int(m.group(2) or 1) else int(m.group(1))
        if start < pos:
            raise ValueError("overlapping hunks")
        out.extend(src[pos:start])
        pos = start
        i += 1
        last_added = None
        while i < len(lines) and not lines[i].startswith("@@"):
            line = lines[i]
            tag, body = line[:1], line[1:]
            if tag == "\\":  # "\ No newline at end of file" — strip the newline of the previous line
                if last_added == "+" and out and out[-1].endswith("\n"):
                    out[-1] = out[-1][:-1]
                i += 1
                continue
            if tag in (" ", "-"):
                have = src[pos] if pos < len(src) else None
                if have is None or have.rstrip("\n") != body.rstrip("\n"):
                    raise ValueError(f"context mismatch at line {pos + 1}")
                if tag == " ":
                    out.append(have)
                pos += 1
            elif tag == "+":
                out.append(body)
            else:
                raise ValueError(f"unexpected diff line: {line!r}")
            last_added = tag
            i += 1
    out.extend(src[pos:])
    return "".join(out).encode("utf-8")


def main() -> int:
    app, stage = Path(sys.argv[1]), Path(sys.argv[2])
    manifest = json.loads((PKG / "MANIFEST.json").read_text(encoding="utf-8"))
    problems: list[str] = []
    install: list[str] = []
    already: list[str] = []
    for rel, spec in manifest["files"].items():
        target = app / rel
        if not target.exists():
            if "absent" not in spec["diffs"]:
                problems.append(f"{rel}: файла нет на сервере")
                continue
            original, cur = b"", "absent"  # a new file of this version
        else:
            original = target.read_bytes()
            cur = sha(original)
        if cur == spec["after"]:
            already.append(rel)
            continue
        diff_name = spec["diffs"].get(cur)
        if not diff_name:
            problems.append(f"{rel}: на сервере другая версия ({cur[:12]}) — его меняли вручную")
            continue
        try:
            built = apply_unified(original, (PKG / diff_name).read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - reported to the operator
            problems.append(f"{rel}: не удалось применить изменения ({exc})")
            continue
        if sha(built) != spec["after"]:
            problems.append(f"{rel}: собранный файл не совпал с эталоном")
            continue
        out = stage / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(built)
        install.append(rel)
    fe = manifest["frontend"]
    static = app / fe["static_dir"]
    wanted = {fe["js_out"]: fe["js_after"], fe["css_out"]: fe["css_after"]}
    present = {rel: (app / rel).exists() and sha((app / rel).read_bytes()) == h for rel, h in wanted.items()}
    if all(present.values()):
        already.extend(wanted)
    else:
        for name, h in ((fe["js_src"], fe["js_before"]), (fe["css_src"], fe["css_before"])):
            p = static / name
            if not p.exists() or sha(p.read_bytes()) != h:
                problems.append(f"{fe['static_dir']}/{name}: другая версия — админку меняли вручную")
        if not problems:
            out_js, out_css = stage / fe["js_out"], stage / fe["css_out"]
            out_js.parent.mkdir(parents=True, exist_ok=True)
            cp = subprocess.run([sys.executable, str(PKG / "delta" / "fe_patch.py"), str(static), str(out_js), str(out_css)], capture_output=True, text=True)
            if cp.returncode != 0:
                problems.append("админка: сборка не удалась: " + (cp.stderr or cp.stdout)[-300:])
            elif sha(out_js.read_bytes()) != fe["js_after"] or sha(out_css.read_bytes()) != fe["css_after"]:
                problems.append("админка: собранные файлы не совпали с эталоном")
            else:
                install.extend(wanted)
    if problems:
        print(json.dumps({"ok": False, "problems": problems}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "install": install, "already": already}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
