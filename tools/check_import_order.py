"""Ловит то, что py_compile не ловит: обращение к имени, которое определено НИЖЕ
по файлу, из кода, выполняемого прямо при импорте.

Именно так упал сервер: _luxbot_init() вызывался на уровне модуля и внутри
дёргал bcols_pre, определённую на 30 строк ниже. Синтаксис верный, импорт падает.
"""
import ast, sys, builtins

path = sys.argv[1]
src = open(path, encoding='utf-8').read()
tree = ast.parse(src)

defined = {}          # имя -> строка, где оно появилось на уровне модуля
module_calls = []     # (имя функции, строка вызова) для вызовов при импорте

for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        defined[node.name] = node.lineno
    elif isinstance(node, (ast.Assign, ast.AnnAssign)):
        tgts = node.targets if isinstance(node, ast.Assign) else [node.target]
        for t in tgts:
            for n in ast.walk(t):
                if isinstance(n, ast.Name):
                    defined.setdefault(n.id, node.lineno)
    elif isinstance(node, (ast.Import, ast.ImportFrom)):
        for a in node.names:
            defined.setdefault((a.asname or a.name).split('.')[0], node.lineno)
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        f = node.value.func
        if isinstance(f, ast.Name):
            module_calls.append((f.id, node.lineno))
    if isinstance(node, ast.Try):
        for st in node.body:
            if isinstance(st, ast.Expr) and isinstance(st.value, ast.Call) and isinstance(st.value.func, ast.Name):
                module_calls.append((st.value.func.id, st.lineno))

# тела функций: какие глобальные имена они дёргают
bodies = {}
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        local = {a.arg for a in node.args.args} | {a.arg for a in node.args.kwonlyargs}
        for n in ast.walk(node):
            if isinstance(n, (ast.Assign,)):
                for t in n.targets:
                    for x in ast.walk(t):
                        if isinstance(x, ast.Name):
                            local.add(x.id)
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                local.add(n.id)
        used = {x.id for x in ast.walk(node) if isinstance(x, ast.Name) and isinstance(x.ctx, ast.Load)}
        bodies[node.name] = (used - local, node.lineno)

bi = set(dir(builtins))
problems = []
for fname, callline in module_calls:
    if fname not in bodies:
        continue
    used, _ = bodies[fname]
    for name in sorted(used):
        if name in bi or name not in defined:
            continue
        if defined[name] > callline:
            problems.append(f"{path}:{callline}: {fname}() вызывается при импорте, "
                            f"но использует '{name}', определённое ниже (строка {defined[name]})")

if problems:
    print("НАЙДЕНЫ ПАДЕНИЯ ПРИ ИМПОРТЕ:")
    for p in problems:
        print("  " + p)
    sys.exit(1)
print("import-order OK — все имена, нужные при импорте, определены выше")
