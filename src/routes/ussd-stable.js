const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Services for session management
const {
  startSession,
  updateSession,
  getSession,
  endSession
} = require('../services/transfer.service');

// Bank & payment services
const {
  listBanks,
  bankTransfer,
  checkUserByPhone,
  nameEnquiry,
  getAccountBalanceByPhone
} = require('../services/bank.service');

// PIN management
const { verifyPin, setPin, changePin } = require('../services/pin.service');

// ================== USSD ENDPOINT ==================
router.post('/', async (req, res) => {
  try {
    const { phoneNumber, text } = req.body;

    // Start or resume session
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

        const { banks: bankResults, hasNext, hasPrev } = listBanks(lastInput, 0);
        if (!bankResults.length) {
          endSession(phoneNumber);
          return res.send('END No banks found');
        }

        updateSession(phoneNumber, 'bankResults', bankResults);
        session.step = 'bank-search-select';

        let menu = 'CON Select Bank\n';
        bankResults.forEach((b, i) => (menu += `${i + 1}. ${b.name}\n`));
        if (hasPrev) menu += '98. Previous\n';
        if (hasNext) menu += '99. Next';

        return res.send(menu.trim());
      }

      // ================= BANK SEARCH SELECT =================
      case 'bank-search-select': {
        const results = session.data.bankResults || [];
        let page = session.data.bankPage || 0;

        if (lastInput === '98') {
          page = page - 1;
        } else if (lastInput === '99') {
          page = page + 1;
        } else {
          const bank = results[parseInt(lastInput) - 1];
          if (!bank) {
            endSession(phoneNumber);
            return res.send('END Invalid bank selection');
          }
          updateSession(phoneNumber, 'bank', bank);
          session.step = 'bank-account';
          return res.send('CON Enter recipient account number');
        }

        updateSession(phoneNumber, 'bankPage', page);
        const search = session.data.bankSearch;
        const { banks: bankResults, hasNext, hasPrev } = listBanks(search, page);
        updateSession(phoneNumber, 'bankResults', bankResults);

        let menu = 'CON Select Bank\n';
        bankResults.forEach((b, i) => (menu += `${i + 1}. ${b.name}\n`));
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
        const amount = parseFloat(lastInput);
        if (isNaN(amount) || amount <= 0) {
          return res.send('CON Enter a valid amount');
        }

        if (session.data.balance < amount + 50) {
          endSession(phoneNumber);
          return res.send('END Insufficient balance');
        }

        updateSession(phoneNumber, 'amount', amount);

        const { bank, accountNumber } = session.data;
        const account = await nameEnquiry(bank.code, accountNumber);

        if (!account || !account.accountName) {
          endSession(phoneNumber);
          return res.send('END Unable to resolve account');
        }

        updateSession(phoneNumber, 'accountName', account.accountName);
        session.step = 'bank-pin';

        return res.send(
          `CON Send NGN ${amount} to ${account.accountName}\nFee: NGN 50\nEnter PIN`
        );
      }

      // ================= PIN + TRANSFER =================
      case 'bank-pin': {
        const pinResult = await verifyPin(phoneNumber, lastInput);

        if (!pinResult.ok) {
          endSession(phoneNumber);
          return res.send('END Invalid or locked PIN');
        }

        // Prepare payload exactly as expected by bank.service.js
        const payload = {
          accountNumber: session.data.accountNumber,
          bank: session.data.bank,
          amount: session.data.amount,
          narration: `USSD Transfer to ${session.data.accountName}`,
          accountName: session.data.accountName,
          customerId: session.data.customerId,
          metadata: { source: 'USSD' }
        };

        console.log('[DEBUG] PAYLOAD:', JSON.stringify(payload, null, 2));

        const result = await bankTransfer(payload);
        endSession(phoneNumber);

        if (!result) return res.send('END Transfer failed: No response from payment service');
        if (!result.status) return res.send(`END Transfer failed: ${result.message}`);
        if (!result.transfer || !result.transfer.reference)
          return res.send(
            'END Transfer pending or failed.\nPlease check your balance or transaction history.'
          );

        return res.send(`END Transfer Successful\nRef: ${result.transfer.reference}`);
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
    console.error('USSD ERROR:', err);
    endSession(req.body.phoneNumber);
    return res.send('END An error occurred. Try again.');
  }
});

module.exports = router;