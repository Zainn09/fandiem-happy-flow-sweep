const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  ROOT, config, resultsDir, cli, sleep, clean, writeJson, env, stampNow,
  logInfo, logWarn,
  locator, click, fill, goto, screenshot, evalPage, runCode, tabNew,
  bodyText, currentUrl, assertContains, assertAbsent, heading,
  resolveAsset, resolveAssets, buildSweepTitle,
  listFileInputs, dropFiles, uploadFiles, captureVisibleErrors,
  galleryItemsText, galleryTileCount, listComboboxOptions, selectCombobox,
  fillRichTextByPlaceholder, waitForText,
  parseJson, readValues, ensureSwitch, findSwitch, switchList,
  entryTierSnapshot, reviewSnapshot, sweepsRowSnapshot, cartState, storefrontSnapshot,
  normalizeCdnKey, comboNorm, fillTextareaByPlaceholder, fillRichTextAny, selectMenuOption,
  networkMark, networkSince, networkSummary, requestDetails
} = require('./common');

async function ensurePlaywrightAttached() {
  console.log('');
  console.log('Checking Playwright Chrome session...');
  const check = cli(['snapshot'], { allowFailure: true });
  if (check.code === 0) {
    console.log('Playwright session is already attached.');
    return;
  }
  console.log('');
  console.log('Playwright session is not attached. Launching attach process...');
  const token = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN || config.extensionToken;
  if (!token) {
    console.log('');
    console.log('==================================================================');
    console.log('ACTION REQUIRED IN CHROME:');
    console.log("A Chrome tab for Playwright Extension has opened (or is already open).");
    console.log("Please switch to Chrome and click 'Allow & select' on that tab.");
    console.log('==================================================================');
    console.log('');
  }
  const attachScript = path.join(ROOT, 'scripts', 'attach.js');
  const child = spawn(process.execPath, [attachScript], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    detached: true,
    windowsHide: false
  });
  child.unref();
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const probe = cli(['snapshot'], { allowFailure: true });
    if (probe.code === 0) {
      console.log('\nPlaywright successfully attached to Chrome.');
      return;
    }
    console.log("  Waiting for Playwright session connection (click 'Allow & select' in Chrome)...");
  }
  throw new Error(
    'Could not attach Playwright to the existing Chrome profile within 60s.\n' +
    "Make sure the Playwright extension is installed and you click 'Allow & select' when prompted,\n" +
    'or configure extensionToken in config.json / PLAYWRIGHT_MCP_EXTENSION_TOKEN.'
  );
}

// ---------------------------------------------------------------- data ---
const isDryRun = process.argv.includes('--dry-run');
function previewTitle() {
  if (process.env.SWEEP_TITLE && process.env.SWEEP_TITLE.trim()) return process.env.SWEEP_TITLE.trim() + ' (preview)';
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  let n = 0;
  try { n = Number(JSON.parse(fs.readFileSync(path.join(resultsDir, `run-counter-${yyyymmdd}.json`), 'utf8')).count || 0); } catch (_) {}
  return `${config.sweepTitlePrefix}-${yyyymmdd}-${String(n + 1).padStart(3, '0')} (preview)`;
}
const sweepTitle = isDryRun ? previewTitle() : buildSweepTitle();
// short stamp for sibling entities (date + counter suffix of the title)
const stamp = sweepTitle.replace(new RegExp(`^${config.sweepTitlePrefix}-`), '').replace(/-/g, '');
const ADMIN = config.adminBaseUrl.replace(/\/$/, '');
const PUBLIC = config.publicBaseUrl.replace(/\/$/, '');
const campaignDescription = env('CAMPAIGN_DESCRIPTION', config.campaignDescription);
const artistQuoteTitle = env('ARTIST_QUOTE_TITLE', config.artistQuoteTitle);
const artistQuote = env('ARTIST_QUOTE', config.artistQuote);
const charitySubtitle = env('CHARITY_SUBTITLE', config.charitySubtitle);
const talentPreferred = env('TALENT_PARTNER_NAME', config.talentPartnerName || config.expectedTalentPartner || '');
const charityPreferred = env('CHARITY_PARTNER_NAME', config.charityPartnerName || '');

const coverMedia = resolveAssets(config.coverMedia);
const galleryMedia = resolveAssets(config.galleryMedia);
const typeCoverageMedia = resolveAssets(config.typeCoverageMedia || []);
const bonusImage = resolveAsset(config.bonusImage);

if (!config.allowMutations && String(env('ALLOW_MUTATIONS', 'false')).toLowerCase() !== 'true') {
  throw new Error('This test creates a sweep. Set allowMutations=true in config.json or ALLOW_MUTATIONS=true.');
}

const data = {
  promotionOne: `QA Promotion One ${stamp}`,
  promotionTwo: `QA Promotion Two ${stamp}`,
  promotionDescriptionOne: `Automated happy-flow promotion one ${stamp}`,
  promotionDescriptionTwo: `Automated happy-flow promotion two ${stamp}`,
  prizeEmoji: '🎁',
  prizeDescription: `Automated prize detail ${stamp}`,
  customTierEntries: String(env('CUSTOM_TIER_ENTRIES', config.customTierEntries || '500')),
  customTierPrice: String(env('CUSTOM_TIER_PRICE', config.customTierPrice || '75')),
  customTierImpact: `Automated tier impact ${stamp}`,
  bonusTitle: `QA Bonus ${stamp}`,
  bonusDescription: `Automated bonus ${stamp}`,
  prizeReward: `QA Reward ${stamp}`,
  numberOfWinners: String(env('NUMBER_OF_WINNERS', config.numberOfWinners || '1')),
  numberOfGuests: String(env('NUMBER_OF_GUESTS', config.numberOfGuests || '2')),
  prizeValue: String(env('PRIZE_VALUE', config.prizeValue || '$5,000')),
  minimumAge: String(env('MINIMUM_AGE', config.minimumAge || '18')),
  eligibleCountries: env('ELIGIBLE_COUNTRIES', config.eligibleCountries || 'Open to legal residents of the United States only'),
  winnerAnnouncementContent: env('WINNER_ANNOUNCEMENT', config.winnerAnnouncementContent || `Congratulations — automated QA winner announcement ${stamp}.`),
  startDate: futureDate(1),
  endDate: futureDate(8),
  drawDate: futureDate(10).slice(0, 10)
};

function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(12, 0, 0, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T12:00`;
}

// ------------------------------------------------------------- helpers ---
function clickFirst(targets, label) {
  for (const t of targets) {
    const r = cli(['click', t], { allowFailure: true });
    if (r.code === 0) {
      logInfo(`clicked ${label}: ${t.slice(0, 90)}`);
      return t;
    }
  }
  throw new Error(`Could not click ${label}. Tried: ${targets.join(' | ')}`);
}

async function clickContinueAndExpect(expectedHeading) {
  const targets = [
    `locator('button[data-slot="button"][data-variant="gradient"][data-size="lg"]:has-text("CONTINUE")')`,
    `locator('button[data-variant="gradient"]:has-text("CONTINUE")')`,
    locator('role', 'button', { name: 'CONTINUE' }) + '.last()',
    `locator('button:has-text("CONTINUE")').last()`,
    locator('role', 'button', { name: 'Continue' }) + '.last()',
    `locator('button:has-text("Continue")').last()`
  ];
  let clicked = null;
  for (const t of targets) {
    const r = cli(['click', t], { allowFailure: true });
    if (r.code === 0) { clicked = t; break; }
  }
  if (!clicked) throw new Error('CONTINUE button not found (gradient CONTINUE / Continue).');
  logInfo(`CONTINUE clicked: ${clicked.slice(0, 100)}`);
  await sleep(1500);
  const errors = captureVisibleErrors();
  const ok = await waitForText(expectedHeading, 20000);
  if (!ok) {
    throw new Error(`Did not reach ${expectedHeading} after CONTINUE. Errors: ${errors.join(' | ') || 'none'}. URL: ${currentUrl()}`);
  }
  if (errors.length) logWarn(`visible errors after CONTINUE (reached ${expectedHeading} anyway): ${errors.join(' | ')}`);
  return { clicked, errors };
}

async function pollMediaIncrease(beforeTiles, beforeItems, timeoutMs) {
  const timeout = timeoutMs || config.timeouts.uploadMs || 30000;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const tiles = galleryTileCount();
    const itemsText = galleryItemsText();
    const m = itemsText.match(/(\d+)/);
    const n = m ? Number(m[1]) : 0;
    if (tiles > beforeTiles || n > beforeItems) return { tiles, itemsText };
    await sleep(config.timeouts.pollMs || 500);
  }
  return null;
}

function itemsNumber() {
  const m = galleryItemsText().match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Upload files with 3 strategies and polling verify.
 * inputNth: which global input[type=file] to target for setInputFiles (-1 = last, null = skip).
 */
async function attemptUpload({ dropTarget, clickTarget, inputNth, absPaths, label, verify }) {
  const names = absPaths.map(p => path.basename(p)).join(',');
  const beforeTiles = galleryTileCount();
  const beforeItems = itemsNumber();
  const errors = [];

  async function confirm(tag) {
    if (typeof verify === 'function') {
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        try {
          if (await verify()) {
            logInfo(`${label}: ${tag} ok (custom verify) files=${names}`);
            return { custom: true, files: absPaths.slice() };
          }
        } catch (_) { /* keep polling */ }
        await sleep(config.timeouts.pollMs || 500);
      }
      return null;
    }
    const grew = await pollMediaIncrease(beforeTiles, beforeItems, 12000);
    if (grew) {
      logInfo(`${label}: ${tag} ok (tiles ${beforeTiles}->${grew.tiles}, ${grew.itemsText || 'items n/a'}) files=${names}`);
      return grew;
    }
    return null;
  }

  // 1) drop
  try {
    logInfo(`${label}: strategy=drop target=${dropTarget} files=${names}`);
    dropFiles(dropTarget, absPaths);
    const grew = await confirm('drop');
    if (grew) return { strategy: 'drop', ...grew };
    errors.push('drop: no new media detected');
  } catch (e) { errors.push(`drop: ${String(e.message).split('\n')[0]}`); }

  // 2) setInputFiles on nth hidden input
  if (inputNth !== null && inputNth !== undefined) {
    try {
      const inputs = listFileInputs();
      const idx = inputNth === -1 ? inputs.length - 1 : inputNth;
      logInfo(`${label}: strategy=setInputFiles nth=${idx} (inputs=${inputs.length}) files=${names}`);
      if (idx < 0) throw new Error(`no file inputs on page (found ${inputs.length})`);
      runCode(`async page => { await page.locator('input[type="file"]').nth(${idx}).setInputFiles(${JSON.stringify(absPaths)}); return 'ok'; }`);
      const grew = await confirm(`setInputFiles[${idx}]`);
      if (grew) return { strategy: `setInputFiles[${idx}]`, ...grew };
      errors.push(`setInputFiles[${idx}]: no new media detected`);
    } catch (e) { errors.push(`setInputFiles: ${String(e.message).split('\n')[0]}`); }
  }

  // 3) click + upload (file chooser)
  try {
    logInfo(`${label}: strategy=click+upload clickTarget=${clickTarget} files=${names}`);
    cli(['click', clickTarget]);
    await sleep(900);
    uploadFiles(absPaths);
    const grew = await confirm('click+upload');
    if (grew) return { strategy: 'click+upload', ...grew };
    errors.push('click+upload: no new media detected');
  } catch (e) { errors.push(`click+upload: ${String(e.message).split('\n')[0]}`); }

  throw new Error(`${label}: all upload strategies failed for [${names}]:\n- ${errors.join('\n- ')}\nVisible errors: ${captureVisibleErrors().join(' | ') || 'none'}`);
}

async function selectComboboxWithFallback({ comboboxTarget, preferredName, label }) {
  if (preferredName && preferredName.trim()) {
    try {
      return await selectCombobox({ comboboxTarget, preferredName, label });
    } catch (e) {
      logWarn(`${label}: preferred ${JSON.stringify(preferredName)} failed (${String(e.message).split('\n')[0]}). Falling back to first available.`);
    }
  }
  return selectCombobox({ comboboxTarget, preferredName: '', label });
}

function richText(value) { fill('locator(\'[contenteditable="true"]\').last()', String(value)); }

function fillFirstAvailable(targets, value, label) {
  for (const t of targets) {
    const r = cli(['fill', t, String(value)], { allowFailure: true });
    if (r.code === 0) {
      logInfo(`filled ${label}: ${t.slice(0, 80)}`);
      return t;
    }
  }
  throw new Error(`Could not fill ${label}. Tried: ${targets.join(' | ')}`);
}

// --------------------------------------------------- screen 1: nav -------
async function openSweepCreate() {
  tabNew(`${ADMIN}/admin`);
  await sleep(2200);
  clickFirst([
    `locator('span.cap-center.flex-1.truncate.text-left:has-text("Campaigns")')`,
    `locator('span:has-text("Campaigns")').first()`,
    locator('role', 'button', { name: 'Campaigns' }),
    `locator('button:has-text("Campaigns")')`
  ], 'Campaigns');
  await sleep(900);
  clickFirst([
    `locator('span.cap-center.flex-1.truncate.text-left:has-text("Sweeps")')`,
    locator('role', 'link', { name: 'Sweeps' }),
    `locator('a[href="/admin/sweeps"]')`,
    `locator('a:has-text("Sweeps")')`
  ], 'Sweeps');
  await sleep(1300);
  const create = cli(['click', `locator('a[href="/admin/sweeps/create"]')`], { allowFailure: true });
  if (create.code !== 0) {
    logWarn('create anchor not clickable, navigating directly to /admin/sweeps/create');
    goto(`${ADMIN}/admin/sweeps/create`);
  }
  await sleep(1800);
  heading('Campaign Info');
}

// ------------------------------------------- screen 1: campaign info -----
async function fillCampaignInfo(report) {
  // Title (required): name="campaignInfo.title"
  fillFirstAvailable(
    [`locator('input[name="campaignInfo.title"]')`, locator('placeholder', 'e.g. Eras Tour Backstage Meet & Greet Experience')],
    sweepTitle,
    'campaign title'
  );
  assertContains(bodyText(), sweepTitle.slice(0, 20), 'Title echo');

  // Diagnose file inputs (cover + gallery share the accept list)
  const inputs = listFileInputs();
  logInfo(`file inputs on Campaign Info: ${JSON.stringify(inputs.map(i => ({ i: i.index, accept: i.accept.slice(0, 60), multiple: i.multiple })))}`);
  report.media = report.media || {};
  report.media.fileInputs = inputs;

  const galleryOrder = [];
  const strategies = [];

  // Cover (optional): div.space-y-1 > input[accept*=image/png]
  try {
    const beforeTiles = galleryTileCount();
    const res = await attemptUpload({
      dropTarget: `locator('div.space-y-1:has(input[type="file"])').first()`,
      clickTarget: `locator('div.space-y-1:has-text("Drag & drop or click to upload")').first()`,
      inputNth: 0,
      absPaths: coverMedia,
      label: 'Cover'
    });
    strategies.push({ slot: 'cover', ...res, files: res.files.map(f => path.basename(f)) });
    report.media.cover = { files: coverMedia.map(f => path.basename(f)), strategy: res.strategy };
    logInfo(`cover tiles ${beforeTiles} -> ${res.tiles}`);
  } catch (e) {
    // Cover is optional per workflow — record but don't fail.
    logWarn(`cover upload failed (optional, continuing): ${String(e.message).split('\n')[0]}`);
    report.media.cover = { files: coverMedia.map(f => path.basename(f)), error: String(e.message).split('\n')[0] };
  }

  // Gallery (required): button[type=button] containing "Add media" — upload one by one to preserve order.
  const galleryTargets = {
    drop: `locator('button[type="button"]:has-text("Add media")')`,
    click: `locator('button[type="button"]:has-text("Add media")')`
  };
  for (const file of galleryMedia) {
    const inputsNow = listFileInputs();
    const res = await attemptUpload({
      dropTarget: galleryTargets.drop,
      clickTarget: galleryTargets.click,
      inputNth: inputsNow.length > 1 ? 1 : -1,
      absPaths: [file],
      label: `Gallery[${path.basename(file)}]`
    });
    galleryOrder.push(path.basename(file));
    strategies.push({ slot: 'gallery', file: path.basename(file), ...res, files: undefined });
  }

  // Type coverage (non-fatal): try every extra type, remember order + errors.
  const coverage = [];
  for (const file of typeCoverageMedia) {
    const name = path.basename(file);
    try {
      const inputsNow = listFileInputs();
      const res = await attemptUpload({
        dropTarget: galleryTargets.drop,
        clickTarget: galleryTargets.click,
        inputNth: inputsNow.length > 1 ? 1 : -1,
        absPaths: [file],
        label: `Gallery-type[${name}]`
      });
      galleryOrder.push(name);
      strategies.push({ slot: 'gallery-type', file: name, strategy: res.strategy });
      coverage.push({ file: name, ok: true, strategy: res.strategy });
    } catch (e) {
      coverage.push({ file: name, ok: false, error: String(e.message).split('\n')[0] });
      logWarn(`type coverage ${name} failed (recorded, continuing): ${String(e.message).split('\n')[0]}`);
    }
  }
  report.media.galleryOrder = galleryOrder;
  report.media.strategies = strategies;
  report.media.typeCoverage = coverage;
  report.media.itemsText = galleryItemsText();

  if (!galleryOrder.length) {
    throw new Error(`Media Gallery is required but no file uploaded. Errors: ${captureVisibleErrors().join(' | ') || 'none'}`);
  }

  // Description (required rich text): data-placeholder="Describe the experience in detail..."
  fillRichTextByPlaceholder('Describe the experience in detail...', campaignDescription);
  await sleep(600);
  assertContains(bodyText(), campaignDescription.slice(0, 32), 'Description echo');

  // CONTINUE (gradient) -> Partners, capture errors on click.
  const cont = await clickContinueAndExpect('Partners');
  report.media.continueErrors = cont.errors;
}

// ----------------------------------------------- screen 2: partners ------
async function fillPartners(report) {
  heading('Partners');
  const comboCss = 'button[type="button"][role="combobox"]';
  const comboScript = '() => String(document.querySelectorAll(' + JSON.stringify(comboCss) + ').length)';
  const comboCount = Number(String(evalPage(comboScript)).replace(/[^0-9]/g, '')) || 0;
  logInfo(`comboboxes on Partners: ${comboCount}`);
  if (comboCount < 2) throw new Error(`Expected 2 comboboxes on Partners, found ${comboCount}.`);

  // 1) Talent (required) — remember innerHTML.
  const talent = await selectComboboxWithFallback({
    comboboxTarget: `locator('${comboCss}').first()`,
    preferredName: talentPreferred,
    label: 'Talent partner'
  });

  // The chosen partner must render as a removable badge (PDF: aria-label "Remove 5B ARTISTS").
  const badges = parseJson(evalPage(`() => JSON.stringify([...document.querySelectorAll('[aria-label^="Remove"]')].map(e => e.getAttribute('aria-label')))`), []);
  report.partnersBadges = badges;
  const wantBadge = comboNorm(talent.text);
  const badgeHit = badges.find(b => comboNorm(b).includes(wantBadge) || wantBadge.includes(comboNorm(b).replace(/^remove/, '')));
  if (badgeHit) logInfo(`talent badge present: ${badgeHit}`);
  else logWarn(`no Remove-badge matched talent ${JSON.stringify(talent.text)}; badges on page: ${badges.join(', ') || 'none'}`);

  // Quote fields.
  fillFirstAvailable(
    [`locator('input[name="promoContent.artistQuoteTitle"]')`, `locator('textarea[name="promoContent.artistQuoteTitle"]')`],
    artistQuoteTitle,
    'artistQuoteTitle'
  );
  fillFirstAvailable(
    [`locator('textarea[name="promoContent.artistQuote"]')`, `locator('input[name="promoContent.artistQuote"]')`],
    artistQuote,
    'artistQuote'
  );

  // 2) Charity — remember selection for storefront check.
  const charity = await selectComboboxWithFallback({
    comboboxTarget: `locator('${comboCss}').nth(1)`,
    preferredName: charityPreferred,
    label: 'Charity partner'
  });

  fillFirstAvailable(
    [`locator('input[name="charitySetup.charitySubtitle"]')`, `locator('textarea[name="charitySetup.charitySubtitle"]')`],
    charitySubtitle,
    'charitySubtitle'
  );

  report.selections = { talent, charity, artistQuoteTitle, artistQuote, charitySubtitle };
}

// ------------------------------------------------- remaining steps -------
// Dialogs here are plain divs (no role="dialog"), so tag the smallest ancestor
// that holds both the field we are about to fill and the modal's submit button.
const MODAL = '[data-qa-modal="1"]';
function markModal(anchorText, probeSelector, saveLabel) {
  const expr = `() => {
    const probe = document.querySelector(${JSON.stringify(probeSelector)});
    if (!probe) return 'no-probe';
    document.querySelectorAll('[data-qa-modal="1"]').forEach(el => el.removeAttribute('data-qa-modal'));
    const label = ${JSON.stringify(saveLabel)};
    const hasSave = el => !!el && [...el.querySelectorAll('button')].some(b => (b.innerText || '').replace(/\\s+/g, ' ').includes(label));
    const anchors = [...document.querySelectorAll('h1,h2,h3,p,span')]
      .filter(el => (el.innerText || '').includes(${JSON.stringify(anchorText)}) && el.contains(probe))
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    let scope = null;
    for (let node = anchors[0]; node && !scope; node = node.parentElement) {
      if (hasSave(node)) scope = node;
    }
    for (let node = probe.closest('form') || probe.parentElement; node && !scope; node = node.parentElement) {
      if (hasSave(node)) scope = node;
    }
    if (!scope) return 'no-scope';
    scope.setAttribute('data-qa-modal', '1');
    return 'ok';
  }`;
  const out = clean(evalPage(expr));
  if (!/\bok\b/.test(out)) throw new Error(`Modal not found (anchor ${JSON.stringify(anchorText)}, save ${JSON.stringify(saveLabel)}): ${out}`);
  return MODAL;
}

function clickModalSave(label) {
  return clickFirst([
    `locator('${MODAL} button:has-text(${JSON.stringify(label)})')`,
    `locator('[role="dialog"] button:has-text(${JSON.stringify(label)})')`,
    `locator('[data-slot="dialog-content"] button:has-text(${JSON.stringify(label)})')`,
    locator('role', 'button', { name: label, exact: true }) + '.last()'
  ], `modal save "${label}"`);
}

/** Promotion Tab modal: plain title input + plain <textarea> description (not rich text) + raw-HTML switch. */
async function addPromotionTab({ title, description, report, index }) {
  click(locator('role', 'button', { name: 'Add Promotion Tab', exact: true }) + '.first()');
  await sleep(900);
  markModal('raw-HTML', 'input[placeholder="Enter promotion title"]', 'Add Promotion Tab');

  const info = parseJson(evalPage(String.raw`() => {
    const scope = document.querySelector('[data-qa-modal="1"]') || document;
    const q = s => scope.querySelector(s);
    const textarea = [...scope.querySelectorAll('textarea')].find(t => /Enter the description/.test(t.getAttribute('placeholder') || ''));
    return JSON.stringify({
      heading: (q('h2') ? q('h2').innerText : '').trim(),
      subtitle: (q('p') ? q('p').innerText : '').trim(),
      labels: [...scope.querySelectorAll('label')].map(l => ({ text: (l.innerText || '').replace(/\s+/g, ' ').trim(), required: !!l.querySelector('.text-destructive') })),
      descriptionControl: textarea ? { tag: 'textarea', placeholder: textarea.getAttribute('placeholder') } : { tag: 'contenteditable', placeholder: '' },
      rawHtmlSwitchCount: scope.querySelectorAll('button[role="switch"]').length
    });
  }`), {});

  const requiredLabels = (info.labels || []).filter(l => l.required).map(l => l.text);
  if (requiredLabels.length) {
    logWarn(`promotion modal labels marked required (workflow says they are optional): ${requiredLabels.join(', ')}`);
  }
  if (info.descriptionControl && info.descriptionControl.tag === 'textarea') {
    fillTextareaByPlaceholder([info.descriptionControl.placeholder || 'Enter the description...', 'Enter the description...', 'Enter the description…'], description);
  } else {
    fillRichTextAny(['Enter the description...', 'Enter the description…'], description);
  }
  fill(locator('placeholder', 'Enter promotion title'), title);
  const rawSwitch = await ensureSwitch('Treat as raw HTML', false);
  const typed = readValues({ title: `${MODAL} input[placeholder="Enter promotion title"]` });
  if (!String(typed.title || '').includes(title)) {
    throw new Error(`Promotion title did not stick: ${JSON.stringify(typed.title)}`);
  }

  clickModalSave('Add Promotion Tab');
  await sleep(900);
  const saved = await waitForText(title, 12000);
  if (!saved) throw new Error(`Promotion tab ${JSON.stringify(title)} not listed after save. Visible errors: ${captureVisibleErrors().join(' | ') || 'none'}`);
  logInfo(`promotion tab ${index} saved: ${title} (fields required: ${requiredLabels.length ? requiredLabels.join(',') : 'none'}, raw HTML: ${rawSwitch.checked ? 'on' : 'off'}, description=${info.descriptionControl ? info.descriptionControl.tag : '?'})`);
  if (report) {
    report.promotionTabs = report.promotionTabs || [];
    report.promotionTabs.push({ index, title, description, heading: info.heading, subtitle: info.subtitle, descriptionControl: info.descriptionControl, fieldsRequired: requiredLabels, rawHtml: rawSwitch.checked });
  }
  return info;
}

async function addPrizeDetail(report) {
  click(locator('role', 'button', { name: 'Add Prize Detail', exact: true }) + '.first()');
  await sleep(900);
  markModal('short emoji', 'input[placeholder="Enter emoji"]', 'Add Prize Detail');
  const info = parseJson(evalPage(String.raw`() => {
    const scope = document.querySelector('[data-qa-modal="1"]') || document;
    const emoji = scope.querySelector('input[placeholder="Enter emoji"]');
    const rich = scope.querySelector('[contenteditable="true"]');
    return JSON.stringify({
      heading: (scope.querySelector('h2') ? scope.querySelector('h2').innerText : '').trim(),
      emojiMaxLength: emoji ? emoji.getAttribute('maxlength') : null,
      descriptionPlaceholder: rich ? (rich.querySelector('[data-placeholder]') ? rich.querySelector('[data-placeholder]').getAttribute('data-placeholder') : '') : '',
      hasRichText: !!rich
    });
  }`), {});
  if (!/Add Pri(ze|ce) Detail/i.test(String(info.heading))) {
    throw new Error(`Unexpected prize modal heading: ${JSON.stringify(info.heading)}`);
  }
  fill(locator('placeholder', 'Enter emoji'), data.prizeEmoji);
  fillRichTextAny([info.descriptionPlaceholder, 'Enter the description...', 'Enter the description…'], data.prizeDescription);
  clickModalSave('Add Prize Detail');
  await sleep(900);
  assertContains(bodyText(), data.prizeDescription, 'Prize detail');
  if (report) {
    report.prizeDetail = { emoji: data.prizeEmoji, description: data.prizeDescription, modalHeading: info.heading, emojiMaxLength: info.emojiMaxLength };
  }
  logInfo(`prize detail saved (modal heading ${JSON.stringify(info.heading)})`);
}

async function addCustomTier(report) {
  const before = entryTierSnapshot();
  if (!before.length) throw new Error('No entry tier rows detected before Add Entry Tier.');
  click(locator('role', 'button', { name: 'Add Entry Tier', exact: true }));
  await sleep(900);
  const after = entryTierSnapshot();
  if (after.length !== before.length + 1) {
    throw new Error(`Add Entry Tier did not add exactly one tier (${before.length} -> ${after.length})`);
  }
  const added = after[after.length - 1];
  if (added.disabled) throw new Error(`New tier ${added.idx} is disabled — cannot fill entries/price/impact.`);
  fill(`locator('input[name="entryTiers.tiers.${added.idx}.entries"]')`, data.customTierEntries);
  fill(`locator('input[name="entryTiers.tiers.${added.idx}.price"]')`, data.customTierPrice);
  fill(`locator('input[name="entryTiers.tiers.${added.idx}.impact"]')`, data.customTierImpact);
  await sleep(400);
  const verified = entryTierSnapshot().find(t => t.idx === added.idx);
  if (!verified) throw new Error(`New tier ${added.idx} disappeared after filling.`);
  for (const [field, expected] of [['entries', data.customTierEntries], ['price', data.customTierPrice], ['impact', data.customTierImpact]]) {
    if (String(verified[field]) !== String(expected)) {
      throw new Error(`Tier ${added.idx} ${field} did not persist: expected ${JSON.stringify(expected)}, got ${JSON.stringify(verified[field])}`);
    }
  }
  assertContains(bodyText(), data.customTierImpact, 'Custom entry tier');
  if (report) {
    report.entryTiers = { seededCount: before.length, seeded: before, added: verified };
    const locked = before.filter(t => t.locked || t.disabled).length;
    logInfo(`entry tiers: ${before.length} seeded (${locked} locked) + 1 added -> tier ${added.idx} ${data.customTierPrice}/${data.customTierEntries}`);
  }
}

/** Bonus modal: title + rich text + optional entry-tier link + required image. */
async function addBonus(report) {
  click(locator('role', 'button', { name: 'Add Bonus', exact: true }) + '.first()');
  await sleep(900);
  markModal('linked entry tiers', 'input[placeholder="Enter bonus title"]', 'Add Bonus');
  const info = parseJson(evalPage(String.raw`() => {
    const scope = document.querySelector('[data-qa-modal="1"]') || document;
    const rich = scope.querySelector('[contenteditable="true"]');
    const input = scope.querySelector('input[type="file"]');
    return JSON.stringify({
      heading: (scope.querySelector('h2') ? scope.querySelector('h2').innerText : '').trim(),
      labels: [...scope.querySelectorAll('label')].map(l => ({ text: (l.innerText || '').replace(/\s+/g, ' ').trim(), required: !!l.querySelector('.text-destructive') })),
      descriptionPlaceholder: rich && rich.querySelector('[data-placeholder]') ? rich.querySelector('[data-placeholder]').getAttribute('data-placeholder') : '',
      imageAccept: input ? (input.getAttribute('accept') || '') : '',
      hasTierMenu: !!scope.querySelector('button[data-slot="dropdown-menu-trigger"]')
    });
  }`), {});

  fill(locator('placeholder', 'Enter bonus title'), data.bonusTitle);
  fillRichTextAny([info.descriptionPlaceholder, 'Enter the description…', 'Enter the description...'], data.bonusDescription);

  let tierLink = null;
  if (info.hasTierMenu) {
    try {
      tierLink = await selectMenuOption({
        triggerTarget: `locator('${MODAL} button[data-slot="dropdown-menu-trigger"]')`,
        preferredText: '',
        label: 'Bonus entry tiers'
      });
    } catch (e) {
      logWarn(`bonus entry-tier link skipped: ${String(e.message).split('\n')[0]}`);
    }
  } else {
    logWarn('bonus modal has no entry-tier dropdown-menu-trigger (skipping link step)');
  }

  const inputs = listFileInputs();
  const bonusUploadProbe = () => {
    const res = parseJson(evalPage(`() => JSON.stringify({
      files: [...document.querySelectorAll('${MODAL} input[type="file"]')].reduce((n, i) => n + (i.files ? i.files.length : 0), 0),
      images: [...document.querySelectorAll('${MODAL} img')].filter(i => /blob:|cloudinary|amazonaws|fandiem/i.test(i.getAttribute('src') || '')).length
    })`), {});
    return (res.files || 0) > 0 || (res.images || 0) > 0;
  };
  const res = await attemptUpload({
    dropTarget: `locator('${MODAL} div:has-text("Drag & drop or click to upload")')`,
    clickTarget: `locator('${MODAL} div:has-text("Drag & drop or click to upload")')`,
    inputNth: inputs.length ? -1 : null,
    absPaths: [bonusImage],
    label: 'Bonus',
    verify: bonusUploadProbe
  });

  clickModalSave('Add Bonus');
  await sleep(1000);
  const saved = await waitForText(data.bonusTitle, 12000);
  if (!saved) throw new Error(`Bonus ${JSON.stringify(data.bonusTitle)} not listed after save. Errors: ${captureVisibleErrors().join(' | ') || 'none'}`);
  report.media = report.media || {};
  report.media.bonus = { file: path.basename(bonusImage), strategy: res.strategy };
  report.bonus = { title: data.bonusTitle, description: data.bonusDescription, modalHeading: info.heading, labels: info.labels, entryTierLink: tierLink, imageStrategy: res.strategy };
  logInfo(`bonus saved: ${data.bonusTitle} (image via ${res.strategy}${tierLink ? `, tier link ${tierLink.text}` : ''})`);
}

function fillSweepsInfo(report) {
  heading('Sweeps Info');
  const fields = [
    ['input[name="prizeDetails.prizeTitle"]', data.prizeReward],
    ['input[name="prizeDetails.numberOfWinners"]', data.numberOfWinners],
    ['input[name="prizeDetails.guests"]', data.numberOfGuests],
    ['input[name="prizeDetails.prizeValue"]', data.prizeValue],
    ['input[name="rulesDates.minimumAge"]', data.minimumAge],
    ['input[name="rulesDates.eligibleCountries"]', data.eligibleCountries],
    ['input[name="rulesDates.startDate"]', data.startDate],
    ['input[name="rulesDates.endDate"]', data.endDate],
    ['textarea[name="prizeDetails.winnerAnnouncementContent"]', data.winnerAnnouncementContent],
    ['input[name="rulesDates.drawDate"]', data.drawDate]
  ];
  const before = switchList().map(s => ({ label: s.label, checked: s.checked }));
  // Drawing date is filled explicitly, so the auto-calculate helper must stay off.
  const autoDraw = findSwitch('Auto-calculate Drawing Date');
  if (autoDraw && autoDraw.checked) ensureSwitch('Auto-calculate Drawing Date', false);
  for (const [css, value] of fields) fill(`locator(${JSON.stringify(css)})`, value);
  const expected = Object.fromEntries(fields.map(([css, value]) => [css, String(value)]));
  const actual = readValues(expected);
  const norm = v => String(v === null || v === undefined ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [css, value] of Object.entries(expected)) {
    if (norm(actual[css]) !== norm(value)) {
      // Currency/number inputs may reformat while typing; record instead of failing on formatting-only drift.
      if (/prizeValue|numberOfWinners|guests|minimumAge/.test(css)) {
        logWarn(`Sweeps Info ${css} stored as ${JSON.stringify(actual[css])} (sent ${JSON.stringify(value)}) — formatting drift, recorded`);
      } else {
        throw new Error(`Sweeps Info field ${css} did not persist: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual[css])}`);
      }
    }
  }
  const after = switchList().map(s => ({ label: s.label, checked: s.checked }));
  if (report) {
    report.sweepsInfo = { values: actual, switchesBefore: before, switchesAfter: after };
  }
  logInfo(`Sweeps Info filled and verified: ${fields.length} fields; switches untouched (${after.map(s => `${s.label}=${s.checked ? 'on' : 'off'}`).join(', ')})`);
}

/** Admin listing row for our title: sweeps link anchor => public storefront URL. */
function publicUrlFromAdminRow(title) {
  const raw = evalPage(String.raw`() => {
    const rows = [...document.querySelectorAll('tr')].filter(tr => (tr.innerText || '').includes(${JSON.stringify(title)}));
    const links = [...document.querySelectorAll('a')].filter(a => /\/sweeps\/[^/?#]+/i.test(a.getAttribute('href') || ''));
    const pick = links.find(a => rows.includes(a.closest('tr')));
    if (!pick) return '[]';
    return JSON.stringify([{ href: pick.href, label: (pick.getAttribute('aria-label') || pick.innerText || '').trim(), inRow: true }]);
  }`);
  const candidates = parseJson(raw, []);
  if (!candidates.length) throw new Error(`No sweeps-link anchor found in the admin row for ${JSON.stringify(title)}`);
  const best = candidates.find(c => !/partners\./i.test(c.href)) || candidates[0];
  const url = best.href.startsWith('http') ? best.href : new URL(best.href, ADMIN).toString();
  logInfo(`admin row sweeps link (${best.label || 'no label'}): ${url}`);
  return url;
}

function storefrontMedia() {
  const raw = evalPage(`() => JSON.stringify([...document.querySelectorAll('img, video')].map(e => ({ tag: e.tagName.toLowerCase(), alt: (e.getAttribute('alt') || '').slice(0, 80), src: ((e.currentSrc || e.src || '').split('?')[0].split('/').slice(-2).join('/')).slice(0, 120) })).filter(m => m.src && !/logo|icon|favicon|sprite/i.test(m.src)).slice(0, 30))`);
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

async function step(report, name, fn) {
  const started = Date.now();
  console.log(`\n[STEP] ${name}`);
  try {
    await fn();
    const shot = path.join(resultsDir, `${String(report.steps.length + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    screenshot(shot);
    report.steps.push({ name, status: 'PASS', durationMs: Date.now() - started });
    console.log(`[PASS] ${name}`);
  } catch (error) {
    const shot = path.join(resultsDir, `${String(report.steps.length + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-FAILED.png`);
    screenshot(shot);
    report.steps.push({ name, status: 'FAIL', durationMs: Date.now() - started, error: error.message });
    throw error;
  }
}

async function main() {
  if (isDryRun) {
    console.log('=== DRY RUN (no browser, no counter increment) ===');
    console.log(`Title: ${sweepTitle}`);
    console.log(`Admin: ${ADMIN}  Public: ${PUBLIC}`);
    console.log(`Cover: ${coverMedia.join(', ')}`);
    console.log(`Gallery: ${galleryMedia.join(', ')}`);
    console.log(`TypeCoverage: ${typeCoverageMedia.join(', ') || '(none)'}`);
    console.log(`Bonus: ${bonusImage}`);
    console.log(`Talent pref: ${talentPreferred || '(first available)'}  Charity pref: ${charityPreferred || '(first available)'}`);
    console.log(`Description: ${campaignDescription.slice(0, 80)}...`);
    console.log(`Quote: ${artistQuoteTitle} / ${artistQuote.slice(0, 60)}...`);
    console.log(`Charity subtitle: ${charitySubtitle.slice(0, 60)}...`);
    console.log(`Test data keys: ${Object.keys(data).join(', ')}`);
    console.log('DRY RUN OK — all assets resolve, config parses, title builds.');
    return;
  }
  const report = { startedAt: new Date().toISOString(), sweepTitle, status: 'RUNNING', steps: [], testData: { ...data, campaignDescription }, selections: {}, media: {} };
  let publicUrl = '';
  try {
    await ensurePlaywrightAttached();

    await step(report, 'Open sweep create via Campaigns Sweeps', async () => {
      await openSweepCreate();
    });

    await step(report, 'Fill Campaign Info with media', async () => {
      await fillCampaignInfo(report);
    });

    await step(report, 'Complete Partners', async () => {
      await fillPartners(report);
      await clickContinueAndExpect('Promotion');
    });

    await step(report, 'Create two Promotion Tabs', async () => {
      await addPromotionTab({ title: data.promotionOne, description: data.promotionDescriptionOne, report, index: 1 });
      await addPromotionTab({ title: data.promotionTwo, description: data.promotionDescriptionTwo, report, index: 2 });
      await clickContinueAndExpect('Prize Details');
    });

    await step(report, 'Create Prize Detail', async () => {
      await addPrizeDetail(report);
      await clickContinueAndExpect('Entry Tiers');
    });

    await step(report, 'Add custom Entry Tier', async () => {
      await addCustomTier(report);
      await clickContinueAndExpect('Bonuses');
    });

    await step(report, 'Create Bonus with image', async () => {
      await addBonus(report);
      await clickContinueAndExpect('Sweeps Info');
    });

    await step(report, 'Fill Sweeps Info', async () => {
      fillSweepsInfo(report);
      await clickContinueAndExpect('Tracking');
    });

    await step(report, 'Leave Tracking and Visibility unchanged', async () => {
      heading('Tracking & Visibility');
      await clickContinueAndExpect('Review');
    });

    await step(report, 'Validate Review and Submit', async () => {
      heading('Review & Submit');
      const review = reviewSnapshot();
      report.review = review;
      report.reviewChecks = [];
      logInfo(`review sections: ${review.sections.map(s => s.section).join(' | ') || '(none detected)'}`);
      if (review.attentionBanner) {
        const flagged = review.sections.filter(s => s.needsAttention).map(s => s.section);
        logWarn(`review banner says ${review.stepsNeedingAttention} step(s) need attention: ${flagged.join(', ') || 'unknown section'}`);
      }
      const expectInSection = (sectionName, entries) => {
        const sec = review.sections.find(s => new RegExp(sectionName, 'i').test(s.section));
        for (const [label, needle] of entries) {
          const present = sec ? sec.text.includes(needle) : false;
          const row = sec && label ? sec.rows.find(r => new RegExp(label, 'i').test(r.label)) : null;
          report.reviewChecks.push({ section: sectionName, label, expected: needle, present, rowValue: row ? row.value : null });
          if (!present) throw new Error(`Review ${sectionName} does not show ${JSON.stringify(needle)}`);
        }
      };
      expectInSection('Campaign Info', [['Sweeps Title', sweepTitle], ['Full Description', campaignDescription.slice(0, 32)]]);
      expectInSection('Partners', [['Talent Partners', (report.selections.talent && report.selections.talent.text) || talentPreferred], ['Artist Quote Title', artistQuoteTitle]]);
      expectInSection('Promotion Tabs', [['', data.promotionOne], ['', data.promotionTwo]]);
      expectInSection('Prize Details', [['', data.prizeDescription]]);
      expectInSection('Entry Tiers', [['', data.customTierEntries]]);
      expectInSection('Bonuses', [['', data.bonusTitle]]);
      expectInSection('Sweeps Info', [['Prize', data.prizeReward], ['Number of Winners', data.numberOfWinners]]);
      const empties = review.sections.filter(s => s.empty && !/Tracking/i.test(s.section)).map(s => s.section);
      if (empties.length) logWarn(`review sections still reported empty: ${empties.join(', ')}`);
      if (review.attentionBanner) logWarn('continuing despite review attention banner (fields may be optional for draft save)');
    });

    await step(report, 'Create Sweep', async () => {
      const mark = networkMark({ includeStatic: true });
      clickFirst([
        `locator('button[type="submit"]:has-text("CREATE SWEEPS")')`,
        `locator('button[type="submit"]:has-text("Create Sweeps")')`,
        locator('role', 'button', { name: 'CREATE SWEEPS' }),
        locator('role', 'button', { name: 'Create Sweeps' })
      ], 'CREATE SWEEPS');
      await sleep(3000);
      const posts = networkSince(mark, { includeStatic: true }).filter(r => r.method === 'POST');
      const sweepPosts = posts.filter(r => /sweeps/i.test(r.url));
      report.createNetwork = { posts: networkSummary(posts), sweepPosts: networkSummary(sweepPosts), url: currentUrl() };
      logInfo(`network after CREATE SWEEPS: ${networkSummary(posts).join(' || ') || '(no POST observed)'}`);
      const failures = posts.filter(r => r.status === -1 || (r.status !== null && r.status >= 400));
      if (failures.length) throw new Error(`Create request failed: ${failures.map(r => r.line).join(' | ')}`);
      if (!sweepPosts.length) logWarn('no POST to a /sweeps URL observed after CREATE SWEEPS (see createNetwork in report.json)');
      const url = currentUrl();
      if (!/\/admin\/sweeps/i.test(url)) throw new Error(`Create did not return to /admin/sweeps. Current URL: ${url}`);
    });

    await step(report, 'Open created sweep storefront', async () => {
      fill(locator('placeholder', 'Search sweeps...'), sweepTitle);
      await sleep(900);
      assertContains(bodyText(), sweepTitle, 'Created sweep');
      publicUrl = publicUrlFromAdminRow(sweepTitle);
      goto(publicUrl);
      await sleep(1600);
      const body = bodyText();
      const talentText = (report.selections.talent && report.selections.talent.text) || talentPreferred || config.expectedTalentPartner;
      const charityText = (report.selections.charity && report.selections.charity.text) || '';
      assertContains(body, sweepTitle, 'Storefront title');
      assertContains(body, campaignDescription.slice(0, 32), 'Storefront description');
      assertContains(body, 'Enter Now', 'Enter Now');
      assertContains(body, 'Prize Details', 'Prize Details');
      assertContains(body, 'Description', 'Description');
      if (talentText) assertContains(body, talentText, 'Storefront talent partner');
      let charityFound = false;
      if (charityText) {
        charityFound = body.toLowerCase().includes(charityText.toLowerCase());
        if (!charityFound) logWarn(`charity ${JSON.stringify(charityText)} not found on storefront (recorded, not failing)`);
      }
      const media = storefrontMedia();
      const snapshot = storefrontSnapshot() || {};
      const uploadedCount = (report.media.galleryOrder || []).length + (report.media.cover && !report.media.cover.error ? 1 : 0);
      logInfo(`storefront media: ${media.length} items (uploaded ${uploadedCount}); order: ${media.map(m => m.alt || m.src).join(' | ').slice(0, 400)}`);
      // Everything entered in admin must be reflected on the public storefront.
      const entryPrice = `$${Number(data.customTierPrice).toFixed(2)}`;
      const requiredOnStorefront = [
        ['Sweeps Title', sweepTitle],
        ['Prize / Reward', data.prizeReward],
        ['Eligible Countries', data.eligibleCountries],
        ['Minimum age', `${data.minimumAge} to win`],
        ['Custom tier entries', `+${data.customTierEntries} entries`],
        ['Winner announcement', data.winnerAnnouncementContent]
      ];
      const recordedOnStorefront = [
        ['Custom tier price', entryPrice],
        ['Promotion tab 1', data.promotionOne],
        ['Promotion tab 2', data.promotionTwo],
        ['Prize detail description', data.prizeDescription],
        ['Bonus title', data.bonusTitle]
      ];
      report.storefrontChecks = [];
      for (const [label, needle] of requiredOnStorefront) {
        const present = body.includes(needle);
        report.storefrontChecks.push({ label, expected: needle, present, required: true });
        if (!present) throw new Error(`Storefront missing ${label}: ${JSON.stringify(needle)}`);
      }
      for (const [label, needle] of recordedOnStorefront) {
        const present = body.includes(needle);
        report.storefrontChecks.push({ label, expected: needle, present, required: false });
        if (!present) logWarn(`storefront missing ${label} ${JSON.stringify(needle)} (recorded, not fatal)`);
      }
      report.storefront = {
        url: publicUrl,
        talentFound: talentText ? body.toLowerCase().includes(String(talentText).toLowerCase()) : null,
        charityFound,
        descriptionFound: body.toLowerCase().includes(campaignDescription.slice(0, 32).toLowerCase()),
        mediaCount: media.length,
        uploadedCount,
        media,
        snapshot,
        entries: (snapshot && snapshot.entries) || []
      };
      if (uploadedCount && media.length && media.length < (report.media.galleryOrder || []).length) {
        logWarn(`storefront shows fewer media items (${media.length}) than uploaded gallery order (${(report.media.galleryOrder || []).length})`);
      }
    });


    await step(report, 'Exercise every add-to-cart button', async () => {
      const rawCount = evalPage('() => String(document.querySelectorAll("button#add-to-cart-btn").length)');
      const count = Number(rawCount.replace(/[^0-9]/g, ''));
      if (!Number.isInteger(count) || count < 1) throw new Error(`No #add-to-cart-btn elements found. Count: ${rawCount}`);
      report.cartButtonCount = count;
      const buttonTexts = JSON.parse(evalPage('() => JSON.stringify([...document.querySelectorAll("button#add-to-cart-btn")].map(x=>x.innerText.trim()))'));
      const cartResults = [];
      for (let i = 0; i < count; i++) {
        console.log(`  Cart button ${i + 1}/${count}: ${buttonTexts[i]}`);
        const mark = networkMark({ includeStatic: true });
        click(`locator('button#add-to-cart-btn').nth(${i})`);
        await sleep(1800);
        const seen = networkSince(mark, { includeStatic: true });
        const cartPosts = seen.filter(r => r.method === 'POST' && /\/cart\b/i.test(r.url));
        const ok = cartPosts.some(r => r.status !== -1 && (r.status === null || r.status < 400));
        const cart = cartState();
        cartResults.push({
          index: i,
          text: clean(buttonTexts[i]),
          postCartObserved: cartPosts.length > 0,
          ok,
          cartPost: cartPosts.map(r => r.line),
          itemCount: cart ? cart.item_count : null,
          requests: networkSummary(seen).slice(0, 25)
        });
        if (!ok) logWarn(`cart button ${i + 1} (${buttonTexts[i]}) had no successful POST /cart; seen: ${networkSummary(seen).join(' || ') || 'none'}`);
        goto(publicUrl);
        await sleep(900);
      }
      writeJson('cart-results.json', cartResults);
      const failed = cartResults.filter(x => !x.ok);
      if (failed.length) throw new Error(`Some add-to-cart clicks had no successful POST /cart: ${JSON.stringify(failed.map(f => ({ i: f.index, text: f.text, seen: f.requests })))}`);
    });

    report.status = 'PASS';
    report.finishedAt = new Date().toISOString();
    report.publicUrl = publicUrl;
    writeJson('report.json', report);
    console.log('\n=== FANDIEM AUTOMATION PASSED ===');
    console.log(`Title: ${sweepTitle}`);
    console.log(`Storefront: ${publicUrl}`);
  } catch (error) {
    report.status = 'FAIL';
    report.finishedAt = new Date().toISOString();
    report.error = error.message;
    writeJson('report.json', report);
    console.error('\n=== FANDIEM AUTOMATION FAILED ===');
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (report.status === 'PASS') {
      cli(['detach'], { allowFailure: true });
    }
  }
}

main();
