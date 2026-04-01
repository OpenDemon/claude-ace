import { WatchdogAgent } from '../src/watchdog/WatchdogAgent.js';
import fs from 'fs';
import path from 'path';

const projectRoot = '/home/ubuntu/ace-coder';
const targetFile = path.join(projectRoot, 'src/watchdog/dummy_target.js');

// 1. Create a dummy target file with a bug
fs.writeFileSync(targetFile, `
export function calculateDiscount(price, discountPercent) {
  // BUG: should be price * (1 - discountPercent / 100)
  return price - discountPercent;
}
`);

// 2. Create a marker file simulating a test failure
fs.writeFileSync(path.join(projectRoot, '.broken-test.json'), JSON.stringify({
  file: targetFile,
  error: 'Expected calculateDiscount(100, 20) to be 80, but got 80. Expected calculateDiscount(200, 10) to be 180, but got 190.'
}));

console.log('=== WatchdogAgent Test ===');
console.log('Simulating a test failure in dummy_target.js...');

const watchdog = new WatchdogAgent(projectRoot, { intervalMs: 5000 });

// Start the watchdog
watchdog.start();

// Stop it after 30 seconds
setTimeout(() => {
  watchdog.stop();
  console.log('\n=== FINAL FILE STATE ===');
  console.log(fs.readFileSync(targetFile, 'utf-8'));
  
  const markerExists = fs.existsSync(path.join(projectRoot, '.broken-test.json'));
  console.log(`\nMarker file cleaned up: ${!markerExists}`);
  
  process.exit(0);
}, 30000);
