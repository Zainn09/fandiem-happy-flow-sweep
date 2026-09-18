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
    const opts = Object.entries(options).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
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
  const raw = evalPage(`() => JSON.stringify([...document.querySelectorAll('input[type="file"]')].map((el, i) => ({
    index: i,
    accept: el.getAttribute('accept') || '',
    name: el.getAttribute('name') || '',
    id: el.id || '',
    multiple: !!el.multiple,
    visible: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()
  })))`);
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

function dropFiles(target, absPaths) {
  return cli(['drop', target, ...absPaths.map(p => `--path=${p}`)]);
}

function uploadFiles(absPaths) {
  return cli(['upload', ...absPaths]);
}

function setInputFiles(css, absPaths) {
  const code = `async page => { await page.locator(${JSON.stringify(css)}).first().setInputFiles(${JSON.stringify(absPaths)}); return 'ok'; }`;
  return runCode(code);
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
    logInfo(`upload strategy=drop target=${target} files=${absPaths.map(p => path.basename(p)).join(',')}`);
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

  throw new Error(`All upload strategies failed for [${absPaths.map(p => path.basename(p)).join(', ')}]:\n- ${errors.join('\n- ')}`);
}

function captureVisibleErrors() {
  const raw = evalPage(`() => JSON.stringify([...document.querySelectorAll('[role="alert"], p[class*="red"], span[class*="red"], div[class*="red"], [class*="text-red"], [class*="error"]')].map(e => (e.innerText || '').trim()).filter(t => t && /required|invalid|failed|error|attention|must|missing|least one/i.test(t)).slice(0, 20))`);
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

function galleryItemsText() {
  return evalPage(`() => { const m = (document.body.innerText || '').match(/(\\d+)\\s+items?/i); return m ? m[0] : ''; }`);
}

function galleryTileCount() {
  const raw = evalPage(`() => String(document.querySelectorAll('img[src*="blob:"], img[src*="cloudinary"], img[src*="amazonaws"], video').length)`);
  return Number(String(raw).replace(/[^0-9]/g, '')) || 0;
}

function listComboboxOptions() {
  const raw = evalPage(`() => JSON.stringify([...document.querySelectorAll(${JSON.stringify(OPTION_SELECTOR)})].map(e => ({ text: (e.innerText || '').trim().slice(0, 160), html: e.innerHTML.trim().slice(0, 400) })).filter(o => o.text).slice(0, 40))`);
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
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
  await sleep(900);
  const name = label || 'Combobox';
  const want = preferredName ? String(preferredName).trim() : '';
  let options = listComboboxOptions();
  let idx = options.length ? matchOptionIndex(options, want) : -1;
  let filteredBy = '';

  if (idx === -1) {
    // Radix/cmdk lists only render options once you type, so retry with progressively shorter queries.
    const queries = [want, want.split(/\s+/)[0], want.slice(0, Math.max(3, Math.ceil(want.length / 2)))].filter((q, i, arr) => q && arr.indexOf(q) === i);
    for (const q of queries) {
      if (!String(fillPopupSearch(q)).includes('ok')) break;
      await sleep(900);
      options = listComboboxOptions();
      idx = options.length ? matchOptionIndex(options, want) : -1;
      if (idx !== -1) { filteredBy = q; break; }
    }
  }

  if (!options.length) {
    const snapshot = cli(['snapshot'], { allowFailure: true }).stdout || '';
    throw new Error(`${name}: dropdown opened but no options detected (tried search: ${want || 'n/a'}). Set the exact name env var. Snapshot head: ${snapshot.slice(0, 400)}`);
  }
  if (idx === -1) {
    throw new Error(`${name}: preferred option ${JSON.stringify(preferredName)} not in [${options.map(o => JSON.stringify(o.text)).join(', ')}]`);
  }

  const chosen = options[idx];
  runCode(`async page => { await page.locator(${JSON.stringify(OPTION_SELECTOR)}).nth(${idx}).click(); return 'ok'; }`);
  await sleep(700);
  logInfo(`${name} selected [${idx}]${filteredBy ? ` (filtered by ${JSON.stringify(filteredBy)})` : ''}: ${chosen.text}`);
  return { index: idx, text: chosen.text, innerHTML: chosen.html, optionsCount: options.length, options: options.map(o => o.text), filteredBy };
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
    return value === null || value === undefined ? fallback : value;
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
  for (const p of list) {
    const css = `textarea[placeholder=${JSON.stringify(p)}]`;
    const r = cli(['fill', `locator(${JSON.stringify(css)})`, String(value)], { allowFailure: true });
    if (r.code === 0) {
      logInfo(`filled textarea placeholder=${JSON.stringify(p)}`);
      return p;
    }
    tried.push(p);
  }
  throw new Error(`No textarea matched placeholders ${JSON.stringify(tried)}`);
}

function fillRichTextAny(placeholders, value) {
  const list = (Array.isArray(placeholders) ? placeholders : [placeholders]).filter(Boolean);
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
  fillRichTextLast(value);
  logInfo('filled rich text via last contenteditable fallback');
  return '(last contenteditable)';
}

function listMenuOptions() {
  const expr = String.raw`() => JSON.stringify([...document.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="option"], [data-slot="dropdown-menu-item"], [data-slot="select-item"]')].map((el, i) => ({
    i,
    text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
    disabled: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled') || el.hasAttribute('disabled') || /pointer-events-none|opacity-50/.test(el.className || '')
  })).filter(o => o.text))`;
  return parseJson(evalPage(expr), []);
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
  if (idx === -1) throw new Error(`${label}: no enabled options (found ${options.map(o => JSON.stringify(o.text)).join(', ')})`);
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
  captureVisibleErrors, galleryItemsText, galleryTileCount,
  listComboboxOptions, selectCombobox,
  fillRichTextLast, fillRichTextByPlaceholder, waitForText,
  parseRequestLines, networkList, networkMark, networkSince, requestDetails, networkSummary,
  comboNorm, parseJson, readValues, switchList, findSwitch, ensureSwitch,
  entryTierSnapshot, reviewSnapshot, sweepsRowSnapshot, cartState, storefrontSnapshot,
  normalizeCdnKey, fillTextareaByPlaceholder, fillRichTextAny, listMenuOptions, selectMenuOption
};
