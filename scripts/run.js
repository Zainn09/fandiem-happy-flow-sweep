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
  fillRichTextByPlaceholder, waitForText
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
  customTierEntries: '500',
  customTierPrice: '75',
  customTierImpact: `Automated tier impact ${stamp}`,
  bonusTitle: `QA Bonus ${stamp}`,
  bonusDescription: `Automated bonus ${stamp}`,
  prizeReward: `QA Reward ${stamp}`,
  numberOfWinners: '1',
  numberOfGuests: '2',
  prizeValue: '1000',
  minimumAge: '18',
  eligibleCountries: 'US',
  startDate: futureDate(1),
  endDate: futureDate(8)
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
async function attemptUpload({ dropTarget, clickTarget, inputNth, absPaths, label }) {
  const names = absPaths.map(p => path.basename(p)).join(',');
  const beforeTiles = galleryTileCount();
  const beforeItems = itemsNumber();
  const errors = [];

  async function verify(tag) {
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
    const grew = await verify('drop');
    if (grew) return { strategy: 'drop', files: absPaths.slice(), ...grew };
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
      const grew = await verify(`setInputFiles[${idx}]`);
      if (grew) return { strategy: `setInputFiles[${idx}]`, files: absPaths.slice(), ...grew };
      errors.push(`setInputFiles[${idx}]: no new media detected`);
    } catch (e) { errors.push(`setInputFiles: ${String(e.message).split('\n')[0]}`); }
  }

  // 3) click + upload (file chooser)
  try {
    logInfo(`${label}: strategy=click+upload clickTarget=${clickTarget} files=${names}`);
    cli(['click', clickTarget]);
    await sleep(900);
    uploadFiles(absPaths);
    const grew = await verify('click+upload');
    if (grew) return { strategy: 'click+upload', files: absPaths.slice(), ...grew };
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
function addPromotion(title, description) {
  click(locator('role', 'button', { name: 'Add Promotion Tab', exact: true }) + '.first()');
  heading('Add Promotion Tab');
  fill(locator('placeholder', 'Enter promotion title'), title);
  richText(description);
  click(locator('role', 'button', { name: 'Add Promotion Tab', exact: true }) + '.last()');
  assertContains(bodyText(), title, 'Promotion tab');
}

function addPrizeDetail() {
  click(locator('role', 'button', { name: 'Add Prize Detail', exact: true }) + '.first()');
  const body = bodyText();
  if (!/Add Pri(ze|ce) Detail/i.test(body)) throw new Error('Add Prize Detail modal did not open.');
  fill(locator('placeholder', 'Enter emoji'), data.prizeEmoji);
  richText(data.prizeDescription);
  click(locator('role', 'button', { name: 'Add Prize Detail', exact: true }) + '.last()');
  assertContains(bodyText(), data.prizeDescription, 'Prize detail');
}

function addCustomTier() {
  click(locator('role', 'button', { name: 'Add Entry Tier', exact: true }));
  const countText = evalPage('() => String(document.querySelectorAll(\'input[name^="entryTiers.tiers."][name$=".entries"]\').length)');
  const count = Number(countText.replace(/[^0-9]/g, ''));
  if (!count) throw new Error(`Could not determine entry-tier count: ${countText}`);
  const i = count - 1;
  fill(`locator('input[name="entryTiers.tiers.${i}.entries"]')`, data.customTierEntries);
  fill(`locator('input[name="entryTiers.tiers.${i}.price"]')`, data.customTierPrice);
  fill(`locator('input[name="entryTiers.tiers.${i}.impact"]')`, data.customTierImpact);
  assertContains(bodyText(), data.customTierImpact, 'Custom entry tier');
}

async function addBonus(report) {
  click(locator('role', 'button', { name: 'Add Bonus', exact: true }) + '.first()');
  heading('Add Bonus');
  fill(locator('placeholder', 'Enter bonus title'), data.bonusTitle);
  richText(data.bonusDescription);
  const inputs = listFileInputs();
  const res = await attemptUpload({
    dropTarget: `locator('div:has-text("Drag & drop or click to upload")').last()`,
    clickTarget: `locator('div:has-text("Drag & drop or click to upload")').last()`,
    inputNth: inputs.length ? -1 : null,
    absPaths: [bonusImage],
    label: 'Bonus'
  });
  report.media.bonus = { file: path.basename(bonusImage), strategy: res.strategy };
  click(locator('role', 'button', { name: 'Add Bonus', exact: true }) + '.last()');
  assertContains(bodyText(), data.bonusTitle, 'Bonus');
}

function fillSweepsInfo() {
  heading('Sweeps Info');
  const fields = [
    ['input[name="prizeDetails.prizeTitle"]', data.prizeReward],
    ['input[name="prizeDetails.numberOfWinners"]', data.numberOfWinners],
    ['input[name="prizeDetails.guests"]', data.numberOfGuests],
    ['input[name="prizeDetails.prizeValue"]', data.prizeValue],
    ['input[name="rulesDates.minimumAge"]', data.minimumAge],
    ['input[name="rulesDates.eligibleCountries"]', data.eligibleCountries],
    ['input[name="rulesDates.startDate"]', data.startDate],
    ['input[name="rulesDates.endDate"]', data.endDate]
  ];
  for (const [css, value] of fields) fill(`locator(${JSON.stringify(css)})`, value);
}

function publicUrlFromAdminRow(title) {
  const script = `() => { const links=[...document.querySelectorAll('a[aria-label="Sweeps link"]')]; const link=links.find(a=>(a.closest('tr')?.innerText||'').includes(${JSON.stringify(title)})); return link?.href||''; }`;
  const href = evalPage(script);
  if (!href) throw new Error(`No Sweeps link found for ${title}`);
  return new URL(href, PUBLIC).toString();
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
      addPromotion(data.promotionOne, data.promotionDescriptionOne);
      addPromotion(data.promotionTwo, data.promotionDescriptionTwo);
      await clickContinueAndExpect('Prize Details');
    });

    await step(report, 'Create Prize Detail', async () => {
      addPrizeDetail();
      await clickContinueAndExpect('Entry Tiers');
    });

    await step(report, 'Add custom Entry Tier', async () => {
      addCustomTier();
      await clickContinueAndExpect('Bonuses');
    });

    await step(report, 'Create Bonus with image', async () => {
      await addBonus(report);
      await clickContinueAndExpect('Sweeps Info');
    });

    await step(report, 'Fill Sweeps Info', async () => {
      fillSweepsInfo();
      await clickContinueAndExpect('Tracking');
    });

    await step(report, 'Leave Tracking and Visibility unchanged', async () => {
      heading('Tracking & Visibility');
      await clickContinueAndExpect('Review');
    });

    await step(report, 'Validate Review and Submit', async () => {
      heading('Review & Submit');
      const body = bodyText();
      assertAbsent(body, 'needs your attention', 'Review');
      assertContains(body, sweepTitle, 'Review title');
      assertContains(body, data.promotionOne, 'Review promotion 1');
      assertContains(body, data.promotionTwo, 'Review promotion 2');
      assertContains(body, data.prizeDescription, 'Review prize detail');
      assertContains(body, data.customTierImpact, 'Review custom tier');
      assertContains(body, data.bonusTitle, 'Review bonus');
      assertContains(body, data.prizeReward, 'Review reward');
    });

    await step(report, 'Create Sweep', async () => {
      clickFirst([
        locator('role', 'button', { name: 'CREATE SWEEPS' }),
        locator('role', 'button', { name: 'Create Sweeps' }),
        `locator('button:has-text("CREATE SWEEPS")')`,
        `locator('button:has-text("Create Sweeps")')`
      ], 'CREATE SWEEPS');
      await sleep(2000);
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
      const uploadedCount = (report.media.galleryOrder || []).length + (report.media.cover && !report.media.cover.error ? 1 : 0);
      logInfo(`storefront media: ${media.length} items (uploaded ${uploadedCount}); order: ${media.map(m => m.alt || m.src).join(' | ').slice(0, 400)}`);
      report.storefront = {
        url: publicUrl,
        talentFound: talentText ? body.toLowerCase().includes(String(talentText).toLowerCase()) : null,
        charityFound,
        descriptionFound: body.toLowerCase().includes(campaignDescription.slice(0, 32).toLowerCase()),
        mediaCount: media.length,
        uploadedCount,
        media
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
        const before = currentUrl();
        click(`locator('button#add-to-cart-btn').nth(${i})`);
        await sleep(700);
        const requests = cli(['requests'], { raw: true, allowFailure: true }).stdout;
        const observed = /POST[^\n]*\/cart/i.test(requests);
        cartResults.push({ index: i, text: clean(buttonTexts[i]), postCartObserved: observed });
        goto(before || publicUrl);
        await sleep(700);
      }
      writeJson('cart-results.json', cartResults);
      const failed = cartResults.filter(x => !x.postCartObserved);
      if (failed.length) throw new Error(`Some add-to-cart clicks had no POST /cart in request log: ${JSON.stringify(failed)}`);
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
