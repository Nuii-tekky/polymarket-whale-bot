#  Polymarket Whale & Insider Bot

A high-performance monitoring and trade-mirroring system that bridges on-chain Polygon transactions with off-chain Polymarket CLOB activity. The bot identifies "Insiders"—freshly funded wallets that make high-conviction trades—and allows for automated mirroring.

---

## 🛠 Architecture & Logic

The bot operates on a **Detect → Watch → Match** lifecycle:

### 1. Detection (Blockchain Layer)
- **Whale Filter:** Monitors the USDC contract on Polygon for transfers `> $5,000`.
- **Insider Heuristic:** Screen recipients for `< 10 transactions` to find "Fresh Insiders."
- **Proxy Resolution:** Detects if the recipient is a Polymarket Proxy or Gnosis Safe and automatically resolves the actual "EOA Owner" to track true trading activity.

### 2. Watchlist (Memory Management)
- **Active Tracking:** Flagged wallets are added to a `watchedWallets` map.
- **Auto-Eviction:** To prevent memory leaks, wallets are automatically evicted after **48 hours** of inactivity. An alert is sent to Telegram upon eviction.

### 3. Matching (Heuristic Layer)
When a watched wallet trades, the bot calculates a **Confidence Score**:
- **High Confidence:** Trade size matches deposit size (variance < 20%).
- **Medium Confidence:** Trade found, but amount differs significantly.
- **Low Confidence:** No trades found within the 120-minute window of funding.



---

## 🚀 Key Features

* **Request Coalescing (Flight Locking):** Prevents "Thundering Herd" API failures by deduplicating simultaneous market data requests.
* **Persistent WebSockets:** Custom RTDS handler with a **Heartbeat Mechanism** to detect and recover from "zombie" connections.
* **Memory-Safe:** Uses listener cleanup (`removeAllListeners`) before reconnection to ensure 24/7 stability.
* **Telegram Integration:** Real-time HTML-formatted alerts for new insiders, mirrored trades, and watchlist expirations.

---

## 🔧 Installation & Setup

### 1. Prerequisites
- **Node.js:** v18+ (v20+ recommended)
- **Provider:** Alchemy or Infura WSS URL (Polygon Mainnet)
- **Messaging:** Telegram Bot Token and Chat ID

### 2. Install Dependencies
```bash
npm install

```

### 3.

# Network
ALCHEMY_POLYGON_WSS=wss://[polygon-mainnet.g.alchemy.com/v2/your-key](https://polygon-mainnet.g.alchemy.com/v2/your-key)

# Polymarket Credentials
POLYMARKET_API_KEY=your_key
POLYMARKET_SECRET=your_secret
POLYMARKET_PASSPHRASE=your_passphrase

# Telegram
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_id

🧪 Testing
```bash
The repository includes a comprehensive test suite covering critical edge cases:

Unit Tests: Heuristic scoring and market resolution.

Stress Tests: Simulates 100 simultaneous whale deposits to verify Flight Locking.

Integration Tests: Checksum sensitivity for wallet addresses.

```

```bash
# Run all tests
npm test

# Run stress tests specifically
npx jest test/polymarket.stress.test.js

```


⚖️ Disclaimer
This software is for educational purposes. Trading on prediction markets involves significant risk. The authors are not responsible for financial losses incurred through the use of this bot.
