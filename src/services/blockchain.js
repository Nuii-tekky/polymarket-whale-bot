require("dotenv").config();
const { ethers } = require("ethers");
const WebSocket = require("ws");
const logger = require("../utils/logger");
const { getMarketByAssetId } = require("./polymarket");
const { analyzeTrade } = require("../core/analyzer");
const { executeMirror } = require("../core/executor");
const { sendMessage } = require("./telegram");

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_DECIMALS = 6;

const PROXY_FACTORIES = [
  "0xaB45c5A4B0c941a2F231C04C3f49182E1A254052", // Polymarket Proxy Factory
  "0xaacfeea03eb1561c4e67d661e40682bd20e3541b"  // Gnosis Safe Factory
].map(a => a.toLowerCase());

let provider;
let watchedWallets = new Map(); 
let ws; // Persistent reference for cleanup
let heartbeatInterval;

async function getProxyOwner(address) {
  try {
    const contract = new ethers.Contract(address, [
      "function getOwners() view returns (address[])", // Gnosis
      "function owner() view returns (address)"       // Custom Proxy
    ], provider);

    try {
      const owners = await contract.getOwners();
      return owners[0].toLowerCase();
    } catch {
      const owner = await contract.owner();
      return owner.toLowerCase();
    }
  } catch (e) {
    return address.toLowerCase(); 
  }
}

function connectTradeSocket() {
  // Cleanup existing socket and intervals before reconnecting
  if (ws) {
    ws.removeAllListeners();
    ws.terminate();
  }
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  ws = new WebSocket("wss://clob.polymarket.com/ws");
  let isAlive = true;

  ws.on("open", () => {
    logger.info("Polymarket RTDS Connected");
    isAlive = true;
    
    ws.send(JSON.stringify({
      type: "subscribe",
      topic: "activity",
      event_type: "trades"
    }));

    // Setup Heartbeat to prevent zombie connections
    heartbeatInterval = setInterval(() => {
      if (isAlive === false) {
        logger.warn("WS connection dead, terminating...");
        return ws.terminate();
      }
      isAlive = false;
      ws.ping();
    }, 30000); 
  });

  ws.on("pong", () => {
    isAlive = true;
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.topic === "activity" && msg.type === "trades") {
        const trade = msg.payload;
        const maker = trade.maker.toLowerCase();
        const taker = trade.taker.toLowerCase();

        const target = watchedWallets.has(maker) ? maker : (watchedWallets.has(taker) ? taker : null);
        if (target) {
          logger.info(`🎯 Signal! Insider ${target} traded.`);
          await handleTradeSignal(trade, target);
        }
      }
    } catch (err) {
      logger.error("Error parsing WS message", { error: err.message });
    }
  });

  ws.on("error", (err) => {
    logger.error("WebSocket error occurred", { error: err.message });
  });

  ws.on("close", () => {
    logger.warn("Polymarket RTDS Closed. Reconnecting in 5s...");
    clearInterval(heartbeatInterval);
    setTimeout(connectTradeSocket, 5000);
  });
}

async function handleTradeSignal(trade, wallet) {
  const market = await getMarketByAssetId(trade.asset_id);
  const tradeData = {
    amountUsd: parseFloat(trade.size) * parseFloat(trade.price),
    side: trade.side,
    marketName: market.title,
    outcome: market.outcome,
    assetId: trade.asset_id,
    price: trade.price
  };

  const analysis = await analyzeTrade(tradeData, wallet);
  if (analysis.shouldMirror) {
    await executeMirror(analysis, wallet, tradeData.amountUsd, tradeData);
    await sendMessage(`✅ <b>Mirrored Insider</b>\nWallet: <code>${wallet}</code>\nMarket: ${market.title}`);
  }
}

async function startWhaleMonitoring() {
  provider = new ethers.WebSocketProvider(process.env.ALCHEMY_POLYGON_WSS);
  const usdc = new ethers.Contract(USDC_ADDRESS, ["event Transfer(address indexed from, address indexed to, uint256 value)"], provider);

  connectTradeSocket();

  usdc.on("Transfer", async (from, to, value) => {
    const amount = parseFloat(ethers.formatUnits(value, USDC_DECIMALS));
    if (amount < 5000) return; 

    const owner = await getProxyOwner(to);
    const txCount = await provider.getTransactionCount(owner);

    if (txCount < 10) {
      watchedWallets.set(to.toLowerCase(), { owner, deposit: amount, time: Date.now() });
      logger.info(`🔥 Insider Watchlist: ${to} (Owner: ${owner})`);
      await sendMessage(`🕵️ <b>New Insider Spotted</b>\nFresh wallet funded with $${amount.toLocaleString()}.\nAddress: <code>${to}</code>`);
    }
  });
}

module.exports = { startWhaleMonitoring, getProvider: () => provider };