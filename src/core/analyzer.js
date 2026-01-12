const logger = require('../utils/logger');
const { getProvider } = require('../services/blockchain');

const RULES = {
  minTradeUsdForMirror: parseFloat(process.env.ANALYZER_MIN_TRADE || '10000'), // Min trade size to consider
  freshWalletTxCountThreshold: parseInt(process.env.ANALYZER_FRESH_TX_THRESHOLD || '20'),
  baseConfidenceThreshold: parseFloat(process.env.ANALYZER_CONFIDENCE_THRESHOLD || '0.6'),
  maxMirrorPercent: parseFloat(process.env.ANALYZER_MAX_MIRROR_PCT || '0.15'),
  freshWalletBonusScore: 0.3,
  tradeSizeBonus: 0.25,
  buySideBonus: 0.2, 
};

async function analyzeTrade(tradeInfo, wallet) {
  let score = 0;
  let reasons = [];

  if (tradeInfo.amountUsd >= 500000) {
    score += 0.4;
    reasons.push('Very large trade ($500K+)');
  } else if (tradeInfo.amountUsd >= RULES.minTradeUsdForMirror) {
    score += RULES.tradeSizeBonus;
    reasons.push('Large trade (>$10K)');
  } else {
    return {
      shouldMirror: false,
      mirrorPercent: 0,
      score: 0,
      reasons: 'Trade too small for mirroring'
    };
  }

  let isFresh = false;
  try {
    const provider = getProvider();
    const txCount = await provider.getTransactionCount(wallet);
    if (txCount < RULES.freshWalletTxCountThreshold) {
      isFresh = true;
      reasons.push(`Fresh wallet detected (only ${txCount} txs) — strong insider signal`);
    } else {
      reasons.push(`Established wallet (${txCount} txs)`);
    }
  } catch (err) {
    logger.warn('RPC error checking wallet age', { error: err.message });
    isFresh = true; 
    reasons.push('Could not check wallet age (RPC error) — assuming fresh');
  }

  if (isFresh) {
    score += RULES.freshWalletBonusScore;
  }

  if (tradeInfo.side === 'BUY') {
    score += RULES.buySideBonus;
    reasons.push('Buy side detected (stronger signal)');
  }

  const shouldMirror = score >= RULES.baseConfidenceThreshold;
  const mirrorPercent = shouldMirror ? Math.min(RULES.maxMirrorPercent, score * RULES.maxMirrorPercent) : 0;

  const result = {
    shouldMirror,
    mirrorPercent,
    score: score.toFixed(2),
    reasons: reasons.join(' | ')
  };

  logger.info('Trade analysis complete', result);
  console.log(result);
  return result;
}

module.exports = { analyzeTrade };