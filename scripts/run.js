const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  ROOT, config, resultsDir, cli, sleep, clean, writeJson, env,
  locator, click, fill, goto, screenshot, evalPage
} = require('./common');

async function ensurePlaywrightAttached() {
  console.log("");
  console.log("Checking Playwright Chrome session...");

  const check = cli(["snapshot"], { allowFailure: true });

  if (check.code === 0) {
    console.log("Playwright session is already attached.");
    return;
  }

  console.log("");
  console.log("Playwright session is not attached.");
  console.log("Launching attach process...");

  const token = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN || config.extensionToken;
  if (!token) {
    console.log("");
    console.log("==================================================================");
    console.log("ACTION REQUIRED IN CHROME:");
    console.log("A Chrome tab for Playwright Extension has opened (or is already open).");
    console.log("Please switch to Chrome and click 'Allow & select' on that tab.");
    console.log("==================================================================");
    console.log("");
  }

  const attachScript = path.join(ROOT, "scripts", "attach.js");

  const child = spawn(process.execPath, [attachScript], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    detached: true,
    windowsHide: false
  });
  child.unref();

  // Poll until the session is responsive (give up to 60 seconds for user action).
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const probe = cli(["snapshot"], { allowFailure: true });
    if (probe.code === 0) {
      console.log("\nPlaywright successfully attached to Chrome.");
      return;
    }
    console.log("  Waiting for Playwright session connection (click 'Allow & select' in Chrome)...");
  }

  throw new Error(
    "Could not attach Playwright to the existing Chrome profile within 60s.\n" +
    "Make sure the Playwright extension is installed and you click 'Allow & select' when prompted,\n" +
    "or configure extensionToken in config.json / PLAYWRIGHT_MCP_EXTENSION_TOKEN."
  );
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const sweepTitle = env('SWEEP_TITLE', `${config.sweepTitlePrefix}-${stamp}`);
const expectedTalent = config.expectedTalentPartner;
const bonusImage = path.resolve(ROOT, config.bonusImage);
const ADMIN = config.adminBaseUrl.replace(/\/$/, '');
const PUBLIC = config.publicBaseUrl.replace(/\/$/, '');

if (!fs.existsSync(bonusImage)) throw new Error(`Bonus image not found: ${bonusImage}`);
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

function bodyText() { return evalPage('() => (document.body ? document.body.innerText : "")'); }
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
function richText(value) { fill('locator(\'[contenteditable="true"]\').last()', value); }
function continueNext(expectedHeading) {
  const continueTargets = [
    locator('role', 'button', { name: 'Continue' }) + '.last()',
    'locator(\'button:has-text("Continue")\').last()',
    locator('role', 'button', { name: 'CONTINUE' }) + '.last()',
    'locator(\'button:has-text("CONTINUE")\').last()',
    locator('role', 'button', { name: 'Continue' }),
    'locator(\'button:has-text("Continue")\')'
  ];
  let clicked = false;
  for (const target of continueTargets) {
    const res = cli(['click', target], { allowFailure: true });
    if (res.code === 0) {
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    // Fallback: try wizard sidebar step button
    const stepBtn = `locator('button:has-text("${expectedHeading}")').first()`;
    cli(['click', stepBtn], { allowFailure: true });
  }

  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (bodyText().toLowerCase().includes(expectedHeading.toLowerCase())) return;
    sleep(400);
  }
  throw new Error(`Did not reach ${expectedHeading}.`);
}

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
  heading('Add Price Detail');
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

function addBonus() {
  click(locator('role', 'button', { name: 'Add Bonus', exact: true }) + '.first()');
  heading('Add Bonus');
  fill(locator('placeholder', 'Enter bonus title'), data.bonusTitle);
  richText(data.bonusDescription);
  click('locator(\'div:has-text("Drag & drop or click to upload")\').last()');
  cli(['upload', bonusImage]);
  click(locator('role', 'button', { name: 'Add Bonus', exact: true }) + '.last()');
  assertContains(bodyText(), data.bonusTitle, 'Bonus');
}

function chooseCharity() {
  const configured = process.env.CHARITY_PARTNER_NAME || config.charityPartnerName;
  const combo = locator('role', 'combobox') + '.nth(1)';
  click(combo);
  if (configured) {
    click(locator('text', configured) + '.first()');
    return;
  }
  // The PDF does not include the charity-picker options, so do not invent a charity name.
  // Choose the first selectable option presented by the live picker.
  const options = [
    'getByRole(\'option\').first()',
    'locator(\'[role="menuitemcheckbox"]\').first()',
    'locator(\'[role="menuitem"]\').first()'
  ];
  for (const target of options) {
    const r = cli(['click', target], { allowFailure: true });
    if (r.code === 0) return;
  }
  throw new Error('Charity picker opened but no selectable option could be detected. Set CHARITY_PARTNER_NAME to the exact live charity name.');
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
  const report = { startedAt: new Date().toISOString(), sweepTitle, status: 'RUNNING', steps: [], testData: data };
  let publicUrl = '';
  try {
    await ensurePlaywrightAttached();
    await step(report, 'Open Partners screen', async () => {
      goto(`${ADMIN}/admin/sweeps/create`);
      await sleep(1500);
      const body = bodyText();
      if (body.includes('Campaign Info')) {
        // Fill required fields on Campaign Info if present
        try {
          fill('locator(\'input[placeholder*="Eras Tour"]\')', sweepTitle);
        } catch (_) {}
        try {
          fill('locator(\'[contenteditable="true"]\').first()', 'Automated QA campaign description created for testing.');
        } catch (_) {}
        try {
          const addMediaBtn = locator('role', 'button', { name: '+ Add media' });
          cli(['click', addMediaBtn], { allowFailure: true });
          cli(['upload', bonusImage], { allowFailure: true });
        } catch (_) {}
        continueNext('Partners');
      }
      heading('Partners');
    });

    await step(report, 'Complete Partners', async () => {
      assertContains(bodyText(), expectedTalent, 'Talent partner');
      chooseCharity();
      fill('locator(\'input[name="promoContent.artistQuoteTitle"]\')', 'Automated QA Quote');
      fill('locator(\'textarea[name="promoContent.artistQuote"]\')', 'Created by browser-only automated testing.');
      fill('locator(\'input[name="charitySetup.charitySubtitle"]\')', 'Automated donation support text.');
    });

    await step(report, 'Create two Promotion Tabs', async () => {
      addPromotion(data.promotionOne, data.promotionDescriptionOne);
      addPromotion(data.promotionTwo, data.promotionDescriptionTwo);
      continueNext('Prize Details');
    });

    await step(report, 'Create Prize Detail', async () => {
      addPrizeDetail();
      continueNext('Entry Tiers');
    });

    await step(report, 'Add custom Entry Tier', async () => {
      addCustomTier();
      continueNext('Bonuses');
    });

    await step(report, 'Create Bonus with image', async () => {
      addBonus();
      continueNext('Sweeps Info');
    });

    await step(report, 'Fill Sweeps Info', async () => {
      fillSweepsInfo();
      continueNext('Tracking & Visibility');
    });

    await step(report, 'Leave Tracking & Visibility unchanged', async () => {
      heading('Tracking & Visibility');
      continueNext('Review & Submit');
    });

    await step(report, 'Validate Review & Submit', async () => {
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
      const createTargets = [
        locator('role', 'button', { name: 'CREATE SWEEPS' }),
        locator('role', 'button', { name: 'Create Sweeps' }),
        'locator(\'button:has-text("CREATE SWEEPS")\')',
        'locator(\'button:has-text("Create Sweeps")\')'
      ];
      let clicked = false;
      for (const target of createTargets) {
        const res = cli(['click', target], { allowFailure: true });
        if (res.code === 0) {
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        throw new Error('Could not find CREATE SWEEPS button.');
      }
      await sleep(1800);
      const url = evalPage('() => location.href');
      if (!/\/admin\/sweeps/i.test(url)) throw new Error(`Create did not return to /admin/sweeps. Current URL: ${url}`);
    });

    await step(report, 'Open created sweep storefront', async () => {
      fill(locator('placeholder', 'Search sweeps...'), sweepTitle);
      await sleep(800);
      assertContains(bodyText(), sweepTitle, 'Created sweep');
      publicUrl = publicUrlFromAdminRow(sweepTitle);
      goto(publicUrl);
      await sleep(1500);
      const body = bodyText();
      assertContains(body, sweepTitle, 'Storefront title');
      assertContains(body, 'Enter Now', 'Enter Now');
      assertContains(body, 'Prize Details', 'Prize Details');
      assertContains(body, 'Description', 'Description');
      assertContains(body, expectedTalent, 'Talent partner');
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
        const before = evalPage('() => location.href');
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
  } catch (error) {
    report.status = 'FAIL';
    report.finishedAt = new Date().toISOString();
    report.error = error.message;
    writeJson('report.json', report);
    console.error('\n=== FANDIEM AUTOMATION FAILED ===');
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    // Only detach upon passing to preserve attached state for debugging on failure
    if (report.status === 'PASS') {
      cli(['detach'], { allowFailure: true });
    }
  }
}


main();
