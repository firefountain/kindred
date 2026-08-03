import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installSafeMtpClose,
  isExpectedMtpCloseError,
} from '../src/mtpCleanupPatch.js';

test('recognizes benign WebUSB disconnect errors', () => {
  assert.equal(
    isExpectedMtpCloseError(
      new Error("transferOut error: Cannot read properties of undefined (reading 'transfer')"),
    ),
    true,
  );
  assert.equal(
    isExpectedMtpCloseError(new Error('LIBUSB_ERROR_NO_DEVICE')),
    true,
  );
  assert.equal(
    isExpectedMtpCloseError(new Error('Unexpected protocol failure')),
    false,
  );
});

test('skips close when the underlying device is already closed', async () => {
  let closeCalls = 0;

  class FakeMtp {
    async close() {
      closeCalls += 1;
    }
  }

  installSafeMtpClose(FakeMtp);
  const mtp = new FakeMtp();
  mtp.device = { opened: false };

  await mtp.close();
  assert.equal(closeCalls, 0);
});

test('preserves unexpected close failures', async () => {
  class FakeMtp {
    async close() {
      throw new Error('Unexpected protocol failure');
    }
  }

  installSafeMtpClose(FakeMtp);
  const mtp = new FakeMtp();
  mtp.device = { opened: true };

  await assert.rejects(() => mtp.close(), /Unexpected protocol failure/);
});
