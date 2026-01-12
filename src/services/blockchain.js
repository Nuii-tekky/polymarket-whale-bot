require("dotenv").config();
const { ethers } = require("ethers");
const { sendMessage } = require("./telegram");
const logger = require("./logger");
const { enrichWhaleAlert } = require("./polymarket");
const { analyzeTrade } = require("../core/analyzer"); 
const { executeMirror } = require("../core/executor");

const USDC_ADDRESS = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"; // Amoy USDC
const USDC_DECIMALS = 6;

const POLYMARKET_EXCHANGES = [
  "0xc5d563a36ae78145c45a50134d48a1215220f80a",
  "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
].map((addr) => addr.toLowerCase());

const CONFIG = {
  thresholdUsd: parseFloat(process.env.WHALE_TRANSFER_THRESHOLD_USD || "10000"),
  minAmountUsd: parseFloat(process.env.WHALE_MIN_AMOUNT_USD || "0.01"),
  ignoreWallets: (process.env.IGNORE_WALLETS || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0),
  alertOnOutflow: process.env.ALERT_ON_OUTFLOW?.toLowerCase() === "true",
  watchDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  pollIntervalMs: 30000, // 30 seconds
};

let provider;
let watchedWallets = new Map(); 

function getProvider() {
  if (provider) return provider;

  const rpcUrl =
    process.env.NETWORK === "mainnet"
      ? process.env.ALCHEMY_MAINNET_WSS
      : process.env.ALCHEMY_AMOY_WSS;

  if (!rpcUrl) {
    logger.error("Missing RPC URL", { network: process.env.NETWORK });
    process.exit(1);
  }

  try {
    provider = new ethers.WebSocketProvider(rpcUrl);

    const waitForReady = () => new Promise((resolve) => {
      const check = () => {
        if (provider._websocket && provider._websocket.readyState === 1) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    waitForReady().then(() => {
      provider.on("error", (err) =>
        logger.error("WebSocket error", { msg: err.message })
      );

      provider.on("close", () => {
        logger.warn("WebSocket disconnected — reconnecting in 5s");
        setTimeout(() => {
          provider = null;
        }, 5000);
      });
    }).catch((err) => {
      logger.error("WebSocket initialization failed", { error: err.message });
    });

    logger.info("Connected to Polygon", {
      network: process.env.NETWORK || "amoy",
    });
  } catch (err) {
    logger.error("Failed to create WebSocketProvider", { error: err.message });
    process.exit(1);
  }

  return provider;
}

async function startWhaleMonitoring() {
  const prov = getProvider();

  const usdc = new ethers.Contract(USDC_ADDRESS, [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ], prov);

  logger.info("Whale monitoring STARTED", CONFIG);

  await sendMessage("✅ Bot is LIVE! Watching for huge deposits → monitoring wallets for trades.");

  usdc.on("Transfer", (from, to, value, event) => {
    (async () => {
      try {
        const amountUsd = parseFloat(ethers.formatUnits(value, USDC_DECIMALS));

        logger.info("RAW USDC TRANSFER EVENT RECEIVED", {
          from,
          to,
          amountUsd,
          txHash: event.transactionHash,
          block: event.blockNumber
        });

        if (amountUsd < CONFIG.minAmountUsd) return;

        const fromLower = from.toLowerCase();
        const toLower = to.toLowerCase();

        if (
          CONFIG.ignoreWallets.includes(fromLower) ||
          CONFIG.ignoreWallets.includes(toLower)
        ) {
          return;
        }

        const isToPM = POLYMARKET_EXCHANGES.includes(toLower);
        const isFromPM = POLYMARKET_EXCHANGES.includes(fromLower);

        if (!isToPM && !isFromPM) return;

        if (amountUsd < CONFIG.thresholdUsd) return;

        const direction = isToPM ? "INTO" : "OUT OF";
        const whaleWallet = isToPM ? from : to;

        watchedWallets.set(whaleWallet.toLowerCase(), {
          startTime: Date.now(),
          depositAmount: amountUsd
        });

        logger.info("Added wallet to watchlist", { wallet: whaleWallet, deposit: amountUsd });

        await sendMessage(`Huge ${direction} deposit detected from ${whaleWallet} ($${amountUsd}) — monitoring for trades!`);

        let enrichment = { note: "No context" };
        try {
          enrichment = await enrichWhaleAlert(whaleWallet, amountUsd, event.transactionHash);
        } catch (err) {
          logger.warn("Enrichment failed", { error: err.message });
        }

        const text = `
🐳 <b>WHALE DEPOSIT DETECTED</b> 🐳

Amount: $${amountUsd.toLocaleString()}
Direction: ${direction} Polymarket
Wallet: <code>${whaleWallet}</code>
${enrichment.marketTitle ? `Market: ${enrichment.marketTitle}\nBetting on: ${enrichment.outcome || "Unknown"}` : enrichment.note}
Tx: <a href="https://polygonscan.com/tx/${event.transactionHash}">View</a>
        `.trim();

        await sendMessage(text);
      } catch (err) {
        logger.error("Deposit detection error", { error: err.message });
      }
    })();
  });

  setInterval(async () => {
    const now = Date.now();
    for (const [wallet, data] of watchedWallets) {
      if (now - data.startTime > CONFIG.watchDurationMs) {
        watchedWallets.delete(wallet);
        logger.info("Removed expired wallet from watchlist", { wallet });
        continue;
      }

      const trades = await getRecentTradesForWallet(wallet, 5).catch(() => []);
      if (trades.length > 0) {
        const latestTrade = trades[0]; 
        const analysis = await analyzeTrade(latestTrade, wallet);

        let decisionText = `
<b>Trade Detected from Watched Wallet</b>
Amount: $${latestTrade.amountUsd}
Side: ${latestTrade.side}
Market: ${latestTrade.market || "Unknown"}
Outcome: ${latestTrade.outcome || "Unknown"}
Decision: ${analysis.shouldMirror ? "MIRROR" : "HOLD"}
Confidence: ${analysis.score}
Mirror %: ${analysis.mirrorPercent > 0 ? (analysis.mirrorPercent * 100).toFixed(1) + "%" : "0%"}
Reason: ${analysis.reasons}
        `.trim();

        await sendMessage(decisionText);

        if (analysis.shouldMirror) {
          const execResult = await executeMirror(analysis, wallet, latestTrade.amountUsd, latestTrade);
          if (execResult.success) {
            logger.info("Mirror executed", { txHash: execResult.txHash });
            await sendMessage(`✅ Copied trade from ${wallet.slice(0,8)}...`);
          } else {
            logger.warn("Mirror failed", { reason: execResult.reason });
          }
        }

        watchedWallets.delete(wallet); 
      }
    }
  }, CONFIG.pollIntervalMs);

  logger.info("USDC whale monitoring ACTIVE");
}

module.exports = { startWhaleMonitoring, getProvider };