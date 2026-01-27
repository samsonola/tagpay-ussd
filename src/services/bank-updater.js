// src/services/bank-updater.service.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PAYSTACK_URL = 'https://api.paystack.co/bank';

async function updateBankList() {
  try {
    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;

    if (!PAYSTACK_SECRET) {
      throw new Error('PAYSTACK_SECRET not set in environment variables');
    }

    console.log('[BANK-UPDATER] Fetching banks from Paystack...');

    const res = await axios.get(PAYSTACK_URL, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`
      }
    });

    const banks = res.data?.data || [];

    if (!banks.length) {
      throw new Error('No banks returned from Paystack');
    }

    console.log(`[BANK-UPDATER] ${banks.length} banks fetched`);

    /**
     * NORMALIZATION RULES
     * - supports_transfer === true
     * - active === true
     * - Nigerian banks
     * - NIBSS 3-digit code ONLY
     */
    const normalizedBanks = banks
      .filter(bank =>
        bank.supports_transfer === true &&
        bank.active === true &&
        bank.country === 'Nigeria' &&
        typeof bank.code === 'string' &&
        bank.code.length === 3
      )
      .map(bank => ({
        name: bank.name.toUpperCase().trim(),
        nibss_code: bank.code,
        paystack_code: bank.code,
        slug: bank.slug
      }))
      // Remove duplicates just in case
      .reduce((acc, bank) => {
        if (!acc.find(b => b.nibss_code === bank.nibss_code)) {
          acc.push(bank);
        }
        return acc;
      }, [])
      // Sort alphabetically
      .sort((a, b) => a.name.localeCompare(b.name));

    const filePath = path.join(__dirname, '../data/transfer_banks.json');
    fs.writeFileSync(filePath, JSON.stringify(normalizedBanks, null, 2));

    console.log(
      `[BANK-UPDATER] ✅ ${normalizedBanks.length} transfer-safe banks saved`
    );
    console.log(`[BANK-UPDATER] File: ${filePath}`);
  } catch (err) {
    console.error('[BANK-UPDATER] ❌ Error:', err.message);
  }
}

// Run directly
if (require.main === module) {
  updateBankList();
}

module.exports = { updateBankList };

















// src/services/bank-updater.js
// require('dotenv').config(); // <-- load .env at the top
// const fs = require('fs');
// const path = require('path');
// const axios = require('axios');

// async function updateBankList() {
//   try {
//     const MERCHANT_SECRET = process.env.MERCHANT_SECRET;
//     const BASE_URL = process.env.BASE_URL;

//     if (!MERCHANT_SECRET || !BASE_URL) {
//       throw new Error('BASE_URL or MERCHANT_SECRET not set in environment variables');
//     }

//     // Call your bank endpoint
//     const response = await axios.get(`${BASE_URL}/transfer/banks`, {
//       headers: {
//         Authorization: `Bearer ${MERCHANT_SECRET}`
//       }
//     });

//     const banksFromEndpoint = response.data.banks || []; // ✅ updated here

//     if (banksFromEndpoint.length === 0) {
//       console.warn('No banks returned from the endpoint.');
//     } else {
//       console.log(`Fetched ${banksFromEndpoint.length} banks from endpoint.`);
//     }

//     // Prepare the final list
//     const bankList = banksFromEndpoint.map(bank => ({
//       name: bank.name,
//       code: bank.code || '',
//     }));

//     const filePath = path.join(__dirname, '../data/banklist.json');
//     fs.writeFileSync(filePath, JSON.stringify(bankList, null, 2));

//     console.log(`Bank list updated: ${bankList.length} banks saved.`);
//   } catch (err) {
//     console.error('Error updating bank list:', err.message);
//   }
// }

// // Run directly if this script is called
// if (require.main === module) {
//   updateBankList();
// }

// module.exports = { updateBankList };
