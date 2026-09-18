#!/usr/bin/env node
/**
 * Compact summary of results/report.json (+ cart-results.json) for a live run.
 * Usage: npm run report  [-- --full]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const resultsDir = path.join(ROOT, 'results');
const full = process.argv.includes('--full');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8')); } catch (_) { return null; }
}

function line(char = '-') { return char.repeat(78); }
function head(text) { console.log(`\n${line('=')}\n${text}\n${line('=')}`); }
function kv(label, value) { console.log(`  ${String(label).padEnd(26)} ${value === undefined || value === null || value === '' ? '—' : value}`); }
function truncate(text, n = 110) {
  const s = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const report = readJson('report.json');
const cart = readJson('cart-results.json');

if (!report) {
  console.error(`No results/report.json found in ${resultsDir}. Run "npm test" first.`);
  process.exit(1);
}

head(`Fandiem happy flow — ${report.status || 'UNKNOWN'}`);
kv('Title', report.sweepTitle);
kv('Started', report.startedAt);
kv('Finished', report.finishedAt);
kv('Public URL', report.publicUrl);
if (report.error) kv('Error', report.error);

head('Steps');
for (const [i, s] of (report.steps || []).entries()) {
  const status = s.status === 'PASS' ? 'PASS' : 'FAIL';
  console.log(`  ${String(i + 1).padStart(2, '0')}. [${status}] ${s.name} (${Math.round((s.durationMs || 0) / 1000)}s)`);
  if (s.error) console.log(`      error: ${truncate(s.error, 400)}`);
}

if (report.selections) {
  head('Partners');
  kv('Talent', report.selections.talent && report.selections.talent.text);
  kv('Charity', report.selections.charity && report.selections.charity.text);
  kv('Quote title', report.selections.artistQuoteTitle);
  kv('Quote', truncate(report.selections.artistQuote, 90));
  kv('Charity subtitle', truncate(report.selections.charitySubtitle, 90));
}

if (report.media) {
  head('Media');
  kv('Cover', report.media.cover && `${(report.media.cover.files || []).join(',')} via ${report.media.cover.strategy || report.media.cover.error}`);
  kv('Gallery order', (report.media.galleryOrder || []).join(' | '));
  for (const s of report.media.strategies || []) kv(`  ${s.slot}${s.file ? `:${s.file}` : ''}`, s.strategy || s.error);
  kv('Bonus image', report.media.bonus && `${report.media.bonus.file} via ${report.media.bonus.strategy}`);
  for (const c of report.media.typeCoverage || []) kv(`  type ${c.file}`, c.ok ? `ok (${c.strategy})` : `FAILED: ${truncate(c.error, 80)}`);
}

if (report.promotionTabs) {
  head('Promotion Tabs');
  for (const t of report.promotionTabs) {
    kv(`#${t.index} ${truncate(t.title, 40)}`, `${t.descriptionControl ? t.descriptionControl.tag : '?'} | required: ${(t.fieldsRequired || []).join(',') || 'none'} | rawHtml: ${t.rawHtml ? 'on' : 'off'}`);
  }
}
if (report.prizeDetail) {
  head('Prize Detail');
  kv('Emoji', `${report.prizeDetail.emoji} (maxlength ${report.prizeDetail.emojiMaxLength})`);
  kv('Description', truncate(report.prizeDetail.description, 90));
  kv('Modal heading', report.prizeDetail.modalHeading);
}
if (report.entryTiers) {
  head('Entry Tiers');
  kv('Seeded rows', `${report.entryTiers.seededCount} (locked: ${(report.entryTiers.seeded || []).filter(t => t.locked || t.disabled).length})`);
  for (const t of report.entryTiers.seeded || []) {
    kv(`  tier ${t.idx}`, `${t.badge ? `${t.badge} ` : ''}$${t.price} -> ${t.entries} entries ${t.locked ? '(locked)' : ''}`);
  }
  const a = report.entryTiers.added;
  kv(`ADDED tier ${a.idx}`, `$${a.price} -> ${a.entries} entries | ${truncate(a.impact, 60)}`);
}
if (report.bonus) {
  head('Bonus');
  kv('Title', report.bonus.title);
  kv('Image strategy', report.bonus.imageStrategy);
  kv('Entry-tier link', report.bonus.entryTierLink ? report.bonus.entryTierLink.text : '(not linked)');
  kv('Required labels', (report.bonus.labels || []).filter(l => l.required).map(l => l.text).join(', ') || 'none');
}
if (report.sweepsInfo) {
  head('Sweeps Info');
  for (const [k, v] of Object.entries(report.sweepsInfo.values || {})) kv(k.replace(/^.*\[name="|"\]$/g, ''), truncate(v, 70));
  const sw = report.sweepsInfo.switchesAfter || [];
  kv('Switches', sw.map(s => `${s.label}=${s.checked ? 'on' : 'off'}`).join(' | '));
}
if (report.review) {
  head('Review page');
  kv('Attention banner', report.review.attentionBanner ? `YES (${report.review.stepsNeedingAttention} step(s))` : 'no');
  for (const s of report.review.sections || []) {
    const flags = [s.empty ? 'EMPTY' : '', s.needsAttention ? 'NEEDS ATTENTION' : ''].filter(Boolean).join(' ');
    console.log(`  - ${s.section}${flags ? ` [${flags}]` : ''}`);
    if (full) for (const r of s.rows || []) console.log(`      ${r.label}: ${truncate(r.value, 90)}${r.images && r.images.length ? ` (${r.images.length} images)` : ''}`);
  }
  const bad = (report.reviewChecks || []).filter(c => !c.present);
  kv('Value checks', `${(report.reviewChecks || []).length} checked, ${bad.length} missing`);
  for (const b of bad) console.log(`      missing: ${b.section} / ${b.label} -> ${truncate(b.expected, 70)}`);
}
if (report.createNetwork) {
  head('Create Sweep — network');
  kv('URL after submit', report.createNetwork.url);
  kv('POSTs observed', (report.createNetwork.posts || []).length);
  for (const p of report.createNetwork.posts || []) console.log(`      ${p}`);
  for (const p of report.createNetwork.sweepPosts || []) console.log(`      [sweeps] ${p}`);
}
if (report.storefrontChecks) {
  head('Storefront checks');
  for (const c of report.storefrontChecks) {
    console.log(`  [${c.present ? 'OK  ' : 'MISS'}] ${c.required ? '(required) ' : '(recorded) '}${c.label}: ${truncate(c.expected, 70)}`);
  }
  const sn = report.storefront && report.storefront.snapshot;
  if (sn) {
    kv('Title', sn.title);
    kv('ENDS', sn.ends);
    kv('Entries', (sn.entries || []).map(e => `${e.entries} ${e.price} v${e.variant}`).join(' | '));
  }
}
if (report.parity) {
  head('Admin <-> storefront parity');
  kv('Review values missing', (report.parity.reviewMissing || []).length);
  for (const m of report.parity.reviewMissing || []) console.log(`      ${m.section} / ${m.label || '-'}: ${truncate(m.expected, 70)}`);
  kv('Storefront values missing', (report.parity.storefrontMissing || []).length);
  for (const m of report.parity.storefrontMissing || []) console.log(`      ${m.label}: ${truncate(m.expected, 70)}`);
}
if (cart) {
  head('Cart buttons');
  console.log(`  ${cart.length} buttons exercised`);
  for (const c of cart) {
    const state = c.ok ? 'OK  ' : 'FAIL';
    console.log(`  [${state}] #${c.index + 1} ${truncate(c.text, 40)} | POST /cart: ${c.postCartObserved ? 'yes' : 'no'} | cart items: ${c.itemCount}`);
    if (!c.ok) for (const s of c.requests || []) console.log(`        seen: ${s}`);
  }
}

head('Result');
console.log(`  ${report.status}${report.error ? ` — ${truncate(report.error, 200)}` : ''}`);
console.log(`  report: ${path.join(resultsDir, 'report.json')}${cart ? `\n  cart:   ${path.join(resultsDir, 'cart-results.json')}` : ''}`);
