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
4. **Promotion Tabs** ×2 → **Prize Details** ×1 → **Entry Tiers** (custom tier) → **Bonuses** (title + description + image upload) → **Sweeps Info** → **Tracking & Visibility** (unchanged) → **Review & Submit** (validates everything, asserts no "needs your attention").
5. **CREATE SWEEPS** → admin listing search → open public **storefront** → verify title, description snippet, talent, charity, media count/order → click every `#add-to-cart-btn` and assert a `POST /cart` request each time.

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

Overrides:

```powershell
$env:SWEEP_TITLE="QA-AUTO-FANDIEM-001"
$env:TALENT_PARTNER_NAME="Exact Talent Name"
$env:CHARITY_PARTNER_NAME="Exact Charity Name"
npm test
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
├── report.json            # steps, title, selections (talent/charity + innerHTML), media order + strategies, storefront checks, public URL
├── cart-results.json      # per add-to-cart-button POST /cart observation
├── run-counter-*.json     # per-day run counter backing the NNN in titles
└── *.png                  # per-step screenshots + FAILED captures
```

## 9. Troubleshooting

- **Gallery still empty**: open `report.json` → `media.strategies` / last FAILED screenshot; the error lists all 3 strategies' outcomes. Most common cause is the site's file-input index shifting — `media.fileInputs` in the report shows the live inputs.
- **Talent/charity not found**: the exact live option names are in `report.json` (`selections.*.options`); set them via env vars and re-run.
- **Stuck on attach**: re-run `npm run attach`, click **Allow & select** in Chrome within 60s, or set `extensionToken`.

## 10. Security

Your Chrome profile holds authenticated sessions. Playwright attachment can access that state — use only in a trusted local env, don't share session data.
