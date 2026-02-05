// src/services/transfer.service.js
const sessions = {};
const dailyTransfers = {}; // <-- Added: in-memory daily tracker

/**
 * Start a session for a phone number
 */
function startSession(phoneNumber) {
  if (!sessions[phoneNumber]) {
    sessions[phoneNumber] = { step: 'start', data: {} };
    console.log(`[USSD] New session started for ${phoneNumber}`);
  } else {
    console.log(`[USSD] Session resumed for ${phoneNumber}`);
  }
  return sessions[phoneNumber];
}

/**
 * Update a session value or step
 */
function updateSession(phoneNumber, key, value) {
  const session = sessions[phoneNumber];
  if (!session) return;
  if (key === 'step') session.step = value;
  else session.data[key] = value;
}

/**
 * Get the latest session object
 */
function getSession(phoneNumber) {
  return sessions[phoneNumber] || null;
}

/**
 * End a session
 */
function endSession(phoneNumber) {
  if (sessions[phoneNumber]) delete sessions[phoneNumber];
}

/**
 * Debug current sessions
 */
function debugSessions() {
  return JSON.parse(JSON.stringify(sessions));
}

/**
 * Add to in-memory daily transfer sum and check limit
 */
function addDailyTransfer(customerId, amount) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (!dailyTransfers[customerId] || dailyTransfers[customerId].date !== today) {
    dailyTransfers[customerId] = { date: today, total: 0 };
  }

  const newTotal = dailyTransfers[customerId].total + amount;
  if (newTotal > 100000) {
    return { ok: false, remaining: 100000 - dailyTransfers[customerId].total };
  }

  dailyTransfers[customerId].total = newTotal;
  return { ok: true, total: dailyTransfers[customerId].total };
}

/**
 * Get today's total transfer for customer (in-memory)
 */
function getDailyTotal(customerId) {
  const today = new Date().toISOString().slice(0, 10);
  if (!dailyTransfers[customerId] || dailyTransfers[customerId].date !== today) return 0;
  return dailyTransfers[customerId].total;
}

/**
 * Optional: get daily total from DB (persistent)
 */
async function getDailyTotalFromDB(customerId, pool) {
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS daily_total
     FROM bank_transfer_logs
     WHERE customer_id = ? 
       AND status = 'submitted' 
       AND DATE(created_at) = CURRENT_DATE()`,
    [customerId]
  );

  return parseFloat(rows[0]?.daily_total || 0);
}


module.exports = {
  startSession,
  updateSession,
  getSession,
  endSession,
  debugSessions,
  addDailyTransfer,
  getDailyTotal,
  getDailyTotalFromDB
};


















// // // // src/services/transfer.service.js
// // src/services/transfer.service.js
// const sessions = {};

// /**
//  * Start a session for a phone number
//  * @param {string} phoneNumber
//  */
// function startSession(phoneNumber) {
//   if (!sessions[phoneNumber]) {
//     sessions[phoneNumber] = { step: 'start', data: {} };
//     console.log(`[USSD] New session started for ${phoneNumber}`);
//   } else {
//     console.log(`[USSD] Session resumed for ${phoneNumber}`);
//   }
//   return sessions[phoneNumber];
// }

// /**
//  * Update a session value or step
//  */
// function updateSession(phoneNumber, key, value) {
//   const session = sessions[phoneNumber];
//   if (!session) {
//     console.warn(`[USSD] Cannot update session; no session exists for ${phoneNumber}`);
//     return;
//   }

//   if (key === 'step') {
//     session.step = value;
//   } else {
//     session.data[key] = value;
//   }

//   console.log(`[USSD] Updated session for ${phoneNumber}: ${key} =`, value);
// }

// /**
//  * Get the latest session object
//  */
// function getSession(phoneNumber) {
//   return sessions[phoneNumber] || null;
// }

// /**
//  * End a session
//  */
// function endSession(phoneNumber) {
//   if (sessions[phoneNumber]) {
//     delete sessions[phoneNumber];
//     console.log(`[USSD] Session ended for ${phoneNumber}`);
//   } else {
//     console.warn(`[USSD] Attempted to end non-existent session for ${phoneNumber}`);
//   }
// }

// /**
//  * Debug current sessions
//  */
// function debugSessions() {
//   return JSON.parse(JSON.stringify(sessions));
// }

// module.exports = {
//   startSession,
//   updateSession,
//   getSession,
//   endSession,
//   debugSessions
// };









// const sessions = {};

// /**
//  * Start a session for a phone number
//  * @param {string} phoneNumber
//  */
// function startSession(phoneNumber) {
//   if (!sessions[phoneNumber]) {
//     sessions[phoneNumber] = { step: 'start', data: {} };
//     console.log(`[USSD] New session started for ${phoneNumber}`);
//   } else {
//     console.log(`[USSD] Session resumed for ${phoneNumber}`);
//   }
//   return sessions[phoneNumber];
// }

// /**
//  * Update a session value
//  */
// function updateSession(phoneNumber, key, value) {
//   const session = sessions[phoneNumber];
//   if (!session) {
//     console.warn(`[USSD] Cannot update session; no session exists for ${phoneNumber}`);
//     return;
//   }
//   session.data[key] = value;
//   console.log(`[USSD] Updated session for ${phoneNumber}: ${key} =`, value);
// }

// /**
//  * Get the latest session object
//  */
// function getSession(phoneNumber) {
//   return sessions[phoneNumber] || null;
// }

// /**
//  * End a session
//  */
// function endSession(phoneNumber) {
//   if (sessions[phoneNumber]) {
//     delete sessions[phoneNumber];
//     console.log(`[USSD] Session ended for ${phoneNumber}`);
//   } else {
//     console.warn(`[USSD] Attempted to end non-existent session for ${phoneNumber}`);
//   }
// }

// /**
//  * Debug current sessions
//  */
// function debugSessions() {
//   return JSON.parse(JSON.stringify(sessions));
// }

// module.exports = {
//   startSession,
//   updateSession,
//   getSession,
//   endSession,
//   debugSessions
// };




















// // Handles USSD session and data storage (production-ready)
// const axios = require('axios');

// // In-memory session store
// // phoneNumber => { step, data }
// const sessions = {};

// /**
//  * Start a session for a phone number
//  * @param {string} phoneNumber
//  * @returns {object} session object
//  */
// function startSession(phoneNumber) {
//   if (!sessions[phoneNumber]) {
//     sessions[phoneNumber] = { step: 'start', data: {} };
//     console.log(`[USSD] New session started for ${phoneNumber}`);
//   } else {
//     console.log(`[USSD] Session resumed for ${phoneNumber}`);
//   }
//   return sessions[phoneNumber];
// }

// /**
//  * Update a session value
//  * @param {string} phoneNumber
//  * @param {string} key
//  * @param {*} value
//  */
// function updateSession(phoneNumber, key, value) {
//   const session = sessions[phoneNumber];
//   if (!session) {
//     console.warn(`[USSD] Cannot update session; no session exists for ${phoneNumber}`);
//     return;
//   }
//   session.data[key] = value;
//   console.log(`[USSD] Updated session for ${phoneNumber}: ${key} =`, value);
// }

// /**
//  * Get the latest session object
//  * @param {string} phoneNumber
//  * @returns {object|null} session object
//  */
// function getSession(phoneNumber) {
//   const session = sessions[phoneNumber] || null;
//   if (!session) console.warn(`[USSD] No session found for ${phoneNumber}`);
//   return session;
// }

// /**
//  * End a session
//  * @param {string} phoneNumber
//  */
// function endSession(phoneNumber) {
//   if (sessions[phoneNumber]) {
//     delete sessions[phoneNumber];
//     console.log(`[USSD] Session ended for ${phoneNumber}`);
//   } else {
//     console.warn(`[USSD] Attempted to end non-existent session for ${phoneNumber}`);
//   }
// }

// /**
//  * Utility to debug current sessions
//  * @returns {object} copy of all sessions
//  */
// function debugSessions() {
//   return JSON.parse(JSON.stringify(sessions));
// }

// module.exports = {
//   startSession,
//   updateSession,
//   getSession,
//   endSession,
//   debugSessions
// };










// // src/services/transfer.service.js
// // Handles USSD session and data storage
// const axios = require('axios');

// const sessions = {}; // phoneNumber => { step, data }

// function startSession(phoneNumber) {
//   if (!sessions[phoneNumber]) {
//     sessions[phoneNumber] = { step: 'start', data: {} };
//   }
//   return sessions[phoneNumber];
// }

// function updateSession(phoneNumber, key, value) {
//   sessions[phoneNumber].data[key] = value;
// }

// function getSession(phoneNumber) {
//   return sessions[phoneNumber];
// }

// function endSession(phoneNumber) {
//   delete sessions[phoneNumber];
// }

// // Export functions
// module.exports = {
//   startSession,
//   updateSession,
//   getSession,
//   endSession
// };