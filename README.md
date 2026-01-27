# TagPay USSD Backend

TagPay USSD is a Node.js backend service that powers the TagPay USSD channel.  
It handles user interactions such as transfers, balance checks, PIN management, and airtime purchases.


## Project Goals

- Build a **fast and reliable USSD backend**
- Handle **very short USSD timeouts**
- Use **clean structure** (no over-engineering)


---

This README explains **why things are done**, not just how.

---

## Project Structure

TagPay-ussd/
│
├── src/
│ ├── app.js # Entry point 
│ ├── routes/
│ │ └── ussd.js # USSD endpoint logic
│ ├── services/
│ │ └── bank.service.js # Bank/FI list loading & lookup
│ └── data/
│ └── banklist.json # Cached list of banks (FI list)
│
├── scripts/
│ └── update-banklist.js # Script to update bank list daily
│
├── package.json # Project dependencies (like composer.json)
└── README.md








2. Transfer to bank (NIP) flow
Dial USSD,
→ Check phone exists
→ Show menu
→ Transfer to Bank
→ Select bank
→ Enter account
→ Enter amount
→ Name enquiry
→ Confirm + PIN
→ Transfer
→ END
→ Async db logging 
