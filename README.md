# fandiem-happy-flow-sweep

Browser-only Fandiem sweep happy-flow automation against your **existing logged-in Chrome profile** via the Playwright extension (no second profile, no remote-debug port, browser stays open).

## Architecture

- Uses the existing Chrome browser + `bigfolio.co` profile login/cookies/tabs.
- Attaches via Playwright browser extension (`npm run attach`), never `--user-data-dir`.
- Opens a **new tab** to the admin; your current tabs are untouched.
- `detach` on finish — Chrome windows/tabs stay open (stays attached on FAIL for debugging).

## Happy-flow steps

1. **Nav**: new tab → `https://partners.fandiem.co/admin` → click `Campaigns` → `Sweeps` → `a[href="/admin/sweeps/create"]`.
2. **Campaign Info**
   - Title `input[name="campaignInfo.title"]` → `QA-AUTO-FANDIEM-YYYYMMDD-NNN` (date + per-day run counter; override with `SWEEP_TITLE`). Required.
   - Cover `div.space-y-1` + `input[accept="image/png,...video/webm"]` — single file, optional, strategy + errors recorded.
   - Gallery `button[type="button"]` containing `Add media` — uploads each file **one by one to preserve order**; order recorded and compared with the storefront. Required (≥1).
   - Type coverage: tries PNG/JPG/WebP from `config.typeCoverageMedia`, records per-file ok/error without failing the flow.
   - Description `[data-placeholder="Describe the experience in detail..."]` rich text — happy-flow text, verified on storefront.
   - **CONTINUE** `button[data-slot="button"][data-variant="gradient"][data-size="lg"]` — visible errors captured on click; must land on Partners.
3. **Partners**: first `button[type="button"][role="combobox"]` (talent, required) → `promoContent.artistQuoteTitle` + `promoContent.artistQuote` → second combobox (charity) → `charitySetup.charitySubtitle`. Both selections (text + innerHTML) saved to the report and checked on the storefront.
4. **Promotion Tabs** — `Add Promotion Tab` modal twice (title + plain-textarea description + optional raw-HTML switch; save, reopen, add a second). Promotion tabs are optional, so a failed tab is logged with the visible error instead of killing the run.
5. **Prize Details** — `Add Prize Detail` modal: emoji (`maxlength=4`) + rich-text description, saved with the modal's own submit button (the heading reads *Add Price Detail*).
6. **Entry Tiers** — tiers 0–3 are locked; `Add Entry Tier` appends tier N, which is then filled (`entryTiers.tiers.N.entries|price|impact`) and read back to prove it persisted.
7. **Bonuses** — `Add Bonus` modal: required Title + rich-text Description + required Bonus Image, plus optional entry-tier linking through the dropdown menu (already-linked tiers are disabled and skipped).
8. **Sweeps Info** — `prizeDetails.*` + `rulesDates.*` (incl. `drawDate`, `winnerAnnouncementContent`); `Auto-calculate Drawing Date` is forced off and every field is read back.
9. **Tracking & Visibility** — untouched, just CONTINUE.
10. **Review & Submit** — every section card is parsed (`review.sections`) and each entered value is asserted to appear in its section; anything the page still flags as *needs your attention* / *No …, added* is recorded and logged.
11. **CREATE SWEEPS** — clicks the `type=submit` button, captures the POSTs + redirect back to `/admin/sweeps` (`--static` so document posts are visible), fails on 4xx/5xx.
12. **Storefront** — the admin row's sweeps-link anchor opens `https://fandiem.co/sweeps/<slug>`; reward, eligible countries, minimum age, custom tier and the winner announcement are asserted, media order/count compared with the upload order.
13. **Cart** — every `#add-to-cart-btn` is clicked and must produce a successful `POST /cart` inside a `requests --static` window; per-button evidence (request lines, cart item count) goes to `cart-results.json`.

## Upload strategy (the previous failure point)

The old code did `click` then `upload` with errors swallowed (`allowFailure: true`), so Cover/Gallery stayed empty (`At least one Media Gallery image is required`) while the step still "passed".

Now every upload tries, in order, with polling verification (tile count / "N items" must grow):

1. `drop` the file(s) onto the dropzone — best for drag-&-drop zones;
2. `setInputFiles` on the hidden `input[type="file"]` via `run-code` (targets the right input index: cover=0, gallery=1, bonus=last);
3. `click` to open the chooser, then `upload`.

The winning strategy per slot is stored in `report.json` (`media.strategies`). Type-coverage failures are recorded per file and never fail the happy flow — only an empty required gallery fails.

## 1. Prerequisite

Use Chrome with the `bigfolio.co` profile selected. Install + enable the Playwright browser extension / MCP Bridge **in that profile**.

- https://playwright.dev/mcp/configuration/browser-extension
- https://playwright.dev/agent-cli/commands/attach

## 2. Install

```powershell
npm install
```

Node.js 20+ recommended.

## 3. Verify profile

```powershell
npm run profile
```

## 4. Attach

```powershell
npm run attach
```

1. A **Welcome** tab (`chrome-extension://.../connect.html`) opens.
2. Click **Allow & select** next to any tab.
3. Terminal reports `PLAYWRIGHT ATTACHED`.

> Zero-click: on that page or `chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html`, copy the token under *"Set this environment variable to bypass the connection dialog"* into `config.json` → `extensionToken`.

## 5. Dry run (no browser, safe anywhere)

```powershell
npm run dry
```

Validates config, assets, and title building without touching the browser or the run counter.

## 6. Run happy flow

```powershell
npm test
```

Overrides (all optional):

```powershell
$env:SWEEP_TITLE="QA-AUTO-FANDIEM-001"
$env:TALENT_PARTNER_NAME="Exact Talent Name"
$env:CHARITY_PARTNER_NAME="Exact Charity Name"
$env:CUSTOM_TIER_ENTRIES="500"      # Entry Tiers
$env:CUSTOM_TIER_PRICE="75"
$env:NUMBER_OF_WINNERS="1"          # Sweeps Info
$env:NUMBER_OF_GUESTS="2"
$env:PRIZE_VALUE="$5,000"
$env:MINIMUM_AGE="18"
$env:ELIGIBLE_COUNTRIES="Open to legal residents of the United States only"
$env:WINNER_ANNOUNCEMENT="Congratulations …"
npm test
```

Defaults for all of these live in `config.json`.

## 6b. Summarize the run

```powershell
npm run report          # compact per-screen summary of the last run
npm run report -- --full  # also prints every review row
```

Creates real sweep data — run only against the intended test env. Talent defaults to `expectedTalentPartner` with fallback to first available; charity defaults to first available.

## 7. Media fixtures

`assets/` holds small upload fixtures (cover PNG, gallery PNGs, JPG + WebP renders at the recommended 820×312):

```text
assets/
├── qa-cover.png      # cover slot
├── qa-gallery-1.png  # gallery order position 1
├── qa-gallery-2.png  # gallery order position 2
├── qa-gallery-3.png  # type coverage (png)
├── qa-sample.jpg     # type coverage (jpeg)
├── qa-sample.webp    # type coverage (webp)
└── qa-bonus.png      # bonus modal
```

Add MP4/MOV files there and list them in `config.json` (`coverMedia`, `galleryMedia`, `typeCoverageMedia`) to extend coverage — order and per-file errors are recorded automatically.

## 8. Results

```text
results/
├── report.json            # steps, title, data entered, selections, media order + strategies, promotionTabs,
│                          # prizeDetail, entryTiers, bonus, sweepsInfo (+switches), review sections + checks,
│                          # createNetwork (POSTs + redirect), storefront checks/snapshot, public URL
├── cart-results.json      # per add-to-cart-button POST /cart observation (request lines + cart item count)
├── run-counter-*.json     # per-day run counter backing the NNN in titles
└── *.png                  # per-step screenshots + FAILED captures
```

## 9. Troubleshooting

- **Gallery still empty**: open `report.json` → `media.strategies` / last FAILED screenshot; the error lists all 3 strategies' outcomes. Most common cause is the site's file-input index shifting — `media.fileInputs` in the report shows the live inputs.
- **Talent/charity not found**: the exact live option names are in `report.json` (`selections.*.options`); set them via env vars and re-run.
- **Stuck on attach**: re-run `npm run attach`, click **Allow & select** in Chrome within 60s, or set `extensionToken`.
- **Talent/charity combobox**: the picker filters server-side, so the code opens it, types the name into the popup's search box when the first option list has no match (exact → contains → short prefix), and records `filteredBy` + every available option. If the badge `Remove <name>` never appears, the run logs a warning with all `Remove …` badges found.
- **Review says "N step(s) need your attention"**: the run records which section is flagged (with the row values) and still submits — that banner is how the previous manual attempt silently shipped empty Promotion Tabs / Prize Details / Bonuses.
- **Cart button shows no POST**: `requests` hides successful document posts by default; the run captures with `--static`, and `cart-results.json` keeps the raw request lines for each button so you can see exactly what the click did.

## 10. Security

Your Chrome profile holds authenticated sessions. Playwright attachment can access that state — use only in a trusted local env, don't share session data.
