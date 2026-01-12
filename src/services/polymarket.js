const axios = require("axios");
const logger = require("../utils/logger");

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

let marketsCache = {
  data: [],
  lastUpdated: 0,
};

const CACHE_TTL = 5 * 60 * 1000;


async function getMarketByAssetId(assetId) {
  try {
    const response = await axios.get(`${GAMMA_API}/markets`, {
      params: { clob_token_ids: assetId },
      timeout: 5000
    });

    const market = response.data[0] || response.data.data?.[0];

    if (!market) {
      return { title: "Unknown Niche Market", outcome: "Unknown", price: 0 };
    }

    const isYes = market.clobTokenIds[0] === assetId;
    const outcome = isYes ? "YES" : "NO";
    const price = isYes ? market.outcomePrices?.[0] : market.outcomePrices?.[1];

    return {
      title: market.question || market.title,
      outcome: outcome,
      conditionId: market.conditionId,
      price: parseFloat(price || 0),
      raw: market 
    };
  } catch (error) {
    logger.error("Failed to resolve AssetID", { assetId, error: error.message });
    return { title: "Resolution Error", outcome: "Unknown", price: 0 };
  }
}


async function fetchActiveMarkets() {
  const now = Date.now();
  if (marketsCache.data.length > 0 && now - marketsCache.lastUpdated < CACHE_TTL) {
    return marketsCache.data;
  }

  try {
    const response = await axios.get(`${GAMMA_API}/markets`, {
      params: { active: true, closed: false, limit: 200 },
      timeout: 10000,
    });

    const markets = response.data.data || response.data;

    marketsCache = {
      data: markets.map((m) => ({
        id: m.id,
        conditionId: m.condition_id || m.clobTokenIds?.[0],
        question: m.question || m.title,
        outcomes: m.outcomes || ["Yes", "No"],
        volume: parseFloat(m.volume || 0),
        liquidity: parseFloat(m.liquidity || 0),
        yesPrice: parseFloat(m.outcomePrices?.[0] || 0),
        noPrice: parseFloat(m.outcomePrices?.[1] || 0),
        clobTokenIds: m.clobTokenIds
      })),
      lastUpdated: now,
    };

    logger.info("Polymarket markets cached", { count: marketsCache.data.length });
    return marketsCache.data;
  } catch (error) {
    logger.error("Failed to fetch Polymarket markets", { error: error.message });
    return marketsCache.data;
  }
}


async function getRecentTradesForWallet(wallet, minutes = 120) {
  if (!wallet) return [];
  const apiKey = process.env.POLYMARKET_API_KEY;

  try {
    const response = await axios.get(`${CLOB_API}/trades`, {
      params: { maker: wallet.toLowerCase(), limit: 20 },
      headers: apiKey ? { 'X-API-KEY': apiKey } : {},
      timeout: 8000
    });

    const trades = response.data.data || response.data || [];
    const cutoff = Date.now() - (minutes * 60 * 1000);

    return trades.filter(t => {
      const ts = new Date(t.timestamp || t.created_at).getTime();
      return ts > cutoff;
    });
  } catch (error) {
    logger.warn('Failed to fetch trades', { error: error.message });
    return [];
  }
}


async function enrichWhaleAlert(whaleWallet, amountUsd, txHash) {
  const markets = await fetchActiveMarkets();
  const recentTrades = await getRecentTradesForWallet(whaleWallet);

  if (recentTrades.length === 0) {
    return { marketTitle: null, outcome: null, confidence: "low", note: "No recent trades" };
  }

  let bestMatch = null;
  let highestScore = 0;

  for (const trade of recentTrades) {
    const tradeAmount = parseFloat(trade.usdc_size || trade.amount || 0);
    const amountMatch = 1 - Math.abs(tradeAmount - amountUsd) / amountUsd;

    const market = markets.find(m => 
      m.conditionId === trade.market || 
      m.clobTokenIds?.includes(trade.token_id)
    );

    if (!market) continue;

    const score = amountMatch * 0.7 + 0.3; 
    if (score > highestScore) {
      highestScore = score;
      const isYes = trade.token_id === market.clobTokenIds[0] || trade.outcome === "YES";
      bestMatch = {
        marketTitle: market.question,
        outcome: isYes ? "YES" : "NO",
        confidence: score > 0.8 ? "high" : "medium",
        tradeAmount,
        prob: isYes ? market.yesPrice : market.noPrice,
      };
    }
  }

  return bestMatch || { marketTitle: null, outcome: null, confidence: "low" };
}

module.exports = {
  fetchActiveMarkets,
  getRecentTradesForWallet,
  enrichWhaleAlert,
  getMarketByAssetId, 
};