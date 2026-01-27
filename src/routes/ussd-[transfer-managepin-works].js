const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db'); // mysql2 pool

// ================= SERVICES =================

// Session management
const {
  startSession,
  updateSession,
  getSession,
  endSession
} = require('../services/transfer.service');

// Bank services
const {
  listBanks,
  bankTransfer,
  walletFeeTransfer,
  checkUserByPhone,
  nameEnquiry,
  getAccountBalanceByPhone
} = require('../services/bank.service');

// PIN services
const { verifyPin, setPin, changePin } = require('../services/pin.service');

const FEE = 10; // Flat fee (NGN)

// ================== USSD ENDPOINT ==================
router.post('/', async (req, res) => {
  const { phoneNumber, text } = req.body;

  try {
    let session = startSession(phoneNumber);
    const inputs = text ? text.trim().split('*') : [];
    const lastInput = inputs.length ? inputs[inputs.length - 1] : '';

    session = getSession(phoneNumber);

    switch (session.step) {

      // ================= START =================
      case 'start': {
        const customer = await checkUserByPhone(phoneNumber);
        if (!customer) {
          endSession(phoneNumber);
          return res.send(
            'END You are not registered on TagPay.\nDownload the TagPay app to continue.'
          );
        }

        session.data.customerId = customer.id;
        session.data.balance = await getAccountBalanceByPhone(phoneNumber);
        session.step = 'main-menu';

        return res.send(
`CON Welcome to TagPay
1. Transfer to TagPay
2. Transfer to Bank
3. Check Balance
4. Airtime/Data
5. Manage PIN`
        );
      }

      // ================= MAIN MENU =================
      case 'main-menu': {
        switch (lastInput) {
          case '1':
            endSession(phoneNumber);
            return res.send('END Transfer to TagPay coming soon');

          case '2':
            session.step = 'bank-menu';
            return res.send(
`CON Select Bank
1. Search Bank
2. Access Bank
3. GTBank
4. Zenith Bank`
            );

          case '3':
            endSession(phoneNumber);
            return res.send(`END Your balance is NGN ${session.data.balance}`);

          case '4':
            endSession(phoneNumber);
            return res.send('END Airtime/Data coming soon');

          case '5':
            session.step = 'manage-pin-menu';
            return res.send(
`CON Manage PIN
1. Set PIN
2. Change PIN`
            );

          default:
            endSession(phoneNumber);
            return res.send('END Invalid selection');
        }
      }

      // ================= BANK MENU =================
      case 'bank-menu': {
        const quickBanks = {
          '2': { name: 'Access Bank', code: '044' },
          '3': { name: 'GTBank', code: '058' },
          '4': { name: 'Zenith Bank', code: '057' }
        };

        if (lastInput === '1') {
          session.step = 'bank-search';
          return res.send('CON Enter bank name');
        }

        const bank = quickBanks[lastInput];
        if (!bank) {
          endSession(phoneNumber);
          return res.send('END Invalid bank selection');
        }

        updateSession(phoneNumber, 'bank', bank);
        session.step = 'bank-account';
        return res.send('CON Enter recipient account number');
      }

      // ================= BANK SEARCH =================
      case 'bank-search': {
        updateSession(phoneNumber, 'bankSearch', lastInput);
        updateSession(phoneNumber, 'bankPage', 0);

        const { banks, hasNext, hasPrev } = listBanks(lastInput, 0);
        if (!banks.length) {
          endSession(phoneNumber);
          return res.send('END No banks found');
        }

        updateSession(phoneNumber, 'bankResults', banks);
        session.step = 'bank-search-select';

        let menu = 'CON Select Bank\n';
        banks.forEach((b, i) => menu += `${i + 1}. ${b.name}\n`);
        if (hasPrev) menu += '98. Previous\n';
        if (hasNext) menu += '99. Next';

        return res.send(menu.trim());
      }

      // ================= BANK SEARCH SELECT =================
      case 'bank-search-select': {
        let page = session.data.bankPage || 0;
        const search = session.data.bankSearch;

        if (lastInput === '98') page--;
        else if (lastInput === '99') page++;
        else {
          const bank = session.data.bankResults[parseInt(lastInput) - 1];
          if (!bank) {
            endSession(phoneNumber);
            return res.send('END Invalid bank selection');
          }
          updateSession(phoneNumber, 'bank', bank);
          session.step = 'bank-account';
          return res.send('CON Enter recipient account number');
        }

        updateSession(phoneNumber, 'bankPage', page);
        const { banks, hasNext, hasPrev } = listBanks(search, page);
        updateSession(phoneNumber, 'bankResults', banks);

        let menu = 'CON Select Bank\n';
        banks.forEach((b, i) => menu += `${i + 1}. ${b.name}\n`);
        if (hasPrev) menu += '98. Previous\n';
        if (hasNext) menu += '99. Next';

        return res.send(menu.trim());
      }

      // ================= ACCOUNT NUMBER =================
      case 'bank-account': {
        if (!/^\d{10}$/.test(lastInput)) {
          return res.send('CON Enter a valid 10-digit account number');
        }

        updateSession(phoneNumber, 'accountNumber', lastInput);
        session.step = 'bank-amount';
        return res.send('CON Enter amount');
      }

      // ================= AMOUNT =================
      case 'bank-amount': {
        const amount = Number(lastInput);
        if (!amount || amount <= 0) {
          return res.send('CON Enter a valid amount');
        }

        if (session.data.balance < amount + FEE) {
          endSession(phoneNumber);
          return res.send(`END Insufficient balance. Fee: NGN ${FEE}`);
        }

        updateSession(phoneNumber, 'amount', amount);

        const account = await nameEnquiry(
          session.data.bank.code,
          session.data.accountNumber
        );

        if (!account?.accountName) {
          endSession(phoneNumber);
          return res.send('END Unable to resolve account');
        }

        updateSession(phoneNumber, 'accountName', account.accountName);
        session.step = 'bank-pin';

        return res.send(
`CON Send NGN ${amount} to ${account.accountName}
Fee: NGN ${FEE}
Enter PIN`
        );
      }

      // ================= PIN + TRANSFER =================
      case 'bank-pin': {
        const pinCheck = await verifyPin(phoneNumber, lastInput);
        if (!pinCheck.ok) {
          endSession(phoneNumber);
          return res.send('END Invalid or locked PIN');
        }

        const reference = uuidv4();

        const customerResult = await bankTransfer({
          accountNumber: session.data.accountNumber,
          bank: session.data.bank,
          amount: session.data.amount,
          narration: `USSD Transfer to ${session.data.accountName}`,
          accountName: session.data.accountName,
          customerId: session.data.customerId,
          metadata: { source: 'USSD' },
          reference
        });

        let merchantFeeSent = false;
        if (customerResult?.status === true) {
          const feeResult = await walletFeeTransfer({
            amount: FEE,
            fromCustomerId: session.data.customerId
          });
          merchantFeeSent = feeResult?.status === true;
        }

        endSession(phoneNumber);

        // Async DB log
        (async () => {
          try {
            await pool.query('INSERT INTO bank_transfer_logs SET ?', {
              id: uuidv4(),
              transaction_type: 'BANK_TRANSFER',
              customer_id: session.data.customerId,
              phone_number: phoneNumber,
              amount: session.data.amount,
              fee: FEE,
              vat: 0,
              total: session.data.amount + FEE,
              bank_code: session.data.bank.code,
              account_number: session.data.accountNumber,
              account_name: session.data.accountName,
              reference,
              transaction_reference: customerResult?.transfer?.reference || null,
              session_id: uuidv4(),
              status: customerResult?.status ? 'submitted' : 'failed',
              message: customerResult?.status
                ? 'Transaction submitted and is being processed'
                : customerResult?.message,
              raw_response: JSON.stringify(customerResult),
              merchant_fee: merchantFeeSent,
              webhook_sent: false,
              created_at: new Date()
            });
          } catch (_) {}
        })();

        if (!customerResult?.status) {
          return res.send(`END Transfer failed: ${customerResult?.message}`);
        }

        return res.send('END Transaction submitted and is being processed');
      }

      // ================= MANAGE PIN =================
      case 'manage-pin-menu': {
        if (lastInput === '1') {
          session.step = 'set-pin';
          return res.send('CON Enter new 4-digit PIN');
        }
        if (lastInput === '2') {
          session.step = 'change-pin-old';
          return res.send('CON Enter old PIN');
        }
        endSession(phoneNumber);
        return res.send('END Invalid selection');
      }

      case 'set-pin': {
        if (!/^\d{4}$/.test(lastInput)) {
          return res.send('CON PIN must be 4 digits');
        }
        updateSession(phoneNumber, 'newPin', lastInput);
        session.step = 'set-pin-confirm';
        return res.send('CON Confirm PIN');
      }

      case 'set-pin-confirm': {
        if (lastInput !== session.data.newPin) {
          session.step = 'set-pin';
          return res.send('CON PIN mismatch. Enter again');
        }
        await setPin(phoneNumber, lastInput);
        endSession(phoneNumber);
        return res.send('END PIN set successfully');
      }

      case 'change-pin-old': {
        const pin = await verifyPin(phoneNumber, lastInput);
        if (!pin.ok) {
          endSession(phoneNumber);
          return res.send('END Incorrect PIN');
        }
        session.step = 'change-pin-new';
        return res.send('CON Enter new PIN');
      }

      case 'change-pin-new': {
        if (!/^\d{4}$/.test(lastInput)) {
          return res.send('CON PIN must be 4 digits');
        }
        await changePin(phoneNumber, lastInput);
        endSession(phoneNumber);
        return res.send('END PIN changed successfully');
      }

      // ================= FALLBACK =================
      default:
        endSession(phoneNumber);
        return res.send('END Session expired');
    }
  } catch (err) {
    endSession(phoneNumber);
    return res.send('END An error occurred. Try again.');
  }
});

module.exports = router;
















// const express = require('express');
// const router = express.Router();
// const { v4: uuidv4 } = require('uuid');
// const pool = require('../db'); // your mysql2 pool

// // Services for session management
// const {
//   startSession,
//   updateSession,
//   getSession,
//   endSession
// } = require('../services/transfer.service');

// // USSD bank menu functions
// const { listBanks, 
//         bankTransfer, 
//         checkUserByPhone , 
//         nameEnquiry,
//         walletFeeTransfer,
//         getAccountBalanceByPhone } = require('../services/bank.service');

// // PIN management
// const { verifyPin, setPin, changePin } = require('../services/pin.service');

// const FEE = 10; // Flat fee

// // ================== USSD ENDPOINT ==================
// router.post('/', async (req, res) => {
//   try {
//     const { phoneNumber, text } = req.body;

//     // Start or resume session
//     let session = startSession(phoneNumber);

//     const inputs = text ? text.trim().split('*') : [];
//     const lastInput = inputs.length ? inputs[inputs.length - 1] : '';

//     session = getSession(phoneNumber);

//     switch (session.step) {

//       // ================= START =================
//       case 'start': {
//         const customer = await checkUserByPhone(phoneNumber);
//         if (!customer) {
//           endSession(phoneNumber);
//           return res.send(
//             'END You are not registered on TagPay.\nDownload the TagPay app to continue.'
//           );
//         }

//         session.data.customerId = customer.id;
//         session.data.balance = await getAccountBalanceByPhone(phoneNumber);
//         session.step = 'main-menu';

//         return res.send(
//           `CON Welcome to TagPay
// 1. Transfer to TagPay
// 2. Transfer to Bank
// 3. Check Balance
// 4. Airtime/Data
// 5. Manage PIN`
//         );
//       }

//       // ================= MAIN MENU =================
//       case 'main-menu': {
//         switch (lastInput) {

//           case '1':
//             endSession(phoneNumber);
//             return res.send('END Transfer to TagPay coming soon');

//           case '2':
//             session.step = 'bank-menu';
//             return res.send(
//               `CON Select Bank
// 1. Search Bank
// 2. Access Bank
// 3. GTBank
// 4. Zenith Bank`
//             );

//           case '3':
//             endSession(phoneNumber);
//             return res.send(`END Your balance is NGN ${session.data.balance}`);

//           case '4':
//             endSession(phoneNumber);
//             return res.send('END Airtime/Data coming soon');

//           case '5':
//             session.step = 'manage-pin-menu';
//             return res.send(
//               `CON Manage PIN
// 1. Set PIN
// 2. Change PIN`
//             );

//           default:
//             endSession(phoneNumber);
//             return res.send('END Invalid selection');
//         }
//       }

//       // ================= BANK MENU =================
//       case 'bank-menu': {
//         const quickBanks = {
//           '2': { name: 'Access Bank', code: '044' },
//           '3': { name: 'GTBank', code: '058' },
//           '4': { name: 'Zenith Bank', code: '057' }
//         };

//         if (lastInput === '1') {
//           session.step = 'bank-search';
//           return res.send('CON Enter bank name');
//         }

//         const bank = quickBanks[lastInput];
//         if (!bank) {
//           endSession(phoneNumber);
//           return res.send('END Invalid bank selection');
//         }

//         updateSession(phoneNumber, 'bank', bank);
//         session.step = 'bank-account';
//         return res.send('CON Enter recipient account number');
//       }

//       // ================= BANK SEARCH =================
//       case 'bank-search': {
//         updateSession(phoneNumber, 'bankSearch', lastInput);
//         updateSession(phoneNumber, 'bankPage', 0);

//         const { banks: bankResults, hasNext, hasPrev } = listBanks(lastInput, 0);

//         if (!bankResults.length) {
//           endSession(phoneNumber);
//           return res.send('END No banks found');
//         }

//         updateSession(phoneNumber, 'bankResults', bankResults);
//         session.step = 'bank-search-select';

//         let menu = 'CON Select Bank\n';
//         bankResults.forEach((b, i) => {
//           menu += `${i + 1}. ${b.name}\n`;
//         });
//         if (hasPrev) menu += '98. Previous\n';
//         if (hasNext) menu += '99. Next';

//         return res.send(menu.trim());
//       }

//       // ================= BANK SEARCH SELECT =================
//       case 'bank-search-select': {
//         const results = session.data.bankResults || [];
//         let page = session.data.bankPage || 0;

//         if (lastInput === '98') {
//           page = page - 1;
//           updateSession(phoneNumber, 'bankPage', page);
//         } else if (lastInput === '99') {
//           page = page + 1;
//           updateSession(phoneNumber, 'bankPage', page);
//         } else {
//           const bank = results[parseInt(lastInput) - 1];
//           if (!bank) {
//             endSession(phoneNumber);
//             return res.send('END Invalid bank selection');
//           }
//           updateSession(phoneNumber, 'bank', bank);
//           session.step = 'bank-account';
//           return res.send('CON Enter recipient account number');
//         }

//         const search = session.data.bankSearch;
//         const { banks: bankResults, hasNext, hasPrev } = listBanks(search, page);
//         updateSession(phoneNumber, 'bankResults', bankResults);

//         let menu = 'CON Select Bank\n';
//         bankResults.forEach((b, i) => {
//           menu += `${i + 1}. ${b.name}\n`;
//         });
//         if (hasPrev) menu += '98. Previous\n';
//         if (hasNext) menu += '99. Next';

//         return res.send(menu.trim());
//       }

//       // ================= ACCOUNT NUMBER =================
//       case 'bank-account': {
//         if (!/^\d{10}$/.test(lastInput)) {
//           return res.send('CON Enter a valid 10-digit account number');
//         }

//         updateSession(phoneNumber, 'accountNumber', lastInput);
//         session.step = 'bank-amount';
//         return res.send('CON Enter amount');
//       }

//       // ================= AMOUNT =================
//       case 'bank-amount': {
//         const amount = parseFloat(lastInput);
//         if (isNaN(amount) || amount <= 0) {
//           return res.send('CON Enter a valid amount');
//         }

//         if (session.data.balance < amount + FEE) {
//           endSession(phoneNumber);
//           return res.send(`END Insufficient balance. Fee: NGN ${FEE}`);
//         }

//         updateSession(phoneNumber, 'amount', amount);

//         const { bank, accountNumber } = session.data;
//         const account = await nameEnquiry(bank.code, accountNumber);

//         if (!account || !account.accountName) {
//           endSession(phoneNumber);
//           return res.send('END Unable to resolve account');
//         }

//         updateSession(phoneNumber, 'accountName', account.accountName);
//         session.step = 'bank-pin';

//         return res.send(
//           `CON Send NGN ${amount} to ${account.accountName}\nFee: NGN ${FEE}\nEnter PIN`
//         );
//       }

//       // ================= PIN + TRANSFER =================
//       case 'bank-pin': {
//         const pinResult = await verifyPin(phoneNumber, lastInput);

//         if (!pinResult.ok) {
//           endSession(phoneNumber);
//           return res.send('END Invalid or locked PIN');
//         }

//         const customerPayload = {
//           accountNumber: session.data.accountNumber,
//           bank: session.data.bank,
//           amount: session.data.amount,
//           narration: `USSD Transfer to ${session.data.accountName}`,
//           accountName: session.data.accountName,
//           customerId: session.data.customerId,
//           metadata: { source: 'USSD' },
//           reference: uuidv4()
//         };

//         // 1️⃣ Customer Bank Transfer
//         const customerResult = await bankTransfer(customerPayload);

//         // 2️⃣ Merchant Fee Transfer (wallet-to-wallet)
//         let merchantFeeSent = false;
//         try {
//           const merchantPayload = {
//             amount: FEE,
//             fromCustomerId: session.data.customerId,
//             toCustomerId: process.env.toCustomerId,
//             metadata: { source: 'USSD Fee' },
//             reference: uuidv4()
//           };

//           await bankTransfer(merchantPayload); // wallet-to-wallet using same bankTransfer function
//           merchantFeeSent = true;
//         } catch (err) {
//           console.error('Merchant fee transfer failed:', err.message);
//           merchantFeeSent = false;
//         }

//         endSession(phoneNumber);

//         // 3️⃣ Log transaction asynchronously
//         (async () => {
//           try {
//             const log = {
//               id: uuidv4(),
//               customer_id: session.data.customerId,
//               phone_number: phoneNumber,
//               amount: session.data.amount,
//               fee: FEE,
//               vat: 0,
//               total: session.data.amount + FEE,
//               bank_code: session.data.bank.code,
//               account_number: session.data.accountNumber,
//               account_name: session.data.accountName,
//               reference: customerPayload.reference,
//               transaction_reference: customerResult?.transfer?.reference || null,
//               session_id: uuidv4(),
//               status: customerResult?.status ? 'submitted' : 'failed',
//               message: customerResult?.status
//                 ? 'Transaction submitted and is being processed'
//                 : customerResult?.message || 'Transfer failed',
//               raw_response: JSON.stringify(customerResult || {}),
//               created_at: new Date(),
//               merchant_fee: merchantFeeSent,
//               webhook_sent: false
//             };
//             await pool.query('INSERT INTO bank_transfer_logs SET ?', log);
//           } catch (err) {
//             console.error('Failed to log transaction:', err.message);
//           }
//         })();

//         // 4️⃣ Response to user
//         if (!customerResult || customerResult.status !== true) {
//           return res.send(`END Transfer failed: ${customerResult?.message || 'Error'}`);
//         }

//         return res.send(
//           `END Transaction submitted and is being processed`
//         );
//       }

//       // ================= MANAGE PIN =================
//       case 'manage-pin-menu': {
//         if (lastInput === '1') {
//           session.step = 'set-pin';
//           return res.send('CON Enter new 4-digit PIN');
//         }

//         if (lastInput === '2') {
//           session.step = 'change-pin-old';
//           return res.send('CON Enter old PIN');
//         }

//         endSession(phoneNumber);
//         return res.send('END Invalid selection');
//       }

//       case 'set-pin': {
//         if (!/^\d{4}$/.test(lastInput)) {
//           return res.send('CON PIN must be 4 digits');
//         }
//         updateSession(phoneNumber, 'newPin', lastInput);
//         session.step = 'set-pin-confirm';
//         return res.send('CON Confirm PIN');
//       }

//       case 'set-pin-confirm': {
//         if (lastInput !== session.data.newPin) {
//           session.step = 'set-pin';
//           return res.send('CON PIN mismatch. Enter again');
//         }

//         await setPin(phoneNumber, lastInput);
//         endSession(phoneNumber);
//         return res.send('END PIN set successfully');
//       }

//       case 'change-pin-old': {
//         const pin = await verifyPin(phoneNumber, lastInput);
//         if (!pin.ok) {
//           endSession(phoneNumber);
//           return res.send('END Incorrect PIN');
//         }
//         session.step = 'change-pin-new';
//         return res.send('CON Enter new PIN');
//       }

//       case 'change-pin-new': {
//         if (!/^\d{4}$/.test(lastInput)) {
//           return res.send('CON PIN must be 4 digits');
//         }

//         await changePin(phoneNumber, lastInput);
//         endSession(phoneNumber);
//         return res.send('END PIN changed successfully');
//       }

//       // ================= FALLBACK =================
//       default:
//         endSession(phoneNumber);
//         return res.send('END Session expired');
//     }
//   } catch (err) {
//     console.error('USSD ERROR:', err);
//     endSession(req.body.phoneNumber);
//     return res.send('END An error occurred. Try again.');
//   }
// });

// module.exports = router;
