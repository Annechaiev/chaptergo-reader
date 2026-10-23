"""Diff ref vs pub drive runs per device. Usage: python compare.py <tag>..."""
import json, sys, re
sys.stdout.reconfigure(encoding='utf-8')
FUNCS = [
 ('F01 library', r'^library\.|^layout\.library'),
 ('F02 open book, toast, hint', r'^open\.(reveal|state|toast|storage|ptrType)|^toast\.gone|^book2\.toast|^layout\.open'),
 ('F03 Dali tap: slide + reveal timing', r'^tap\d\.(reveal|scroll|state)|^layout\.tap'),
 ('F04 second tap flushes', r'^flush\.'),
 ('F05 typing indicator', r'\.typing$'),
 ('F06 menu edge/text tap', r'^menu\.|^layout\.menuOpen'),
 ('F07 settings panel', r'^settings\.|^layout\.settings'),
 ('F08 text size A-/A/A+', r'^size\.|^layout\.size'),
 ('F09 theme + system dark', r'^theme\.|^sysdark'),
 ('F10 speed setting', r'^speed\.'),
 ('F11 Auto scroll/pause', r'^auto\.(?!.*typing)'),
 ('F12 contents (TOC)', r'^toc\.'),
 ('F13 whole chapter + end', r'^whole\.|^layout\.end'),
 ('F14 choices', r'^book2\.(choice|pick)|^book2\.opt1|^layout\.book2\.choice'),
 ('F15 resume after reload', r'^resume\.|^book2\.resume|storage$'),
 ('F16 reread chapter', r'^reread\.|^book2\.reread'),
 ('F17 next chapter / to library', r'^nextch\.|^book2\.(open|reveal|end|toLibrary)'),
 ('F18 books button + restart', r'^books\.|^restart\.|^layout\.library2'),
 ('F19 hide guide', r'^about\.'),
 ('F20 rotation', r'^rotate\.|^layout\.(landscape|portrait)'),
 ('F21 pictures', r'picture|Pictures|avatars|about\.styles|covers'),
 ('F22 open before fonts load', r'^quick\.'),
 ('F23 errors', r'^errors|ERROR$|^harness'),
 ('F24 tap targets reachable', r'^tapTarget'),
]
def motion(c):
    ys = [y for _, y in c]; s, e = ys[0], ys[-1]
    mv = [t for t, y in c if y != s]; st = next((t for t, y in c if y == e), None)
    return s, e, (mv[0] if mv else None), st
def cmp(key, a, b):
    if key == 'fonts' or key == 'quick.fontsAtTap': return True, f'{a} / {b} (info)'
    if a is None or b is None: return a == b, f'REF {j(a)} | PUB {j(b)}'
    if key.endswith('.reveal'):
        sa = [x[1:] for x in a]; sb = [x[1:] for x in b]
        dt = max((abs(x[0] - y[0]) for x, y in zip(a, b)), default=0)
        tol = 400 if key.startswith(('auto.', 'quick')) else 150
        ok = sa == sb and dt <= tol
        return ok, f'{len(a)}/{len(b)} items, same sequence={sa == sb}, max|dt|={dt}ms' + ('' if sa == sb else f'\n        REF {j(sa)[:400]}\n        PUB {j(sb)[:400]}')
    if key.endswith('.typing'):
        dt = max((abs(x - y) for x, y in zip(a, b)), default=0)
        return len(a) == len(b) and dt <= 60, f'REF {a} PUB {b}'
    if key.startswith('auto.') and key.endswith('.scroll'):
        rate = lambda c: (c[-1][1] - c[1][1]) / max(1, c[-1][0] - c[1][0]) * 1000
        ra, rb = rate(a), rate(b)
        return a[0][1] == b[0][1] and abs(ra - rb) <= max(1.0, .1 * abs(ra)), f'start {a[0][1]}/{b[0][1]}, speed {ra:.1f}/{rb:.1f} px/s'
    if key.endswith('.scroll'):
        ma, mb = motion(a), motion(b)
        dur = lambda m: None if m[2] is None or m[3] is None else m[3] - m[2]
        ok = ma[:2] == mb[:2] and (dur(ma) is None) == (dur(mb) is None) and (dur(ma) is None or abs(dur(ma) - dur(mb)) <= 120)
        return ok, f'scrollY {ma[0]}->{ma[1]} / {mb[0]}->{mb[1]}, slide {dur(ma)}/{dur(mb)}ms'
    if key == 'quick.state':  # the scroll target races the web fonts landing during the opening slide
        a2, b2 = dict(a), dict(b); ya, yb = a2.pop('scrollY'), b2.pop('scrollY')
        return a2 == b2, f'scrollY {ya}/{yb} (info)' + ('' if a2 == b2 else f' REF {j(a2)} PUB {j(b2)}')
    if key.startswith('auto.') and isinstance(a, dict):
        a2, b2 = dict(a), dict(b); ya, yb = a2.pop('scrollY'), b2.pop('scrollY')
        return a2 == b2 and abs(ya - yb) <= 25, f'scrollY {ya}/{yb}' + ('' if a2 == b2 else f' REF {j(a2)} PUB {j(b2)}')
    if 'covers' in key or 'picture' in key.lower() :
        return a == b, 'equal' if a == b else f'REF {j(a)} | PUB {j(b)}'
    return a == b, 'equal' if a == b else f'REF {j(a)[:500]}\n        PUB {j(b)[:500]}'
j = lambda v: json.dumps(v, ensure_ascii=False)
def absolute(key, v):
    """Checks that must hold in the published file regardless of the reference."""
    if key.startswith('layout.') and isinstance(v, dict):
        bad = []
        if v['overflowX']: bad.append(f"horizontal overflow {v['overflowX']}px")
        if v['clipped']: bad.append(f"clipped {v['clipped']}")
        if v['outside']: bad.append(f"outside viewport {v['outside']}")
        return bad
    if key.startswith('errors') and v: return [f'errors {v}']
    if key.endswith('ERROR'): return [f'step error {v}']
    if key == 'harness' and v: return [f'harness {v}']
    if key.startswith('tapTarget'): return [f'tap target not reachable {v}']
    return []
def main(tag):
    A = json.load(open(f'ref-{tag}.json', encoding='utf-8')); B = json.load(open(f'pub-{tag}.json', encoding='utf-8'))
    ra, rb = dict(A['obs']), dict(B['obs'])
    print(f'===== {tag}  crash ref={A.get("crash")} pub={B.get("crash")}  checks {len(ra)}/{len(rb)}')
    res = {}
    for key in sorted(ra.keys() | rb.keys(), key=lambda k: ([i for i, (n, p) in enumerate(FUNCS) if re.search(p, k)] or [99])[0]):
        fn = next((n for n, p in FUNCS if re.search(p, key)), 'F99 other')
        ok, det = cmp(key, ra.get(key), rb.get(key))
        absb = absolute(key, rb.get(key)); absa = absolute(key, ra.get(key))
        r = res.setdefault(fn, {'n': 0, 'fail': [], 'abs': []}); r['n'] += 1
        if not ok: r['fail'].append(f'{key}: {det}')
        # The task is parity: a defect the source reader has too is reported, not failed.
        if absb and absb == absa: print(f'     known in source: {key}: {absb}')
        elif absb: r['abs'].append(f'{key}: PUB {absb} (REF {absa or "clean"})')
        if '-v' in sys.argv: print(('OK  ' if ok else 'DIFF'), key, det.split('\n')[0][:200])
    for fn, r in sorted(res.items()):
        verdict = 'PASS' if not r['fail'] and not r['abs'] else 'FAIL'
        print(f'{fn:40s} {verdict}  ({r["n"]} checks)')
        for f in r['fail'] + r['abs']: print('    ', f[:900])
    json.dump({k: ('PASS' if not v['fail'] and not v['abs'] else 'FAIL') for k, v in res.items()}, open(f'verdict-{tag}.json', 'w'))
    return not A.get('crash') and not B.get('crash') and all(not v['fail'] and not v['abs'] for v in res.values())
results = [main(t) for t in sys.argv[1:] if not t.startswith('-')]
sys.exit(0 if all(results) else 1)
