const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const headers = {
  Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
  'Content-Type': 'application/json'
};

// ---------------- HELPERS ----------------
function formatPhone(phone) {
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '234' + phone.slice(1);
  return phone;
}

// ---------------- BANK LIST ----------------
const bankListPath = path.join(__dirname, '../data/banklist.json');
let banks = [];

function loadBankList() {
  try {
    const raw = fs.readFileSync(bankListPath, 'utf-8');
    banks = JSON.parse(raw);
    console.log(`[BankService] Bank list loaded: ${banks.length} banks`);
  } catch (err) {
    console.error('[BankService] Failed to load bank list:', err.message);
    banks = [];
  }
}

function listBanks(searchTerm = '', page = 0, pageSize = 10) {
  let filtered = banks;
  if (searchTerm) {
    const search = searchTerm.toLowerCase();
    filtered = banks.filter(b => b.name.toLowerCase().includes(search));
  }
  const start = page * pageSize;
  const pagedBanks = filtered.slice(start, start + pageSize);
  return {
    banks: pagedBanks,
    hasNext: start + pageSize < filtered.length,
    hasPrev: page > 0
  };
}

function getBankByCode(code) {
  return banks.find(b => b.code === code) || null;
}

// ---------------- TAGPAY APIs ----------------
async function checkUserByPhone(phoneNumber) {
  const phone = formatPhone(phoneNumber);
  const res = await axios.get(
    `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
    { headers }
  );
  return res.data.status ? res.data.customer : null;
}

async function getUserByAccount(accountNumber) {
  const res = await axios.get(
    'https://core-api.tagpay.ng/v1/wallet/customer/account',
    { headers, params: { accountNumber } }
  );
  return res.data?.status ? res.data.wallet : null;
}

async function nameEnquiry(sortCode, accountNumber) {
  const res = await axios.get(
    'https://core-api.tagpay.ng/v1/transfer/account/details',
    { headers, params: { sortCode, accountNumber } }
  );
  return res.data.status ? res.data.account : null;
}

async function bankTransfer(payload) {
  if (!payload.reference) payload.reference = uuidv4();
  const res = await axios.post(
    'https://core-api.tagpay.ng/v1/transfer/bank/customer',
    payload,
    { headers }
  );
  return res.data;
}

async function walletToWalletTransfer(payload) {
  const res = await axios.post(
    'https://core-api.tagpay.ng/v1/transfer/wallet',
    payload,
    { headers }
  );
  return res.data;
}



async function transferCharge({ feeAmount, fromCustomerId }) {
  const vatPercent = parseFloat(process.env.VAT_PERCENT || '7.5');

  const merchantFeeAmount = feeAmount;
  const vatAmount = +(feeAmount * vatPercent / 100).toFixed(2);

  try {
    /* =======================
       1️⃣ Transfer VAT to CBN
       ======================= */
    console.log('[FEE] Transferring VAT to CBN:', vatAmount);

    const cbnTransfer = await axios.post(
      'https://core-api.tagpay.ng/v1/transfer/wallet',
      {
        amount: vatAmount,
        fromCustomerId,
        toCustomerId: process.env.toCbnId
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CBN_FEE_SECRET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!cbnTransfer.data?.status) {
      throw new Error(
        `CBN VAT transfer failed: ${cbnTransfer.data?.message || 'Unknown error'}`
      );
    }

    console.log('[FEE] VAT transfer to CBN successful');

    /* ==========================
       2️ Transfer Fee to Merchant
       ========================== */
    console.log('[FEE] Transferring fee to Merchant:', merchantFeeAmount);

    const merchantTransfer = await axios.post(
      'https://core-api.tagpay.ng/v1/transfer/wallet',
      {
        amount: merchantFeeAmount,
        fromCustomerId,
        toCustomerId: process.env.toCustomerId
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MERCHANT_FEE}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!merchantTransfer.data?.status) {
      throw new Error(
        `Merchant fee transfer failed: ${merchantTransfer.data?.message || 'Unknown error'}`
      );
    }

    console.log('[FEE] Merchant fee transfer successful');

    return {
      vatAmount,
      merchantFeeAmount,
      cbnTransfer: cbnTransfer.data,
      merchantTransfer: merchantTransfer.data
    };

  } catch (err) {
    console.error('[FEE TRANSFER ERROR]');
    console.error(err.response?.data || err.message);

    // VERY IMPORTANT: bubble up so USSD can end safely
    throw err;
  }
}


async function getAccountBalanceByPhone(phoneNumber) {
  const customer = await checkUserByPhone(phoneNumber);
  if (!customer) return 0;

  const res = await axios.get(
    `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
    { headers }
  );

  return res.data?.wallet?.availableBalance || 0;
}

// Load bank list on import
loadBankList();

module.exports = {
  checkUserByPhone,
  getUserByAccount,
  nameEnquiry,
  bankTransfer,
  walletToWalletTransfer,
  transferCharge,
  getAccountBalanceByPhone,
  listBanks,
  getBankByCode
};













