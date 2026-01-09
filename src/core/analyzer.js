const logger = require('../services/logger');
const { getProvider } = require('../services/blockchain');
const { ethers } = require('ethers');

const RULES = {
  minDepositUsdForMirror: parseFloat(process.env.ANALYZER_MIN_DEPOSIT || '50000'),
  freshWalletTxCountThreshold: parseInt(process.env.ANALYZER_FRESH_TX_THRESHOLD || '20'),
  baseConfidenceThreshold: parseFloat(process.env.ANALYZER_CONFIDENCE_THRESHOLD || '0.6'),
  maxMirrorPercent: parseFloat(process.env.ANALYZER_MAX_MIRROR_PCT || '0.15'),
  freshWalletBonusScore: 0.3,
};

async function analyzeWhale(whaleWallet, amountUsd, txHash) {
  let score = 0;
  let reasons = [];

  // 1. Deposit size score
  if (amountUsd >= 500000) {
    score += 0.4;
    reasons.push('Very large deposit ($500K+)');
  } else if (amountUsd >= RULES.minDepositUsdForMirror) {
    score += 0.25;
    reasons.push('Large deposit (>$50K)');
  } else {
    return {
      shouldMirror: false,
      mirrorPercent: 0,
      score: 0,
      reasons: 'Deposit too small for mirroring'
    };
  }

  // 2. Fresh wallet check — paramount for insiders
  let isFresh = false;
  try {
    const provider = getProvider();
    const txCount = await provider.getTransactionCount(whaleWallet);
    if (txCount < RULES.freshWalletTxCountThreshold) {
      isFresh = true;
      reasons.push(`Fresh wallet detected (only ${txCount} txs) — strong insider signal`);
    } else {
      reasons.push(`Established wallet (${txCount} txs)`);
    }
  } catch (err) {
    reasons.push('Could not check wallet age (RPC error)');
  }

  if (isFresh) {
    score += RULES.freshWalletBonusScore;
  }

  // 3. Future expansions (e.g., prob shift from enrichment)

  const shouldMirror = score >= RULES.baseConfidenceThreshold;
  const mirrorPercent = shouldMirror ? Math.min(RULES.maxMirrorPercent, score * RULES.maxMirrorPercent) : 0;

  const result = {
    shouldMirror,
    mirrorPercent,
    score,
    reasons: reasons.join(' | ')
  };

  logger.info('Analysis complete', result);

  return result;
}

module.exports = { analyzeWhale };