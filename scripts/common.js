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
    throw new Error(`playwright-cli failed (exit ${result.status})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
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

module.exports = {
  ROOT, config, resultsDir, cli, sleep, clean, writeJson, env,
  locator, click, fill, press, goto, screenshot, evalPage
};
