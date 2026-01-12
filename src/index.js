require('dotenv').config();
const { startWhaleMonitoring } = require('./services/blockchain');

console.log("Polymarket Whale Tracker Bot - LIVE MODE");
console.log("Network:", process.env.NETWORK || "mainnet");
console.log("Threshold:", process.env.WHALE_TRANSFER_THRESHOLD_USD || "5");

startWhaleMonitoring().catch((err) => {
  console.error("Startup failed", err);
  process.exit(1);
});