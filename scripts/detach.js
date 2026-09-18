const { cli } = require('./common');
try {
  cli(['detach']);
  console.log('Detached from Chrome. The Chrome browser and its tabs remain open.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
