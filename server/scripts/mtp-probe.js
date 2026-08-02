import Mtp from 'webmtp';

const VENDOR_ID = 0x1949;
const PRODUCT_ID = 0x9981;
const cycles = Math.max(1, Number.parseInt(process.env.MTP_CYCLES || '3', 10));
const listHandles = process.argv.includes('--handles');
const timeoutMs = Math.max(5_000, Number.parseInt(process.env.MTP_TIMEOUT_MS || '20000', 10));

function withTimeout(promise, label, ms = timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function waitForReady(mtp) {
  return withTimeout(new Promise((resolve, reject) => {
    mtp.addEventListener('ready', resolve, { once: true });
    mtp.addEventListener('error', () => reject(new Error('webmtp failed while opening the USB device')), { once: true });
  }), 'USB ready');
}

async function runCycle(index) {
  console.log(`\n[${index}/${cycles}] Connecting to Kindle 1949:9981...`);
  const mtp = new Mtp(VENDOR_ID, PRODUCT_ID);

  try {
    await waitForReady(mtp);
    await withTimeout(mtp.openSession(), 'MTP openSession');
    console.log(`[${index}/${cycles}] MTP session opened.`);

    if (listHandles) {
      console.log(`[${index}/${cycles}] Listing all object handles. This may be slow on a Scribe...`);
      const handles = await withTimeout(mtp.getObjectHandles(), 'getObjectHandles', 120_000);
      console.log(`[${index}/${cycles}] Found ${handles.length} object handles.`);
    }
  } finally {
    // webmtp.close() catches its own errors, so we still explicitly report progress.
    console.log(`[${index}/${cycles}] Closing and releasing USB interface...`);
    await withTimeout(mtp.close(), 'MTP close', 10_000).catch(error => {
      console.error(`[${index}/${cycles}] Close warning: ${error.message}`);
    });
  }
}

console.log('Kindred webmtp probe');
console.log(`Cycles: ${cycles}`);
console.log(`Object scan: ${listHandles ? 'enabled' : 'disabled'}`);
console.log('Quit OpenMTP and every other MTP application before running this.');

for (let i = 1; i <= cycles; i += 1) {
  await runCycle(i);
  if (i < cycles) await new Promise(resolve => setTimeout(resolve, 1_000));
}

console.log('\nPASS: webmtp opened and closed the Kindle for every cycle.');
console.log('Now verify macOS still sees it: system_profiler SPUSBDataType | grep -A8 Kindle');
