const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function sanitize(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function usage() {
  console.log('Usage:');
  console.log('node generateHash.js --payload \'{"currency":"NGN","amount":"100"}\'');
  console.log('node generateHash.js --file payload.json');
  console.log('Optional: --secret YOUR_SECRET_KEY');
}

function loadPayloadRaw(args) {
  let obj;
  if (args.payload) {
    obj = JSON.parse(args.payload);
  } else if (args.file) {
    const fileContent = fs.readFileSync(args.file, 'utf8');
    obj = JSON.parse(fileContent);
  } else {
    throw new Error('Provide --payload or --file');
  }

  if (obj && typeof obj === 'object') {
    delete obj.narration;
    delete obj.naration;
  }

  return JSON.stringify(obj);
}

function run() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || args.h) {
      usage();
      process.exit(0);
    }

    const secret = sanitize(args.secret || process.env.BUDPAY_SECRET_KEY);
    if (!secret) {
      throw new Error('Missing secret key. Use --secret or set BUDPAY_SECRET_KEY in .env');
    }

    const payloadRaw = loadPayloadRaw(args);
    const signature = crypto.createHmac('sha512', secret).update(payloadRaw).digest('hex');

    console.log(
      JSON.stringify(
        {
          payload_raw: payloadRaw,
          signature,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        { error: error.message || 'Failed to generate hash' },
        null,
        2
      )
    );
    process.exit(1);
  }
}

run();
