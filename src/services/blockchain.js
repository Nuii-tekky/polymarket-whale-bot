require('dotenv').config();
const { ethers } = require('ethers');
const { sendMessage } = require('./telegram');
const logger = require('./logger');
const { enrichWhaleAlert } = require('./polymarket'); // ← NEW

// ============ CONSTANTS ============
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_DECIMALS = 6;

const POLYMARKET_EXCHANGES = [
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
].map(addr => addr.toLowerCase());

// ============ CONFIG FROM .env ============
const CONFIG = {
  thresholdUsd: parseFloat(process.env.WHALE_TRANSFER_THRESHOLD_USD || '100000'),
  minAmountUsd: parseFloat(process.env.WHALE_MIN_AMOUNT_USD || '0.01'),
  ignoreWallets: (process.env.IGNORE_WALLETS || '')
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0),
  alertOnOutflow: process.env.ALERT_ON_OUTFLOW?.toLowerCase() === 'true',
  testMode: process.env.TEST_MODE?.toLowerCase() === 'true',
};

// ============ PROVIDER ============
let provider;

function getProvider() {
  if (provider) return provider;

  if (CONFIG.testMode) {
    logger.info('TEST MODE: Using dummy provider (no real connection)');
    provider = {
      on: () => {},
      removeAllListeners: () => {},
    };
    return provider;
  }

  const rpcUrl = process.env.NETWORK === 'mainnet'
    ? process.env.ALCHEMY_MAINNET_WSS
    : process.env.ALCHEMY_AMOY_WSS;

  if (!rpcUrl) {
    logger.error('Missing RPC URL', { network: process.env.NETWORK });
    process.exit(1);
  }

  provider = new ethers.WebSocketProvider(rpcUrl);

  provider.on('error', err => logger.error('WebSocket error', { msg: err.message }));
  provider.on('close', () => {
    logger.warn('WebSocket disconnected — reconnecting in 5s');
    setTimeout(() => { provider = null; }, 5000);
  });

  logger.info('Connected to Polygon', { network: process.env.NETWORK || 'amoy' });
  return provider;
}

// ============ MAIN MONITOR ============
async function startWhaleMonitoring() {
  getProvider();

  let usdc;

  if (CONFIG.testMode && global.__mockUsdcContract) {
    usdc = global.__mockUsdcContract;
    logger.info('TEST MODE: Using injected mock USDC contract for events');
  } else if (CONFIG.testMode) {
    usdc = {
      on(eventName, callback) {
        logger.warn('TEST MODE: No events will fire (no mock contract injected)');
      }
    };
  } else {
    const prov = getProvider();
    usdc = new ethers.Contract(USDC_ADDRESS, [
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ], prov);
  }

  logger.info('Whale monitoring STARTED', {
    thresholdUsd: CONFIG.thresholdUsd,
    alertOnOutflow: CONFIG.alertOnOutflow,
    ignoredWalletsCount: CONFIG.ignoreWallets.length,
    testMode: CONFIG.testMode
  });

  usdc.on('Transfer', async (from, to, value, event) => {
    const amountUsd = parseFloat(ethers.formatUnits(value, USDC_DECIMALS));

    if (amountUsd < CONFIG.minAmountUsd) return;

    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();

    if (CONFIG.ignoreWallets.includes(fromLower) || CONFIG.ignoreWallets.includes(toLower)) {
      return;
    }

    const isToPM = POLYMARKET_EXCHANGES.includes(toLower);
    const isFromPM = POLYMARKET_EXCHANGES.includes(fromLower);

    if (!isToPM && !(isFromPM && CONFIG.alertOnOutflow)) return;

    if (amountUsd < CONFIG.thresholdUsd) return;

    const direction = isToPM ? 'INTO' : 'OUT OF';
    const whaleWallet = isToPM ? from : to;
    const exchangeAddr = isToPM ? to : from;

    // === NEW: Enrich with Polymarket context ===
    const enrichment = await enrichWhaleAlert(whaleWallet, amountUsd, event.transactionHash);

    let contextText = '';
    if (enrichment.marketTitle) {
      contextText = `
<b>Market:</b> ${enrichment.marketTitle}
<b>Betting on:</b> ${enrichment.outcome} (confidence: ${enrichment.confidence})
      `.trim();
    } else {
      contextText = `<i>${enrichment.note || 'Searching for market context...'}</i>`;
    }

    const text = `
🐳 <b>WHALE DETECTED</b> 🐳

<b>Amount:</b> $${amountUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC
<b>Direction:</b> ${direction} Polymarket
<b>Whale Wallet:</b> <code>${whaleWallet}</code>
${contextText}
<b>Tx:</b> <a href="https://polygonscan.com/tx/${event.transactionHash}">View on Polygonscan</a>
<b>Block:</b> ${event.blockNumber}
    `.trim();

    logger.info('Whale transfer detected', {
      amountUsd,
      direction,
      whaleWallet,
      txHash: event.transactionHash,
      market: enrichment.marketTitle || 'unknown',
      outcome: enrichment.outcome || 'unknown'
    });

    await sendMessage(text);
  });

  logger.info('USDC whale monitoring is ACTIVE');
}

module.exports = { startWhaleMonitoring, getProvider };