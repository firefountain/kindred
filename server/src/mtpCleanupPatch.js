import Mtp from 'webmtp';

const PATCH_MARKER = Symbol.for('kindred.webmtp.safe-close');

export function isExpectedMtpCloseError(error) {
  const message = String(error?.message || error || '');

  return [
    "reading 'transfer'",
    'transferOut',
    'device is not open',
    'LIBUSB_TRANSFER_NO_DEVICE',
    'LIBUSB_ERROR_NO_DEVICE',
  ].some(fragment => message.includes(fragment));
}

export function installSafeMtpClose(MtpClass = Mtp) {
  const prototype = MtpClass?.prototype;
  if (!prototype || prototype[PATCH_MARKER]) return false;

  const originalClose = prototype.close;
  if (typeof originalClose !== 'function') return false;

  Object.defineProperty(prototype, PATCH_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  prototype.close = async function safeClose(...args) {
    // webmtp occasionally closes the WebUSB transport itself after a completed
    // transfer. Calling close() again then tries to write CloseSession through
    // an endpoint that no longer exists and usb prints a misleading stack.
    if (!this?.device?.opened) return undefined;

    try {
      return await originalClose.apply(this, args);
    } catch (error) {
      if (isExpectedMtpCloseError(error)) return undefined;
      throw error;
    }
  };

  return true;
}

installSafeMtpClose();
