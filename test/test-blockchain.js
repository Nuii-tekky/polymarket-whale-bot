require('dotenv').config();
const { ethers } = require('ethers');
const logger = require('../src/utils/logger');
const { startWhaleMonitoring } = require('../src/services/blockchain');


// Create mock contract
const mockContract = {
  listeners: [],
  on(eventName, callback) {
    if (eventName === 'Transfer') {
      this.listeners.push(callback);
    }
  },
  async emitTransfer(from, to, amountUsd) {
    const value = ethers.parseUnits(amountUsd.toString(), 6); 
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

global.__mockUsdcContract = mockContract;

async function runBlockchainTest() {
  logger.info('=== WHALE BOT - BLOCKCHAIN TEST MODE ===');

  await startWhaleMonitoring();

  logger.info('Mock monitoring active.\n');

  setTimeout(async () => {
    await mockContract.emitTransfer(
      '0x89A2BDD391A5D8447F33Bbf5e84A49a7F33Bbf5e',
      '0xc5d563a36ae78145c45a50134d48a1215220f80a',
      '200000'  
    );
  }, 2000);
}

runBlockchainTest();

process.stdin.resume();