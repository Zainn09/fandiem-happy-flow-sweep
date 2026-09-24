"""
common.py — Python port of common.js
Wraps @playwright/cli (same Chrome extension session) but from Python.
Keeps the same happy-flow logic, now driven by Python.

Usage: from common import *
"""
import json
import pathlib
import subprocess
import sys
import time
import os
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
resultsDir = ROOT / "results"
resultsDir.mkdir(parents=True, exist_ok=True)

def get_cli_runner():
    import shutil
    node = shutil.which("node") or "node"
    cli_js = ROOT / "node_modules" / "@playwright" / "cli" / "playwright-cli.js"
    if cli_js.exists():
        return {"command": node, "prefix": [str(cli_js)], "shell": False}
    local_name = "playwright-cli.cmd" if os.name == "nt" else "playwright-cli"
    local = ROOT / "node_modules" / ".bin" / local_name
    command = str(local) if local.exists() else local_name
    return {"command": command, "prefix": [], "shell": os.name == "nt"}

def cli(args, raw=False, allow_failure=False):
    final = []
    if config.get("sessionName"):
        final.append(f"--session={config['sessionName']}")
    if raw:
        final.append("--raw")
    final.extend(args)
    runner = get_cli_runner()
    cmd = [runner["command"]] + runner["prefix"] + final
    result = subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        shell=runner["shell"],
    )
    stdout = result.stdout or ""
    stderr = result.stderr or ""
    if result.returncode != 0 and not allow_failure:
        raise RuntimeError(f"playwright-cli failed (exit {result.returncode})\nARGS: {args}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}")
    return {"code": result.returncode, "stdout": stdout, "stderr": stderr}

def sleep(ms): time.sleep(ms/1000)
def clean(v): return re.sub(r"\s+", " ", str(v or "")).strip()
def write_json(name, data):
    p = resultsDir / name
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return str(p)
def env(name, fallback): return os.environ.get(name, fallback)
def stamp_now(): return time.strftime("%Y%m%d%H%M%S")
def log_info(msg): print(f"  [info] {msg}")
def log_warn(msg): print(f"  [warn] {msg}", file=sys.stderr)

def locator(kind, value, options=None):
    options = options or {}
    if kind == "role":
        opts = ", ".join(f'{k}: {json.dumps(v)}' for k,v in options.items())
        return f'getByRole({json.dumps(value)}{", { "+opts+" }" if opts else ""})'
    if kind == "label": return f'getByLabel({json.dumps(value)})'
    if kind == "text": return f'getByText({json.dumps(value)}, {{ exact: true }})'
    if kind == "placeholder": return f'getByPlaceholder({json.dumps(value)})'
    if kind == "css": return f'locator({json.dumps(value)})'
    raise ValueError(f"Unknown locator kind: {kind}")

def click(target): cli(["click", target])
def fill(target, value): cli(["fill", target, str(value)])
def press(key): cli(["press", key])
def goto(url): cli(["goto", url])
def screenshot(filename): cli(["screenshot", f"--filename={filename}"], allow_failure=True)
def eval_page(expr):
    for attempt in range(2):
        try:
            return cli(["eval", expr], raw=True)["stdout"].strip()
        except Exception as e:
            if "modal" in str(e).lower() and attempt == 0:
                log_warn(f"eval modal blocked, dismissing then retry: {str(e)[:150]}")
                try:
                    cli(["press", "Escape"], allow_failure=True)
                    sleep(400)
                    cli(["press", "Escape"], allow_failure=True)
                    sleep(300)
                except: pass
                continue
            raise
    return 
def run_code(code): return cli(["run-code", code], raw=True)["stdout"].strip()
def tab_new(url=None): return cli(["tab-new", url] if url else ["tab-new"])["stdout"]
def tab_list(): return cli(["tab-list"])["stdout"]

def body_text():
    for attempt in range(2):
        try:
            return eval_page('() => (document.body ? document.body.innerText : "")')
        except Exception as e:
            if "modal" in str(e).lower() and attempt == 0:
                try:
                    cli(["press", "Escape"], allow_failure=True)
                    sleep(300)
                except: pass
                continue
            try:
                raw2 = run_code("async page => { return await page.evaluate(() => (document.body ? document.body.innerText : '')); }")
                return str(raw2 or "").strip().strip('"').strip("'")
            except:
                return ""
    return ""

def current_url():
    try:
        return eval_page('() => location.href')
    except Exception as e:
        if "modal" in str(e).lower():
            try:
                cli(["press", "Escape"], allow_failure=True)
                sleep(300)
                return eval_page('() => location.href')
            except:
                pass
        try:
            raw2 = run_code("async page => { return await page.evaluate(() => location.href); }")
            return str(raw2 or "").strip().strip('"').strip("'")
        except:
            return 

def assert_contains(text, value, label):
    if str(value).lower() not in str(text).lower():
        raise AssertionError(f'{label}: expected to find {json.dumps(value)}')
def assert_absent(text, value, label):
    if str(value).lower() in str(text).lower():
        raise AssertionError(f'{label}: unexpected text {json.dumps(value)}')
def heading(name): assert_contains(body_text(), name, "Screen")

def resolve_asset(rel):
    abs_path = (ROOT / rel).resolve()
    if not abs_path.exists():
        raise FileNotFoundError(f"Asset not found: {rel} (resolved {abs_path})")
    return str(abs_path)
def resolve_assets(lst): return [resolve_asset(p) for p in (lst or [])]

def next_daily_number():
    now = time.localtime()
    yyyymmdd = f"{now.tm_year}{now.tm_mon:02d}{now.tm_mday:02d}"
    f = resultsDir / f"run-counter-{yyyymmdd}.json"
    n = 0
    try:
        n = int(json.loads(f.read_text(encoding="utf-8")).get("count", 0))
    except: pass
    n += 1
    f.write_text(json.dumps({"date": yyyymmdd, "count": n}, indent=2), encoding="utf-8")
    return yyyymmdd, n

def build_sweep_title():
    override = os.environ.get("SWEEP_TITLE", "").strip()
    if override: return override
    yyyymmdd, n = next_daily_number()
    return f"{config['sweepTitlePrefix']}-{yyyymmdd}-{n:03d}"

# ---- uploads ----
def list_file_inputs():
    for _attempt in range(2):
        try:
            raw = eval_page("""() => {
      const found=[]; const seen=new Set();
      function collect(root){
        try{
          for(const el of [...root.querySelectorAll('input[type="file"]')]){
            if(!seen.has(el)){seen.add(el); found.push({accept:el.getAttribute('accept')||'',name:el.getAttribute('name')||'',id:el.id||'',multiple:!!el.multiple,visible:(()=>{try{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}catch(_){return false;}})(),selector:'input[type="file"]'})}
          }
          for(const el of [...root.querySelectorAll('input[accept]')].filter(e=>/image|video/.test(e.getAttribute('accept')||''))){
            if(!seen.has(el)){seen.add(el); found.push({accept:el.getAttribute('accept')||'',name:el.getAttribute('name')||'',id:el.id||'',multiple:!!el.multiple,visible:(()=>{try{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}catch(_){return false;}})(),selector:'input[accept]'})}
          }
          for(const el of [...root.querySelectorAll('input.hidden')].filter(e=>e.type==='file')){
            if(!seen.has(el)){seen.add(el); found.push({accept:el.getAttribute('accept')||'',name:el.getAttribute('name')||'',id:el.id||'',multiple:!!el.multiple,visible:false,selector:'input.hidden'})}
          }
          for(const el of [...root.querySelectorAll('*')]){ if(el.shadowRoot) collect(el.shadowRoot); }
        }catch(_){}
      }
      collect(document);
      try{ for(const iframe of [...document.querySelectorAll('iframe')]){ try{ const d=iframe.contentDocument||iframe.contentWindow.document; if(d) collect(d);}catch(_){} } }catch(_){}
      return JSON.stringify(found.map((f,i)=>({index:i,...f})));
    }""")
            # Use cleaned raw for check too
            raw_for_check = str(raw or "").strip().strip('"').strip("'").strip()
            if not raw_for_check or raw_for_check == "[]":
                try:
                    cnt = int(run_code("async page => String(await page.locator('input[type=\"file\"]').count())").strip() or "0")
                    if cnt>0:
                        log_info(f"list_file_inputs eval 0 but locator count={cnt}, creating dummy entries")
                        return [{"index":i,"accept":"","name":"","id":"","multiple":False,"visible":False,"selector":"locator-count"} for i in range(cnt)]
                except: pass
            # raw may be '"[{"index":0}]"' with outer quotes from --raw, handle it
            raw_clean = str(raw or "").strip()
            # If raw is quoted string like '"[]"' or "'[]'", unwrap once
            if len(raw_clean) >= 2 and raw_clean[0] in ('"', "'") and raw_clean[-1] == raw_clean[0]:
                try:
                    inner = json.loads(raw_clean)
                    if isinstance(inner, str):
                        raw_clean = inner
                except:
                    raw_clean = raw_clean[1:-1]
            parsed = json.loads(raw_clean or "[]")
            if isinstance(parsed, list): return parsed
            if isinstance(parsed, dict):
                vals = list(parsed.values())
                if vals and isinstance(vals[0], dict): return vals
            return []
        except Exception as e:
            if "modal" in str(e).lower() and _attempt == 0:
                log_warn(f"list_file_inputs modal blocked, dismissing: {str(e)[:200]}")
                try: cli(["press", "Escape"], allow_failure=True); sleep(400)
                except: pass
                continue
            try: log_warn(f"list_file_inputs failed: {e}, returning []")
            except: pass
            return []
    return []

def reveal_file_inputs():
    for attempt in range(2):
        try:
            res = eval_page("""() => {
      let c=0; for(const inp of [...document.querySelectorAll('input[type="file"]')]){
        try{
          if(inp.style.display==='none' || getComputedStyle(inp).display==='none') inp.style.display='block';
          inp.style.visibility='visible'; inp.style.opacity='1';
          if(inp.style.width==='0px'||inp.style.width==='') inp.style.width='100px';
          if(inp.style.height==='0px'||inp.style.height==='') inp.style.height='20px';
          if(getComputedStyle(inp).position==='absolute' && inp.getBoundingClientRect().width===0) inp.style.position='static';
          inp.removeAttribute('hidden'); inp.classList.remove('hidden'); c++;
        }catch(_){}
      }
      try{
        const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('Add media'));
        if(b) b.scrollIntoView({behavior:'instant',block:'center'});
        else{
          const lab=[...document.querySelectorAll('label')].find(l=>(l.innerText||'').includes('Media Gallery'));
          if(lab) lab.scrollIntoView({behavior:'instant',block:'center'}); else window.scrollBy(0,400);
        }
      }catch(_){}
      return String(c);
    }""")
            # res may be '"2"' with quotes from eval -- strip non-digits
            clean_res = re.sub(r'[^0-9]', '', str(res) or '')
            num = int(clean_res or 0)
            log_info(f"reveal_file_inputs: ensured {num} inputs visible and scrolled (raw={repr(res)[:40]})")
            return num
        except Exception as e:
            if "modal" in str(e).lower() and attempt == 0:
                log_warn(f"reveal_file_inputs modal blocked, dismissing: {str(e)[:200]}")
                try:
                    cli(["press", "Escape"], allow_failure=True); sleep(400)
                    try: run_code("async page => { const btn=[...document.querySelectorAll('button')].find(b=>/Cancel/.test(b.innerText||'')); if(btn) btn.click(); return 'clicked-cancel'; }")
                    except: pass
                    sleep(300)
                except: pass
                continue
            try:
                raw2 = run_code("""async page => { let c=0; for(const inp of await page.$$('input[type="file"]')){ try{ await inp.evaluate(el=>{ if(el.style.display==='none') el.style.display='block'; el.style.visibility='visible'; el.style.opacity='1'; el.style.width='100px'; el.style.height='20px'; el.removeAttribute('hidden'); el.classList.remove('hidden'); }); c++; }catch(_){}} try{ const b=await page.$('button:has-text("Add media")'); if(b) await b.scrollIntoViewIfNeeded(); }catch(_){} return String(c); }""")
                clean2 = re.sub(r'[^0-9]', '', str(raw2) or '')
                num2 = int(clean2 or 0)
                log_info(f"reveal_file_inputs fallback ensured {num2}")
                return num2
            except Exception as e2:
                log_warn(f"reveal_file_inputs failed: {e2}")
                return 0
    return 0

def drop_files(target, abs_paths):
    for p in abs_paths:
        if not pathlib.Path(p).exists(): raise FileNotFoundError(f"File not found: {p}")
    try:
        return cli(["drop", target] + [f"--path={p}" for p in abs_paths])
    except Exception as e:
        res = cli(["drop", target] + [f"--path={p}" for p in abs_paths], allow_failure=True)
        if res["code"] != 0:
            raise RuntimeError(f"drop failed for target {target}: STDERR: {res['stderr']}\nSTDOUT: {res['stdout']}"[:1000])
        return res

def upload_files(abs_paths):
    for p in abs_paths:
        if not pathlib.Path(p).exists(): raise FileNotFoundError(f"File not found: {p}")
    try:
        return cli(["upload"] + abs_paths)
    except Exception as e:
        res = cli(["upload"] + abs_paths, allow_failure=True)
        if res["code"] != 0:
            raise RuntimeError(f"upload failed: STDERR={res['stderr'][:800]} STDOUT={res['stdout'][:800]}")
        return res

def set_input_files(css, abs_paths):
    for p in abs_paths:
        if not pathlib.Path(p).exists(): raise FileNotFoundError(f"File not found: {p}")
    code = f"async page => {{ await page.locator({json.dumps(css)}).first().setInputFiles({json.dumps(abs_paths)}); return 'ok'; }}"
    return run_code(code)

def capture_visible_errors():
    try:
        raw = eval_page("""() => JSON.stringify([...document.querySelectorAll('[role="alert"], p[class*="red"], span[class*="red"], div[class*="red"], [class*="text-red"], [class*="error"]')].map(e=>(e.innerText||'').trim()).filter(t=>t && /required|invalid|failed|error|attention|must|missing|least one/i.test(t)).slice(0,20))""")
        # raw may be '"[{"index":0}]"' with outer quotes from --raw, handle it
        raw_clean = str(raw or "").strip()
        # If raw is quoted string like '"[]"' or "'[]'", unwrap once
        if len(raw_clean) >= 2 and raw_clean[0] in ('"', "'") and raw_clean[-1] == raw_clean[0]:
            try:
                # Try to parse as JSON string containing JSON
                inner = json.loads(raw_clean)
                if isinstance(inner, str):
                    raw_clean = inner
            except:
                # Strip outer quotes manually
                raw_clean = raw_clean[1:-1]
        # Debug: uncomment to see raw
        # log_info(f"list_file_inputs raw={raw_clean[:300]}")
        parsed = json.loads(raw_clean or "[]")
        if isinstance(parsed, list): return parsed
        if isinstance(parsed, dict): return [v for v in parsed.values() if isinstance(v, str)]
        return []
    except:
        return []

def safe_join(arr, sep=" | "):
    try:
        if isinstance(arr, list): return sep.join(arr)
        if isinstance(arr, dict): return sep.join(v for v in arr.values() if isinstance(v, str))
        return str(arr or "")
    except: return ""

def gallery_items_text():
    # Handle modal state: browser_evaluate fails when Playwright banner modal is open (top Cancel banner)
    for attempt in range(2):
        try:
            return eval_page("""() => { const m=(document.body.innerText||'').match(/(\\d+)\\s+items?/i); return m?m[0]:''; }""")
        except Exception as e:
            if "modal" in str(e).lower() and attempt == 0:
                log_warn(f"gallery_items_text modal blocked, dismissing: {str(e)[:200]}")
                try:
                    # Dismiss Playwright banner Cancel or any modal via Escape
                    cli(["press", "Escape"], allow_failure=True)
                    sleep(500)
                    # Also try clicking Cancel on the banner
                    cli(["press", "Escape"], allow_failure=True)
                    sleep(500)
                except: pass
                continue
            # Fallback: try via run_code which may handle modal differently
            try:
                raw2 = run_code("""async page => { return await page.evaluate(() => { const m=(document.body.innerText||'').match(/(\\d+)\\s+items?/i); return m?m[0]:''; }); }""")
                return str(raw2 or "").strip().strip('"').strip("'")
            except:
                return ""
    return ""

def gallery_tile_count():
    for attempt in range(2):
        try:
            raw = eval_page("""() => String(document.querySelectorAll('img[src*="blob:"], img[src*="cloudinary"], img[src*="amazonaws"], video').length)""")
            return int(re.sub(r"[^0-9]", "", str(raw)) or 0) if raw else 0
        except Exception as e:
            if "modal" in str(e).lower() and attempt == 0:
                log_warn(f"gallery_tile_count modal blocked, dismissing: {str(e)[:200]}")
                try:
                    cli(["press", "Escape"], allow_failure=True)
                    sleep(500)
                    cli(["press", "Escape"], allow_failure=True)
                    sleep(500)
                except: pass
                continue
            try:
                raw2 = run_code("""async page => { return String(await page.evaluate(() => document.querySelectorAll('img[src*="blob:"], img[src*="cloudinary"], img[src*="amazonaws"], video').length)); }""")
                clean = re.sub(r'[^0-9]', '', str(raw2) or '')
                return int(clean or 0)
            except:
                return 0
    return 0

OPTION_SELECTOR = '[role="option"], [role="menuitemcheckbox"], [role="menuitem"][data-value], [data-slot="select-item"], [data-radix-collection-item]'

def list_combobox_options():
    try:
        raw = eval_page(f"""() => JSON.stringify([...document.querySelectorAll({json.dumps(OPTION_SELECTOR)})].map(e=>({{text:(e.innerText||'').trim().slice(0,160),html:e.innerHTML.trim().slice(0,400)}})).filter(o=>o.text).slice(0,40))""")
        # raw may be '"[{"index":0}]"' with outer quotes from --raw, handle it
        raw_clean = str(raw or "").strip()
        # If raw is quoted string like '"[]"' or "'[]'", unwrap once
        if len(raw_clean) >= 2 and raw_clean[0] in ('"', "'") and raw_clean[-1] == raw_clean[0]:
            try:
                # Try to parse as JSON string containing JSON
                inner = json.loads(raw_clean)
                if isinstance(inner, str):
                    raw_clean = inner
            except:
                # Strip outer quotes manually
                raw_clean = raw_clean[1:-1]
        # Debug: uncomment to see raw
        # log_info(f"list_file_inputs raw={raw_clean[:300]}")
        parsed = json.loads(raw_clean or "[]")
        if isinstance(parsed, list): return parsed
        if isinstance(parsed, dict): return list(parsed.values())
        return []
    except: return []

def combo_norm(v): return re.sub(r"[^a-z0-9]", "", str(v or "").lower())
def match_option_index(options, wanted):
    if not wanted or not str(wanted).strip(): return 0
    w = combo_norm(wanted)
    idx = next((i for i,o in enumerate(options) if combo_norm(o.get("text",""))==w), -1)
    if idx==-1: idx = next((i for i,o in enumerate(options) if w in combo_norm(o.get("text",""))), -1)
    if idx==-1: idx = next((i for i,o in enumerate(options) if combo_norm(o.get("text","")) in w and len(combo_norm(o.get("text","")))>2), -1)
    return idx
def fill_popup_search(text):
    code = f"""async page => {{
    const visible=el=>!!el && el.offsetParent!==null && !el.readOnly && !el.disabled;
    const pick=()=>{{ const f=[...document.querySelectorAll('input[cmdk-input], input[placeholder*="Search" i]')].find(visible); if(f) return f; const b=[...document.querySelectorAll('input')].filter(e=>visible(e)&&(e.type==='text'||e.type===''||e.type==='search')); return b[b.length-1]||null; }};
    const el=pick(); if(!el) return 'no-input'; await el.click(); await el.fill({json.dumps(str(text))}); return 'ok';
  }}"""
    return run_code(code)

def select_combobox(combobox_target, preferred_name="", label="Combobox"):
    name = label or "Combobox"
    log_info(f"{name}: clicking {combobox_target} want={preferred_name or '(any)'}")
    # HTML provided: <button role=\"combobox\" aria-haspopup=\"dialog\" data-state=\"open/closed\">Select talents</button>
    # This is Radix Dialog combobox, not listbox. Need to handle dialog.
    # Check if already has selection (e.g., 'A Day To Remember x' badge) - then consider talent already selected
    try:
        already = run_code("""async page => {
            const btn=[...document.querySelectorAll('button[role="combobox"]')].find(b=> {
                const txt=(b.innerText||'');
                return txt.includes('A Day To Remember') || txt.includes('5B ARTISTS') || (!txt.includes('Select talents') && !txt.includes('Select one or more') && txt.trim().length>3);
            });
            const badges=[...document.querySelectorAll('[aria-label^="Remove"]')].length;
            const btnTxt=btn ? btn.innerText.trim().slice(0,80) : '';
            return JSON.stringify({btnTxt, badges, hasSelection: badges>0 || (btn && !btn.innerText.includes('Select talents') && !btn.innerText.includes('Select one or more'))});
        }""")
        log_info(f"{name}: already check {already}")
        try:
            import json as _j
            aj=_j.loads(already.strip().strip('"').strip("'")) if already else {}
            # If already has selection and we are not forced to add another, consider success
            if isinstance(aj, dict) and aj.get("hasSelection") and str(preferred_name or "").strip() == "":
                log_info(f"{name}: already has selection '{aj.get('btnTxt')}' badges {aj.get('badges')}, treating as PASS")
                # Ensure dialog closed
                try: cli(["press", "Escape"], allow_failure=True); sleep(300)
                except: pass
                return {"index":0,"text":aj.get("btnTxt") or "Already selected","innerHTML":"","optionsCount":1,"options":[aj.get("btnTxt")],"filteredBy":"already-selected"}
            # If want is specific and already matches, also PASS
            if isinstance(aj, dict) and aj.get("hasSelection") and want and want.lower() in str(aj.get("btnTxt") or "").lower():
                log_info(f"{name}: already has wanted '{want}'")
                try: cli(["press", "Escape"], allow_failure=True); sleep(300)
                except: pass
                return {"index":0,"text":aj.get("btnTxt"),"innerHTML":"","optionsCount":1,"options":[aj.get("btnTxt")],"filteredBy":"already-wanted"}
        except: pass
    except: pass
    # Check if dialog already open - don't click again if open
    already_open=False
    try:
        state_check = run_code("""async page => {
            const btn=[...document.querySelectorAll('button[role="combobox"]')].find(b=> (b.innerText||'').includes('Select talents') || (b.innerText||'').includes('Select one or more charities') || b.getAttribute('aria-controls'));
            if (!btn) return 'no-btn';
            return JSON.stringify({state: btn.getAttribute('data-state'), expanded: btn.getAttribute('aria-expanded'), hasDialog: !!document.querySelector('[role="dialog"]')});
        }""")
        log_info(f"{name}: pre-open check {state_check}")
        if '"state":"open"' in state_check or '"expanded":"true"' in state_check or '"hasDialog":true' in state_check:
            already_open=True
            log_info(f"{name}: dialog already open, skipping initial click")
    except: pass
    if not already_open:
        for open_attempt in range(2):
            try:
                click(combobox_target)
                sleep(1200)
                break
            except Exception as e:
                log_warn(f"{name}: click attempt {open_attempt+1} failed {e}")
                try:
                    run_code(f"""async page => {{
                        const sel={json.dumps(combobox_target)};
                        try {{ await page.locator({json.dumps(combobox_target)}).first().click(); return 'clicked-locator'; }} catch(_e) {{}}
                        const btn=document.querySelector('button[role="combobox"]')||[...document.querySelectorAll('button')].find(b=>(b.innerText||'').includes('Select talents')||(b.innerText||'').includes('Select one or more charities'));
                        if (btn) {{ btn.scrollIntoView({{block:'center'}}); btn.click(); return 'clicked-js'; }}
                        return 'no-btn';
                    }}""")
                    sleep(1000)
                    break
                except: pass
        sleep(800)
    else:
        sleep(400)
    # Verify dialog opened and wait for options to load (poll)
    for wait_i in range(4):
        try:
            dbg = run_code("""async page => {
                const btn=[...document.querySelectorAll('button[role="combobox"]')].find(b=> (b.innerText||'').includes('Select talents') || b.getAttribute('aria-controls'));
                const ctrl=btn ? btn.getAttribute('aria-controls') : '';
                const dlg=ctrl ? document.getElementById(ctrl) : null;
                const byRole=document.querySelector('[role="dialog"]');
                const portal=document.querySelector('[data-radix-portal]');
                const scope=dlg||byRole||portal||document.body;
                const opts=[...scope.querySelectorAll('[role="option"], [data-slot="select-item"], [cmdk-item], div[data-value]')].filter(e=>e.offsetParent!==null).length;
                const divs=[...scope.querySelectorAll('div')].filter(e=> (e.innerText||'').includes('@') && e.getBoundingClientRect().width>80).length;
                const state=btn ? btn.getAttribute('data-state') : '';
                const expanded=btn ? btn.getAttribute('aria-expanded') : '';
                return JSON.stringify({ctrl, hasDlg:!!dlg, byRole: !!byRole, hasPortal: !!portal, state, expanded, opts, divs, html: (dlg||byRole||portal) ? (dlg||byRole||portal).innerHTML.slice(0,500).replace(/\n/g,' ') : 'none'});
            }""")
            log_info(f"{name}: dialog check {wait_i+1}: {dbg[:600]}")
            # If opts or divs >0, break
            if '"opts":0' not in dbg or '"divs":0' not in dbg:
                if 'opts":' in dbg:
                    # crude: if any opts found
                    import re as _re
                    m=_re.search(r'"opts":(\d+)', dbg)
                    n=_re.search(r'"divs":(\d+)', dbg)
                    if (m and int(m.group(1))>0) or (n and int(n.group(1))>0):
                        break
                else:
                    break
            sleep(800)
        except Exception as e:
            log_warn(f"{name}: dialog check failed {e}")
            sleep(800)
    want = str(preferred_name or "").strip()
    log_info(f"{name}: dropdown should be open, want={want or '(any random)'}")
    # New dialog-aware JS: look inside [role=dialog] or radix dialog
    js_click = """
    async page => {
      const getDialog = () => {
        const btn=[...document.querySelectorAll('button[role="combobox"]')].find(b=> (b.innerText||'').includes('Select talents') || (b.innerText||'').includes('Select one or more charities'));
        const ctrl=btn ? btn.getAttribute('aria-controls') : '';
        const dlgByCtrl=ctrl ? document.getElementById(ctrl) : null;
        if (dlgByCtrl && dlgByCtrl.offsetParent!==null) return dlgByCtrl;
        const byRole=document.querySelector('[role="dialog"]');
        if (byRole && byRole.offsetParent!==null) return byRole;
        const portal=document.querySelector('[data-radix-portal]') || document.querySelector('[data-slot="dialog-content"]');
        if (portal) return portal;
        // Fallback: find any element that contains "Search brands" or "5B ARTISTS"
        const searchEl=[...document.querySelectorAll('input[placeholder*="Search"]')].find(e=>e.offsetParent!==null);
        if (searchEl) {
          let p=searchEl.parentElement;
          for (let i=0;i<4 && p;i++){ if (p.querySelector('[role="option"]') || p.innerText.includes('5B ARTISTS')) return p; p=p.parentElement; }
        }
        return document.body;
      };
      const dlg=getDialog();
      // For this UI, listbox is global: <div role="listbox"><button role="option">5B ARTISTS @5BArtists</button> - search globally
      const scope=dlg && dlg.querySelector('[role="option"]') ? dlg : document;
      let tries=0;
      while (tries<4) {
        const hasGlobal=[...document.querySelectorAll('[role="option"]')].filter(e=>e.offsetParent!==null).length;
        const hasScope=[...scope.querySelectorAll('[role="option"], [data-slot="select-item"], [cmdk-item], div[data-value]')].filter(e=>e.offsetParent!==null).length;
        const hasAt=[...document.querySelectorAll('div, button')].filter(e=> (e.innerText||'').includes('@5BArtists') || (e.innerText||'').includes('@3oh')).length;
        if (hasGlobal>0 || hasScope>0 || hasAt>0) break;
        await new Promise(r=>setTimeout(r,700));
        tries++;
      }
      const selectors=[
        '[role="listbox"] [role="option"]',
        'div[role="listbox"] button[role="option"]',
        '[role="option"]',
        '[data-slot="select-item"]',
        '[cmdk-item]',
        'div[data-value]',
        '[data-radix-collection-item]'
      ];
      const findOptions = () => {
        for (const sel of selectors) {
          try {
            const els=[...document.querySelectorAll(sel)].filter(e=>{
              const r=e.getBoundingClientRect();
              const t=(e.innerText||'').trim();
              return r.width>50 && r.height>12 && t.length>1 && t.length<120 && !/Select talents|Select one or more charities|Search brands/.test(t) && r.top>20;
            });
            const visible=els.filter(e=> e.offsetParent!==null || e.getClientRects().length>0);
            if (visible.length) return {found:true, sel, els: visible};
            if (els.length) return {found:true, sel, els};
          } catch(e){}
        }
        try {
          const atEls=[...document.querySelectorAll('button[role="option"], div[role="option"], button')].filter(e=>{
            const r=e.getBoundingClientRect();
            const t=(e.innerText||'').trim();
            return r.width>120 && r.height>24 && r.height<70 && t.includes('@') && t.length>4 && t.length<90;
          });
          if (atEls.length) return {found:true, sel:'at-global', els: atEls};
        } catch(e){}
        try {
          const lb=document.querySelector('[role="listbox"]');
          if (lb) {
            const lbOpts=[...lb.querySelectorAll('button')].filter(e=> e.getBoundingClientRect().width>80);
            if (lbOpts.length) return {found:true, sel:'listbox-buttons', els: lbOpts};
          }
        } catch(e){}
        return {found:false, sel:'none', els:[]};
      };
      const chk=findOptions();
      if (!chk.found) {
        const lb=document.querySelector('[role="listbox"]');
        const html=(lb ? lb.innerHTML : (scope.innerHTML||'')).slice(0,1200).replace(/\n/g,' ');
        const allOpts=[...document.querySelectorAll('[role="option"]')].length;
        return 'no-options:'+JSON.stringify({selTried: selectors.slice(0,3), scopeTag: scope.tagName, hasListbox: !!lb, allOpts, html: html.slice(0,700)});
      }
      // Filter by want if provided
      let candidates=chk.els;
      const wantNorm=(TEXT_WANT||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      if (wantNorm) {
        const filtered=candidates.filter(e=>{
          const t=(e.innerText||'').toLowerCase().replace(/[^a-z0-9]/g,'');
          return t.includes(wantNorm) || wantNorm.includes(t);
        });
        if (filtered.length) candidates=filtered;
      }
      // Pick random among first 10 or exact match
      const idx=Math.floor(Math.random()*Math.min(candidates.length,10));
      const tgt=candidates[idx] || candidates[0];
      try { tgt.scrollIntoView({block:'center'}); } catch(e){}
      await new Promise(r=>setTimeout(r,300));
      try { tgt.click(); } catch(e) { 
        // Try dispatch
        tgt.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      }
      await new Promise(r=>setTimeout(r,500));
      return 'clicked:'+idx+':'+(tgt.innerText||tgt.textContent||'').slice(0,60).replace(/\n/g,' ')+':via='+chk.sel+':total='+candidates.length;
    }
    """
    # Inject want into js_click
    js_click_injected = js_click.replace("TEXT_WANT", json.dumps(want))
    for attempt in range(6):
        try:
            # If dialog not visible, try reopening
            if attempt in (2,4):
                try: click(combobox_target); sleep(1000)
                except: pass
            res = run_code(js_click_injected)
            log_info(f"{name}: JS click attempt {attempt+1}: {res}")
            if str(res).startswith("clicked"):
                sleep(1200)
                # Verify selection - check for badges or selected value
                try:
                    ver = run_code("""async page => {
                        const badges=[...document.querySelectorAll('[aria-label^="Remove"]')].map(e=>e.getAttribute('aria-label')).slice(0,3);
                        const selected=[...document.querySelectorAll('button[role="combobox"]')].map(b=>b.innerText.trim()).slice(0,2);
                        const dlgOpen=!!document.querySelector('[role="dialog"]');
                        return JSON.stringify({badges, selected, dlgOpen});
                    }""")
                    log_info(f"{name}: verify {ver}")
                    # If badges appear or button text no longer "Select talents", success
                    if "Remove" in ver or "Select talents" not in ver:
                        chosen = ":".join(str(res).split(":")[2:]) or "Random Talent"
                        # Close dialog if still open via Escape
                        try: cli(["press", "Escape"], allow_failure=True); sleep(300)
                        except: pass
                        return {"index":0,"text":chosen,"innerHTML":"","optionsCount":1,"options":[chosen],"filteredBy":"dialog"}
                except Exception as ve:
                    log_warn(f"{name}: verify failed {ve}")
                    return {"index":0,"text":str(res),"innerHTML":"","optionsCount":1,"options":[str(res)],"filteredBy":"dialog-no-verify"}
        except Exception as e:
            log_warn(f"{name}: attempt {attempt+1} failed {e}")
        sleep(1000)
    try:
        direct = run_code("""async page => {
            const lb=document.querySelector('[role="listbox"]');
            const scope=lb || document.querySelector('[role="dialog"]') || document.body;
            const opts=[...scope.querySelectorAll('[role="option"]')].filter(e=>e.offsetParent!==null);
            if (!opts.length) {
                const fallback=[...document.querySelectorAll('button[role="option"]')].filter(e=>e.offsetParent!==null);
                if (fallback.length) {
                    fallback[0].click();
                    return 'clicked-direct-fallback:'+(fallback[0].innerText||'').slice(0,60);
                }
                return 'no-opts-direct:'+scope.innerHTML.slice(0,500).replace(/\n/g,' ');
            }
            let tgt=opts[0];
            const want=(TEXT_WANT2||'').toLowerCase();
            if (want) {
                const m=opts.find(e=> (e.innerText||'').toLowerCase().includes(want));
                if (m) tgt=m;
            } else {
                tgt=opts[Math.floor(Math.random()*Math.min(opts.length,10))] || opts[0];
            }
            tgt.scrollIntoView({block:'center'});
            await new Promise(r=>setTimeout(r,200));
            tgt.click();
            return 'clicked-direct:'+(tgt.innerText||'').slice(0,60);
        }""".replace("TEXT_WANT2", json.dumps(want)))
        log_info(f"{name}: direct fallback {direct}")
        if "clicked-direct" in str(direct):
            sleep(800)
            return {"index":0,"text":str(direct).split(":")[1] if ":" in str(direct) else "Direct", "innerHTML":"","optionsCount":1,"options":[str(direct)],"filteredBy":"direct"}
    except Exception as e:
        log_warn(f"{name}: direct fallback failed {e}")
    raise RuntimeError(f"{name}: Could not click any option after all attempts. Body: {body_text()[:800]}")

# ---- other helpers ----
def fill_rich_text_last(value): fill('locator(\'[contenteditable="true"]\').last()', str(value))
def wait_for_text(text, timeout=30000, poll=500):
    end=time.time()+timeout/1000
    while time.time()<end:
        if str(text).lower() in body_text().lower(): return True
        sleep(poll)
    return False
def parse_json(raw, fallback):
    try:
        v=json.loads(str(raw or "").strip() or "null")
        if v is None: return fallback
        if isinstance(fallback, list) and isinstance(v, dict):
            vals=list(v.values())
            return vals if vals else fallback
        return v
    except: return fallback
def read_values(m): return parse_json(eval_page(f"() => JSON.stringify(Object.fromEntries(Object.entries({json.dumps(m)}).map(([k,sel])=>{{const el=document.querySelector(sel);return [k,el?(el.value!==undefined&&el.value!==null?el.value:(el.innerText||'')):null];}}))"), {})
def switch_list():
    return parse_json(eval_page(r"""() => JSON.stringify([...document.querySelectorAll('button[role="switch"]')].map((el,i)=>{
    const parents=[]; let n=el.parentElement; for(let d=0;d<5&&n;d++){parents.push((n.innerText||'').replace(/\s+/g,' ').trim()); n=n.parentElement;}
    return {i,checked:el.getAttribute('aria-checked')==='true',label:((el.parentElement&&el.parentElement.innerText)||'').split('\n').map(s=>s.trim()).filter(Boolean)[0]||'',parents:parents.filter(Boolean)}
  }))"""), [])
def find_switch(label):
    want=str(label).lower()
    cands=[]
    for s in switch_list():
        hit=sorted([{"t":t,"len":len(t)} for t in s.get("parents",[]) if want in t.lower()], key=lambda x:x["len"])
        if hit: cands.append({**s,"parentText":hit[0]["t"]})
    return sorted(cands, key=lambda x: len(x["parentText"]))[0] if cands else None
def ensure_switch(label, desired):
    before=find_switch(label)
    if not before: raise RuntimeError(f"Switch not found: {label}")
    if before["checked"]==bool(desired):
        log_info(f'switch "{label}" already {"ON" if desired else "OFF"}'); return before
    run_code(f"async page => {{ await page.locator('button[role=\"switch\"]').nth({before['i']}).click(); return 'ok'; }}")
    sleep(500)
    after=find_switch(label)
    if not after: raise RuntimeError(f"Switch {label} disappeared")
    if after["checked"]!=bool(desired): raise RuntimeError(f"Switch {label} did not reach {'ON' if desired else 'OFF'}")
    log_info(f'switch "{label}": {"ON" if before["checked"] else "OFF"} -> {"ON" if after["checked"] else "OFF"}')
    return after
def entry_tier_snapshot():
    return parse_json(eval_page(r"""() => JSON.stringify([...document.querySelectorAll('input[name^="entryTiers"][name$=".entries"]')].map(el=>{
    const name=el.getAttribute('name')||''; const m=name.match(/tiers\.(\d+)\.entries/); const idx=m?Number(m[1]):-1; const art=el.closest('article')||document; const badge=art.querySelector('span[data-slot="badge"]'); const price=art.querySelector('input[name="entryTiers.tiers.'+idx+'.price"]'); const impact=art.querySelector('input[name="entryTiers.tiers.'+idx+'.impact"]');
    return {idx,badge:badge?(badge.innerText||'').replace(/\s+/g,' ').trim():'',locked:!!art.querySelector('svg.lucide-lock'),disabled:!!el.disabled||el.hasAttribute('readonly'),entries:el.value,price:price?price.value:'',impact:impact?impact.value:'',name}
  }))"""), [])
def review_snapshot():
    s=parse_json(eval_page(r"""() => JSON.stringify([...document.querySelectorAll('p.truncate.text-paragraph-small.font-medium')].map(h=>{
    const card=h.closest('div.overflow-hidden')||h.parentElement; if(!card) return null; const rows=[...card.querySelectorAll('dl > div')].map(d=>{const dt=d.querySelector('dt');const dd=d.querySelector('dd');return {label:dt?(dt.innerText||'').replace(/\s+/g,' ').trim():'',value:dd?(dd.innerText||'').replace(/\s+/g,' ').trim():'',images:dd?[...dd.querySelectorAll('img')].map(i=>i.getAttribute('src')||''):[]};}); const text=(card.innerText||'').replace(/\s+/g,' ').trim(); return {section:(h.innerText||'').replace(/\s+/g,' ').trim(),rows,empty:/No .* added\./i.test(text),needsAttention:/needs attention/i.test(text),text:text.slice(0,1500)};}).filter(Boolean))"""), [])
    import re
    m=re.search(r"(\d+)\s+steps?\s+need your attention", body_text(), re.I)
    return {"sections":s,"stepsNeedingAttention":int(m.group(1)) if m else 0,"attentionBanner":bool(re.search(r"needs your attention", body_text(), re.I))}
def sweeps_row_snapshot(title):
    return parse_json(eval_page(f"""() => {{
    const rows=[...document.querySelectorAll('tr')].filter(tr=>(tr.innerText||'').includes({json.dumps(title)}));
    if(!rows.length) return JSON.stringify({{found:false}});
    const tr=rows[0]; const cells=[...tr.querySelectorAll('td')].map(td=>(td.innerText||'').replace(/\\s+/g,' ').trim());
    const link=tr.querySelector('a[aria-label="Sweeps link"]'); const free=tr.querySelector('a[aria-label="Free entry link"]'); const track=tr.querySelector('a[aria-label="Tracking link"]'); const titleEl=tr.querySelector('td p[title]');
    return JSON.stringify({{found:true,titleCell:titleEl?(titleEl.getAttribute('title')||'').trim():(cells[0]||''),cells,text:(tr.innerText||'').replace(/\\s+/g,' ').trim(),sweepsLink:link?link.href:'',freeEntryLink:free?free.href:'',trackingLink:track?track.href:''}});
  }}"""), {"found":False})
# network etc minimal for python - keep stub
def network_mark(options=None): return 0
def network_since(mark, options=None): return []
def network_summary(entries): return []
def request_details(idx): return ""