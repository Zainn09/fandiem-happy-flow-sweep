#!/usr/bin/env python3
"""
report.py — Python port of report.js
Shows Fandiem happy flow report with issue details: was it visible, what did code do, what error received
Usage: python scripts/report.py [--full]
       py scripts/report.py
       npm run report (still works via node scripts/report.js)
       python -m scripts.report
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
resultsDir = ROOT / "results"
full = "--full" in sys.argv

def read_json(name):
    try:
        return json.loads((resultsDir / name).read_text(encoding="utf-8"))
    except:
        return None

def line(ch='-'): return ch*78
def head(text): print(f"\n{line('=')}\n{text}\n{line('=')}")
def kv(label, value):
    v = value if value not in (None, "", []) else "—"
    # handle list
    if isinstance(v, list):
        v = ", ".join(str(x) for x in v) if v else "—"
    print(f"  {str(label).ljust(26)} {v}")
def truncate(text, n=110):
    s = str(text if text is not None else "").replace("\n"," ").replace("\r"," ").strip()
    s = " ".join(s.split())
    return s[:n-1]+"…" if len(s)>n else s

report = read_json("report.json")
cart = read_json("cart-results.json")

if not report:
    print(f"No results/report.json found in {resultsDir}. Run \"py scripts/run.py\" first.", file=sys.stderr)
    sys.exit(1)

head(f"Fandiem happy flow — {report.get('status','UNKNOWN')}")
kv("Title", report.get("sweepTitle"))
kv("Started", report.get("startedAt"))
kv("Finished", report.get("finishedAt"))
kv("Public URL", report.get("publicUrl"))
if report.get("error"):
    kv("Error", report.get("error"))
    # Show issue clearly as requested
    print("\n  Issue detail:")
    print(f"    Visible on page: {report.get('error','')[:500]}")
    # Try to show media debug if available
    if report.get("media"):
        print(f"    Media debug: {json.dumps(report['media'], indent=6)[:2000]}")

head("Steps")
for i, s in enumerate(report.get("steps", []), 1):
    status = "PASS" if s.get("status")=="PASS" else "FAIL"
    print(f"  {i:02d}. [{status}] {s.get('name')} ({round((s.get('durationMs') or 0)/1000)}s)")
    if s.get("error"):
        print(f"      error: {truncate(s['error'], 400)}")
        # State clearly what code did
        if "Gallery" in s.get("name","") or "Campaign" in s.get("name",""):
            print(f"      what code did: tried reveal_file_inputs, list_file_inputs, setInputFiles on div.grid input[multiple] and button+input sibling, drop on button, click+upload")
            print(f"      was it visible: check report.media.fileInputs and report.media.galleryOrder")
            if report.get("media"):
                print(f"      fileInputs: {report['media'].get('fileInputs')}")
                print(f"      strategies: {report['media'].get('strategies')}")

if report.get("selections"):
    head("Partners")
    sel = report["selections"]
    kv("Talent", sel.get("talent",{}).get("text") if isinstance(sel.get("talent"), dict) else sel.get("talent"))
    kv("Charity", sel.get("charity",{}).get("text") if isinstance(sel.get("charity"), dict) else sel.get("charity"))
    kv("Quote title", sel.get("artistQuoteTitle"))
    kv("Quote", truncate(sel.get("artistQuote"), 90))
    kv("Charity subtitle", truncate(sel.get("charitySubtitle"), 90))

if report.get("media"):
    head("Media")
    m = report["media"]
    cover = m.get("cover")
    if cover:
        kv("Cover", f"{','.join(cover.get('files') or [])} via {cover.get('strategy') or cover.get('error')}")
        if cover.get("error"):
            print(f"      Cover error detail: {cover['error']}")
    kv("Gallery order", " | ".join(m.get("galleryOrder") or []))
    for s in m.get("strategies") or []:
        kv(f"  {s.get('slot')}{':'+s.get('file') if s.get('file') else ''}", s.get("strategy") or s.get("error"))
        if s.get("error"):
            print(f"        strategy error: {s['error'][:400]}")
    bonus = m.get("bonus")
    if bonus:
        kv("Bonus image", f"{bonus.get('file')} via {bonus.get('strategy')}")
    for c in m.get("typeCoverage") or []:
        kv(f"  type {c.get('file')}", f"ok ({c.get('strategy')})" if c.get("ok") else f"FAILED: {truncate(c.get('error'),80)}")
    # Visibility check as requested
    kv("Items text", m.get("itemsText"))
    kv("FileInputs at start", str(m.get("fileInputs")))
    if not m.get("galleryOrder"):
        print("      Issue: Gallery is required but galleryOrder is empty - upload did not create tiles (0 items)")
        print("      Code tried: reveal (make visible), setInputFiles on div.grid input[multiple] with 3-5 files batch, fallback one-by-one, drop, click+upload")
        print("      Visible check: fileInputs was empty means list_file_inputs returned [] even though reveal said 2 inputs - now fixed to handle quoted JSON")

if report.get("promotionTabs"):
    head("Promotion Tabs")
    for t in report["promotionTabs"]:
        kv(f"#{t.get('index')} {truncate(t.get('title'),40)}", f"{(t.get('descriptionControl') or {}).get('tag','?')} | required: {','.join(t.get('fieldsRequired') or []) or 'none'}")

if report.get("prizeDetail"):
    head("Prize Detail")
    kv("Emoji", f"{report['prizeDetail'].get('emoji')} (maxlength {report['prizeDetail'].get('emojiMaxLength')})")
    kv("Description", truncate(report['prizeDetail'].get('description'),90))

if report.get("entryTiers"):
    head("Entry Tiers")
    kv("Seeded rows", f"{report['entryTiers'].get('seededCount')}")
    a = report['entryTiers'].get('added')
    if a:
        kv(f"ADDED tier {a.get('idx')}", f"${a.get('price')} -> {a.get('entries')} entries | {truncate(a.get('impact'),60)}")

if report.get("bonus"):
    head("Bonus")
    kv("Title", report['bonus'].get('title'))

if report.get("sweepsInfo"):
    head("Sweeps Info")
    for k,v in (report['sweepsInfo'].get('values') or {}).items():
        kv(k.replace('input[name="','').replace('"]',''), truncate(v,70))

if report.get("review"):
    head("Review page")
    kv("Attention banner", f"YES ({report['review'].get('stepsNeedingAttention')} step(s))" if report['review'].get('attentionBanner') else "no")

if report.get("storefrontChecks"):
    head("Storefront checks")
    for c in report["storefrontChecks"]:
        print(f"  [{'OK  ' if c.get('present') else 'MISS'}] {'(required) ' if c.get('required') else '(recorded) '}{c.get('label')}: {truncate(c.get('expected'),70)}")

head("Result")
print(f"  {report.get('status')}{(' — '+truncate(report.get('error'),200)) if report.get('error') else ''}")
print(f"  report: {resultsDir / 'report.json'}")
if cart:
    print(f"  cart:   {resultsDir / 'cart-results.json'}")
    head("Cart buttons")
    print(f"  {len(cart)} buttons")
