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














