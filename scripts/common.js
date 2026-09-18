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
  const raw = evalPage(`() => JSON.stringify([...document.querySelectorAll('[role="option"], [role="menuitemcheckbox"], [role="menuitem"], [data-slot="select-item"], [data-radix-collection-item]')].map(e => ({ text: (e.innerText || '').trim().slice(0, 160), html: e.innerHTML.trim().slice(0, 400) })).filter(o => o.text).slice(0, 40))`);
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

async function selectCombobox({ comboboxTarget, preferredName, label }) {
  click(comboboxTarget);
  await sleep(900);
  const options = listComboboxOptions();
  if (!options.length) {
    // dump a hint for debugging
    const snapshot = cli(['snapshot'], { allowFailure: true }).stdout || '';
    throw new Error(`${label || 'Combobox'}: dropdown opened but no options detected. Set the exact name env var. Snapshot head: ${snapshot.slice(0, 400)}`);
  }
  let idx = 0;
  if (preferredName && preferredName.trim()) {
    const want = preferredName.trim().toLowerCase();
    const found = options.findIndex(o => o.text.toLowerCase() === want || o.text.toLowerCase().includes(want));
    if (found === -1) throw new Error(`${label || 'Combobox'}: preferred option ${JSON.stringify(preferredName)} not in [${options.map(o => JSON.stringify(o.text)).join(', ')}]`);
    idx = found;
  }
  const chosen = options[idx];
  const clickCode = `async page => { await page.locator('[role="option"], [role="menuitemcheckbox"], [role="menuitem"], [data-slot="select-item"], [data-radix-collection-item]').nth(${idx}).click(); return 'ok'; }`;
  runCode(clickCode);
  await sleep(700);
  logInfo(`${label || 'Combobox'} selected [${idx}]: ${chosen.text}`);
  return { index: idx, text: chosen.text, innerHTML: chosen.html, optionsCount: options.length, options: options.map(o => o.text) };
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
  fillRichTextLast, fillRichTextByPlaceholder, waitForText
};
