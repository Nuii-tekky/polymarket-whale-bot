const axios = require('axios');
const logger = require('./logger');

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

let marketsCache = {
  data: [],
  lastUpdated: 0
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchActiveMarkets() {
  const now = Date.now();
  if (marketsCache.data.length > 0 && now - marketsCache.lastUpdated < CACHE_TTL) {
    return marketsCache.data;
  }

  try {
    const response = await axios.get(`${GAMMA_API}/markets`, {
      params: {
        active: true,
        closed: false,
        limit: 200
      },
      timeout: 10000
    });

    const markets = response.data.data || response.data;

    marketsCache = {
      data: markets.map(m => ({
        id: m.id,
        conditionId: m.condition_id || m.clob_token_ids?.[0]?.split('_')[0], 
        question: m.question || m.title,
        outcomes: m.outcomes || ['Yes', 'No'],
        volume: parseFloat(m.volume || 0),
        liquidity: parseFloat(m.liquidity || 0),
        yesPrice: parseFloat(m.outcome_prices?.[0] || m.yes_price || 0),
        noPrice: parseFloat(m.outcome_prices?.[1] || m.no_price || 1)
      })),
      lastUpdated: now
    };

    logger.info('Polymarket markets cached', { count: marketsCache.data.length });
    return marketsCache.data;
  } catch (error) {
    logger.error('Failed to fetch Polymarket markets', { error: error.message });
    return marketsCache.data; 
  }
}

async function getRecentTradesForWallet(wallet, minutes = 5) {
  if (!wallet) return [];

  try {
    const response = await axios.get(`${CLOB_API}/trades`, {
      params: {
        maker: wallet.toLowerCase(),
        taker: wallet.toLowerCase(),
        limit: 20
      },
      timeout: 8000
    });

    const trades = response.data.data || response.data;

    // Filter recent
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return trades.filter(t => new Date(t.timestamp).getTime() > cutoff);
  } catch (error) {
    logger.warn('Failed to fetch recent trades', { wallet: wallet.slice(0,10), error: error.message });
    return [];
  }
}

async function enrichWhaleAlert(whaleWallet, amountUsd, txHash) {
  const markets = await fetchActiveMarkets();
  const recentTrades = await getRecentTradesForWallet(whaleWallet, 120);

  if (recentTrades.length === 0) {
    return {
      marketTitle: null,
      outcome: null,
      confidence: 'low',
      note: 'No recent trades found for wallet'
    };
  }

  let bestMatch = null;
  let highestScore = 0;

  for (const trade of recentTrades) {
    const tradeAmount = parseFloat(trade.usdc_size || trade.amount || 0);
    const amountMatch = 1 - Math.abs(tradeAmount - amountUsd) / amountUsd;

    const market = markets.find(m => 
      m.conditionId === trade.market || 
      m.id === trade.market ||
      m.conditionId === trade.condition_id
    );
                      
    if (!market) continue;

    const volumeFactor = Math.min(market.volume / 1e7, 1); 
    const score = amountMatch * 0.7 + volumeFactor * 0.3;

    if (score > highestScore) {
      highestScore = score;
      const isYes = trade.side === 'buy' && trade.outcome === 'YES' || 
      trade.token_id?.endsWith('_YES');
      bestMatch = {
        marketTitle: market.question,
        outcome: isYes ? 'YES' : 'NO',
        confidence: score > 0.8 ? 'high' : 'medium',
        tradeAmount,
        prob: isYes ? market.yesPrice : market.noPrice
      };
    }
  }

  return bestMatch || {
    marketTitle: null,
    outcome: null,
    confidence: 'low',
    note: 'No strong market match'
  };
}

module.exports = {
  fetchActiveMarkets,
  getRecentTradesForWallet,
  enrichWhaleAlert
};

