<<<<<<< HEAD
# fandiem-happy-flow-sweep
=======
# Fandiem – Existing Chrome Profile Automation

This version matches the requested architecture:

- Uses the existing Chrome browser.
- Targets the existing `bigfolio.co` Chrome profile.
- Reuses that profile's current login, cookies and tabs.
- Uses the Playwright browser extension rather than remote debugging port 9222.
- Does not use a Shopify Admin API key.
- Does not launch a second Chrome profile.
- Does not close Chrome when the test finishes.

The supplied Fandiem PDF documents the Partners fields, Promotion modal, Prize Detail modal, Entry Tiers, Bonus modal/image upload, Sweeps Info, unchanged Tracking & Visibility, Review & Submit, CREATE SWEEPS, admin sweep listing and public `#add-to-cart-btn` verification. The test follows that order. The PDF's initial Campaign Info DOM is not included, so the runner detects it and clicks CONTINUE when present instead of inventing selectors for that missing screen.

## 1. Prerequisite

Use Chrome with the `bigfolio.co` profile selected.

Install the Playwright browser extension / MCP Bridge in that specific Chrome profile. Playwright's extension connection is designed to attach to existing tabs and reuse existing logged-in sessions/cookies. It also supports selecting a specific profile with `--profile-dir-name`. See the official docs:

- https://playwright.dev/mcp/configuration/browser-extension
- https://playwright.dev/agent-cli/commands/attach

## 2. Install dependencies in VS Code

Open the project folder and run:

```powershell
npm install
```

Node.js 20+ is recommended for the current Playwright CLI documentation.

## 3. Verify the Chrome profile

```powershell
npm run profile
```

Expected output is similar to:

```text
Chrome User Data: C:\Users\YOURUSER\AppData\Local\Google\Chrome\User Data
Profile display name: bigfolio.co
Profile directory: Profile 2
```

Do not copy that example `Profile 2`. The script detects the actual directory from Chrome's Local State file.

## 4. Attach to your existing Chrome

```powershell
npm run attach
```

When you run this command:
1. Chrome will open a tab titled **Welcome** (`chrome-extension://.../connect.html`).
2. On that tab, click the **"Allow & select"** button next to any tab to approve Playwright automation.
3. Once approved, the terminal will report `PLAYWRIGHT ATTACHED` and you can run your tests!

> **Tip (Zero-Click Auto-Attach):** On that same extension page or by visiting `chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html`, copy the token shown under *"Set this environment variable to bypass the connection dialog"* and paste it into `config.json` as `"extensionToken": "YOUR_TOKEN"`. Future runs will attach immediately without prompting!

## 5. Run the Fandiem happy flow

```powershell
$env:SWEEP_TITLE="QA-AUTO-FANDIEM-001"
npm test
```

The test creates real sweep data, so run it only against the intended test/staging environment. The test data and bonus image are unique/reusable test fixtures.

## 6. Change charity if needed

The supplied PDF does not include the actual charity picker options, so the test does not invent a charity name. By default it selects the first selectable option exposed by the live picker.

To force a specific charity:

```powershell
$env:CHARITY_PARTNER_NAME="Exact Charity Name"
npm test
```

## 7. Chrome remains open

The runner calls `detach` when the test finishes. Attached sessions are detached without closing the external browser. Your Chrome windows/tabs remain open.

## 8. Results

```text
results/
├── report.json
├── cart-results.json
└── *.png
```

Screenshots are captured after each major step and on failures.

## 9. Important security note

Your existing Chrome profile contains authenticated session data. The Playwright documentation warns that browser-attachment/automation can access the state available in that browser profile. Use the extension only in a trusted local environment and do not share the generated session data.
>>>>>>> big-dev-nightmare
