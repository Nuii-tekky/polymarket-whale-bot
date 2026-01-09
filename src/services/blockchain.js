require("dotenv").config();
const { ethers } = require("ethers");
const { sendMessage } = require("./telegram");
const logger = require("./logger");
const { enrichWhaleAlert } = require("./polymarket");
const { analyzeWhale } = require("../core/analyzer");

const USDC_ADDRESS = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582";
const USDC_DECIMALS = 6;

const POLYMARKET_EXCHANGES = [
  "0xc5d563a36ae78145c45a50134d48a1215220f80a",
  "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
].map((addr) => addr.toLowerCase());

const CONFIG = {
  thresholdUsd: parseFloat(process.env.WHALE_TRANSFER_THRESHOLD_USD || "5"), // Low default for testnet testing
  minAmountUsd: parseFloat(process.env.WHALE_MIN_AMOUNT_USD || "0.01"),
  ignoreWallets: (process.env.IGNORE_WALLETS || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0),
  alertOnOutflow: process.env.ALERT_ON_OUTFLOW?.toLowerCase() === "true",
};

let provider;

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

    // Wait for internal WebSocket to be ready before registering events
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

  logger.info("Whale monitoring STARTED", {
    thresholdUsd: CONFIG.thresholdUsd,
    alertOnOutflow: CONFIG.alertOnOutflow,
    ignoredWalletsCount: CONFIG.ignoreWallets.length,
  });

  logger.info("USDC contract listener registered. Bot is LIVE and monitoring Amoy testnet.");

  usdc.on("Transfer", (from, to, value, event) => {
    // Synchronous wrapper for async processing
    (async () => {
      try {
        const amountUsd = parseFloat(ethers.formatUnits(value, USDC_DECIMALS));

        logger.info("RAW USDC TRANSFER EVENT RECEIVED", {
          from,
          to,
          amountRaw: value.toString(),
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
          logger.info("Ignored transfer (whitelisted wallet)", { wallet: fromLower || toLower });
          return;
        }

        const isToPM = POLYMARKET_EXCHANGES.includes(toLower);
        const isFromPM = POLYMARKET_EXCHANGES.includes(fromLower);

        if (!isToPM && !(isFromPM && CONFIG.alertOnOutflow)) {
          logger.info("Ignored transfer (not to/from Polymarket exchange)");
          return;
        }

        if (amountUsd < CONFIG.thresholdUsd) {
          logger.info("Ignored transfer (below threshold)", { amountUsd });
          return;
        }

        const direction = isToPM ? "INTO" : "OUT OF";
        const whaleWallet = isToPM ? from : to;

        let enrichment = {
          marketTitle: null,
          outcome: null,
          note: "No market context available",
        };
        try {
          enrichment = await enrichWhaleAlert(
            whaleWallet,
            amountUsd,
            event.transactionHash
          );
        } catch (err) {
          logger.warn("Enrichment failed", { error: err.message });
        }

        let contextText = "";
        if (enrichment.marketTitle) {
          contextText = `
<b>Market:</b> ${enrichment.marketTitle}
<b>Betting on:</b> ${enrichment.outcome || "Unknown"} (confidence: ${
            enrichment.confidence || "low"
          })
          `.trim();
        } else {
          contextText = `<i>${enrichment.note}</i>`;
        }

        const text = `
🐳 <b>WHALE DETECTED</b> 🐳

<b>Amount:</b> $${amountUsd.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })} USDC
<b>Direction:</b> ${direction} Polymarket
<b>Whale Wallet:</b> <code>${whaleWallet}</code>
${contextText}
<b>Tx:</b> <a href="https://polygonscan.com/tx/${event.transactionHash}">View on Polygonscan</a>
<b>Block:</b> ${event.blockNumber}
        `.trim();

        logger.info("Whale transfer processed", {
          amountUsd,
          direction,
          whaleWallet,
          txHash: event.transactionHash,
          market: enrichment.marketTitle || "unknown",
          outcome: enrichment.outcome || "unknown",
        });

        await sendMessage(text);

        // AUTO-MIRROR DECISION
        const analysis = await analyzeWhale(
          whaleWallet,
          amountUsd,
          event.transactionHash
        );

        let decisionText = `
<b>Bot Decision:</b> ${analysis.shouldMirror ? "MIRROR" : "HOLD"}
<b>Confidence Score:</b> ${analysis.score.toFixed(2)}
<b>Mirror Amount:</b> ${
          analysis.mirrorPercent > 0
            ? (analysis.mirrorPercent * 100).toFixed(1) + "%"
            : "0%"
        }
<b>Reason:</b> ${analysis.reasons}
        `.trim();

        const decisionMessage = `
🤖 <b>AUTO ANALYSIS</b> 🤖

${decisionText}
        `.trim();

        await sendMessage(decisionMessage);
      } catch (err) {
        logger.error("Error processing Transfer event", {
          error: err.message,
          stack: err.stack
        });
      }
    })();
  });

  logger.info("USDC whale monitoring is ACTIVE");
}

module.exports = { startWhaleMonitoring, getProvider };