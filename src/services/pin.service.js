const bcrypt = require('bcrypt');
const db = require('../db'); // Your MySQL pool
const SALT_ROUNDS = 10;

// =================== PHONE NORMALIZER ===================
// Converts input to E.164 format (Nigerian numbers)
function normalizePhone(phoneNumber) {
  let phone = phoneNumber.trim();

  // Remove any non-digit characters except '+'
  phone = phone.replace(/[^\d+]/g, '');

  if (phone.startsWith('0')) {
    // Local 0XXXXXXXXXX → +234XXXXXXXXXX
    phone = '+234' + phone.slice(1);
  } else if (phone.startsWith('234')) {
    // 234XXXXXXXXXX → +234XXXXXXXXXX
    phone = '+' + phone;
  } else if (!phone.startsWith('+234')) {
    // Anything else → invalid format, but keep as-is
    phone = '+' + phone;
  }

  return phone;
}

// ================= GET USER PIN =================
async function getUserPin(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);

  const [rows] = await db.query(
    'SELECT pin_hash, attempts, locked_until FROM user_pins WHERE phone_number = ?',
    [normalized]
  );
  return rows[0] || null;
}

// ================= VERIFY PIN =================
async function verifyPin(phoneNumber, pin) {
  const normalized = normalizePhone(phoneNumber);
  const record = await getUserPin(normalized);

  if (!record || !record.pin_hash) {
    return { notSet: true };
  }

  if (record.locked_until && new Date(record.locked_until) > new Date()) {
    return { locked: true };
  }

  const ok = await bcrypt.compare(pin, record.pin_hash);

  if (!ok) {
    await db.query(
      'UPDATE user_pins SET attempts = attempts + 1 WHERE phone_number = ?',
      [normalized]
    );
  }

  return { ok };
}

// ================= SET INITIAL PIN =================
async function setPin(phoneNumber, pin) {
  const normalized = normalizePhone(phoneNumber);
  const hash = await bcrypt.hash(pin, SALT_ROUNDS);

  const [rows] = await db.query(
    'SELECT id FROM user_pins WHERE phone_number = ?',
    [normalized]
  );

  if (rows.length > 0) {
    // Update existing record
    await db.query(
      'UPDATE user_pins SET pin_hash = ?, attempts = 0, locked_until = NULL WHERE phone_number = ?',
      [hash, normalized]
    );
  } else {
    // Insert new record
    await db.query(
      'INSERT INTO user_pins (phone_number, pin_hash, attempts, created_at) VALUES (?, ?, 0, NOW())',
      [normalized, hash]
    );
  }
}

// ================= CHANGE PIN =================
async function changePin(phoneNumber, pin) {
  const normalized = normalizePhone(phoneNumber);
  const hash = await bcrypt.hash(pin, SALT_ROUNDS);

  await db.query(
    'UPDATE user_pins SET pin_hash = ?, attempts = 0, locked_until = NULL WHERE phone_number = ?',
    [hash, normalized]
  );
}

module.exports = {
  verifyPin,
  setPin,
  changePin,
  normalizePhone, // export in case needed elsewhere
};





// const bcrypt = require('bcrypt');
// const db = require('../db'); // Your MySQL pool from db.js

// const SALT_ROUNDS = 10;

// // ================= GET USER PIN =================
// async function getUserPin(phoneNumber) {
//   const [rows] = await db.query(
//     'SELECT pin_hash, attempts, locked_until FROM user_pins WHERE phone_number = ?',
//     [phoneNumber]
//   );
//   return rows[0] || null;
// }

// // ================= VERIFY PIN =================
// async function verifyPin(phoneNumber, pin) {
//   const record = await getUserPin(phoneNumber);

//   if (!record || !record.pin_hash) {
//     return { notSet: true };
//   }

//   if (record.locked_until && new Date(record.locked_until) > new Date()) {
//     return { locked: true };
//   }

//   const ok = await bcrypt.compare(pin, record.pin_hash);

//   if (!ok) {
//     await db.query(
//       'UPDATE user_pins SET attempts = attempts + 1 WHERE phone_number = ?',
//       [phoneNumber]
//     );
//   }

//   return { ok };
// }

// // ================= SET INITIAL PIN =================
// async function setPin(phoneNumber, pin) {
//   const hash = await bcrypt.hash(pin, SALT_ROUNDS);

//   // Check if record exists
//   const [rows] = await db.query(
//     'SELECT id FROM user_pins WHERE phone_number = ?',
//     [phoneNumber]
//   );

//   if (rows.length > 0) {
//     // Update existing record
//     await db.query(
//       'UPDATE user_pins SET pin_hash = ?, attempts = 0, locked_until = NULL WHERE phone_number = ?',
//       [hash, phoneNumber]
//     );
//   } else {
//     // Insert new record
//     await db.query(
//       'INSERT INTO user_pins (phone_number, pin_hash, attempts, created_at) VALUES (?, ?, 0, NOW())',
//       [phoneNumber, hash]
//     );
//   }
// }

// // ================= CHANGE PIN =================
// async function changePin(phoneNumber, pin) {
//   const hash = await bcrypt.hash(pin, SALT_ROUNDS);

//   await db.query(
//     'UPDATE user_pins SET pin_hash = ?, attempts = 0, locked_until = NULL WHERE phone_number = ?',
//     [hash, phoneNumber]
//   );
// }

// module.exports = {
//   verifyPin,
//   setPin,
//   changePin
// };
