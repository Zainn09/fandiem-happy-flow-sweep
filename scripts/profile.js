const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('./common');

function chromeUserDataRoot() {
  if (process.env.CHROME_USER_DATA_DIR) return path.resolve(process.env.CHROME_USER_DATA_DIR);
  if (process.platform !== 'win32') {
    throw new Error('Windows Chrome profile auto-detection is configured for this project. Set CHROME_USER_DATA_DIR to override.');
  }
  return path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Google', 'Chrome', 'User Data'
  );
}

function getProfiles() {
  const root = chromeUserDataRoot();
  const localState = path.join(root, 'Local State');
  if (!fs.existsSync(localState)) throw new Error(`Chrome Local State not found: ${localState}`);
  const data = JSON.parse(fs.readFileSync(localState, 'utf8'));
  return { root, cache: data?.profile?.info_cache || {} };
}

function detect() {
  const { root, cache } = getProfiles();
  const target = String(process.env.CHROME_PROFILE_DISPLAY_NAME || config.chromeProfileDisplayName || '').trim().toLowerCase();
  const records = Object.entries(cache).map(([dirName, info]) => ({
    dirName,
    name: info?.name || '',
    userName: info?.user_name || '',
    gaiaName: info?.gaia_name || ''
  }));

  if (config.chromeProfileDirName) {
    const explicit = records.find(p => p.dirName === config.chromeProfileDirName) || {
      dirName: config.chromeProfileDirName,
      name: config.chromeProfileDisplayName,
      userName: '',
      gaiaName: ''
    };
    return { root, selected: explicit, records };
  }

  const exact = records.find(p => [p.name, p.userName, p.gaiaName, p.dirName]
    .filter(Boolean).some(v => String(v).trim().toLowerCase() === target));
  if (exact) return { root, selected: exact, records };

  const fuzzy = records.find(p => [p.name, p.userName, p.gaiaName, p.dirName]
    .filter(Boolean).some(v => {
      const x = String(v).trim().toLowerCase();
      return x.includes(target) || target.includes(x);
    }));
  return { root, selected: fuzzy || null, records };
}

try {
  const result = detect();
  if (!result.selected) {
    console.error(`Could not find Chrome profile matching "${config.chromeProfileDisplayName}".`);
    console.error('Profiles found:');
    for (const p of result.records) console.error(`  ${p.dirName} | ${p.name} | ${p.userName}`);
    process.exit(2);
  }
  console.log(`Chrome User Data: ${result.root}`);
  console.log(`Profile display name: ${result.selected.name}`);
  console.log(`Profile directory: ${result.selected.dirName}`);
}
catch (error) {
  console.error(error.message);
  process.exit(1);
}
