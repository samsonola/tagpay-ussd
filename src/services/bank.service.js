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

// async function transferCharge({ feeAmount, fromCustomerId }) {
//   const vatPercent = parseFloat(process.env.VAT_PERCENT || '7.5');

//   const merchantAmount = feeAmount;
//   const cbnAmount = +(feeAmount * vatPercent / 100).toFixed(2);

//   // fire both transfers (parallel + faster)
//   const [cbnTransfer, merchantTransfer] = await Promise.all([
//     axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       {
//         amount: cbnAmount,
//         fromCustomerId,
//         toCustomerId: process.env.toCbnId
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.CBN_FEE_SECRET}`,
//           'Content-Type': 'application/json'
//         }
//       }
//     ),

//     axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       {
//         amount: merchantAmount,
//         fromCustomerId,
//         toCustomerId: process.env.toCustomerId
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.MERCHANT_FEE}`,
//           'Content-Type': 'application/json'
//         }
//       }
//     )
//   ]);

//   return {
//     merchantAmount,
//     cbnAmount,
//     merchantTransfer: merchantTransfer.data,
//     cbnTransfer: cbnTransfer.data
//   };
// }


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













// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');

// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// // ---------------- HELPERS ----------------
// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.slice(1);
//   return phone;
// }

// // ---------------- BANK LIST ----------------
// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = JSON.parse(fs.readFileSync(bankListPath));

// // ---------------- TAGPAY APIs ----------------
// async function checkUserByPhone(phoneNumber) {
//   const phone = formatPhone(phoneNumber);
//   const res = await axios.get(
//     `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
//     { headers }
//   );
//   return res.data.status ? res.data.customer : null;
// }

// async function getUserByAccount(accountNumber) {
//   const res = await axios.get(
//     'https://core-api.tagpay.ng/v1/wallet/customer/account',
//     { headers, params: { accountNumber } }
//   );
//   return res.data?.status ? res.data.wallet : null;
// }

// async function nameEnquiry(sortCode, accountNumber) {
//   const res = await axios.get(
//     'https://core-api.tagpay.ng/v1/transfer/account/details',
//     { headers, params: { sortCode, accountNumber } }
//   );
//   return res.data.status ? res.data.account : null;
// }

// async function bankTransfer(payload) {
//   if (!payload.reference) throw new Error('reference is required');
//   const res = await axios.post(
//     'https://core-api.tagpay.ng/v1/transfer/bank/customer',
//     payload,
//     { headers }
//   );
//   return res.data;
// }

// async function walletToWalletTransfer(payload) {
//   const res = await axios.post(
//     'https://core-api.tagpay.ng/v1/transfer/wallet',
//     payload,
//     { headers }
//   );
//   return res.data;
// }

// // ---------------- FEE SPLIT ----------------
// async function transferCharge({ feeAmount, fromCustomerId }) {
//   const vatPercent = parseFloat(process.env.VAT_PERCENT || '7.5');
//   const merchantAmount = feeAmount;
//   const cbnAmount = +(feeAmount * vatPercent / 100).toFixed(2);

//   const cbnTransfer = await axios.post(
//     'https://core-api.tagpay.ng/v1/transfer/wallet',
//     { amount: cbnAmount, fromCustomerId, toCustomerId: process.env.toCbnId },
//     { headers: { Authorization: `Bearer ${process.env.CBN_FEE_SECRET}`, 'Content-Type': 'application/json' } }
//   );

//   const merchantTransfer = await axios.post(
//     'https://core-api.tagpay.ng/v1/transfer/wallet',
//     { amount: merchantAmount, fromCustomerId, toCustomerId: process.env.toCustomerId },
//     { headers: { Authorization: `Bearer ${process.env.MERCHANT_FEE}`, 'Content-Type': 'application/json' } }
//   );

//   return {
//     merchantAmount,
//     cbnAmount,
//     merchantTransfer: merchantTransfer.data,
//     cbnTransfer: cbnTransfer.data
//   };
// }

// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   const res = await axios.get(
//     `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
//     { headers }
//   );

//   return res.data?.wallet?.availableBalance || 0;
// }

// module.exports = {
//   checkUserByPhone,
//   getUserByAccount,
//   nameEnquiry,
//   bankTransfer,
//   walletToWalletTransfer,
//   transferCharge,
//   getAccountBalanceByPhone,
//   listBanks: (s, p) => ({ banks, hasNext: false, hasPrev: false })
// };




// // src/services/bank.service.js
// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid');

// // ==================== HEADERS ====================
// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// // ==================== HELPERS ====================
// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.slice(1);
//   return phone;
// }

// // ==================== BANK LIST ====================
// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];

// function loadBankList() {
//   try {
//     const raw = fs.readFileSync(bankListPath, 'utf-8');
//     banks = JSON.parse(raw);
//     console.log(`[BankService] Bank list loaded: ${banks.length} banks`);
//   } catch (err) {
//     console.error('[BankService] Failed to load bank list:', err.message);
//     banks = [];
//   }
// }

// function listBanks(searchTerm = '', page = 0, pageSize = 10) {
//   let filtered = banks;
//   if (searchTerm) {
//     const search = searchTerm.toLowerCase();
//     filtered = banks.filter(b => b.name.toLowerCase().includes(search));
//   }
//   const start = page * pageSize;
//   const pagedBanks = filtered.slice(start, start + pageSize);
//   return {
//     banks: pagedBanks,
//     hasNext: start + pageSize < filtered.length,
//     hasPrev: page > 0
//   };
// }

// function getBankByCode(code) {
//   return banks.find(b => b.code === code) || null;
// }

// // ==================== TAGPAY API ====================
// async function checkUserByPhone(phoneNumber) {
//   const phone = formatPhone(phoneNumber);
//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
//       { headers }
//     );
//     return res.data.status ? res.data.customer : null;
//   } catch (err) {
//     console.error('checkUserByPhone error:', err.response?.data || err.message);
//     return null;
//   }
// }

// async function getUserByAccount(accountNumber) {
//   try {
//     const res = await axios.get(
//       'https://core-api.tagpay.ng/v1/wallet/customer/account',
//       {
//         headers,
//         params: { accountNumber }
//       }
//     );

//     if (!res.data?.status || !res.data?.wallet) {
//       return null;
//     }

//     const wallet = res.data.wallet;

//     return {
//       customerId: wallet.customerId,
//       accountNumber: wallet.accountNumber,
//       accountName: wallet.accountName,
//       phoneNumber: wallet.phoneNumber,
//       balance: wallet.availableBalance
//     };

//   } catch (err) {
//     console.error(
//       'getUserByAccount error:',
//       err.response?.data || err.message
//     );
//     return null;
//   }
// }


// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get(
//       'https://core-api.tagpay.ng/v1/transfer/account/details',
//       { headers, params: { sortCode, accountNumber } }
//     );
//     return res.data.status ? res.data.account : null;
//   } catch (err) {
//     console.error('nameEnquiry error:', err.response?.data || err.message);
//     return null;
//   }
// }

// async function bankTransfer({ accountNumber, bank, amount, narration, accountName, customerId, metadata }) {
//   try {
//     if (!bank || !bank.code) {
//       return { status: false, message: 'Bank not found' };
//     }
//     if (!customerId) {
//       return { status: false, message: 'Customer ID is required' };
//     }

//     const payload = {
//       accountNumber,
//       sortCode: bank.code,
//       amount,
//       narration,
//       accountName,
//       customerId,
//       metadata: metadata || {},
//       reference: uuidv4()
//     };

//     console.log('[BankService] Transfer payload:', JSON.stringify(payload, null, 2));

//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/bank/customer',
//       payload,
//       { headers }
//     );

//     console.log('[BankService] Transfer response:', res.data);
//     return res.data;

//   } catch (err) {
//     console.error('bankTransfer error FULL:', {
//       message: err.message,
//       response: err.response?.data,
//       status: err.response?.status
//     });
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // ==================== WALLET FEE TRANSFER ====================
// async function walletFeeTransfer({ amount, fromCustomerId }) {
//   try {
//     const payload = {
//       amount,
//       fromCustomerId,
//       toCustomerId: process.env.toCustomerId
//     };

//     const feeHeaders = {
//       Authorization: `Bearer ${process.env.MERCHANT_FEE}`,
//       'Content-Type': 'application/json'
//     };

//     console.log('[BankService] Wallet fee transfer payload:', JSON.stringify(payload, null, 2));

//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       payload,
//       { headers: feeHeaders }
//     );

//     // console.log('[BankService] Wallet fee transfer response:', res.data);
//     return res.data;

//   } catch (err) {
//     // console.error('[BankService] walletFeeTransfer error FULL:', {
//     //   message: err.message,
//     //   response: err.response?.data,
//     //   status: err.response?.status
//     // });
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }


// // TagPay wallet-to-wallet
// async function walletToWalletTransfer({ amount, fromCustomerId, toCustomerId }) {
//   try {
//     const res = await axios.post('https://core-api.tagpay.ng/v1/transfer/wallet', { amount, fromCustomerId, toCustomerId }, { headers });
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // Wallet fee transfer
// async function walletFeeTransfer({ amount, fromCustomerId }) {
//   try {
//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       { amount, fromCustomerId, toCustomerId: process.env.toCustomerId },
//       { headers: { Authorization: `Bearer ${process.env.MERCHANT_FEE}`, 'Content-Type': 'application/json' } }
//     );
//     return res.data;
//   } catch {
//     return { status: false };
//   }
// }

// /**
//  * Transfer fee from customer
//  * 10 → Merchant, 0.75 → CBN
//  *
//  * @param {number} feeAmount - fee for merchant
//  * @param {string} fromCustomerId - wallet ID of customer paying
//  * @param {string} bankTransferLogId - optional, to update bank_transfer_logs table
//  */
// async function transferCharge({ feeAmount, fromCustomerId, bankTransferLogId }) {
//   if (!feeAmount || feeAmount <= 0) throw new Error('Invalid fee amount');
//   if (!fromCustomerId) throw new Error('fromCustomerId is required');

//   const vatPercent = parseFloat(process.env.VAT_PERCENT || '7.5');

//   // Amounts
//   const merchantAmount = parseFloat(feeAmount.toFixed(2)); // full fee to merchant
//   const cbnAmount = parseFloat((feeAmount * (vatPercent / 100)).toFixed(2)); // VAT to CBN

//   console.log(`[BankService] Fee split - Fee: ${merchantAmount}, VAT(7.5%): ${cbnAmount}`);

//   let cbnTransfer = { status: false }, merchantTransfer = { status: false };

//   // 1️⃣ Send VAT to CBN
//   try {
//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       { amount: cbnAmount, fromCustomerId, toCustomerId: process.env.toCbnId },
//       { headers: { Authorization: `Bearer ${process.env.CBN_FEE_SECRET}`, 'Content-Type': 'application/json' } }
//     );
//     cbnTransfer = res.data;
//     if (!cbnTransfer.status) console.error('[CBN Fee Transfer Failed]', cbnTransfer.message);
//   } catch (err) {
//     console.error('[CBN Fee Transfer Error]', err.response?.data || err.message);
//   }

//   // 2️⃣ Send Fee to Merchant
//   try {
//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       { amount: merchantAmount, fromCustomerId, toCustomerId: process.env.toCustomerId },
//       { headers: { Authorization: `Bearer ${process.env.MERCHANT_FEE}`, 'Content-Type': 'application/json' } }
//     );
//     merchantTransfer = res.data;
//     if (!merchantTransfer.status) console.error('[Merchant Fee Transfer Failed]', merchantTransfer.message);
//   } catch (err) {
//     console.error('[Merchant Fee Transfer Error]', err.response?.data || err.message);
//   }

//   // 3️⃣ Update DB if log ID is provided
//   if (bankTransferLogId) {
//     try {
//       await pool.query('UPDATE bank_transfer_logs SET merchant_fee = ?, merchant_fee_status = ?, cbn_fee = ?, cbn_fee_status = ? WHERE id = ?', [
//         merchantAmount,
//         merchantTransfer.status ? 'success' : 'failed',
//         cbnAmount,
//         cbnTransfer.status ? 'success' : 'failed',
//         bankTransferLogId
//       ]);
//     } catch (err) {
//       console.error('[BankService] Failed to update bank_transfer_logs for fee:', err.message);
//     }
//   }

//   return {
//     status: cbnTransfer.status && merchantTransfer.status,
//     totalFee: parseFloat((merchantAmount + cbnAmount).toFixed(2)), // total deducted from sender
//     cbnAmount,
//     merchantAmount,
//     cbnTransfer,
//     merchantTransfer
//   };
// }




// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;
//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
//       { headers }
//     );
//     return res.data.status && res.data.wallet ? res.data.wallet.availableBalance || 0 : 0;
//   } catch (err) {
//     console.error('getAccountBalanceByPhone error:', err.response?.data || err.message);
//     return 0;
//   }
// }

// // Load bank list on import
// loadBankList();

// module.exports = {
//   loadBankList,
//   listBanks,
//   getBankByCode,
//   checkUserByPhone,
//   nameEnquiry,
//   getUserByAccount,
//   bankTransfer,
//    transferCharge,
//   walletFeeTransfer,
//   walletToWalletTransfer,
//   getAccountBalanceByPhone
// };









// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid');

// // Env Variables (ensure these are set in production)
// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.slice(1);
//   return phone;
// }

// // Load bank list
// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];
// function loadBankList() {
//   banks = JSON.parse(fs.readFileSync(bankListPath, 'utf8'));
// }
// loadBankList();

// function listBanks(search = '', page = 0, size = 10) {
//   let filtered = banks;
//   if (search) filtered = banks.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));
//   const start = page * size;
//   return { banks: filtered.slice(start, start + size), hasNext: start + size < filtered.length, hasPrev: page > 0 };
// }

// // Check customer exists
// async function checkUserByPhone(phoneNumber) {
//   try {
//     const phone = formatPhone(phoneNumber);
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`, { headers });
//     return res.data?.status ? res.data.customer : null;
//   } catch {
//     return null;
//   }
// }

// // Get wallet for TagPay transfers
// async function getWalletByPhone(phoneNumber) {
//   try {
//     const phone = formatPhone(phoneNumber);
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/wallet/customer?accountNumber=${phone}`, { headers });
//     return res.data?.status ? res.data.wallet : null;
//   } catch {
//     return null;
//   }
// }

// // Name enquiry for bank accounts
// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get('https://core-api.tagpay.ng/v1/transfer/account/details', { headers, params: { sortCode, accountNumber } });
//     return res.data?.status ? res.data.account : null;
//   } catch {
//     return null;
//   }
// }

// // Bank transfer
// async function bankTransfer(payload) {
//   try {
//     payload.reference = payload.reference || uuidv4();
//     const res = await axios.post('https://core-api.tagpay.ng/v1/transfer/bank/customer', payload, { headers });
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // TagPay wallet-to-wallet
// async function walletToWalletTransfer({ amount, fromCustomerId, toCustomerId }) {
//   try {
//     const res = await axios.post('https://core-api.tagpay.ng/v1/transfer/wallet', { amount, fromCustomerId, toCustomerId }, { headers });
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // Wallet fee transfer
// async function walletFeeTransfer({ amount, fromCustomerId }) {
//   try {
//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       { amount, fromCustomerId, toCustomerId: process.env.toCustomerId },
//       { headers: { Authorization: `Bearer ${process.env.MERCHANT_FEE}`, 'Content-Type': 'application/json' } }
//     );
//     return res.data;
//   } catch {
//     return { status: false };
//   }
// }

// // Get account balance
// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`, { headers });
//     return res.data?.wallet?.availableBalance || 0;
//   } catch {
//     return 0;
//   }
// }

// module.exports = {
//   listBanks,
//   checkUserByPhone,
//   getWalletByPhone,
//   nameEnquiry,
//   bankTransfer,
//   walletToWalletTransfer,
//   walletFeeTransfer,
//   getAccountBalanceByPhone
// };









// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid');

// // Env Variables (ensure these are set in production)
// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.slice(1);
//   return phone;
// }

// // Load bank list
// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];
// function loadBankList() {
//   banks = JSON.parse(fs.readFileSync(bankListPath, 'utf8'));
// }
// loadBankList();

// function listBanks(search = '', page = 0, size = 10) {
//   let filtered = banks;
//   if (search) filtered = banks.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));
//   const start = page * size;
//   return { banks: filtered.slice(start, start + size), hasNext: start + size < filtered.length, hasPrev: page > 0 };
// }

// // Check customer exists
// async function checkUserByPhone(phoneNumber) {
//   try {
//     const phone = formatPhone(phoneNumber);
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`, { headers });
//     return res.data?.status ? res.data.customer : null;
//   } catch {
//     return null;
//   }
// }

// // Get wallet for TagPay transfers
// async function getWalletByPhone(phoneNumber) {
//   try {
//     const phone = formatPhone(phoneNumber);
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/wallet/customer?accountNumber=${phone}`, { headers });
//     return res.data?.status ? res.data.wallet : null;
//   } catch {
//     return null;
//   }
// }

// // Name enquiry for bank accounts
// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get('https://core-api.tagpay.ng/v1/transfer/account/details', { headers, params: { sortCode, accountNumber } });
//     return res.data?.status ? res.data.account : null;
//   } catch {
//     return null;
//   }
// }

// // Bank transfer
// async function bankTransfer(payload) {
//   try {
//     payload.reference = payload.reference || uuidv4();
//     const res = await axios.post('https://core-api.tagpay.ng/v1/transfer/bank/customer', payload, { headers });
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // TagPay wallet-to-wallet
// async function walletToWalletTransfer({ amount, fromCustomerId, toCustomerId }) {
//   try {
//     const res = await axios.post('https://core-api.tagpay.ng/v1/transfer/wallet', { amount, fromCustomerId, toCustomerId }, { headers });
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // Wallet fee transfer
// async function walletFeeTransfer({ amount, fromCustomerId }) {
//   try {
//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       { amount, fromCustomerId, toCustomerId: process.env.FEE_CUSTOMER_ID },
//       { headers: { Authorization: `Bearer ${process.env.MERCHANT_FEE}`, 'Content-Type': 'application/json' } }
//     );
//     return res.data;
//   } catch {
//     return { status: false };
//   }
// }

// // Get account balance
// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`, { headers });
//     return res.data?.wallet?.availableBalance || 0;
//   } catch {
//     return 0;
//   }
// }

// module.exports = {
//   listBanks,
//   checkUserByPhone,
//   getWalletByPhone,
//   nameEnquiry,
//   bankTransfer,
//   walletToWalletTransfer,
//   walletFeeTransfer,
//   getAccountBalanceByPhone
// };









// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid');

// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.slice(1);
//   return phone;
// }

// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];

// function loadBankList() {
//   banks = JSON.parse(fs.readFileSync(bankListPath, 'utf8'));
// }

// function listBanks(search = '', page = 0, size = 10) {
//   let filtered = banks;
//   if (search) filtered = banks.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));
//   const start = page * size;
//   return { banks: filtered.slice(start, start + size), hasNext: start + size < filtered.length, hasPrev: page > 0 };
// }

// async function checkUserByPhone(phoneNumber) {
//   try {
//     const phone = formatPhone(phoneNumber);
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`, { headers });
//     return res.data?.status ? res.data.customer : null;
//   } catch {
//     return null;
//   }
// }

// async function getWalletByPhone(phoneNumber) {
//   try {
//     const phone = formatPhone(phoneNumber);
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/wallet/customer?accountNumber=${phone}`, { headers });
//     return res.data?.status ? res.data.wallet : null;
//   } catch {
//     return null;
//   }
// }

// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get('https://core-api.tagpay.ng/v1/transfer/account/details', { headers, params: { sortCode, accountNumber } });
//     return res.data?.status ? res.data.account : null;
//   } catch {
//     return null;
//   }
// }

// async function bankTransfer(payload) {
//   try {
//     payload.reference = payload.reference || uuidv4();
//     const res = await axios.post('https://core-api.tagpay.ng/v1/transfer/bank/customer', payload, { headers });
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// async function walletToWalletTransfer({ amount, fromCustomerId, toCustomerId }) {
//   try {
//     const res = await axios.post('https://core-api.tagpay.ng/v1/transfer/wallet', { amount, fromCustomerId, toCustomerId }, { headers });
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// async function walletFeeTransfer({ amount, fromCustomerId }) {
//   try {
//     const res = await axios.post('https://core-api.tagpay.ng/v1/transfer/wallet', {
//       amount,
//       fromCustomerId,
//       toCustomerId: process.env.FEE_CUSTOMER_ID
//     }, {
//       headers: {
//         Authorization: `Bearer ${process.env.MERCHANT_FEE}`,
//         'Content-Type': 'application/json'
//       }
//     });
//     return res.data;
//   } catch {
//     return { status: false };
//   }
// }

// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(`https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`, { headers });
//     return res.data?.wallet?.availableBalance || 0;
//   } catch {
//     return 0;
//   }
// }

// loadBankList();

// module.exports = {
//   listBanks,
//   checkUserByPhone,
//   getWalletByPhone,
//   nameEnquiry,
//   bankTransfer,
//   walletToWalletTransfer,
//   walletFeeTransfer,
//   getAccountBalanceByPhone
// };











// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid');

// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.slice(1);
//   return phone;
// }

// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];

// function loadBankList() {
//   banks = JSON.parse(fs.readFileSync(bankListPath, 'utf8'));
// }

// function listBanks(search = '', page = 0, size = 10) {
//   let filtered = banks;
//   if (search) {
//     filtered = banks.filter(b =>
//       b.name.toLowerCase().includes(search.toLowerCase())
//     );
//   }
//   const start = page * size;
//   return {
//     banks: filtered.slice(start, start + size),
//     hasNext: start + size < filtered.length,
//     hasPrev: page > 0
//   };
// }

// async function checkUserByPhone(phoneNumber) {
//   try {
//     const phone = formatPhone(phoneNumber);
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
//       { headers }
//     );
//     return res.data?.status ? res.data.customer : null;
//   } catch {
//     return null;
//   }
// }

// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get(
//       'https://core-api.tagpay.ng/v1/transfer/account/details',
//       { headers, params: { sortCode, accountNumber } }
//     );
//     return res.data?.status ? res.data.account : null;
//   } catch {
//     return null;
//   }
// }

// async function bankTransfer(payload) {
//   try {
//     payload.reference = payload.reference || uuidv4();
//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/bank/customer',
//       payload,
//       { headers }
//     );
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// /**
//  * WALLET → WALLET (TAGPAY)
//  */
// async function walletToWalletTransfer({ amount, fromCustomerId, toCustomerId }) {
//   try {
//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       { amount, fromCustomerId, toCustomerId },
//       { headers }
//     );
//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// async function walletFeeTransfer({ amount, fromCustomerId }) {
//   try {
//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       {
//         amount,
//         fromCustomerId,
//         toCustomerId: process.env.toCustomerId
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.MERCHANT_FEE}`,
//           'Content-Type': 'application/json'
//         }
//       }
//     );
//     return res.data;
//   } catch {
//     return { status: false };
//   }
// }

// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
//       { headers }
//     );
//     return res.data?.wallet?.availableBalance || 0;
//   } catch {
//     return 0;
//   }
// }

// loadBankList();

// module.exports = {
//   listBanks,
//   checkUserByPhone,
//   nameEnquiry,
//   bankTransfer,
//   walletToWalletTransfer,
//   walletFeeTransfer,
//   getAccountBalanceByPhone
// };













// // src/bank.service.js
// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid');

// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.substring(1);
//   return phone;
// }

// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];

// function loadBankList() {
//   try {
//     const raw = fs.readFileSync(bankListPath, 'utf-8');
//     banks = JSON.parse(raw);
//     console.log(`[BankService] Bank list loaded: ${banks.length} banks`);
//   } catch (err) {
//     console.error('[BankService] Failed to load bank list:', err.message);
//     banks = [];
//   }
// }

// function listBanks(searchTerm = '', page = 0, pageSize = 10) {
//   let filtered = banks;
//   if (searchTerm) {
//     const search = searchTerm.toLowerCase();
//     filtered = banks.filter(b => b.name.toLowerCase().includes(search));
//   }
//   const start = page * pageSize;
//   const pagedBanks = filtered.slice(start, start + pageSize);
//   return {
//     banks: pagedBanks,
//     hasNext: start + pageSize < filtered.length,
//     hasPrev: page > 0
//   };
// }


// function getBankByCode(code) {
//   code = code.toString().padStart(6, '0'); // normalize
//   return banks.find(b => b.code.toString().padStart(6,'0') === code) || null;
// }



// async function checkUserByPhone(phoneNumber) {
//   const phone = formatPhone(phoneNumber);
//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
//       { headers }
//     );
//     return res.data.status && res.data.customer ? res.data.customer : null;
//   } catch (err) {
//     console.error('checkUserByPhone error:', err.response?.data || err.message);
//     return null;
//   }
// }

// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get(
//       'https://core-api.tagpay.ng/v1/transfer/account/details',
//       { headers, params: { sortCode, accountNumber } }
//     );
//     return res.data.status ? res.data.account : null;
//   } catch (err) {
//     console.error('nameEnquiry error:', err.response?.data || err.message);
//     return null;
//   }
// }

// async function bankTransfer({ accountNumber, bank, amount, narration, accountName, customerId, metadata }) {
//   try {
//     if (!bank || !bank.code) {
//       return { status: false, message: 'Bank not found' };
//     }

//     if (!customerId) {
//       return { status: false, message: 'Customer ID is required for this transfer' };
//     }

//     const payload = {
//       accountNumber,
//       sortCode: bank.code,
//       amount,
//       narration,
//       accountName,
//       customerId,
//       metadata: metadata || {},
//       reference: uuidv4()
//     };

//     console.log('[USSD] Transfer payload:', JSON.stringify(payload, null, 2));

//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/bank/customer',
//       payload,
//       { headers }
//     );

//     console.log('[USSD] Transfer response:', res.data);
//     return res.data;

//   } catch (err) {
//     console.error('bankTransfer error FULL:', {
//       message: err.message,
//       response: err.response?.data,
//       status: err.response?.status
//     });
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }


// async function walletFeeTransfer({ amount, fromCustomerId }) {
//   try {
//     const payload = {
//       amount,
//       fromCustomerId,
//       toCustomerId: process.env.toCustomerId
//     };

//     const feeHeaders = {
//       Authorization: `Bearer ${process.env.MERCHANT_FEE}`,
//       'Content-Type': 'application/json'
//     };

//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/wallet',
//       payload,
//       { headers: feeHeaders }
//     );

//     return res.data;
//   } catch (err) {
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }



// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
//       { headers }
//     );
//     return res.data.status && res.data.wallet ? res.data.wallet.availableBalance || 0 : 0;
//   } catch (err) {
//     console.error('getAccountBalanceByPhone error:', err.response?.data || err.message);
//     return 0;
//   }
// }

// // Immediately load bank list on import
// loadBankList();

// module.exports = {
//   loadBankList,
//   listBanks,
//   getBankByCode,
//   checkUserByPhone,
//   nameEnquiry,
//   bankTransfer,
//   walletFeeTransfer,
//   getAccountBalanceByPhone
// };







// // src/services/bank.service.js
// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid'); // For unique transfer reference

// // ==================== HEADERS ====================
// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// // ==================== HELPERS ====================
// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.substring(1);
//   return phone;
// }

// // ==================== BANK LIST ====================
// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];

// function loadBankList() {
//   try {
//     const raw = fs.readFileSync(bankListPath, 'utf-8');
//     banks = JSON.parse(raw);
//     console.log(`[BankService] Bank list loaded: ${banks.length} banks`);
//   } catch (err) {
//     console.error('[BankService] Failed to load bank list:', err.message);
//     banks = [];
//   }
// }

// // List banks with pagination
// function listBanks(searchTerm = '', page = 0, pageSize = 10) {
//   let filtered = banks;
//   if (searchTerm) {
//     const search = searchTerm.toLowerCase();
//     filtered = banks.filter(b => b.name.toLowerCase().includes(search));
//   }
//   const start = page * pageSize;
//   const pagedBanks = filtered.slice(start, start + pageSize);
//   return {
//     banks: pagedBanks,
//     hasNext: start + pageSize < filtered.length,
//     hasPrev: page > 0
//   };
// }

// // Lookup bank by code
// function getBankByCode(code) {
//   return banks.find(b => b.code === code) || null;
// }

// // ==================== TAGPAY API ====================

// // Check if user exists
// async function checkUserByPhone(phoneNumber) {
//   const phone = formatPhone(phoneNumber); // make sure phone is in proper format
//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
//       { headers }
//     );

//     if (res.data.status && res.data.customer) {
//       // return the full customer object, including customerId
//       return res.data.customer;
//     }

//     return null;
//   } catch (err) {
//     console.error('checkUserByPhone error:', {
//       message: err.message,
//       response: err.response?.data,
//       status: err.response?.status
//     });
//     return null;
//   }
// }

// // async function checkUserByPhone(phoneNumber) {
// //   const phone = formatPhone(phoneNumber);
// //   try {
// //     const res = await axios.get(
// //       `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
// //       { headers }
// //     );
// //     return res.data.status ? res.data.customer : null;
// //   } catch (err) {
// //     console.error('checkUserByPhone error:', err.response?.data || err.message);
// //     return null;
// //   }
// // }

// // Name enquiry
// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get(
//       'https://core-api.tagpay.ng/v1/transfer/account/details',
//       { headers, params: { sortCode, accountNumber } }
//     );
//     return res.data.status ? res.data.account : null;
//   } catch (err) {
//     console.error('nameEnquiry error:', err.response?.data || err.message);
//     return null;
//   }
// }

// // Bank transfer



// async function bankTransfer({
//   accountNumber,
//   bank,
//   amount,
//   narration,
//   accountName,
//   customerId,       // <-- REQUIRED now
//   metadata
// }) {
//   try {
//     // validate required fields
//     if (!bank || !bank.code) {
//       return { status: false, message: 'Bank not found' };
//     }

//     if (!customerId) {
//       return { status: false, message: 'Customer ID is required for this transfer' };
//     }

//     const payload = {
//       accountNumber,
//       sortCode: bank.code,    // bank code
//       amount,
//       narration,
//       accountName,
//       customerId,             // critical for debiting customer wallet
//       metadata: metadata || {}, // optional
//       reference: uuidv4()
//     };

//     console.log('[USSD] Transfer payload:', JSON.stringify(payload, null, 2));

//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/bank/customer',  // <--- new endpoint
//       payload,
//       { headers }  // make sure headers include Authorization
//     );

//     console.log('[USSD] Transfer response:', res.data);

//     return res.data;
//   } catch (err) {
//     console.error('bankTransfer error FULL:', {
//       message: err.message,
//       response: err.response?.data,
//       status: err.response?.status
//     });

//     return {
//       status: false,
//       message: err.response?.data?.message || err.message
//     };
//   }
// }

// // async function bankTransfer({ accountNumber, bank, amount, narration, accountName, metadata }) {
// //   try {
// //     // if (!bank || !bank.code) {
// //     //   return { status: false, message: 'Bank not found' };
// //     // }
    


// //     const payload = {
// //       accountNumber,
// //       sortCode: bank.code,
// //       amount,
// //       narration,
// //       accountName,        // <-- REQUIRED
// //       metadata: metadata || {}, // optional
// //       reference: uuidv4()
// //     };

// //     if (!payload.sortCode || typeof payload.sortCode !== 'string') {
// //   console.error('[USSD] INVALID sortCode:', payload.sortCode);
// // }

// //     console.log('[USSD] Transfer payload:', JSON.stringify(payload, null, 2));

// //     const res = await axios.post(
// //       'https://core-api.tagpay.ng/v1/transfer/bank',
// //       payload,
// //       { headers }
// //     );

// //     console.log('[USSD] Transfer response:', res.data);

// //     return res.data;
// //   } catch (err) {
// //   console.error('bankTransfer error FULL:', {
// //     message: err.message,
// //     response: err.response?.data,
// //     status: err.response?.status
// //   });

// //   return {
// //     status: false,
// //     message: err.response?.data?.message || err.message
// //   };
// // }

// // }

// // Accepts either bank object {code} or a direct sortCode
// // async function bankTransfer({ accountNumber, bank, sortCode, amount, narration }) {
// //   try {
// //     const code = (bank && bank.code) || sortCode;
// //     if (!code) {
// //       return { status: false, message: 'Bank not found' };
// //     }

// //     const payload = {
// //       accountNumber,
// //       sortCode: code,
// //       amount,
// //       narration,
// //       reference: uuidv4()
// //     };

// //     const res = await axios.post(
// //       'https://core-api.tagpay.ng/v1/transfer/bank',
// //       payload,
// //       { headers }
// //     );

// //     return res.data;
// //   } catch (err) {
// //     console.error('bankTransfer error:', err.response?.data || err.message);
// //     return { status: false, message: err.response?.data?.message || err.message };
// //   }
// // }

// // Get account balance
// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
//       { headers }
//     );
//     return res.data.status && res.data.wallet
//       ? res.data.wallet.availableBalance || 0
//       : 0;
//   } catch (err) {
//     console.error('getAccountBalanceByPhone error:', err.response?.data || err.message);
//     return 0;
//   }
// }

// // Immediately load bank list on import
// loadBankList();

// // ==================== EXPORT ====================
// module.exports = {
//   loadBankList,
//   listBanks,
//   getBankByCode,
//   checkUserByPhone,
//   nameEnquiry,
//   bankTransfer,
//   getAccountBalanceByPhone
// };














// src/services/bank.service.js
// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid'); // For unique transfer reference

// // ==================== HEADERS ====================
// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// // ==================== HELPERS ====================
// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.substring(1);
//   return phone;
// }

// // ==================== BANK LIST ====================
// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];

// function loadBankList() {
//   try {
//     const raw = fs.readFileSync(bankListPath, 'utf-8');
//     banks = JSON.parse(raw);
//     console.log(`[BankService] Bank list loaded: ${banks.length} banks`);
//   } catch (err) {
//     console.error('[BankService] Failed to load bank list:', err.message);
//     banks = [];
//   }
// }

// // List banks with pagination
// function listBanks(searchTerm = '', page = 0, pageSize = 10) {
//   let filtered = banks;
//   if (searchTerm) {
//     const search = searchTerm.toLowerCase();
//     filtered = banks.filter(b => b.name.toLowerCase().includes(search));
//   }
//   const start = page * pageSize;
//   const pagedBanks = filtered.slice(start, start + pageSize);
//   return {
//     banks: pagedBanks,
//     hasNext: start + pageSize < filtered.length,
//     hasPrev: page > 0
//   };
// }

// // Lookup a bank by code
// function getBankByCode(code) {
//   return banks.find(b => b.code === code) || null;
// }

// // ==================== TAGPAY API ====================

// // Check if user exists
// async function checkUserByPhone(phoneNumber) {
//   const phone = formatPhone(phoneNumber);
//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
//       { headers }
//     );
//     return res.data.status ? res.data.customer : null;
//   } catch (err) {
//     console.error('checkUserByPhone error:', err.response?.data || err.message);
//     return null;
//   }
// }

// // Name enquiry
// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get(
//       'https://core-api.tagpay.ng/v1/transfer/account/details',
//       { headers, params: { sortCode, accountNumber } }
//     );
//     return res.data.status ? res.data.account : null;
//   } catch (err) {
//     console.error('nameEnquiry error:', err.response?.data || err.message);
//     return null;
//   }
// }

// // Bank transfer
// // Accepts either bank object {code} or directly sortCode
// async function bankTransfer({ accountNumber, bank, sortCode, amount, narration }) {
//   try {
//     const code = (bank && bank.code) || sortCode;
//     if (!code) {
//       return { status: false, message: 'Bank not found' };
//     }

//     const payload = {
//       accountNumber,
//       sortCode: code,
//       amount,
//       narration,
//       reference: uuidv4()
//     };

//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/bank',
//       payload,
//       { headers }
//     );

//     return res.data;
//   } catch (err) {
//     console.error('bankTransfer error:', err.response?.data || err.message);
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // Get account balance
// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
//       { headers }
//     );
//     return res.data.status && res.data.wallet
//       ? res.data.wallet.availableBalance || 0
//       : 0;
//   } catch (err) {
//     console.error('getAccountBalanceByPhone error:', err.response?.data || err.message);
//     return 0;
//   }
// }

// // Immediately load bank list
// loadBankList();

// // Export all functions
// module.exports = {
//   loadBankList,
//   listBanks,
//   getBankByCode,
//   checkUserByPhone,
//   nameEnquiry,
//   bankTransfer,
//   getAccountBalanceByPhone
// };









// src/services/bank.service.js
// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid'); // For unique transfer reference

// // ==================== HEADERS ====================
// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// // ==================== HELPERS ====================
// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.substring(1);
//   return phone;
// }

// // ==================== BANK LIST (USSD MENU) ====================
// const bankListPath = path.join(__dirname, '../data/banklist.json');
// let banks = [];

// // Load bank list immediately
// (function loadBankList() {
//   try {
//     const raw = fs.readFileSync(bankListPath, 'utf-8');
//     banks = JSON.parse(raw);
//     console.log(`[BankService] Bank list loaded: ${banks.length} banks`);
//   } catch (err) {
//     console.error('[BankService] Failed to load bank list:', err.message);
//     banks = [];
//   }
// })();

// // List banks with pagination
// function listBanks(searchTerm = '', page = 0, pageSize = 10) {
//   let filtered = banks;
//   if (searchTerm) {
//     const search = searchTerm.toLowerCase();
//     filtered = banks.filter(b => b.name.toLowerCase().includes(search));
//   }
//   const start = page * pageSize;
//   const pagedBanks = filtered.slice(start, start + pageSize);
//   return {
//     banks: pagedBanks,
//     hasNext: start + pageSize < filtered.length,
//     hasPrev: page > 0
//   };
// }

// // Get bank by code
// function getBankByCode(code) {
//   return banks.find(b => b.code === code) || null;
// }

// // ==================== TAGPAY API ====================

// // Check if user exists
// async function checkUserByPhone(phoneNumber) {
//   const phone = formatPhone(phoneNumber);
//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
//       { headers }
//     );
//     return res.data.status ? res.data.customer : null;
//   } catch (err) {
//     console.error('checkUserByPhone error:', err.response?.data || err.message);
//     return null;
//   }
// }

// // Name enquiry
// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get(
//       'https://core-api.tagpay.ng/v1/transfer/account/details',
//       { headers, params: { sortCode, accountNumber } }
//     );
//     return res.data.status ? res.data.account : null;
//   } catch (err) {
//     console.error('nameEnquiry error:', err.response?.data || err.message);
//     return null;
//   }
// }

// // Bank transfer
// async function bankTransfer({ accountNumber, bank, amount, narration }) {
//   try {
//     if (!bank || !bank.code) {
//       return { status: false, message: 'Bank not found' };
//     }

//     const payload = {
//       accountNumber,
//       sortCode: bank.code,
//       amount,
//       narration,
//       reference: uuidv4()
//     };

//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/bank',
//       payload,
//       { headers }
//     );

//     return res.data;
//   } catch (err) {
//     console.error('bankTransfer error:', err.response?.data || err.message);
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // Get account balance
// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
//       { headers }
//     );
//     return res.data.status && res.data.wallet
//       ? res.data.wallet.availableBalance || 0
//       : 0;
//   } catch (err) {
//     console.error('getAccountBalanceByPhone error:', err.response?.data || err.message);
//     return 0;
//   }
// }

// module.exports = {
//   listBanks,
//   getBankByCode,
//   checkUserByPhone,
//   nameEnquiry,
//   bankTransfer,
//   getAccountBalanceByPhone
// };









// src/services/bank.service.js
// const axios = require('axios');
// const { getBankByCode } = require('./bank.service');
// const { v4: uuidv4 } = require('uuid'); // For unique transfer reference

// // ==================== HEADERS ====================
// const headers = {
//   Authorization: `Bearer ${process.env.MERCHANT_SECRET}`,
//   'Content-Type': 'application/json'
// };

// // ==================== HELPERS ====================
// function formatPhone(phone) {
//   phone = phone.replace(/\D/g, '');
//   if (phone.startsWith('0')) phone = '234' + phone.substring(1);
//   return phone;
// }

// // ==================== CHECK USER ====================
// async function checkUserByPhone(phoneNumber) {
//   const phone = formatPhone(phoneNumber);
//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/customer/phone?phoneNumber=${phone}`,
//       { headers }
//     );
//     return res.data.status ? res.data.customer : null;
//   } catch (err) {
//     console.error('checkUserByPhone error:', err.response?.data || err.message);
//     return null;
//   }
// }

// // ==================== NAME ENQUIRY ====================
// async function nameEnquiry(sortCode, accountNumber) {
//   try {
//     const res = await axios.get(
//       'https://core-api.tagpay.ng/v1/transfer/account/details',
//       { headers, params: { sortCode, accountNumber } }
//     );
//     return res.data.status ? res.data.account : null;
//   } catch (err) {
//     console.error('nameEnquiry error:', err.response?.data || err.message);
//     return null;
//   }
// }

// // ==================== BANK TRANSFER ====================
// async function bankTransfer({ accountNumber, bank, amount, narration }) {
//   try {
//     if (!bank || !bank.code) {
//       return { status: false, message: 'Bank not found' };
//     }

//     const payload = {
//       accountNumber,
//       sortCode: bank.code,
//       amount,
//       narration,
//       reference: uuidv4() // unique transfer reference
//     };

//     const res = await axios.post(
//       'https://core-api.tagpay.ng/v1/transfer/bank',
//       payload,
//       { headers }
//     );

//     return res.data;
//   } catch (err) {
//     console.error('bankTransfer error:', err.response?.data || err.message);
//     return { status: false, message: err.response?.data?.message || err.message };
//   }
// }

// // ==================== GET BALANCE ====================
// async function getAccountBalanceByPhone(phoneNumber) {
//   const customer = await checkUserByPhone(phoneNumber);
//   if (!customer) return 0;

//   try {
//     const res = await axios.get(
//       `https://core-api.tagpay.ng/v1/wallet/customer?customerId=${customer.id}`,
//       { headers }
//     );
//     return res.data.status && res.data.wallet ? res.data.wallet.availableBalance || 0 : 0;
//   } catch (err) {
//     console.error('getAccountBalanceByPhone error:', err.response?.data || err.message);
//     return 0;
//   }
// }

// module.exports = {
//   checkUserByPhone,
//   nameEnquiry,
//   bankTransfer,
//   getAccountBalanceByPhone
// };















// const fs = require('fs');
// const path = require('path');

// // Path to banklist.json
// const bankListPath = path.join(__dirname, '../data/banklist.json');

// let banks = [];

// /**
//  * Load bank list from JSON file
//  */
// function loadBankList() {
//   try {
//     const raw = fs.readFileSync(bankListPath, 'utf-8');
//     banks = JSON.parse(raw);
//     console.log(`Bank list loaded. Total banks: ${banks.length}`);
//   } catch (err) {
//     console.error('Error loading bank list:', err.message);
//     banks = [];
//   }
// }

// /**
//  * Return all banks
//  */
// function getAllBanks() {
//   return banks;
// }

// /**
//  * Search banks by name with pagination
//  */
// function listBanks(searchTerm = '', page = 0, pageSize = 10) {
//   let filtered = banks;

//   if (searchTerm) {
//     const search = searchTerm.toLowerCase();
//     filtered = banks.filter(b => b.name.toLowerCase().includes(search));
//   }

//   const start = page * pageSize;
//   const pagedBanks = filtered.slice(start, start + pageSize);

//   return {
//     banks: pagedBanks,
//     hasNext: start + pageSize < filtered.length,
//     hasPrev: page > 0
//   };
// }

// /**
//  * Find bank by exact name
//  */
// function getBankByName(name) {
//   return banks.find(b => b.name.toLowerCase() === name.toLowerCase()) || null;
// }

// /**
//  * Find bank by code
//  */
// function getBankByCode(code) {
//   return banks.find(b => b.code === code) || null;
// }

// // Load banks immediately
// loadBankList();

// module.exports = {
//   loadBankList,
//   getAllBanks,
//   listBanks,
//   getBankByName,
//   getBankByCode
// };
















// src/services/bank.service.js
// const fs = require('fs');
// const path = require('path');

// // Path to banklist.json
// const bankListPath = path.join(__dirname, '../data/banklist.json');

// let banks = [];

// // Load bank list from JSON file
// function loadBankList() {
//   try {
//     const raw = fs.readFileSync(bankListPath, 'utf-8');
//     banks = JSON.parse(raw);
//     console.log(`Bank list loaded. Total banks: ${banks.length}`);
//   } catch (err) {
//     console.error('Error loading bank list:', err.message);
//     banks = [];
//   }
// }

// // Get all banks
// function getAllBanks() {
//   return banks;
// }

// // Search + Pagination
// function listBanks(searchTerm = '', page = 0, pageSize = 10) {
//   let filtered = banks;

//   if (searchTerm) {
//     const search = searchTerm.toLowerCase();
//     filtered = banks.filter(b => b.name.toLowerCase().includes(search));
//   }

//   const start = page * pageSize;
//   const pagedBanks = filtered.slice(start, start + pageSize);

//   return {
//     banks: pagedBanks,
//     hasNext: start + pageSize < filtered.length,
//     hasPrev: page > 0
//   };
// }

// // Lookup a bank by exact name
// function getBankByName(name) {
//   return banks.find(b => b.name.toLowerCase() === name.toLowerCase()) || null;
// }

// // Lookup a bank by code
// function getBankByCode(code) {
//   return banks.find(b => b.code === code) || null;
// }

// // Immediately load bank list when service is imported
// loadBankList();

// module.exports = {
//   loadBankList,
//   getAllBanks,
//   listBanks,
//   getBankByName,
//   getBankByCode
// };
