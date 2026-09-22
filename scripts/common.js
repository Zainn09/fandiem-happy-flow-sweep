const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const resultsDir = path.join(ROOT, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

function getCliRunner() {
  const cliJs = path.join(ROOT, 'node_modules', '@playwright', 'cli', 'playwright-cli.js');
  if (fs.existsSync(cliJs)) {
    return { command: process.execPath, prefixArgs: [cliJs], shell: false };
  }
  const localName = process.platform === 'win32' ? 'playwright-cli.cmd' : 'playwright-cli';
  const local = path.join(ROOT, 'node_modules', '.bin', localName);
  const command = fs.existsSync(local) ? local : localName;
  return { command, prefixArgs: [], shell: process.platform === 'win32' };
}

function cli(args, { raw = false, allowFailure = false } = {}) {
  const finalArgs = [];
  if (config.sessionName) finalArgs.push(`--session=${config.sessionName}`);
  if (raw) finalArgs.push('--raw');
  finalArgs.push(...args);

  const runner = getCliRunner();
  const result = spawnSync(runner.command, [...runner.prefixArgs, ...finalArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: false,
    shell: runner.shell,
    maxBuffer: 30 * 1024 * 1024
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.error) {
    throw new Error(`playwright-cli spawn error: ${result.error.message}\nCommand: ${runner.command}`);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`playwright-cli failed (exit ${result.status})\nARGS: ${JSON.stringify(args)}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
  return { code: result.status ?? 0, stdout, stderr };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function writeJson(name, data) {
  const file = path.join(resultsDir, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
function env(name, fallback) { return process.env[name] !== undefined ? process.env[name] : fallback; }
function stampNow() { return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }
function logInfo(msg) { console.log(`  [info] ${msg}`); }
function logWarn(msg) { console.warn(`  [warn] ${msg}`); }

function locator(kind, value, options = {}) {
  if (kind === 'role') {
    const opts = safeJoin(Object.entries(options).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), ', ');
    return `getByRole(${JSON.stringify(value)}${opts ? `, { ${opts} }` : ''})`;
  }
  if (kind === 'label') return `getByLabel(${JSON.stringify(value)})`;
  if (kind === 'text') return `getByText(${JSON.stringify(value)}, { exact: true })`;
  if (kind === 'placeholder') return `getByPlaceholder(${JSON.stringify(value)})`;
  if (kind === 'css') return `locator(${JSON.stringify(value)})`;
  throw new Error(`Unknown locator kind: ${kind}`);
}

function click(target) { cli(['click', target]); }
function fill(target, value) { cli(['fill', target, String(value)]); }
function press(key) { cli(['press', key]); }
function goto(url) { cli(['goto', url]); }
function screenshot(filename) { cli(['screenshot', `--filename=${filename}`], { allowFailure: true }); }
function evalPage(expression) { return cli(['eval', expression], { raw: true }).stdout.trim(); }
function runCode(code) { return cli(['run-code', code], { raw: true }).stdout.trim(); }
function tabNew(url) { return url ? cli(['tab-new', url]).stdout : cli(['tab-new']).stdout; }
function tabList() { return cli(['tab-list']).stdout; }

function bodyText() { return evalPage('() => (document.body ? document.body.innerText : "")'); }
function currentUrl() { return evalPage('() => location.href'); }

function assertContains(text, value, label) {
  if (!String(text).toLowerCase().includes(String(value).toLowerCase())) {
    throw new Error(`${label}: expected to find ${JSON.stringify(value)}`);
  }
}
function assertAbsent(text, value, label) {
  if (String(text).toLowerCase().includes(String(value).toLowerCase())) {
    throw new Error(`${label}: unexpected text ${JSON.stringify(value)}`);
  }
}
function heading(name) { assertContains(bodyText(), name, 'Screen'); }

function resolveAsset(relPath) {
  const abs = path.resolve(ROOT, relPath);
  if (!fs.existsSync(abs)) throw new Error(`Asset not found: ${relPath} (resolved ${abs})`);
  return abs;
}
function resolveAssets(list) { return (list || []).map(resolveAsset); }

// ---- per-day run counter + title: PREFIX-YYYYMMDD-NNN ----
function nextDailyRunNumber() {
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const file = path.join(resultsDir, `run-counter-${yyyymmdd}.json`);
  let n = 0;
  try {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    n = Number(prev.count || 0);
  } catch (_) { /* first run of the day */ }
  n += 1;
  fs.writeFileSync(file, JSON.stringify({ date: yyyymmdd, count: n }, null, 2));
  return { yyyymmdd, n };
}

function buildSweepTitle() {
  const override = process.env.SWEEP_TITLE;
  if (override && override.trim()) return override.trim();
  const { yyyymmdd, n } = nextDailyRunNumber();
  return `${config.sweepTitlePrefix}-${yyyymmdd}-${String(n).padStart(3, '0')}`;
}

// ---- uploads: 3 strategies ----
function listFileInputs() {
  try {
<<<<<<< HEAD
    const raw = evalPage(`() => JSON.stringify([...document.querySelectorAll('input[type="file"]')].map((el, i) => ({
      index: i,
      accept: el.getAttribute('accept') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      multiple: !!el.multiple,
      visible: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()
    })))`);
    const parsed = JSON.parse(raw || '[]');
    // Ensure always array - fix for inputs.map is not a function
=======
    // Try multiple selectors and wait a bit for inputs to appear
    const raw = evalPage(`() => {
      const selectors = [
        'input[type="file"]',
        'input[type=file]',
        'input[accept*="image"]',
        'input[accept*="video"]',
        'input.hidden',
        '[data-testid="file-input"]'
      ];
      let all = [];
      for (const sel of selectors) {
        try {
          const els = [...document.querySelectorAll(sel)];
          for (const el of els) {
            if (!all.find(x => x.el === el)) all.push({ el, sel });
          }
        } catch (_) {}
      }
      return JSON.stringify(all.map(({el, sel}, i) => ({
        index: i,
        accept: el.getAttribute('accept') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        multiple: !!el.multiple,
        visible: (() => { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch(_) { return false; } })(),
        selector: sel
      })));
    }`);
    const parsed = JSON.parse(raw || '[]');
>>>>>>> efa86e92dfe49b04b7204fc84a410152fa21a309
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const vals = Object.values(parsed);
      if (vals.length && typeof vals[0] === 'object') return vals;
    }
    return [];
  } catch (e) {
    try { logWarn(`listFileInputs failed: ${e.message}, returning []`); } catch(_) {}
    return [];
  }
}

<<<<<<< HEAD
=======
// Removed waitForFileInputs with busy loop - use sleep in run.js loops instead

>>>>>>> efa86e92dfe49b04b7204fc84a410152fa21a309

function dropFiles(target, absPaths) {
  try {
    // Verify files exist
    for (const p of absPaths) {
      if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
    }
    return cli(['drop', target, ...absPaths.map(p => `--path=${p}`)]);
  } catch (e) {
    // Try with allowFailure to get more info
    try {
      const res = cli(['drop', target, ...absPaths.map(p => `--path=${p}`)], { allowFailure: true });
      if (res.code !== 0) {
        throw new Error(`drop failed: ${res.stderr.slice(0,300) || res.stdout.slice(0,300)}`);
      }
      return res;
    } catch (e2) {
      throw e2;
    }
  }
}

function uploadFiles(absPaths) {
  try {
    for (const p of absPaths) {
      if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
    }
    return cli(['upload', ...absPaths]);
  } catch (e) {
    try {
      const res = cli(['upload', ...absPaths], { allowFailure: true });
      if (res.code !== 0) {
        throw new Error(`upload failed: ${res.stderr.slice(0,300) || res.stdout.slice(0,300)}`);
      }
      return res;
    } catch (e2) {
      throw e2;
    }
  }
}

function setInputFiles(css, absPaths) {
  try {
    for (const p of absPaths) {
      if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
    }
    const code = `async page => { await page.locator(${JSON.stringify(css)}).first().setInputFiles(${JSON.stringify(absPaths)}); return 'ok'; }`;
    return runCode(code);
  } catch (e) {
    throw new Error(`setInputFiles ${css} failed: ${e.message}`);
  }
}

/**
 * Robust file upload with fallbacks. Records which strategy worked.
 * Order: (1) drop onto target, (2) setInputFiles on hidden input, (3) click target + upload.
 * Returns { strategy, target, files } or throws with combined error detail.
 */
async function robustUpload({ target, clickTarget, fileInputCss, absPaths, verify }) {
  const errors = [];
  // Strategy 1: drop
  try {
    logInfo(`upload strategy=drop target=${target} files=${safeJoin(absPaths.map(p => path.basename(p)), ',')}`);
    dropFiles(target, absPaths);
    await sleep(1500);
    if (!verify || (await verify())) return { strategy: 'drop', target, files: absPaths.slice() };
    errors.push('drop: verify failed (no new media detected)');
  } catch (e) { errors.push(`drop: ${e.message.split('\n')[0]}`); }

  // Strategy 2: setInputFiles directly on hidden input
  if (fileInputCss) {
    try {
      logInfo(`upload strategy=setInputFiles css=${fileInputCss}`);
      setInputFiles(fileInputCss, absPaths);
      await sleep(1500);
      if (!verify || (await verify())) return { strategy: 'setInputFiles', target: fileInputCss, files: absPaths.slice() };
      errors.push('setInputFiles: verify failed (no new media detected)');
    } catch (e) { errors.push(`setInputFiles: ${e.message.split('\n')[0]}`); }
  }

  // Strategy 3: click to open chooser, then upload
  try {
    logInfo(`upload strategy=click+upload clickTarget=${clickTarget || target}`);
    cli(['click', clickTarget || target], { allowFailure: false });
    await sleep(800);
    uploadFiles(absPaths);
    await sleep(1500);
    if (!verify || (await verify())) return { strategy: 'click+upload', target: clickTarget || target, files: absPaths.slice() };
    errors.push('click+upload: verify failed (no new media detected)');
  } catch (e) { errors.push(`click+upload: ${e.message.split('\n')[0]}`); }

  throw new Error(`All upload strategies failed for [${safeJoin(absPaths.map(p => path.basename(p)), ', ')}]:\n- ${safeJoin(errors, '\n- ')}`);
}

function captureVisibleErrors() {
  try {
    const raw = evalPage(`() => JSON.stringify([...document.querySelectorAll('[role="alert"], p[class*="red"], span[class*="red"], div[class*="red"], [class*="text-red"], [class*="error"]')].map(e => (e.innerText || '').trim()).filter(t => t && /required|invalid|failed|error|attention|must|missing|least one/i.test(t)).slice(0, 20))`);
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const vals = Object.values(parsed);
      // filter to strings
      return vals.filter(v => typeof v === 'string');
    }
    return [];
  } catch (e) {
    try { logWarn(`captureVisibleErrors failed: ${e.message}, returning []`); } catch(_) {}
    return [];
  }
}

function safeJoin(arr, sep=' | ') {
  try {
    if (Array.isArray(arr)) return arr.join(sep);
    if (arr && typeof arr === 'object') {
      const vals = Object.values(arr).filter(v=>typeof v==='string');
      return vals.join(sep);
    }
    return String(arr||'');
  } catch (_) { return ''; }
}

function galleryItemsText() {
  return evalPage(`() => { const m = (document.body.innerText || '').match(/(\\d+)\\s+items?/i); return m ? m[0] : ''; }`);
}

function galleryTileCount() {
  const raw = evalPage(`() => String(document.querySelectorAll('img[src*="blob:"], img[src*="cloudinary"], img[src*="amazonaws"], video').length)`);
  return Number(String(raw).replace(/[^0-9]/g, '')) || 0;
}

function listComboboxOptions() {
  try {
    const raw = evalPage(`() => JSON.stringify([...document.querySelectorAll(${JSON.stringify(OPTION_SELECTOR)})].map(e => ({ text: (e.innerText || '').trim().slice(0, 160), html: e.innerHTML.trim().slice(0, 400) })).filter(o => o.text).slice(0, 40))`);
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return Object.values(parsed);
    return [];
  } catch (_) { return []; }
}

const OPTION_SELECTOR = '[role="option"], [role="menuitemcheckbox"], [role="menuitem"][data-value], [data-slot="select-item"], [data-radix-collection-item]';

function comboNorm(value) {
  return String(value === undefined || value === null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Best-effort index of `wanted` inside an option list: exact, then contains, then reverse-contains. */
function matchOptionIndex(options, wanted) {
  if (!wanted || !String(wanted).trim()) return 0;
  const w = comboNorm(wanted);
  let idx = options.findIndex(o => comboNorm(o.text) === w);
  if (idx === -1) idx = options.findIndex(o => comboNorm(o.text).includes(w));
  if (idx === -1) idx = options.findIndex(o => w.includes(comboNorm(o.text)) && comboNorm(o.text).length > 2);
  return idx;
}

/** Type into the popup's filter input (cmdk / Radix combobox search), if one exists. */
function fillPopupSearch(text) {
  const code = `async page => {
    const visible = el => !!el && el.offsetParent !== null && !el.readOnly && !el.disabled;
    const pick = () => {
      const first = [...document.querySelectorAll('input[cmdk-input], input[placeholder*="Search" i], input[placeholder*="search" i]')].find(visible);
      if (first) return first;
      const boxes = [...document.querySelectorAll('input')].filter(el => visible(el) && (el.type === 'text' || el.type === '' || el.type === 'search'));
      return boxes[boxes.length - 1] || null;
    };
    const el = pick();
    if (!el) return 'no-input';
    await el.click();
    await el.fill(${JSON.stringify(String(text))});
    return 'ok';
  }`;
  return runCode(code);
}

async function selectCombobox({ comboboxTarget, preferredName, label }) {
  click(comboboxTarget);
  await sleep(1200);
  const name = label || 'Combobox';
  const want = preferredName ? String(preferredName).trim() : '';
  let options = [];
  let attempts = 0;
  
  // Try multiple times with increasing wait
  while (attempts < 5) {
    await sleep(500 + attempts * 300);
    options = listComboboxOptions();
    if (options.length) break;
    attempts++;
    logInfo(`${name}: waiting for options... attempt ${attempts}, found ${options.length}`);
  }
  
  let idx = options.length ? matchOptionIndex(options, want) : -1;
  let filteredBy = '';

  if (idx === -1 && options.length === 0) {
    // Try JS to detect options in portal
    try {
      const portalCheck = evalPage(`() => {
        const selectors = ['[role="option"]', '[data-slot="select-item"]', '[role="menuitemcheckbox"]', '[data-radix-collection-item]', '.select-item', '[data-value]'];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length) return JSON.stringify({ sel, count: els.length, texts: [...els].slice(0,3).map(e=>e.innerText.slice(0,50)) });
        }
        return JSON.stringify({ count: 0 });
      }`);
      logInfo(`${name}: portal check: ${portalCheck}`);
    } catch (_) {}
  }

  if (idx === -1) {
    // Radix/cmdk lists only render options once you type, so retry with progressively shorter queries.
    const queries = [want, want.split(/\s+/)[0], want.slice(0, Math.max(3, Math.ceil(want.length / 2)))].filter((q, i, arr) => q && arr.indexOf(q) === i);
    for (const q of queries) {
      if (!q) continue;
      const fillRes = String(fillPopupSearch(q));
      logInfo(`${name}: tried search "${q}" -> ${fillRes}`);
      if (!fillRes.includes('ok')) {
        // Try typing directly
        try {
          runCode(`async page => {
            const inputs = [...document.querySelectorAll('input')];
            const search = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('search')) || inputs[inputs.length-1];
            if (search) { await search.fill(${JSON.stringify(q)}); return 'ok'; }
            return 'no-search';
          }`);
        } catch (_) {}
      }
      await sleep(1000);
      options = listComboboxOptions();
      idx = options.length ? matchOptionIndex(options, want) : -1;
      if (idx !== -1) { filteredBy = q; break; }
      if (options.length && !want) { idx = 0; filteredBy = q; break; } // If no preferred, take first
    }
  }

  // If still no options, try one more time with empty search (show all)
  if (!options.length) {
    await sleep(500);
    options = listComboboxOptions();
  }

  if (!options.length) {
    // Try to get any visible options via JS
    try {
      const jsOpts = evalPage(`() => {
        const all = [...document.querySelectorAll('[role="option"], [data-slot="select-item"], [role="menuitemcheckbox"], [data-radix-collection-item], [data-value]')];
        return JSON.stringify(all.map(e => ({ text: (e.innerText||'').trim().slice(0,100) })).filter(o=>o.text).slice(0,10));
      }`);
      const parsed = JSON.parse(jsOpts || '[]');
      if (Array.isArray(parsed) && parsed.length) {
        options = parsed.map(o => ({ text: o.text, html: '' }));
        idx = 0;
        logInfo(`${name}: recovered ${options.length} options via JS`);
      }
    } catch (_) {}
  }

  if (!options.length) {
    const snapshot = cli(['snapshot'], { allowFailure: true }).stdout || '';
    const body = bodyText().slice(0, 1000);
    throw new Error(`${name}: dropdown opened but no options detected (tried search: ${want || 'n/a'}). Body has: ${body.slice(0,500)}. Snapshot head: ${snapshot.slice(0, 400)}`);
  }
  
  if (idx === -1) {
    // If preferred not found, take first available
    if (!want || want.trim() === '') {
      idx = 0;
    } else {
      logWarn(`${name}: preferred ${JSON.stringify(preferredName)} not found in [${safeJoin(options.map(o => JSON.stringify(o.text)), ', ')}], taking first`);
      idx = 0;
    }
  }

  const chosen = options[idx];
  
  // Try multiple ways to click
  let clicked = false;
  try {
    const res = runCode(`async page => { 
      try {
        await page.locator(${JSON.stringify(OPTION_SELECTOR)}).nth(${idx}).click(); 
        return 'ok';
      } catch(e) {
        // Try clicking via text
        const els = [...document.querySelectorAll(${JSON.stringify(OPTION_SELECTOR)})];
        if (els[${idx}]) { els[${idx}].click(); return 'ok-js'; }
        return 'fail:'+e.message;
      }
    }`);
    if (String(res).includes('ok')) clicked = true;
    logInfo(`${name}: click result ${res}`);
  } catch (e) {
    logWarn(`${name}: click failed ${e.message}, trying fallback`);
    try {
      runCode(`async page => {
        const els = [...document.querySelectorAll('[role="option"], [data-slot="select-item"]')];
        if (els[${idx}]) els[${idx}].click();
        return 'ok';
      }`);
      clicked = true;
    } catch (_) {}
  }
  
  await sleep(800);
  logInfo(`${name} selected [${idx}]${filteredBy ? ` (filtered by ${JSON.stringify(filteredBy)})` : ''}: ${chosen.text}`);
  return { index: idx, text: chosen.text, innerHTML: chosen.html || '', optionsCount: options.length, options: options.map(o => o.text), filteredBy };
}

function fillRichTextLast(value) {
  fill('locator(\'[contenteditable="true"]\').last()', String(value));
}

function fillRichTextByPlaceholder(placeholder, value) {
  // TipTap placeholder elements expose data-placeholder on the editable node.
  const css = `[data-placeholder=${JSON.stringify(placeholder)}]`;
  try {
    fill(`locator(${JSON.stringify(css)})`, String(value));
  } catch (_) {
    // Fallback: click then type
    cli(['click', `locator(${JSON.stringify(css)})`]);
    cli(['type', String(value)]);
  }
}

async function waitForText(text, timeoutMs = 30000, pollMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (bodyText().toLowerCase().includes(String(text).toLowerCase())) return true;
    await sleep(pollMs);
  }
  return false;
}

// ---------------------------------------------------------------- network --
// `playwright-cli requests` renders one line per request: `12. [POST] https://host/path => [200] OK`
function parseRequestLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\.\s+\[([A-Z]+)\]\s+(\S+?)(?:\s+=>\s+\[(\d+|FAILED)\]\s*(.*?))?\s*$/);
    if (!m) continue;
    out.push({
      index: Number(m[1]),
      method: m[2],
      url: m[3],
      status: m[4] === 'FAILED' ? -1 : (m[4] ? Number(m[4]) : null),
      statusText: clean(m[5] || ''),
      line: line.trim()
    });
  }
  return out;
}

function networkList({ filter, includeStatic = false } = {}) {
  const args = ['requests'];
  if (includeStatic) args.push('--static');
  if (filter) args.push(`--filter=${filter}`);
  const res = cli(args, { raw: true, allowFailure: true });
  return parseRequestLines(res.stdout);
}

function networkMark(options) {
  const list = networkList(options);
  return list.length ? Math.max(...list.map(r => r.index)) : 0;
}

function networkSince(mark, options = {}) {
  return networkList(options).filter(r => r.index > mark);
}

function requestDetails(index) {
  const res = cli(['request', String(index)], { raw: true, allowFailure: true });
  return String(res.stdout || '').trim();
}

function networkSummary(entries) {
  return entries.map(e => `${e.index}. [${e.method}] ${e.url.slice(0, 180)} => ${e.status === -1 ? 'FAILED' : (e.status === null ? 'no-response' : e.status)} ${e.statusText}`.trim());
}

// ------------------------------------------------------------- page state --
function parseJson(raw, fallback) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!text) return fallback;
  try {
    const value = JSON.parse(text);
    if (value === null || value === undefined) return fallback;
    // If fallback is array but value is object with numeric keys, coerce to array
    if (Array.isArray(fallback) && !Array.isArray(value) && typeof value === 'object') {
      const vals = Object.values(value);
      // If vals look like the expected type, return them, else fallback
      if (vals.length === 0) return fallback;
      return vals;
    }
    return value;
  } catch (_) {
    return fallback;
  }
}

function readValues(map) {
  const expr = `() => JSON.stringify(Object.fromEntries(Object.entries(${JSON.stringify(map)}).map(([k, sel]) => { const el = document.querySelector(sel); return [k, el ? (el.value !== undefined && el.value !== null ? el.value : (el.innerText || '')) : null]; })))`;
  return parseJson(evalPage(expr), {});
}

// Switches: button[role="switch"] with its label text living in an ancestor block.
function switchList() {
  const expr = String.raw`() => JSON.stringify([...document.querySelectorAll('button[role="switch"]')].map((el, i) => {
    const parents = [];
    let node = el.parentElement;
    for (let depth = 0; depth < 5 && node; depth++) {
      parents.push((node.innerText || '').replace(/\s+/g, ' ').trim());
      node = node.parentElement;
    }
    return {
      i,
      checked: el.getAttribute('aria-checked') === 'true',
      label: ((el.parentElement && el.parentElement.innerText) || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '',
      parents: parents.filter(Boolean)
    };
  }))`;
  return parseJson(evalPage(expr), []);
}

function findSwitch(label) {
  const want = String(label).toLowerCase();
  const cands = switchList().map(s => {
    const hit = s.parents.map(t => ({ t, len: t.length })).filter(x => x.t.toLowerCase().includes(want)).sort((a, b) => a.len - b.len)[0];
    return hit ? { ...s, parentText: hit.t } : null;
  }).filter(Boolean).sort((a, b) => a.parentText.length - b.parentText.length);
  return cands[0] || null;
}

async function ensureSwitch(label, desired) {
  const before = findSwitch(label);
  if (!before) throw new Error(`Switch not found: ${label}`);
  if (before.checked === !!desired) {
    logInfo(`switch "${label}" already ${desired ? 'ON' : 'OFF'}`);
    return before;
  }
  runCode(`async page => { await page.locator('button[role="switch"]').nth(${before.i}).click(); return 'ok'; }`);
  await sleep(500);
  const after = findSwitch(label);
  if (!after) throw new Error(`Switch "${label}" disappeared after toggling.`);
  if (after.checked !== !!desired) throw new Error(`Switch "${label}" did not reach ${desired ? 'ON' : 'OFF'} (still ${after.checked}).`);
  logInfo(`switch "${label}": ${before.checked ? 'ON' : 'OFF'} -> ${after.checked ? 'ON' : 'OFF'}`);
  return after;
}

function entryTierSnapshot() {
  const expr = String.raw`() => JSON.stringify([...document.querySelectorAll('input[name^="entryTiers"][name$=".entries"]')].map(el => {
    const name = el.getAttribute('name') || '';
    const m = name.match(/tiers\.(\d+)\.entries/);
    const idx = m ? Number(m[1]) : -1;
    const art = el.closest('article') || document;
    const badge = art.querySelector('span[data-slot="badge"]');
    const price = art.querySelector('input[name="entryTiers.tiers.' + idx + '.price"]');
    const impact = art.querySelector('input[name="entryTiers.tiers.' + idx + '.impact"]');
    return {
      idx,
      badge: badge ? (badge.innerText || '').replace(/\s+/g, ' ').trim() : '',
      locked: !!art.querySelector('svg.lucide-lock'),
      disabled: !!el.disabled || el.hasAttribute('readonly'),
      entries: el.value,
      price: price ? price.value : '',
      impact: impact ? impact.value : '',
      name
    };
  }))`;
  return parseJson(evalPage(expr), []);
}

// Review & Submit: section cards -> { section: { label: value } } plus media thumbnails.
function reviewSnapshot() {
  const expr = String.raw`() => JSON.stringify([...document.querySelectorAll('p.truncate.text-paragraph-small.font-medium')].map(h => {
    const card = h.closest('div.overflow-hidden') || h.parentElement;
    if (!card) return null;
    const rows = [...card.querySelectorAll('dl > div')].map(d => {
      const dt = d.querySelector('dt');
      const dd = d.querySelector('dd');
      return {
        label: dt ? (dt.innerText || '').replace(/\s+/g, ' ').trim() : '',
        value: dd ? (dd.innerText || '').replace(/\s+/g, ' ').trim() : '',
        images: dd ? [...dd.querySelectorAll('img')].map(i => i.getAttribute('src') || '') : []
      };
    });
    const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
    const m = text.match(/(\d+)\s+steps?\s+need/i);
    return {
      section: (h.innerText || '').replace(/\s+/g, ' ').trim(),
      rows,
      empty: /No .* added\./i.test(text),
      needsAttention: /needs attention/i.test(text),
      text: text.slice(0, 1500)
    };
  }).filter(Boolean))`;
  const sections = parseJson(evalPage(expr), []);
  const attentionCount = (bodyText().match(/(\d+)\s+steps?\s+need your attention/i) || [])[1] || '';
  return {
    sections,
    stepsNeedingAttention: attentionCount ? Number(attentionCount) : 0,
    attentionBanner: /needs your attention/i.test(bodyText())
  };
}

function sweepsRowSnapshot(title) {
  const expr = `() => {
    const rows = [...document.querySelectorAll('tr')].filter(tr => (tr.innerText || '').includes(${JSON.stringify(title)}));
    if (!rows.length) return JSON.stringify({ found: false });
    const tr = rows[0];
    const cells = [...tr.querySelectorAll('td')].map(td => (td.innerText || '').replace(/\\s+/g, ' ').trim());
    const link = tr.querySelector('a[aria-label="Sweeps link"]');
    const freeLink = tr.querySelector('a[aria-label="Free entry link"]');
    const trackLink = tr.querySelector('a[aria-label="Tracking link"]');
    const titleEl = tr.querySelector('td p[title]');
    return JSON.stringify({
      found: true,
      titleCell: titleEl ? (titleEl.getAttribute('title') || '').trim() : (cells[0] || ''),
      cells,
      text: (tr.innerText || '').replace(/\\s+/g, ' ').trim(),
      sweepsLink: link ? link.href : '',
      freeEntryLink: freeLink ? freeLink.href : '',
      trackingLink: trackLink ? trackLink.href : ''
    });
  }`;
  return parseJson(evalPage(expr), { found: false });
}

function cartState() {
  const code = `async page => {
    const raw = await page.evaluate(async () => {
      try {
        const res = await fetch('/cart.js', { cache: 'no-store' });
        const j = await res.json();
        return {
          ok: true,
          item_count: j.item_count,
          total_price: j.total_price,
          currency: j.currency,
          items: (j.items || []).map(it => ({ key: it.key, title: it.title, price: it.price, quantity: it.quantity, variant_id: it.variant_id }))
        };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    });
    return JSON.stringify(raw);
  }`;
  const out = runCode(code);
  const state = parseJson(out, null);
  return state && state.ok ? state : null;
}

function storefrontSnapshot() {
  const expr = String.raw`() => {
    const txt = (document.body.innerText || '');
    const entries = [...document.querySelectorAll('form[action="/cart"]')].map(f => {
      const holder = f.parentElement || f;
      const label = holder.querySelector('span');
      const price = f.querySelector('.product-price');
      const hidden = f.querySelector('input[name="cartFormInput"]');
      let variant = '';
      try { variant = (JSON.parse(hidden.value).inputs.lines[0].merchandiseId || '').split('/').pop(); } catch (e) {}
      return {
        entries: label ? (label.innerText || '').replace(/\s+/g, ' ').trim() : '',
        price: price ? (price.innerText || '').replace(/\s+/g, ' ').trim() : '',
        variant
      };
    });
    const media = [...document.querySelectorAll('img')].map(i => ({ src: i.currentSrc || i.src || '', cls: i.className || '' }));
    const hero = media.filter(m => /aspect-square/.test(m.cls)).map(m => m.src);
    const thumbs = [...document.querySelectorAll('.swiper-slide img')].map(i => i.currentSrc || i.src || '');
    const partnerLinks = [...document.querySelectorAll('a[href^="/partners/"]')].map(a => ({ href: a.getAttribute('href'), text: (a.innerText || '').replace(/\s+/g, ' ').trim() }));
    const info = {};
    for (const div of document.querySelectorAll('div.nowrap-md')) {
      const t = (div.innerText || '').replace(/\s+/g, ' ').trim();
      const m = t.match(/^([A-Z][A-Z()\/ .-]*[A-Z)]):\s*([\s\S]*)$/);
      if (m) info[m[1].trim()] = m[2].trim();
    }
    return JSON.stringify({
      url: location.href,
      title: (document.querySelector('h1') ? document.querySelector('h1').innerText : '').trim(),
      ends: (txt.match(/ENDS:\s*([0-9\/]+)/) || [])[1] || '',
      badges: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(t => /^(Live|Coming Soon|Ended)$/i.test(t)),
      hasEnterNow: /Enter Now/i.test(txt),
      tabs: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(t => /^(Prize Details|Description)$/.test(t)),
      entries,
      media: { hero, thumbs, all: media.map(m => m.src) },
      partnerLinks,
      info,
      disclaimer: /NO PURCHASE OR DONATION IS NECESSARY TO ENTER TO WIN/i.test(txt),
      descriptionVisible: /Describe|Happy case|Automated/i.test(txt),
      text: txt.slice(0, 6000)
    });
  }`;
  return parseJson(evalPage(expr), null);
}

function normalizeCdnKey(url) {
  const noQuery = String(url || '').split('?')[0];
  const base = noQuery.split('/').pop() || '';
  return base.replace(/_\d+x(?=\.[a-z0-9]+$)/i, '');
}

// ------------------------------------------------------------- form filling --
function fillTextareaByPlaceholder(placeholders, value) {
  const list = Array.isArray(placeholders) ? placeholders : [placeholders];
  const tried = [];
  const modalSelectors = ['[data-qa-modal="1"]', '[role="dialog"]', '[data-slot="dialog-content"]', ''];
  for (const modalSel of modalSelectors) {
    for (const p of list) {
      const css = modalSel ? `${modalSel} textarea[placeholder=${JSON.stringify(p)}]` : `textarea[placeholder=${JSON.stringify(p)}]`;
      const r = cli(['fill', `locator(${JSON.stringify(css)})`, String(value)], { allowFailure: true });
      if (r.code === 0) {
        logInfo(`filled textarea ${modalSel ? '(modal) ' : ''}placeholder=${JSON.stringify(p)}`);
        return p;
      }
      tried.push(`${modalSel||'global'}:${p}`);
    }
  }
  // Fallback: any textarea inside modal
  for (const modalSel of ['[data-qa-modal="1"]', '[role="dialog"]']) {
    const r = cli(['fill', `locator('${modalSel} textarea')`, String(value)], { allowFailure: true });
    if (r.code === 0) {
      logInfo(`filled textarea via ${modalSel} textarea fallback`);
      return '(modal textarea)';
    }
  }
  throw new Error(`No textarea matched placeholders ${JSON.stringify(tried)}`);
}

function fillRichTextAny(placeholders, value) {
  const list = (Array.isArray(placeholders) ? placeholders : [placeholders]).filter(Boolean);
  const modalSelectors = [
    '[data-qa-modal="1"]',
    '[role="dialog"]',
    '[data-slot="dialog-content"]'
  ];
  // Try modal-scoped first (critical for Prize Details fix)
  for (const modalSel of modalSelectors) {
    for (const p of list) {
      const css = `${modalSel} [data-placeholder=${JSON.stringify(p)}]`;
      const r = cli(['fill', `locator(${JSON.stringify(css)})`, String(value)], { allowFailure: true });
      if (r.code === 0) {
        logInfo(`filled rich text (modal ${modalSel}) data-placeholder=${JSON.stringify(p)}`);
        return p;
      }
    }
    // also try any contenteditable inside modal without placeholder filter
    const rAny = cli(['fill', `locator('${modalSel} [contenteditable="true"]')`, String(value)], { allowFailure: true });
    if (rAny.code === 0) {
      logInfo(`filled rich text via modal ${modalSel} [contenteditable]`);
      return '(modal contenteditable)';
    }
  }
  // Global placeholders
  for (const p of list) {
    const css = `[data-placeholder=${JSON.stringify(p)}]`;
    const r = cli(['fill', `locator(${JSON.stringify(css)})`, String(value)], { allowFailure: true });
    if (r.code === 0) {
      logInfo(`filled rich text data-placeholder=${JSON.stringify(p)}`);
      return p;
    }
    const r2 = cli(['click', `locator(${JSON.stringify(css)})`], { allowFailure: true });
    if (r2.code === 0) {
      cli(['type', String(value)], { allowFailure: true });
      logInfo(`typed rich text data-placeholder=${JSON.stringify(p)}`);
      return p;
    }
  }
  // JS fallback: execCommand inside modal or last contenteditable
  try {
    const jsRes = runCode(`async page => {
      const val = ${JSON.stringify(String(value))};
      const modals = [document.querySelector('[data-qa-modal="1"]'), document.querySelector('[role="dialog"]'), document.querySelector('[data-slot="dialog-content"]')].filter(Boolean);
      for (const modal of modals) {
        const el = modal.querySelector('[contenteditable="true"]');
        if (el) {
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, val);
          if (!el.innerText.includes(val.slice(0,10))) { el.innerText = val; el.dispatchEvent(new Event('input',{bubbles:true})); }
          return 'ok:modal:' + el.innerText.slice(0,30);
        }
      }
      const last = [...document.querySelectorAll('[contenteditable="true"]')].pop();
      if (last) {
        last.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, val);
        return 'ok:last:' + last.innerText.slice(0,30);
      }
      return 'no-editable';
    }`);
    if (String(jsRes).startsWith('ok')) {
      logInfo(`filled rich text via JS: ${jsRes}`);
      return '(js ' + jsRes + ')';
    }
  } catch (e) {
    logWarn(`JS rich text fallback failed: ${e.message}`);
  }
  fillRichTextLast(value);
  logInfo('filled rich text via last contenteditable fallback');
  return '(last contenteditable)';
}

function listMenuOptions() {
  try {
    const expr = String.raw`() => JSON.stringify([...document.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="option"], [data-slot="dropdown-menu-item"], [data-slot="select-item"]')].map((el, i) => ({
    i,
    text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
    disabled: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled') || el.hasAttribute('disabled') || /pointer-events-none|opacity-50/.test(el.className || '')
  })).filter(o => o.text))`;
    const raw = evalPage(expr);
    const parsed = parseJson(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

async function selectMenuOption({ triggerTarget, preferredText, label }) {
  click(triggerTarget);
  await sleep(800);
  const options = listMenuOptions();
  if (!options.length) throw new Error(`${label}: menu opened but no options detected.`);
  let idx = -1;
  if (preferredText && String(preferredText).trim()) {
    const want = String(preferredText).trim().toLowerCase();
    idx = options.findIndex(o => !o.disabled && (o.text.toLowerCase() === want || o.text.toLowerCase().includes(want)));
  }
  if (idx === -1) idx = options.findIndex(o => !o.disabled);
  if (idx === -1) throw new Error(`${label}: no enabled options (found ${safeJoin(options.map(o => JSON.stringify(o.text)), ', ')})`);
  runCode(`async page => { await page.locator('[role="menuitemcheckbox"], [role="menuitem"], [role="option"], [data-slot="dropdown-menu-item"], [data-slot="select-item"]').nth(${idx}).click(); return 'ok'; }`);
  await sleep(600);
  logInfo(`${label}: selected option [${idx}] ${options[idx].text}`);
  return { index: idx, text: options[idx].text, options: options.map(o => ({ text: o.text, disabled: o.disabled })) };
}

module.exports = {
  ROOT, config, resultsDir, cli, sleep, clean, writeJson, env, stampNow,
  logInfo, logWarn,
  locator, click, fill, press, goto, screenshot, evalPage, runCode,
  tabNew, tabList,
  bodyText, currentUrl, assertContains, assertAbsent, heading,
  resolveAsset, resolveAssets,
  nextDailyRunNumber, buildSweepTitle,
  listFileInputs, dropFiles, uploadFiles, setInputFiles, robustUpload,
  captureVisibleErrors, safeJoin, galleryItemsText, galleryTileCount,
  listComboboxOptions, selectCombobox,
  fillRichTextLast, fillRichTextByPlaceholder, waitForText,
  parseRequestLines, networkList, networkMark, networkSince, requestDetails, networkSummary,
  comboNorm, parseJson, readValues, switchList, findSwitch, ensureSwitch,
  entryTierSnapshot, reviewSnapshot, sweepsRowSnapshot, cartState, storefrontSnapshot,
  normalizeCdnKey, fillTextareaByPlaceholder, fillRichTextAny, listMenuOptions, selectMenuOption
};
