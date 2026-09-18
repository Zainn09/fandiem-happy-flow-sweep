# fandiem-happy-flow-sweep

Browser-only Fandiem sweep happy-flow automation against the user's **existing logged-in Chrome profile** via the Playwright extension (no second profile, no remote-debug port, browser stays open).

## Architecture

- Uses the existing Chrome browser + `bigfolio.co` profile login/cookies/tabs.
- Attaches via Playwright browser extension (`npm run attach`), never `--user-data-dir`.
- `detach` on finish — Chrome windows/tabs stay open.
- Follows the Screen-1 workflow: Admin → Campaigns → Sweeps → `/admin/sweeps/create` → Campaign Info (title + cover + gallery + description + CONTINUE) → Partners (2 comboboxes + quote + subtitle) → Promotion Tabs → Prize Details → Entry Tiers → Bonuses → Sweeps Info → Tracking & Visibility (unchanged) → Review & Submit → CREATE SWEEPS → admin listing → storefront verification incl. media order + `#add-to-cart-btn` clicks.

## 1. Prerequisite

Use Chrome with the `bigfolio.co` profile selected. Install + enable the Playwright browser extension / MCP Bridge **in that profile**.

Docs:

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

Expected:

```text
Chrome User Data: C:\Users\YOURUSER\AppData\Local\Google\Chrome\User Data
Profile display name: bigfolio.co
Profile directory: Profile 2
```

Don't copy `Profile 2` — the script detects the real directory from Chrome's Local State.

## 4. Attach

```powershell
npm run attach
```

1. A **Welcome** tab (`chrome-extension://.../connect.html`) opens.
2. Click **Allow & select** next to any tab.
3. Terminal reports `PLAYWRIGHT ATTACHED`.

> Zero-click: on that page or `chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html`, copy the token under *"Set this environment variable to bypass the connection dialog"* into `config.json` → `extensionToken`.

## 5. Run happy flow

```powershell
npm test
```

What it does (Screen 1 detail):

- Opens new tab to `https://partners.fandiem.co/admin`, clicks `Campaigns` → `Sweeps` → `a[href="/admin/sweeps/create"]`.
- Title: `input[name="campaignInfo.title"]` → `QA-AUTO-FANDIEM-YYYYMMDD-NNN` (date + per-day run counter, required).
- Cover: `div.space-y-1` + `input[accept="image/png,image/jpeg,image/jpg,image/webp,video/mp4,video/quicktime,video/webm"]` — tries `drop` → `setInputFiles` via `run-code` → `click+upload`; records file order + errors. Optional.
- Gallery: `button[type="button"]` containing `Add media` — uploads multiple files, records order for storefront comparison. Required (at least 1).
- Description: `[data-placeholder="Describe the experience in detail..."]` rich-text — happy-flow text, verified on storefront.
- CONTINUE: `button[data-slot="button"][data-variant="gradient"][data-size="lg"]` with `CONTINUE` — captures errors on click.
- Partners: first `button[type="button"][role="combobox"]` (talent, required) + `input[name="promoContent.artistQuoteTitle"]` + `textarea[name="promoContent.artistQuote"]` + second combobox (charity) + `input[name="charitySetup.charitySubtitle"]`. Both combobox selections + innerHTML remembered for storefront check.

Override title / partners if needed:

```powershell
$env:SWEEP_TITLE="QA-AUTO-FANDIEM-001"
$env:TALENT_PARTNER_NAME="Exact Talent Name"
$env:CHARITY_PARTNER_NAME="Exact Charity Name"
npm test
```

Creates real sweep data — run only against intended test env.

## 6. Media fixtures

`assets/` holds small upload fixtures. Add your own images/videos there and list them in `config.json` (`coverMedia`, `galleryMedia`) to exercise PNG/JPEG/JPG/WebP/MP4/MOV/WebM order + error cases.

## 7. Results

```text
results/
├── report.json          # steps, title, selections, media order, storefront URL
├── cart-results.json
├── run-counter-*.json   # per-day run counter for title NNN
└── *.png                # per-step screenshots + FAILED captures
```

## 8. Chrome stays open

Runner calls `detach` on PASS (stays attached on FAIL for debugging). Never closes your browser.

## 9. Security

Your Chrome profile holds authenticated sessions. Playwright attachment can access that state — use only in a trusted local env, don't share session data.
