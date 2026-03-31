const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalizeBase32(secret = '') {
  return String(secret).toUpperCase().replace(/[^A-Z2-7]/g, '');
}

function decodeBase32(secret) {
  const normalized = normalizeBase32(secret);
  let bits = '';

  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateBase32Secret(length = 32) {
  const random = crypto.randomBytes(length);
  let secret = '';

  for (let i = 0; i < random.length; i++) {
    secret += BASE32_ALPHABET[random[i] % BASE32_ALPHABET.length];
  }

  return secret;
}

function generateTotp(secret, timestamp = Date.now(), step = 30, digits = 6) {
  const secretBuffer = decodeBase32(secret);
  if (!secretBuffer.length) return null;

  const counter = Math.floor(timestamp / 1000 / step);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = String(binaryCode % (10 ** digits)).padStart(digits, '0');
  return otp;
}

function verifyTotp(secret, token, options = {}) {
  const {
    timestamp = Date.now(),
    step = 30,
    digits = 6,
    window = 1,
  } = options;

  const normalizedToken = String(token || '').trim();
  if (!/^\d{6}$/.test(normalizedToken)) return false;

  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = generateTotp(secret, timestamp + offset * step * 1000, step, digits);
    if (candidate === normalizedToken) {
      return true;
    }
  }

  return false;
}

module.exports = {
  generateBase32Secret,
  generateTotp,
  verifyTotp,
};
