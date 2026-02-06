const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

// Session services
const {
  startSession,
  updateSession,
  getSession,
  endSession,
  addDailyTransfer,
  getDailyTotalFromDB
} = require('../services/transfer.service');

// Bank services
const {
  listBanks,
  bankTransfer,
  walletToWalletTransfer,
  checkUserByPhone,
  getUserByAccount,
  transferCharge,
  nameEnquiry,
  getAccountBalanceByPhone
} = require('../services/bank.service');

// PIN services
const { verifyPin, setPin, changePin, normalizePhone } = require('../services/pin.service');

const FEE = parseFloat(process.env.MERCHANT_FEE_AMOUNT || '0');
const VAT_PERCENT = parseFloat(process.env.VAT_PERCENT || '7.5');

// -------------------- DB UPSERT HELPER --------------------
async function upsertTransferLog(data) {
  const sql = `
    INSERT INTO bank_transfer_logs
    (session_id, transaction_type, customer_id, phone_number,
     amount, fee, vat, total, bank_code, account_number, account_name,
     reference, transaction_reference, status, message, raw_response,
     merchant_fee, merchant_fee_status, cbn_fee, cbn_fee_status, webhook_sent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      message = VALUES(message),
      raw_response = VALUES(raw_response),
      transaction_reference = VALUES(transaction_reference),
      merchant_fee_status = VALUES(merchant_fee_status),
      cbn_fee_status = VALUES(cbn_fee_status)
  `;

  await pool.query(sql, [
    data.session_id,
    data.transaction_type,
    data.customer_id,
    data.phone_number,
    data.amount,
    data.fee,
    data.vat,
    data.total,
    data.bank_code,
    data.account_number,
    data.account_name,
    data.reference,
    data.transaction_reference,
    data.status,
    data.message,
    data.raw_response,
    data.merchant_fee,
    data.merchant_fee_status,
    data.cbn_fee,
    data.cbn_fee_status,
    data.webhook_sent
  ]);
}

// -------------------- USSD ROUTE --------------------
router.post('/', async (req, res) => {
  const { phoneNumber, text, sessionId } = req.body;

  try {
    let session = startSession(phoneNumber, sessionId);
    session = getSession(phoneNumber);

    const inputs = text ? text.split('*') : [];
    const lastInput = inputs[inputs.length - 1];

    // Ensure ONE reference per session
    if (!session.data.reference) {
      session.data.reference = uuidv4();
    }

    switch (session.step) {

      // ---------------- START ----------------
      case 'start': {
        const customer = await checkUserByPhone(phoneNumber);
        if (!customer) {
          endSession(phoneNumber);
          return res.send('END You are not registered on TagPay');
        }

        session.data.customerId = customer.id;
        session.data.balance = await getAccountBalanceByPhone(phoneNumber);
        session.step = 'main-menu';

        return res.send(
`CON Welcome to TagPay
1. Transfer to TagPay
2. Transfer to Bank
3. Check Balance
4. Manage PIN
5. Airtime/Data`
        );
      }

     // ---------------- MAIN MENU ----------------
case 'main-menu': {
  // ---------------- Fee Confirmation ----------------
  if (session.stepConfirmed) {
    if (lastInput === '1') {
      const CHECK_BALANCE_FEE = 10; // NGN 10 fixed charge
      try {
        if (session.data.balance < CHECK_BALANCE_FEE) {
          endSession(phoneNumber);
          return res.send('END Insufficient funds to check balance');
        }

        const feeResult = await walletToWalletTransfer({
          amount: CHECK_BALANCE_FEE,
          fromCustomerId: session.data.customerId,
          toCustomerId: process.env.toCustomerId
        });

        if (!feeResult || !feeResult.status) {
          endSession(phoneNumber);
          return res.send('END Could not process balance check fee. Try again later.');
        }

        session.data.balance -= CHECK_BALANCE_FEE;

        await upsertTransferLog({
          session_id: session.sessionId,
          transaction_type: 'BALANCE_CHECK',
          customer_id: session.data.customerId,
          phone_number: phoneNumber,
          amount: 0,
          fee: CHECK_BALANCE_FEE,
          vat: 0,
          total: CHECK_BALANCE_FEE,
          bank_code: null,
          account_number: null,
          account_name: null,
          reference: session.data.reference,
          transaction_reference: feeResult.reference || null,
          status: 'submitted',
          message: 'Balance check fee deducted',
          raw_response: JSON.stringify(feeResult),
          merchant_fee: CHECK_BALANCE_FEE,
          merchant_fee_status: 'success',
          cbn_fee: 0,
          cbn_fee_status: 'n/a',
          webhook_sent: false
        });

        endSession(phoneNumber);
        return res.send(`END Hello! Your balance is NGN ${session.data.balance}`);
      } catch (err) {
        console.error(err);
        endSession(phoneNumber);
        return res.send('END System error. Please try again later.');
      }
    }

    if (lastInput === '2') {
      // fully clear the session
      session.step = null;
      session.stepConfirmed = false;
      session.data = {};
      session.ended = true;  // optional, if you track ended sessions
      endSession(phoneNumber); // clear DB / memory
      return res.send('END Balance check cancelled.');
    }

    // Invalid choice at confirmation
    return res.send('CON Invalid choice. Press 1 to proceed or 2 to cancel.');
  }

  // ---------------- Main Menu Options ----------------
  if (lastInput === '1') {
    session.step = 'tagpay-account';
    return res.send('CON Enter recipient TagPay account number');
  }

  if (lastInput === '2') {
    session.step = 'bank-menu';
    return res.send('CON Select Bank\n1. Search Bank\n2. Access Bank\n3. GTBank\n4. Zenith Bank');
  }

  if (lastInput === '3') {
    // Ask for confirmation before deducting fee
    session.stepConfirmed = true;
    return res.send(
      `CON You are about to check your balance. A fee of NGN 10 will be deducted.\n` +
      `Press 1 to proceed\n` +
      `Press 2 to cancel`
    );
  }

   if (lastInput === '4') {
            session.step = 'manage-pin-menu';
            return res.send(
              `CON Manage PIN
          1. Set PIN
          2. Change PIN`
                      );
            }

  // Invalid option
  endSession(phoneNumber);
  return res.send('END Invalid option');
}



      // ---------------- TAGPAY ACCOUNT ----------------
      case 'tagpay-account': {
        const recipient = await getUserByAccount(lastInput);
        if (!recipient || recipient.customerId === session.data.customerId) {
          endSession(phoneNumber);
          return res.send('END Invalid recipient');
        }

        updateSession(phoneNumber, 'recipient', recipient);
        session.step = 'tagpay-amount';
        return res.send('CON Enter amount');
      }

      case 'tagpay-amount': {
        const amount = Number(lastInput);
        if (amount <= 0 || session.data.balance < amount) {
          endSession(phoneNumber);
          return res.send('END Invalid or insufficient balance');
        }

        session.data.amount = amount;
        session.step = 'tagpay-pin';
        return res.send(`CON Send NGN ${amount} to ${session.data.recipient.accountName}\nEnter PIN`);
      }

      case 'tagpay-pin': {
        const pinCheck = await verifyPin(normalizePhone(phoneNumber), lastInput);
        if (!pinCheck.ok) {
          endSession(phoneNumber);
          return res.send('END Invalid PIN');
        }

        const result = await walletToWalletTransfer({
          amount: session.data.amount,
          fromCustomerId: session.data.customerId,
          toCustomerId: session.data.recipient.customerId
        });

        await upsertTransferLog({
          session_id: session.sessionId,
          transaction_type: 'TAGPAY_TRANSFER',
          customer_id: session.data.customerId,
          phone_number: phoneNumber,
          amount: session.data.amount,
          fee: 0,
          vat: 0,
          total: session.data.amount,
          bank_code: null,
          account_number: session.data.recipient.accountNumber,
          account_name: session.data.recipient.accountName,
          reference: session.data.reference,
          transaction_reference: result?.reference || null,
          status: result?.status ? 'submitted' : 'failed',
          message: result?.message || '',
          raw_response: JSON.stringify(result),
          merchant_fee: 0,
          merchant_fee_status: 'n/a',
          cbn_fee: 0,
          cbn_fee_status: 'n/a',
          webhook_sent: false
        });

        endSession(phoneNumber);
        return res.send(result?.status
          ? 'END Transaction submitted and is being processed'
          : 'END Transfer failed');
      }



 // ---------------- BANK MENU ----------------
      case 'bank-menu': {
        const quickBanks = {
          '2': { name: 'Access Bank', code: '044' },
          '3': { name: 'GTBank', code: '058' },
          '4': { name: 'Zenith Bank', code: '057' }
        };

        if (lastInput === '1') {
          session.step = 'bank-search';
          return res.send('CON Enter bank name to search');
        }

        const bank = quickBanks[lastInput];
        if (!bank) {
          endSession(phoneNumber);
          return res.send('END Invalid bank selection');
        }

        updateSession(phoneNumber, 'bank', bank);
        session.step = 'bank-account';
        return res.send(`CON Enter recipient account number for ${bank.name}`);
      }

      // ---------------- BANK SEARCH ----------------
      case 'bank-search': {
        updateSession(phoneNumber, 'bankSearch', lastInput);
        updateSession(phoneNumber, 'bankPage', 0);

        const page = 0;
        const pageSize = 4;
        const { banks, total } = await listBanks(lastInput, page, pageSize);

        if (!banks.length) {
          endSession(phoneNumber);
          return res.send('END No banks found');
        }

        updateSession(phoneNumber, 'bankResults', banks);
        updateSession(phoneNumber, 'bankPage', page);
        session.step = 'bank-search-select';

        let menu = 'CON Select Bank\n';
        banks.forEach((b, i) => {
          menu += `${i + 1}. ${b.name}\n`;
        });

        if (page > 0) menu += '98. Previous\n';
        if (total > (page + 1) * pageSize) menu += '99. Next';

        return res.send(menu.trim());
      }

      // ---------------- BANK SEARCH SELECT ----------------
      case 'bank-search-select': {
        let page = session.data.bankPage || 0;
        const search = session.data.bankSearch;
        const pageSize = 4;

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
          return res.send(`CON Enter recipient account number for ${bank.name}`);
        }

        const { banks, total } = await listBanks(search, page, pageSize);
        if (!banks.length) {
          endSession(phoneNumber);
          return res.send('END No more banks found');
        }

        updateSession(phoneNumber, 'bankResults', banks);
        updateSession(phoneNumber, 'bankPage', page);

        let menu = 'CON Select Bank\n';
        banks.forEach((b, i) => {
          menu += `${i + 1}. ${b.name}\n`;
        });
        if (page > 0) menu += '98. Previous\n';
        if (total > (page + 1) * pageSize) menu += '99. Next';

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

        const dailyTotal = await getDailyTotalFromDB(session.data.customerId, pool);
        const DAILY_LIMIT = 100000;
        if (dailyTotal + amount > DAILY_LIMIT) {
          endSession(phoneNumber);
          return res.send(
            `END Daily transfer limit reached. You can transfer up to NGN ${DAILY_LIMIT - dailyTotal} today.`
          );
        }

        let fee = 0;
        if (amount < 5000) fee = 10;
        else if (amount < 50000) fee = 25;
        else fee = 50;

        const vat = +(fee * 0.075).toFixed(2);
        const total = amount + fee + vat;

        if (session.data.balance < total) {
          endSession(phoneNumber);
          return res.send(
            `END Insufficient balance. Total: NGN ${total} (Amount: NGN ${amount}, Fee: NGN ${fee}, VAT: NGN ${vat})`
          );
        }

        updateSession(phoneNumber, 'amount', amount);
        updateSession(phoneNumber, 'fee', fee);
        updateSession(phoneNumber, 'vat', vat);

        const account = await nameEnquiry(session.data.bank.code, session.data.accountNumber);
        if (!account?.accountName) {
          endSession(phoneNumber);
          return res.send('END Unable to resolve account');
        }

        updateSession(phoneNumber, 'accountName', account.accountName);
        session.step = 'bank-pin';

        return res.send(
          `CON Send NGN ${amount} to ${account.accountName}\nFee: NGN ${fee}\nVAT: NGN ${vat}\nEnter PIN`
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
          sortCode: session.data.bank.code,
          narration: `USSD Transfer to ${session.data.accountName}`,
          accountName: session.data.accountName,
          customerId: session.data.customerId,
          metadata: { source: 'USSD' },
          reference
        });

        if (customerResult?.status === true) {
         await transferCharge({
          feeAmount: session.data.fee,
          fromCustomerId: session.data.customerId
        });

        }

        endSession(phoneNumber);

        pool.query('INSERT INTO bank_transfer_logs SET ?', {
          id: uuidv4(),
          transaction_type: 'BANK_TRANSFER',
          customer_id: session.data.customerId,
          phone_number: phoneNumber,
          amount: session.data.amount,
          fee: session.data.fee,
          vat: session.data.vat,
          total: session.data.amount + session.data.fee + session.data.vat,
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
          merchant_fee: session.data.fee,
          cbn_fee: 0,
          webhook_sent: 'pending',
          created_at: new Date()
        });

        if (!customerResult?.status) {
          return res.send(`END Transfer failed: ${customerResult?.message}`);
        }

        return res.send('END Transaction submitted and is being processed');
      } // end case 'bank-pin'



      // ================= MANAGE PIN =================
  case 'manage-pin-menu': {
    if (lastInput === '1') {
      updateSession(phoneNumber, 'step', 'set-pin');
      return res.send('CON Enter new 4-digit PIN');
    }

    if (lastInput === '2') {
      updateSession(phoneNumber, 'step', 'change-pin-old');
      return res.send('CON Enter old PIN');
    }

    endSession(phoneNumber);
    return res.send('END Invalid selection');
  }

  // ================= SET PIN =================
  case 'set-pin': {
    if (!/^\d{4}$/.test(lastInput)) {
      return res.send('CON PIN must be exactly 4 digits');
    }

    updateSession(phoneNumber, 'newPin', lastInput);
    updateSession(phoneNumber, 'step', 'set-pin-confirm');
    return res.send('CON Confirm new PIN');
  }

  case 'set-pin-confirm': {
    if (lastInput !== session.data.newPin) {
      updateSession(phoneNumber, 'step', 'set-pin');
      return res.send('CON PIN mismatch. Enter new PIN again');
    }

    await setPin(phoneNumber, lastInput);
    endSession(phoneNumber);
    return res.send('END PIN set successfully');
  }

  // ================= CHANGE PIN =================
  case 'change-pin-old': {
    const pin = await verifyPin(phoneNumber, lastInput);

    if (!pin.ok) {
      endSession(phoneNumber);
      return res.send('END Incorrect PIN');
    }

    updateSession(phoneNumber, 'step', 'change-pin-new');
    return res.send('CON Enter new 4-digit PIN');
  }

  case 'change-pin-new': {
    if (!/^\d{4}$/.test(lastInput)) {
      return res.send('CON PIN must be exactly 4 digits');
    }

    updateSession(phoneNumber, 'newPin', lastInput);
    updateSession(phoneNumber, 'step', 'change-pin-confirm');
    return res.send('CON Confirm new PIN');
  }

  case 'change-pin-confirm': {
    if (lastInput !== session.data.newPin) {
      updateSession(phoneNumber, 'step', 'change-pin-new');
      return res.send('CON PIN mismatch. Enter new PIN again');
    }

    await changePin(phoneNumber, lastInput);
    endSession(phoneNumber);
    return res.send('END PIN changed successfully');
  }

    } // end switch

  } catch (err) {
    console.error(err);
    endSession(phoneNumber);
    return res.send('END System error. Please try again later.');
  }




  


   
 


  
}); // end router.post

module.exports = router;

