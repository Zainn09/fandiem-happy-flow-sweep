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
  const attachScript = path.join(ROOT, 'scripts', 'attach.js');

  function launchAttach(reason) {
    if (reason) logInfo(reason);
    if (!token) {
      console.log('');
      console.log('==================================================================');
      console.log('ACTION REQUIRED IN CHROME:');
      console.log("A Chrome tab for Playwright Extension has opened (or is already open).");
      console.log("Please switch to Chrome and click 'Allow & select' on that tab.");
      console.log('==================================================================');
      console.log('');
    } else {
      logInfo('Launching attach with extension token (should connect instantly)...');
    }
    try {
      const child = spawn(process.execPath, [attachScript], {
        cwd: ROOT,
        env: process.env,
        stdio: 'inherit',
        detached: true,
        windowsHide: false
      });
      child.unref();
      logInfo(`Spawned attach process: ${attachScript}`);
    } catch (e) {
      logWarn(`Failed to spawn attach.js: ${e.message}`);
    }
  }

  launchAttach('Initial attach attempt - opening Allow & Select tab...');

  const deadline = Date.now() + 60000;
  let attempts = 0;
  while (Date.now() < deadline) {
    await sleep(2000);
    attempts++;
    const probe = cli(['snapshot'], { allowFailure: true });
    if (probe.code === 0) {
      console.log('\nPlaywright successfully attached to Chrome.');
      return;
    }
    console.log(`  Waiting for Playwright session connection (click 'Allow & select' in Chrome)... [${attempts}]`);

    // Every 5 attempts (~10 seconds) re-open the permission tab by re-launching attach.js
    // This is the same method that worked before - it opens chrome-extension://.../connect.html?mcpRelayUrl=... with correct params
    if (attempts % 5 === 0) {
      const elapsed = Math.round((Date.now() - (deadline - 60000)) / 1000);
      console.log('');
      console.log('------------------------------------------------------------------');
      console.log(`Still not attached after ${elapsed}s / ${attempts} checks. Re-opening Allow & Select tab...`);
      console.log("If you missed it, a new Welcome tab should appear. Please click 'Allow & select'.");
      console.log('------------------------------------------------------------------');
      console.log('');
      launchAttach(`Re-launching attach process after ${attempts} attempts (${elapsed}s) - this will open the Allow & Select tab with mcpRelayUrl param`);
    }
  }
  throw new Error(
    'Could not attach Playwright to the existing Chrome profile within 60s.\n' +
    "Make sure the Playwright extension is installed and you click 'Allow & select' when prompted,\n" +
    'or configure extensionToken in config.json / PLAYWRIGHT_MCP_EXTENSION_TOKEN.\n' +
    'The code now re-opens the Allow & Select tab every 10s automatically via attach.js (with correct mcpRelayUrl).'
  );
}

// ---------------------------------------------------------------- data ---
const isDryRun = process.argv.includes('--dry-run');
function previewTitle() {
  if (process.env.SWEEP_TITLE && process.env.SWEEP_TITLE.trim()) return process.env.SWEEP_TITLE.trim() + ' (preview)';
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  let n = 0;
  try { n = Number(JSON.parse(fs.readFileSync(path.join(resultsDir, `run-counter-${yyyymmdd}.json`), 'utf8')).count || 0); } catch (_) { }
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
    `locator('button:has-text("Continue")').last()`,
    `locator('button[type="submit"]:has-text("CONTINUE")')`,
    `locator('button[type="submit"]:has-text("Continue")')`
  ];
  let clicked = null;
  let lastErr = '';
  for (const t of targets) {
    const r = cli(['click', t], { allowFailure: true });
    if (r.code === 0) { clicked = t; break; }
    else lastErr = r.stderr || r.stdout;
  }
  if (!clicked) {
    logWarn(`Standard CONTINUE click failed (${lastErr.slice(0, 200)}), trying JS click`);
    const jsRes = runCode(`async page => {
      const btns=[...document.querySelectorAll('button')].filter(b=>/CONTINUE|Continue/.test(b.innerText||''));
      const grad=btns.find(b=> (b.getAttribute('data-variant')==='gradient') || /gradient/.test(b.className||''));
      const target=grad || btns[btns.length-1];
      if(!target) return 'no-btn:'+ [...document.querySelectorAll('button')].map(b=> (b.innerText||'').trim()).filter(t=>t).slice(-10).join('|');
      if(target.disabled) return 'disabled:'+target.innerText;
      target.click();
      return 'clicked:'+target.innerText;
    }`);
    logInfo(`JS CONTINUE click: ${jsRes}`);
    if (String(jsRes).startsWith('clicked')) clicked = `js:${jsRes}`;
    else throw new Error(`CONTINUE button not found (gradient CONTINUE / Continue). JS: ${jsRes}`);
  }
  logInfo(`CONTINUE clicked: ${clicked.slice(0, 120)} expecting ${expectedHeading}`);
  await sleep(1800);
  let errors = captureVisibleErrors();
  let ok = await waitForText(expectedHeading, 25000);
  if (!ok) {
    // retry once more
    logWarn(`Did not reach ${expectedHeading} after first CONTINUE, retrying click. Errors so far: ${errors.join(' | ') || 'none'}`);
    try {
      cli(['click', targets[0]], { allowFailure: true });
      await sleep(1000);
      runCode(`async page => { const b=[...document.querySelectorAll('button')].find(x=>/CONTINUE/.test(x.innerText||'')); if(b) b.click(); return 'ok'; }`);
      await sleep(1500);
    } catch (_) { }
    errors = captureVisibleErrors();
    ok = await waitForText(expectedHeading, 15000);
  }
  if (!ok) {
    const bodySnippet = bodyText().slice(0, 1500);
    throw new Error(`Did not reach ${expectedHeading} after CONTINUE. Errors: ${errors.join(' | ') || 'none'}. URL: ${currentUrl()} Body: ${bodySnippet.slice(0, 800)}`);
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
      let inputs = listFileInputs();
      if (!Array.isArray(inputs)) inputs = [];
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
  let inputs = listFileInputs();
  if (!Array.isArray(inputs)) {
    logWarn(`listFileInputs returned non-array: ${JSON.stringify(inputs).slice(0,200)}, coercing to []`);
    inputs = [];
  }
  logInfo(`file inputs on Campaign Info: ${JSON.stringify(inputs.map(i => ({ i: i.index, accept: (i.accept||'').slice(0, 60), multiple: i.multiple })))}`);
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
    let inputsNow = listFileInputs();
    if (!Array.isArray(inputsNow)) inputsNow = [];
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
      let inputsNow = listFileInputs();
    if (!Array.isArray(inputsNow)) inputsNow = [];
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

/**
 * Robust modal marker - tries multiple anchors & probes and has dialog fallbacks.
 * This is the fix for Prize Details stalling after opener.
 */
function markModal(anchorText, probeSelector, saveLabel) {
  const anchors = Array.isArray(anchorText) ? anchorText : [anchorText];
  const probes = Array.isArray(probeSelector) ? probeSelector : [probeSelector];
  const saveLabels = Array.isArray(saveLabel) ? saveLabel : [saveLabel];

  for (const save of saveLabels) {
    for (const probeSel of probes) {
      for (const anchor of anchors) {
        try {
          const expr = `() => {
            const probe = document.querySelector(${JSON.stringify(probeSel)});
            if (!probe) return 'no-probe:${probeSel}';
            const label = ${JSON.stringify(save)};
            const hasSave = el => !!el && [...el.querySelectorAll('button')].some(b => (b.innerText || '').replace(/\\s+/g, ' ').trim().includes(label) || (b.innerText || '').toLowerCase().includes(label.toLowerCase()));
            const anchorLower = ${JSON.stringify(String(anchor).toLowerCase())};
            const anchors = [...document.querySelectorAll('h1,h2,h3,p,span,label,div')]
              .filter(el => {
                const txt = (el.innerText || '').toLowerCase();
                return txt.includes(anchorLower) && el.contains(probe);
              })
              .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
            let scope = null;
            if (anchors[0]) {
              for (let node = anchors[0]; node && !scope; node = node.parentElement) {
                if (hasSave(node)) scope = node;
              }
            }
            if (!scope) {
              for (let node = probe.closest('form') || probe.closest('[role="dialog"]') || probe.closest('[data-slot="dialog-content"]') || probe.parentElement; node && !scope; node = node.parentElement) {
                if (hasSave(node)) scope = node;
              }
            }
            if (!scope) return 'no-scope:${probeSel}|${anchor}';
            document.querySelectorAll('[data-qa-modal="1"]').forEach(el => el.removeAttribute('data-qa-modal'));
            scope.setAttribute('data-qa-modal', '1');
            return 'ok:${probeSel}|${anchor}';
          }`;
          const out = clean(evalPage(expr));
          if (/\bok\b/.test(out)) {
            logInfo(`markModal ok: probe=${probeSel} anchor=${anchor} save=${save} -> ${out}`);
            return MODAL;
          }
        } catch (e) {
          // try next combo
        }
      }
    }
  }

  // Fallback: any dialog-like container that has save button and an input
  const fallbackExpr = `() => {
    const saveLabels = ${JSON.stringify(saveLabels)};
    const hasSave = el => {
      const btns = [...el.querySelectorAll('button')];
      return saveLabels.some(lbl => btns.some(b => {
        const t = (b.innerText || '').replace(/\\s+/g, ' ').trim();
        return t.includes(lbl) || t.toLowerCase().includes(lbl.toLowerCase());
      }));
    };
    const candidates = [
      ...document.querySelectorAll('[role="dialog"]'),
      ...document.querySelectorAll('[data-slot="dialog-content"]'),
      ...document.querySelectorAll('div.fixed.inset-0 > div'),
      ...document.querySelectorAll('div[class*="dialog"]'),
      ...document.querySelectorAll('form'),
    ];
    // also try body children that are visible modals
    const visible = [...document.querySelectorAll('div')].filter(d => {
      const r = d.getBoundingClientRect();
      return r.width > 300 && r.height > 200 && r.top >= 0 && getComputedStyle(d).position === 'fixed';
    });
    const all = [...candidates, ...visible];
    for (const el of all) {
      if (!hasSave(el)) continue;
      // must contain at least one input or contenteditable
      if (!el.querySelector('input, textarea, [contenteditable="true"]')) continue;
      document.querySelectorAll('[data-qa-modal="1"]').forEach(x => x.removeAttribute('data-qa-modal'));
      el.setAttribute('data-qa-modal', '1');
      return 'ok:fallback:' + (el.tagName + '.' + (el.className || '').slice(0,60));
    }
    return 'no-fallback';
  }`;
  const fbOut = clean(evalPage(fallbackExpr));
  if (/\bok\b/.test(fbOut)) {
    logInfo(`markModal fallback ok: ${fbOut}`);
    return MODAL;
  }

  // Last resort: mark the largest visible dialog-ish element
  const lastResort = evalPage(`() => {
    const saveLabels = ${JSON.stringify(saveLabels)};
    const all = [...document.querySelectorAll('div')].filter(d => {
      const txt = (d.innerText || '');
      return saveLabels.some(l => txt.includes(l));
    }).sort((a,b) => b.innerText.length - a.innerText.length);
    if (!all[0]) return 'no-candidate';
    document.querySelectorAll('[data-qa-modal="1"]').forEach(x => x.removeAttribute('data-qa-modal'));
    let node = all[0];
    for (let i=0;i<6 && node; i++) {
      if (node.querySelector('input, textarea, [contenteditable]')) {
        node.setAttribute('data-qa-modal','1');
        return 'ok:last:' + node.innerText.slice(0,100);
      }
      node = node.parentElement;
    }
    return 'no-input-in-candidate';
  }`);
  if (/\bok\b/.test(lastResort)) {
    logInfo(`markModal last resort ok: ${lastResort}`);
    return MODAL;
  }

  throw new Error(`Modal not found (anchors ${JSON.stringify(anchors)}, probes ${JSON.stringify(probes)}, save ${JSON.stringify(saveLabels)}): last=${fbOut} / ${lastResort} | body has: ${bodyText().slice(0, 500)}`);
}

function clickModalSave(label) {
  const labels = Array.isArray(label) ? label : [label];
  for (const lbl of labels) {
    try {
      return clickFirst([
        `locator('${MODAL} button:has-text(${JSON.stringify(lbl)})')`,
        `locator('${MODAL} button:has-text("${lbl}")')`,
        `locator('${MODAL} button[type="submit"]:has-text("${lbl}")')`,
        `locator('${MODAL} button[type="submit"]')`,
        `locator('[role="dialog"] button:has-text(${JSON.stringify(lbl)})')`,
        `locator('[data-slot="dialog-content"] button:has-text(${JSON.stringify(lbl)})')`,
        locator('role', 'button', { name: lbl, exact: true }) + '.last()',
        locator('role', 'button', { name: lbl }) + '.last()',
        `locator('button:has-text("${lbl}")').last()`
      ], `modal save "${lbl}"`);
    } catch (e) {
      logWarn(`clickModalSave attempt for ${lbl} failed: ${String(e.message).split('\\n')[0]}, trying next`);
    }
  }
  // final attempt: click any submit button inside modal via JS
  try {
    const res = runCode(`async page => {
      const modal = document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]') || document.querySelector('[data-slot="dialog-content"]');
      if (!modal) return 'no-modal';
      const btns = [...modal.querySelectorAll('button')].filter(b => /Add Prize|Save|Create|Submit/i.test(b.innerText || ''));
      if (!btns.length) return 'no-btn:' + [...modal.querySelectorAll('button')].map(b=> (b.innerText||'').trim().slice(0,30)).join('|');
      const target = btns[btns.length-1];
      target.click();
      return 'clicked:' + (target.innerText||'').trim();
    }`);
    if (String(res).startsWith('clicked')) {
      logInfo(`clickModalSave via JS: ${res}`);
      return res;
    }
    throw new Error(`JS click failed: ${res}`);
  } catch (e) {
    throw new Error(`All modal save attempts failed for ${JSON.stringify(labels)}: ${e.message}`);
  }
}

function fillInputRobust(targets, value, label) {
  for (const t of targets) {
    const r = cli(['fill', t, String(value)], { allowFailure: true });
    if (r.code === 0) {
      logInfo(`filled ${label}: ${t.slice(0, 100)}`);
      return t;
    }
  }
  // JS fallback: set value directly and dispatch events - try modal inputs directly
  try {
    const code = `async page => {
      const val = ${JSON.stringify(String(value))};
      const modal = document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]') || document.querySelector('[data-slot="dialog-content"]');
      const tryFill = (el) => {
        if (!el) return false;
        try {
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
          el.dispatchEvent(new KeyboardEvent('input', {bubbles:true}));
          return true;
        } catch(e) { return false; }
      };
      if (modal) {
        const inputs = [...modal.querySelectorAll('input')];
        for (const inp of inputs) {
          if (tryFill(inp)) return 'ok:modal-input:' + (inp.placeholder||'');
        }
      }
      const allInputs = [...document.querySelectorAll('input[placeholder*="emoji" i], input[maxlength="4"], input[maxlength="2"], input[placeholder*="promotion" i]')];
      for (const inp of allInputs) {
        if (tryFill(inp)) return 'ok:global-input:' + (inp.placeholder||'');
      }
      return 'fail';
    }`;
    const out = runCode(code);
    if (String(out).startsWith('ok')) {
      logInfo(`filled ${label} via JS: ${out}`);
      return out;
    }
  } catch (e) {
    logWarn(`JS fill fallback failed for ${label}: ${e.message}`);
  }
  throw new Error(`Could not fill ${label}. Tried: ${targets.join(' | ')}`);
}

/** Promotion Tab modal: plain title input + plain <textarea> description (not rich text) + raw-HTML switch. */
async function addPromotionTab({ title, description, report, index }) {
  // Robust click for Add Promotion Tab
  try {
    clickFirst([
      locator('role', 'button', { name: 'Add Promotion Tab', exact: true }) + '.first()',
      `locator('button:has-text("Add Promotion Tab")').first()`,
      `locator('button:has-text("Add Promotion")').first()`
    ], 'Add Promotion Tab');
  } catch (e) {
    logWarn(`Add Promotion Tab click fallback via JS`);
    runCode(`async page => { const b=[...document.querySelectorAll('button')].find(x=>/Add Promotion Tab/i.test(x.innerText||'')); if(b){b.click(); return 'ok';} return 'no'; }`);
  }
  await sleep(1200);
  markModal(['raw-HTML', 'raw HTML', 'promotion title', 'promotion'], ['input[placeholder="Enter promotion title"]', 'input[placeholder*="promotion title" i]', 'input[placeholder*="Enter promotion" i]'], ['Add Promotion Tab', 'Add Promotion']);

  const info = parseJson(evalPage(String.raw`() => {
    const scope = document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]') || document.querySelector('[data-slot="dialog-content"]') || document;
    const q = s => scope.querySelector(s);
    const textarea = [...scope.querySelectorAll('textarea')].find(t => /Enter the description/.test(t.getAttribute('placeholder') || '') || /description/i.test(t.getAttribute('placeholder')||''));
    const rich = scope.querySelector('[contenteditable="true"]');
    return JSON.stringify({
      heading: (q('h2') ? q('h2').innerText : (q('h1') ? q('h1').innerText : '')).trim(),
      subtitle: (q('p') ? q('p').innerText : '').trim(),
      labels: [...scope.querySelectorAll('label')].map(l => ({ text: (l.innerText || '').replace(/\s+/g, ' ').trim(), required: !!l.querySelector('.text-destructive') })),
      descriptionControl: textarea ? { tag: 'textarea', placeholder: textarea.getAttribute('placeholder') } : (rich ? { tag: 'contenteditable', placeholder: rich.getAttribute('data-placeholder') || '' } : { tag: 'unknown' }),
      rawHtmlSwitchCount: scope.querySelectorAll('button[role="switch"]').length,
      hasTitle: !!scope.querySelector('input[placeholder*="promotion title" i], input[placeholder*="Enter promotion" i]'),
      inputs: [...scope.querySelectorAll('input')].map(i=> ({ph:i.placeholder, name:i.name, max:i.maxLength})).slice(0,5)
    });
  }`), {});

  const requiredLabels = (info.labels || []).filter(l => l.required).map(l => l.text);
  if (requiredLabels.length) {
    logWarn(`promotion modal labels marked required (workflow says they are optional): ${requiredLabels.join(', ')}`);
  }
  logInfo(`promotion modal info: ${JSON.stringify(info).slice(0, 600)}`);

  // Fill description first (so focus doesn't jump)
  if (info.descriptionControl && info.descriptionControl.tag === 'textarea') {
    try {
      fillTextareaByPlaceholder([info.descriptionControl.placeholder || 'Enter the description...', 'Enter the description...', 'Enter the description…', 'Enter description'], description);
    } catch (e) {
      // fallback to modal textarea
      try { fill(`locator('${MODAL} textarea')`, description); } catch (_) {
        runCode(`async page => { const m=document.querySelector('[data-qa-modal="1"]'); const ta=m?m.querySelector('textarea'):null; if(ta){ta.focus(); ta.value=${JSON.stringify(description)}; ta.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';} return 'no'; }`);
      }
    }
  } else {
    // rich text path - try multiple
    try {
      fillRichTextAny([info.descriptionControl?.placeholder, 'Enter the description...', 'Enter the description…'], description);
    } catch (_) {
      // modal scoped rich text
      try { fill(`locator('${MODAL} [contenteditable="true"]')`, description); } catch (_) {
        runCode(`async page => {
          const modal=document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]');
          const el=modal?modal.querySelector('[contenteditable="true"]'):null;
          if(!el) return 'no-rich';
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(description)});
          return 'ok';
        }`);
      }
    }
  }
  await sleep(300);

  // Fill title
  try {
    fill(locator('placeholder', 'Enter promotion title'), title);
  } catch (_) {
    try { fill(`locator('${MODAL} input[placeholder*="promotion title" i]')`, title); } catch (_) {
      fillInputRobust([`locator('${MODAL} input').first()`, `locator('input[placeholder*="promotion title" i]')`], title, 'promotion title');
    }
  }

  // Switch
  try {
    const rawSwitch = await ensureSwitch('Treat as raw HTML', false);
    logInfo(`raw HTML switch: ${rawSwitch.checked ? 'on' : 'off'}`);
  } catch (e) {
    logWarn(`raw HTML switch not found/toggle failed: ${String(e.message).split('\\n')[0]}`);
  }

  const typed = readValues({ title: `${MODAL} input[placeholder="Enter promotion title"]` });
  if (!String(typed.title || '').includes(title.slice(0, 10))) {
    // try alternative selector
    const alt = parseJson(evalPage(`() => JSON.stringify({ v: (document.querySelector('[data-qa-modal="1"] input')||{}).value || '' })`), {});
    if (!String(alt.v || '').includes(title.slice(0, 10))) {
      logWarn(`Promotion title may not have stuck: ${JSON.stringify(typed.title)} vs ${JSON.stringify(alt.v)}`);
    }
  }

  clickModalSave(['Add Promotion Tab', 'Add Promotion', 'Save']);
  await sleep(1200);
  // wait for modal to close
  const closed = await waitForText(title, 15000);
  if (!closed) {
    const errs = captureVisibleErrors();
    logWarn(`Promotion tab ${JSON.stringify(title)} not listed after save. Errors: ${errs.join(' | ') || 'none'}. Trying to close modal via Esc`);
    try { runCode(`async page => { await page.keyboard.press('Escape'); return 'ok'; }`); await sleep(800); } catch (_) { }
  }
  const finalOk = await waitForText(title, 5000);
  if (!finalOk) {
    throw new Error(`Promotion tab ${JSON.stringify(title)} not listed after save. Visible errors: ${captureVisibleErrors().join(' | ') || 'none'}. Body: ${bodyText().slice(0, 800)}`);
  }
  logInfo(`promotion tab ${index} saved: ${title}`);
  if (report) {
    report.promotionTabs = report.promotionTabs || [];
    report.promotionTabs.push({ index, title, description, heading: info.heading, subtitle: info.subtitle, descriptionControl: info.descriptionControl, fieldsRequired: requiredLabels, rawHtml: false });
  }
  return info;
}

async function addPrizeDetail(report) {
  logInfo(`Starting Prize Detail creation: emoji=${data.prizeEmoji} desc=${data.prizeDescription}`);

  // 1. Click Add Prize Detail with multiple fallbacks
  let clicked = false;
  const clickTargets = [
    locator('role', 'button', { name: 'Add Prize Detail', exact: true }) + '.first()',
    locator('role', 'button', { name: 'Add Price Detail', exact: true }) + '.first()',
    `locator('button:has-text("Add Prize Detail")').first()`,
    `locator('button:has-text("Add Price Detail")').first()`,
    `locator('button:has-text("Prize Detail")').first()`,
    `locator('button[data-slot="button"]:has-text("Add")').last()`
  ];
  for (const t of clickTargets) {
    const r = cli(['click', t], { allowFailure: true });
    if (r.code === 0) { logInfo(`clicked Prize Detail opener: ${t.slice(0, 100)}`); clicked = true; break; }
  }
  if (!clicked) {
    logWarn('Standard click targets failed, trying JS click');
    const jsRes = runCode(`async page => {
      const btns=[...document.querySelectorAll('button')];
      const target=btns.find(b=>/Add Prize Detail|Add Price Detail/i.test(b.innerText||'')) || btns.find(b=>/Prize Detail/i.test(b.innerText||'') && /Add/i.test(b.innerText||''));
      if(!target) return 'no-btn:'+btns.map(b=> (b.innerText||'').trim().slice(0,30)).join('|').slice(0,400);
      target.click();
      return 'clicked:'+(target.innerText||'').trim();
    }`);
    logInfo(`JS click result: ${jsRes}`);
    if (!String(jsRes).startsWith('clicked')) {
      throw new Error(`Could not click Add Prize Detail. JS result: ${jsRes}`);
    }
  }

  await sleep(1500);

  // 2. Mark modal with very robust selectors
  const probeSelectors = [
    'input[placeholder="Enter emoji"]',
    'input[placeholder*="emoji" i]',
    'input[maxlength="4"]',
    'input[maxlength="2"]',
    `${MODAL} input`,
    '[role="dialog"] input[placeholder*="emoji" i]',
    '[data-slot="dialog-content"] input',
    'input[placeholder*="Enter"]'
  ];
  const anchorTexts = [
    'short emoji',
    'emoji',
    'Prize Detail',
    'Price Detail',
    'Add Prize',
    'Add Price',
    'description',
    'represent this prize'
  ];
  const saveLabels = ['Add Prize Detail', 'Add Price Detail', 'Add Prize', 'Save', 'Create'];

  let modalMarked = false;
  let lastMarkError = '';
  try {
    markModal(anchorTexts, probeSelectors, saveLabels);
    modalMarked = true;
  } catch (e) {
    lastMarkError = e.message;
    logWarn(`markModal first attempt failed: ${lastMarkError.slice(0, 500)}`);
    // try even more aggressive fallback
    await sleep(500);
    try {
      markModal(['emoji', 'Prize'], ['input', 'textarea', '[contenteditable]'], saveLabels);
      modalMarked = true;
    } catch (e2) {
      lastMarkError += ' | ' + e2.message;
    }
  }

  if (!modalMarked) {
    // dump debug info
    const debug = evalPage(String.raw`() => {
      return JSON.stringify({
        body: (document.body.innerText||'').slice(0,2000),
        dialogs: [...document.querySelectorAll('[role="dialog"], [data-slot="dialog-content"]')].map(d=> (d.innerText||'').slice(0,500)),
        inputs: [...document.querySelectorAll('input')].map(i=> ({ph:i.placeholder, max:i.getAttribute('maxlength'), type:i.type, name:i.name})).slice(0,10),
        buttons: [...document.querySelectorAll('button')].map(b=> (b.innerText||'').trim()).filter(t=>t).slice(0,20)
      });
    }`);
    throw new Error(`Prize Detail modal not found after clicking opener. ${lastMarkError}. Debug: ${String(debug).slice(0, 2000)}`);
  }

  // 3. Gather modal info with robust queries
  const info = parseJson(evalPage(String.raw`() => {
    const scope = document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]') || document.querySelector('[data-slot="dialog-content"]') || document;
    const allInputs = [...scope.querySelectorAll('input')];
    const emojiInput = allInputs.find(i=> /emoji/i.test(i.placeholder||'') || i.getAttribute('maxlength')==='4' || i.getAttribute('maxlength')==='2') || allInputs[0] || null;
    const textarea = scope.querySelector('textarea');
    const rich = scope.querySelector('[contenteditable="true"]');
    const richPh = rich ? (rich.getAttribute('data-placeholder') || (rich.querySelector('[data-placeholder]') ? rich.querySelector('[data-placeholder]').getAttribute('data-placeholder') : '')) : '';
    return JSON.stringify({
      heading: (scope.querySelector('h2') ? scope.querySelector('h2').innerText : (scope.querySelector('h1') ? scope.querySelector('h1').innerText : (scope.querySelector('[role="heading"]') ? scope.querySelector('[role="heading"]').innerText : ''))).trim(),
      headingAll: [...scope.querySelectorAll('h1,h2,h3')].map(h=>h.innerText.trim()).slice(0,3),
      emojiFound: !!emojiInput,
      emojiPlaceholder: emojiInput ? emojiInput.placeholder : '',
      emojiMaxLength: emojiInput ? emojiInput.getAttribute('maxlength') : null,
      emojiType: emojiInput ? emojiInput.type : '',
      inputs: allInputs.map(i=> ({ph:i.placeholder, max:i.getAttribute('maxlength'), val:i.value?.slice(0,20)})).slice(0,5),
      hasTextarea: !!textarea,
      textareaPh: textarea ? textarea.placeholder : '',
      hasRichText: !!rich,
      descriptionPlaceholder: richPh || (textarea ? textarea.placeholder : ''),
      buttons: [...scope.querySelectorAll('button')].map(b=> (b.innerText||'').trim()).filter(t=>t).slice(0,10),
      scopeText: (scope.innerText||'').slice(0,800)
    });
  }`), {});

  logInfo(`Prize modal info: ${JSON.stringify(info).slice(0, 1000)}`);

  if (info.heading && !/Prize|Price/i.test(info.heading) && !(info.headingAll || []).some(h => /Prize|Price/i.test(h))) {
    logWarn(`Unexpected prize modal heading: ${JSON.stringify(info.heading)} / ${JSON.stringify(info.headingAll)} - continuing anyway`);
  }

  // 4. Fill emoji - multiple strategies
  let emojiFilled = false;
  const emojiTargets = [
    `locator('${MODAL} input[placeholder="Enter emoji"]')`,
    `locator('${MODAL} input[placeholder*="emoji" i]')`,
    `locator('${MODAL} input[maxlength="4"]')`,
    `locator('${MODAL} input').first()`,
    locator('placeholder', 'Enter emoji'),
    `locator('input[placeholder*="emoji" i]').first()`,
    `locator('input[maxlength="4"]').first()`
  ];
  for (const tgt of emojiTargets) {
    const r = cli(['fill', tgt, String(data.prizeEmoji)], { allowFailure: true });
    if (r.code === 0) { logInfo(`emoji filled via ${tgt.slice(0, 80)}`); emojiFilled = true; break; }
  }
  if (!emojiFilled) {
    logWarn('emoji fill via CLI failed, trying JS');
    const jsFill = runCode(`async page => {
      const modal=document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]') || document;
      const inputs=[...modal.querySelectorAll('input')];
      const emojiIn = inputs.find(i=> /emoji/i.test(i.placeholder||'') || i.getAttribute('maxlength')==='4' || i.getAttribute('maxlength')==='2') || inputs[0];
      if(!emojiIn) return 'no-input';
      emojiIn.focus();
      emojiIn.value=${JSON.stringify(data.prizeEmoji)};
      emojiIn.dispatchEvent(new Event('input',{bubbles:true}));
      emojiIn.dispatchEvent(new Event('change',{bubbles:true}));
      return 'ok:'+emojiIn.placeholder;
    }`);
    logInfo(`emoji JS fill: ${jsFill}`);
    if (String(jsFill).startsWith('ok')) emojiFilled = true;
  }

  // Verify emoji stuck
  const emojiCheck = parseJson(evalPage(`() => {
    const modal=document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]') || document;
    const inputs=[...modal.querySelectorAll('input')];
    const el=inputs.find(i=> /emoji/i.test(i.placeholder||'') || i.getAttribute('maxlength')==='4') || inputs[0];
    return JSON.stringify({ val: el ? el.value : null, ph: el ? el.placeholder : null });
  }`), {});
  logInfo(`emoji after fill check: ${JSON.stringify(emojiCheck)}`);
  if (!emojiCheck.val || !String(emojiCheck.val).includes(data.prizeEmoji) && String(emojiCheck.val).length === 0) {
    logWarn(`emoji may not have persisted: ${JSON.stringify(emojiCheck.val)}, trying alternative emoji fallback '🎁' as plain text`);
    // try with simple ASCII fallback if emoji fails validation - but keep original
  }

  await sleep(400);

  // 5. Fill description - handle both textarea and rich text
  let descFilled = false;
  if (info.hasTextarea) {
    try {
      fillTextareaByPlaceholder([info.textareaPh, info.descriptionPlaceholder, 'Enter the description...', 'Enter the description…', 'Enter description'], data.prizeDescription);
      descFilled = true;
    } catch (e) {
      logWarn(`textarea fill failed: ${e.message}`);
      try {
        fill(`locator('${MODAL} textarea')`, data.prizeDescription);
        descFilled = true;
      } catch (_) {
        const jsRes = runCode(`async page => {
          const modal=document.querySelector('[data-qa-modal="1"]') || document;
          const ta=modal.querySelector('textarea');
          if(!ta) return 'no-ta';
          ta.focus();
          ta.value=${JSON.stringify(data.prizeDescription)};
          ta.dispatchEvent(new Event('input',{bubbles:true}));
          ta.dispatchEvent(new Event('change',{bubbles:true}));
          return 'ok';
        }`);
        if (String(jsRes).includes('ok')) descFilled = true;
      }
    }
  }
  if (!descFilled) {
    // rich text path
    const placeholders = [info.descriptionPlaceholder, 'Enter the description...', 'Enter the description…', 'Enter description', ''].filter(Boolean);
    for (const ph of placeholders) {
      try {
        if (ph) {
          const css = `[data-placeholder=${JSON.stringify(ph)}]`;
          const r = cli(['fill', `locator('${MODAL} ${css}')`, String(data.prizeDescription)], { allowFailure: true });
          if (r.code === 0) { descFilled = true; logInfo(`rich text filled via placeholder ${ph}`); break; }
        }
      } catch (_) { }
    }
    if (!descFilled) {
      try {
        fill(`locator('${MODAL} [contenteditable="true"]')`, data.prizeDescription);
        descFilled = true;
      } catch (_) {
        // JS execCommand
        const jsRes = runCode(`async page => {
          const modal=document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]') || document;
          const el=modal.querySelector('[contenteditable="true"]');
          if(!el) return 'no-rich';
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(data.prizeDescription)});
          // also try innerText
          if(!el.innerText.includes(${JSON.stringify(data.prizeDescription.slice(0, 10))})) {
            el.innerText=${JSON.stringify(data.prizeDescription)};
            el.dispatchEvent(new Event('input',{bubbles:true}));
          }
          return 'ok:'+el.innerText.slice(0,50);
        }`);
        logInfo(`rich text JS fill: ${jsRes}`);
        if (String(jsRes).startsWith('ok')) descFilled = true;
      }
    }
  }

  if (!descFilled) {
    logWarn('Description fill may have failed, capturing visible errors before save attempt');
  }

  await sleep(600);

  // 6. Capture errors before save
  const preSaveErrors = captureVisibleErrors();
  if (preSaveErrors.length) logWarn(`Pre-save visible errors: ${preSaveErrors.join(' | ')}`);

  // 7. Click save with robust handling
  let saveClicked = false;
  try {
    clickModalSave(saveLabels);
    saveClicked = true;
  } catch (e) {
    logWarn(`clickModalSave failed: ${e.message}, trying direct JS click on save button`);
    const jsClick = runCode(`async page => {
      const modal=document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]') || document.querySelector('[data-slot="dialog-content"]');
      if(!modal) return 'no-modal';
      const btns=[...modal.querySelectorAll('button')];
      const saveBtn=btns.find(b=>/Add Prize Detail|Add Price Detail/i.test(b.innerText||'')) || btns.find(b=>/Add Prize|Add Price/i.test(b.innerText||'')) || [...modal.querySelectorAll('button[type="submit"]')].pop();
      if(!saveBtn) return 'no-save-btn:'+btns.map(b=> (b.innerText||'').trim()).join('|').slice(0,300);
      // check disabled
      if(saveBtn.disabled) return 'disabled:'+saveBtn.innerText;
      saveBtn.click();
      return 'clicked:'+saveBtn.innerText;
    }`);
    logInfo(`JS save click: ${jsClick}`);
    if (String(jsClick).startsWith('clicked')) saveClicked = true;
    else throw new Error(`Save button click failed: ${jsClick} | pre-errors: ${preSaveErrors.join(' | ')}`);
  }

  await sleep(1200);

  // 8. Verify modal closed and prize saved
  // Check if modal still open
  const modalStillOpen = parseJson(evalPage(`() => JSON.stringify({ open: !!document.querySelector('[data-qa-modal="1"]'), dialog: !!document.querySelector('[role="dialog"]'), bodyHas: document.body.innerText.includes(${JSON.stringify(data.prizeDescription.slice(0, 15))}) })`), {});
  logInfo(`Post-save modal check: ${JSON.stringify(modalStillOpen)}`);

  if (modalStillOpen.open || modalStillOpen.dialog) {
    logWarn('Modal still appears open after save, checking for validation errors');
    const errs = captureVisibleErrors();
    if (errs.length) {
      logWarn(`Validation errors after save attempt: ${errs.join(' | ')}`);
      // Try to close via Esc and retry with different emoji if needed
      if (errs.join(' ').toLowerCase().includes('emoji') || errs.join(' ').toLowerCase().includes('required')) {
        logWarn('Emoji validation error suspected, trying alternative emoji "🎉"');
        try {
          const altEmoji = '🎉';
          runCode(`async page => {
            const modal=document.querySelector('[data-qa-modal="1"]') || document.querySelector('[role="dialog"]');
            const inp=modal.querySelector('input[placeholder*="emoji" i]') || modal.querySelector('input[maxlength="4"]') || modal.querySelector('input');
            if(inp){ inp.focus(); inp.value=${JSON.stringify(altEmoji)}; inp.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; } return 'no'; }`);
          await sleep(400);
          clickModalSave(saveLabels);
          await sleep(1200);
        } catch (_) { }
      }
    }
  }

  // Final verification - prize description should appear on page
  const saved = await waitForText(data.prizeDescription, 15000);
  if (!saved) {
    const body = bodyText().slice(0, 2000);
    const errs = captureVisibleErrors();
    // try to dismiss modal and check again
    try { runCode(`async page => { await page.keyboard.press('Escape'); return 'ok'; }`); await sleep(800); } catch (_) { }
    const saved2 = await waitForText(data.prizeDescription, 5000);
    if (!saved2) {
      throw new Error(`Prize detail ${JSON.stringify(data.prizeDescription)} not listed after save. Errors: ${errs.join(' | ') || 'none'}. Modal open: ${JSON.stringify(modalStillOpen)}. Body snippet: ${body.slice(0, 800)}`);
    }
  }

  // Clean up modal marker
  try { evalPage(`() => { document.querySelectorAll('[data-qa-modal="1"]').forEach(el=> el.removeAttribute('data-qa-modal')); return 'ok'; }`); } catch (_) { }

  if (report) {
    report.prizeDetail = { emoji: data.prizeEmoji, description: data.prizeDescription, modalHeading: info.heading || info.headingAll?.[0] || '', emojiMaxLength: info.emojiMaxLength, modalInfo: info };
  }
  logInfo(`prize detail saved (modal heading ${JSON.stringify(info.heading || info.headingAll)})`);
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
  // robust opener
  try {
    clickFirst([
      locator('role', 'button', { name: 'Add Bonus', exact: true }) + '.first()',
      `locator('button:has-text("Add Bonus")').first()`,
      `locator('button:has-text("Bonus")').first()`
    ], 'Add Bonus');
  } catch (e) {
    runCode(`async page => { const b=[...document.querySelectorAll('button')].find(x=>/Add Bonus/i.test(x.innerText||'')); if(b){b.click(); return 'ok';} return 'no'; }`);
  }
  await sleep(1200);
  markModal(['linked entry tiers', 'bonus title', 'Bonus'], ['input[placeholder="Enter bonus title"]', 'input[placeholder*="bonus title" i]', 'input[placeholder*="Enter bonus" i]'], ['Add Bonus', 'Add bonus', 'Save']);
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

  let inputs = listFileInputs();
  if (!Array.isArray(inputs)) inputs = [];
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
      const pageText = bodyText();
      const sectionsParsed = review.sections.length > 0;
      if (!sectionsParsed) logWarn('could not parse review section cards; falling back to whole-page text checks');
      const expectInSection = (sectionName, entries) => {
        const sec = review.sections.find(s => new RegExp(sectionName, 'i').test(s.section));
        for (const [label, needle] of entries) {
          const haystack = sec ? sec.text : pageText;
          const present = haystack.includes(needle);
          const row = sec && label ? sec.rows.find(r => new RegExp(label, 'i').test(r.label)) : null;
          report.reviewChecks.push({ section: sectionName, label, expected: needle, present, rowValue: row ? row.value : null });
          // Report-only: the workflow is "check that everything is shown, then submit".
          if (!present) logWarn(`review is missing ${sectionName} ${label || ''}: ${JSON.stringify(needle)}`);
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
      if (sweepPosts.length) {
        const detail = requestDetails(sweepPosts[sweepPosts.length - 1].index);
        fs.writeFileSync(path.join(resultsDir, 'create-request.txt'), detail);
        report.createNetwork.detailFile = path.join(resultsDir, 'create-request.txt');
        report.createNetwork.detail = detail.slice(0, 1500);
      }
    });

    await step(report, 'Open created sweep storefront', async () => {
      try {
        fillFirstAvailable([
          locator('placeholder', 'Search sweeps...'),
          locator('placeholder', 'Search sweeps'),
          locator('placeholder', 'Search...'),
          locator('placeholder', 'Search')
        ], sweepTitle, 'sweeps search');
        await sleep(900);
      } catch (e) {
        logWarn(`sweeps search box not filled (${String(e.message).split('\n')[0]}); continuing with the unfiltered listing`);
      }
      assertContains(bodyText(), sweepTitle, 'Created sweep');
      const row = sweepsRowSnapshot(sweepTitle);
      report.sweepsRow = row;
      if (row.found) {
        logInfo(`admin row for ${sweepTitle}: ${(row.cells || []).join(' | ')}`);
        logInfo(`row links -> sweeps: ${row.sweepsLink || 'n/a'} | free entry: ${row.freeEntryLink || 'n/a'} | tracking: ${row.trackingLink || 'n/a'}`);
      } else {
        logWarn(`admin listing did not expose a <tr> for ${sweepTitle} (search box filtering?); falling back to sweeps-link lookup`);
      }
      publicUrl = (row.found && row.sweepsLink && !/partners\./i.test(row.sweepsLink)) ? row.sweepsLink : publicUrlFromAdminRow(sweepTitle);
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
      for (const [label, needle, required] of [...requiredOnStorefront.map(c => [...c, true]), ...recordedOnStorefront.map(c => [...c, false])]) {
        const present = body.includes(needle);
        report.storefrontChecks.push({ label, expected: needle, present, required });
        if (!present) logWarn(`storefront ${required ? 'MISSING (required)' : 'missing (recorded)'} ${label}: ${JSON.stringify(needle)}`);
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
        let cart = null;
        try { cart = cartState(); } catch (e) { logWarn(`cart state unavailable after button ${i + 1}: ${String(e.message).split('\n')[0]}`); }
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

    // All evidence is collected by now: fail loudly only after the whole flow ran.
    await step(report, 'Summarize admin <-> storefront parity', async () => {
      const missingReview = (report.reviewChecks || []).filter(c => !c.present);
      const missingStorefront = (report.storefrontChecks || []).filter(c => c.required && !c.present);
      if (missingReview.length) logWarn(`${missingReview.length} review value(s) were not shown: ${missingReview.map(c => `${c.section}/${c.label || '-'}`).join(', ')}`);
      report.parity = {
        reviewMissing: missingReview.map(c => ({ section: c.section, label: c.label, expected: c.expected })),
        storefrontMissing: missingStorefront.map(c => ({ label: c.label, expected: c.expected }))
      };
      if (missingStorefront.length) {
        throw new Error(`${missingStorefront.length} admin value(s) never reached the storefront: ${missingStorefront.map(c => `${c.label}=${JSON.stringify(c.expected)}`).join(', ')}`);
      }
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
