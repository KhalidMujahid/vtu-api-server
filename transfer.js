const axios = require('axios');
const readline = require('readline');
const crypto = require('crypto');
require('dotenv').config();

const TRANSFER_ENDPOINT = 'https://api.budpay.com/api/v2/bank_transfer';
const BANK_LIST_ENDPOINT = 'https://api.budpay.com/api/v2/bank_list';
const ACCOUNT_VERIFY_ENDPOINT = 'https://api.budpay.com/api/v2/account_name_verify';

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

function sanitizeEnvValue(value) {
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

function requireField(args, field) {
  const value = args[field];
  if (!value) {
    throw new Error(`Missing required argument: --${field}`);
  }
  return value;
}

function toCurrency(value) {
  return (value || 'NGN').toUpperCase();
}

function getAuthHeaders(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };
}

function createSignature(rawPayload, secretKey) {
  return crypto.createHmac('sha512', secretKey).update(rawPayload).digest('hex');
}

function buildTransferHeaders(secretKey, signature) {
  return {
    ...getAuthHeaders(secretKey),
    Encryption: signature,
  };
}

function createQuestionInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function resolveBankByFilter(banks, filter) {
  if (!filter) return null;
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return null;

  const exactCode = banks.find((bank) => bank.bank_code.toLowerCase() === normalized);
  if (exactCode) return exactCode;

  const exactName = banks.find((bank) => bank.bank_name.toLowerCase() === normalized);
  if (exactName) return exactName;

  const matches = banks.filter(
    (bank) =>
      bank.bank_name.toLowerCase().includes(normalized) ||
      bank.bank_code.toLowerCase().includes(normalized)
  );

  return matches.length === 1 ? matches[0] : null;
}

async function fetchBanks(secretKey, currency) {
  const url = currency ? `${BANK_LIST_ENDPOINT}/${currency}` : BANK_LIST_ENDPOINT;
  const response = await axios.get(url, {
    headers: getAuthHeaders(secretKey),
    timeout: 30000,
  });
  const banks = response.data?.data;
  if (!Array.isArray(banks) || banks.length === 0) {
    throw new Error('No banks returned from BudPay');
  }
  return banks;
}

function printBanks(banks) {
  banks.forEach((bank, index) => {
    const idx = String(index + 1).padStart(3, ' ');
    console.log(`${idx}. ${bank.bank_name} (${bank.bank_code})`);
  });
}

async function pickBankInteractively(banks) {
  const rl = createQuestionInterface();
  try {
    console.log('\nAvailable banks:\n');
    printBanks(banks);
    console.log('');

    while (true) {
      const answer = await ask(rl, 'Choose bank number: ');
      const choice = Number(answer);
      if (Number.isInteger(choice) && choice >= 1 && choice <= banks.length) {
        return banks[choice - 1];
      }
      console.log('Invalid selection. Enter a valid number from the list.');
    }
  } finally {
    rl.close();
  }
}

async function resolveBankSelection(args, secretKey, currency) {
  if (args.bank_code && args.bank_name) {
    return { bank_code: args.bank_code, bank_name: args.bank_name };
  }

  const banks = await fetchBanks(secretKey, currency);
  const byFilter = resolveBankByFilter(banks, args.bank_filter);
  if (byFilter) return byFilter;

  if (args.bank_code && !args.bank_name) {
    const byCode = banks.find((bank) => bank.bank_code === args.bank_code);
    if (byCode) return byCode;
  }

  if (args.bank_name && !args.bank_code) {
    const byName = banks.find(
      (bank) => bank.bank_name.toLowerCase() === String(args.bank_name).toLowerCase()
    );
    if (byName) return byName;
  }

  return pickBankInteractively(banks);
}

function normalizeAccountNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function validateAccountNumber(value) {
  const normalized = normalizeAccountNumber(value);
  if (!/^\d{10}$/.test(normalized)) {
    throw new Error('account_number must be a valid 10-digit number');
  }
  return normalized;
}

function maskAccountNumber(accountNumber) {
  const digits = String(accountNumber);
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

async function verifyAccountName(secretKey, bankCode, accountNumber) {
  const response = await axios.post(
    ACCOUNT_VERIFY_ENDPOINT,
    { bank_code: bankCode, account_number: accountNumber },
    { headers: getAuthHeaders(secretKey), timeout: 30000 }
  );

  if (!response.data?.success) {
    throw new Error(response.data?.message || 'Account verification failed');
  }

  return response.data?.data || '';
}

function buildPayload(args, selectedBank, accountNumber) {
  const payload = {
    currency: toCurrency(args.currency),
    amount: String(requireField(args, 'amount')),
    bank_code: selectedBank.bank_code,
    bank_name: selectedBank.bank_name,
    account_number: accountNumber,
    narration: args.narration || `Transfer to ${selectedBank.bank_name}`,
  };

  if (args.paymentMode) payload.paymentMode = args.paymentMode;

  if (args.sender_name || args.sender_address) {
    payload.meta_data = [
      {
        sender_name: args.sender_name || '',
        sender_address: args.sender_address || '',
      },
    ];
  }

  return payload;
}

async function confirmProceeding(args, details) {
  if (args.yes) return true;
  const rl = createQuestionInterface();
  try {
    const answer = await ask(
      rl,
      `Proceed with transfer to ${details.accountName} (${details.bankName}, ${details.maskedAccount}) amount ${details.currency} ${details.amount}? (yes/no): `
    );
    return ['y', 'yes'].includes(String(answer).toLowerCase());
  } finally {
    rl.close();
  }
}

function printUsage() {
  console.log('Usage:');
  console.log('node transfer.js --amount 100 --account_number 0050883605 --currency NGN');
  console.log(
    'Optional: --bank_filter "opay" --bank_code 100004 --bank_name "OPAY" --narration "Transfer" --paymentMode momo --sender_name "Nium Consult" --sender_address "New Orleans, USA" --yes'
  );
  console.log('List banks: node transfer.js --list-banks --currency NGN');
  console.log(
    'Verify only: node transfer.js --verify-only --account_number 0050883605 --currency NGN --bank_filter "opay"'
  );
}

async function run() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || args.h) {
      printUsage();
      process.exit(0);
    }

    const secretKey = sanitizeEnvValue(process.env.BUDPAY_SECRET_KEY);
    if (!secretKey) {
      throw new Error('Missing BUDPAY_SECRET_KEY in environment');
    }

    const currency = toCurrency(args.currency);

    if (args['list-banks']) {
      const banks = await fetchBanks(secretKey, currency);
      console.log(JSON.stringify({ currency, total: banks.length, data: banks }, null, 2));
      process.exit(0);
    }

    const accountNumber = validateAccountNumber(requireField(args, 'account_number'));
    const selectedBank = await resolveBankSelection(args, secretKey, currency);
    const accountName = await verifyAccountName(
      secretKey,
      selectedBank.bank_code,
      accountNumber
    );

    console.log(
      JSON.stringify(
        {
          verification: 'passed',
          bank_name: selectedBank.bank_name,
          bank_code: selectedBank.bank_code,
          account_number_masked: maskAccountNumber(accountNumber),
          account_name: accountName,
        },
        null,
        2
      )
    );

    if (args['verify-only']) {
      process.exit(0);
    }

    const amount = requireField(args, 'amount');
    const shouldProceed = await confirmProceeding(args, {
      accountName,
      bankName: selectedBank.bank_name,
      maskedAccount: maskAccountNumber(accountNumber),
      currency,
      amount,
    });
    if (!shouldProceed) {
      console.log('Transfer cancelled.');
      process.exit(0);
    }

    const payload = buildPayload(args, selectedBank, accountNumber);
    const rawPayload = JSON.stringify(payload);
    const signature = createSignature(rawPayload, secretKey);

    const response = await axios.post(TRANSFER_ENDPOINT, rawPayload, {
      headers: buildTransferHeaders(secretKey, signature),
      timeout: 30000,
    });

    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    const message = error.response?.data || error.message || 'Transfer request failed';
    console.error(JSON.stringify(message, null, 2));
    process.exit(1);
  }
}

run();
