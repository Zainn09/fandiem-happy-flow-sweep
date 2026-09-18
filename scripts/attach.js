// const fs = require('fs');
// const path = require('path');
// const { spawnSync } = require('child_process');
// const { config, ROOT } = require('./common');

// function detectProfileDir() {
//   if (config.chromeProfileDirName) return config.chromeProfileDirName;
//   const result = spawnSync(process.execPath, [path.join(__dirname, 'profile.js')], {
//     cwd: ROOT,
//     encoding: 'utf8',
//     windowsHide: false
//   });
//   if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Could not resolve Chrome profile.');
//   const match = String(result.stdout).match(/^Profile directory:\s*(.+)$/m);
//   if (!match) throw new Error(`Could not parse profile directory.\n${result.stdout}`);
//   return match[1].trim();
// }

// function openProfile(profileDir) {
//   if (!config.autoOpenProfileIfNeeded) return;
//   if (process.platform !== 'win32') return;
//   const chrome = config.chromeExecutablePath;
//   if (!fs.existsSync(chrome)) {
//     console.warn(`Chrome executable not found at ${chrome}; skipping profile auto-open.`);
//     return;
//   }
//   // This opens the existing Chrome profile normally. It does NOT create a new user-data directory
//   // and does NOT enable remote debugging. Existing windows/tabs are left alone.
//   const child = require('child_process').spawn(chrome, [`--profile-directory=${profileDir}`], {
//     detached: true,
//     stdio: 'ignore',
//     windowsHide: false
//   });
//   child.unref();
// }

// const profileDir = detectProfileDir();
// console.log(`Target Chrome profile: ${config.chromeProfileDisplayName} (${profileDir})`);
// openProfile(profileDir);

// const localBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright-cli.cmd' : 'playwright-cli');
// const executable = fs.existsSync(localBin)
//   ? localBin
//   : (process.platform === 'win32' ? 'playwright-cli.cmd' : 'playwright-cli');

// const args = [
//   `--session=${config.sessionName}`,
//   'attach',
//   '--extension=chrome'
// ];

// console.log('Attaching through the Playwright browser extension...');
// const result = spawnSync(executable, args, {
//   cwd: ROOT,
//   stdio: 'inherit',
//   windowsHide: false
// });
// process.exit(result.status ?? 1);
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  ROOT,
  config
} = require("./common");

function getCliRunner() {
  const cliJs = path.join(ROOT, 'node_modules', '@playwright', 'cli', 'playwright-cli.js');
  if (fs.existsSync(cliJs)) {
    return { command: process.execPath, prefixArgs: [cliJs], shell: false };
  }
  const localName = process.platform === "win32" ? "playwright-cli.cmd" : "playwright-cli";
  const localPath = path.join(ROOT, "node_modules", ".bin", localName);
  const command = fs.existsSync(localPath) ? localPath : localName;
  return { command, prefixArgs: [], shell: process.platform === "win32" };
}

function getChromeProfileDir() {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "profile.js")],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: false
    }
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr ||
      result.stdout ||
      "Unable to detect Chrome profile."
    );
  }

  const match = String(result.stdout).match(
    /^Profile directory:\s*(.+)$/m
  );

  if (!match) {
    throw new Error(
      `Could not determine Chrome profile directory.\n${result.stdout}`
    );
  }

  return match[1].trim();
}

function openChromeProfile(profileDir) {
  if (!config.autoOpenProfileIfNeeded) {
    return;
  }

  if (process.platform !== "win32") {
    return;
  }

  const chromePath =
    config.chromeExecutablePath ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

  if (!fs.existsSync(chromePath)) {
    console.warn(
      `Chrome was not found at:\n${chromePath}`
    );
    return;
  }

  console.log("");
  console.log("Opening Chrome profile:");
  console.log(`  ${profileDir}`);
  console.log("");

  const child = require("child_process").spawn(
    chromePath,
    [
      `--profile-directory=${profileDir}`
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  );

  child.unref();
}

const profileDir = getChromeProfileDir();

console.log("========================================");
console.log(" FANDIEM EXISTING CHROME ATTACH");
console.log("========================================");
console.log("");
console.log(`Profile: ${config.chromeProfileDisplayName}`);
console.log(`Directory: ${profileDir}`);
console.log(`Session: ${config.sessionName}`);
console.log("");

/*
 * Open the user's REAL Chrome profile.
 *
 * This does NOT create:
 *   --user-data-dir=...
 *
 * It therefore does not create a second Playwright Chrome profile.
 */
openChromeProfile(profileDir);

/*
 * IMPORTANT:
 *
 * Profile selection is passed through the environment.
 *
 * Do NOT do:
 *
 *   attach --extension=chrome --profile-dir-name=...
 *
 * The current Playwright CLI expects the profile selection
 * through PLAYWRIGHT_MCP_PROFILE_DIR_NAME.
 */
const token = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN || config.extensionToken;

const env = {
  ...process.env,

  PLAYWRIGHT_MCP_PROFILE_DIR_NAME: profileDir,

  // Make sure extension mode is used.
  PLAYWRIGHT_MCP_EXTENSION: "true",

  // Keep the same named CLI session.
  PLAYWRIGHT_CLI_SESSION: config.sessionName,

  ...(token ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: token } : {})
};

const runner = getCliRunner();

const args = [
  `--session=${config.sessionName}`,
  "attach",
  "--extension=chrome"
];

console.log("Attaching Playwright to existing Chrome...");
if (token) {
  console.log("Using extension token for instant connection.\n");
} else {
  console.log("");
  console.log("------------------------------------------------------------------");
  console.log("ACTION REQUIRED IN CHROME:");
  console.log("A Chrome tab from Playwright Extension will appear (or is already open).");
  console.log("Please click the 'Allow & select' button on that tab to permit access.");
  console.log("------------------------------------------------------------------");
  console.log("");
}

const result = spawnSync(
  runner.command,
  [...runner.prefixArgs, ...args],
  {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: runner.shell,
    windowsHide: false
  }
);

if (result.status !== 0) {
  console.error("");
  console.error("========================================");
  console.error(" PLAYWRIGHT ATTACH FAILED");
  console.error("========================================");
  console.error("");
  console.error(
    "Make sure the Playwright extension is installed and enabled"
  );
  console.error(
    `inside the "${config.chromeProfileDisplayName}" Chrome profile.`
  );
  console.error("");

  process.exit(result.status ?? 1);
}

console.log("");
console.log("========================================");
console.log(" PLAYWRIGHT ATTACHED");
console.log("========================================");
console.log("");
console.log(
  `Session "${config.sessionName}" is now attached to Chrome.`
);
console.log("");