// // // src/services/transfer.service.js
// src/services/transfer.service.js
const sessions = {};

/**
 * Start a session for a phone number
 * @param {string} phoneNumber
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
  if (!session) {
    console.warn(`[USSD] Cannot update session; no session exists for ${phoneNumber}`);
    return;
  }

  if (key === 'step') {
    session.step = value;
  } else {
    session.data[key] = value;
  }

  console.log(`[USSD] Updated session for ${phoneNumber}: ${key} =`, value);
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
  if (sessions[phoneNumber]) {
    delete sessions[phoneNumber];
    console.log(`[USSD] Session ended for ${phoneNumber}`);
  } else {
    console.warn(`[USSD] Attempted to end non-existent session for ${phoneNumber}`);
  }
}

/**
 * Debug current sessions
 */
function debugSessions() {
  return JSON.parse(JSON.stringify(sessions));
}

module.exports = {
  startSession,
  updateSession,
  getSession,
  endSession,
  debugSessions
};









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