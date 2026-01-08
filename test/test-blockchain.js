require('dotenv').config();
const { ethers } = require('ethers');
const logger = require('../src/services/logger');
const { startWhaleMonitoring } = require('../src/services/blockchain');

// Force test mode
process.env.TEST_MODE = 'true';

// Create mock contract
const mockContract = {
  listeners: [],
  on(eventName, callback) {
    if (eventName === 'Transfer') {
      this.listeners.push(callback);
    }
  },
  async emitTransfer(from, to, amountUsd) {
    const value = ethers.parseUnits(amountUsd.toString(), 6); // Fixed: v6 syntax
    const fakeEvent = {
      transactionHash: '0xfake' + Math.random().toString(16).slice(2, 12),
      blockNumber: 99999999,
    };

    logger.info(`🧪 Emitting fake Transfer: $${amountUsd} USDC → ${to.slice(0,10)}...`);

    setTimeout(() => {
      this.listeners.forEach(listener => {
        listener(from, to, value, fakeEvent);
      });
    }, 100);
  }
};

// INJECT MOCK INTO GLOBAL so blockchain.js can use it
global.__mockUsdcContract = mockContract;

async function runBlockchainTest() {
  logger.info('=== WHALE BOT - BLOCKCHAIN TEST MODE ===');

  // Start monitoring — it will detect and use the global mock
  await startWhaleMonitoring();

  logger.info('Mock monitoring active. Sending test events in 2 seconds...\n');

  setTimeout(async () => {
    await mockContract.emitTransfer(
      '0xWhale11111111111111111111111111111111111',
      '0xc5d563a36ae78145c45a50134d48a1215220f80a',
      '14000'  // $15,000 — should trigger if threshold ≤15000
    );

    setTimeout(async () => {
      await mockContract.emitTransfer(
        '0xSmall22222222222222222222222222222222222',
        '0xc5d563a36ae78145c45a50134d48a1215220f80a',
        '6005'      // $5 — should NOT trigger
      );

      setTimeout(async () => {
        await mockContract.emitTransfer(
          '0xc5d563a36ae78145c45a50134d48a1215220f80a',
          '0xRichWhale33333333333333333333333333333333',
          '80000'  // Outflow — ignored unless ALERT_ON_OUTFLOW=true
        );

        setTimeout(async () => {
          const ignored = process.env.IGNORE_WALLETS?.split(',')[0]?.trim() || '0xIgnored44444444444444444444444444444444';
          await mockContract.emitTransfer(
            ignored,
            '0xc5d563a36ae78145c45a50134d48a1215220f80a',
            '2000000' // $1M — should be silenced
          );

          logger.info('\nAll test events sent! Check Telegram for alerts (only qualifying ones).');
          logger.info('Ctrl+C to stop.');
        }, 3000);
      }, 3000);
    }, 3000);
  }, 2000);
}

runBlockchainTest();

process.stdin.resume();