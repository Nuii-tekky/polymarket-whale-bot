const { ethers } = require("ethers");
const axios = require("axios");
const logger = require("../services/logger");
const { sendMessage } = require("../services/telegram");
const { getProvider } = require("../services/blockchain");

const CLOB_API = "https://clob.polymarket.com";
const VAULT_ABI = [
  "function executeTrade(address to, uint256 amount) external",
  "function balanceOfUSDC() view returns (uint256)",
];

async function executeMirror(analysis, whaleWallet, amountUsd, tradeInfo) {
  if (!analysis.shouldMirror || !tradeInfo.outcome)
    return { success: false, reason: "No mirror or outcome" };

  const provider = getProvider();
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const vault = new ethers.Contract(
    process.env.VAULT_ADDRESS,
    VAULT_ABI,
    wallet
  );

  try {
    const balance = await vault.balanceOfUSDC();
    const amount = balance
      .mul(Math.floor(analysis.mirrorPercent * 100))
      .div(100);

    if (amount.eq(0)) return { success: false, reason: "Insufficient balance" };

    // Get token ID for outcome
    const tokenId = tradeInfo.market + "_" + tradeInfo.outcome;

    // Build order params
    const order = {
      token_id: tokenId,
      price: tradeInfo.price || 0.5, // Use whale's price or current
      size: ethers.formatUnits(amount, 6),
      side: "buy",
      type: "fok", // Fill or Kill
    };

    // Sign order (EIP-712)
    const domain = {
      name: "Polymarket CLOB",
      version: "1",
      chainId: 80002,
      verifyingContract: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8b8982e",
    };
    const types = {
      Order: [
        { name: "token_id", type: "string" },
        { name: "price", type: "uint256" },
        { name: "size", type: "uint256" },
        { name: "side", type: "string" },
        { name: "type", type: "string" },
      ],
    };
    const signature = await wallet.signTypedData(domain, types, order);

    // POST order to CLOB
    const response = await axios.post(
      `${CLOB_API}/order`,
      {
        ...order,
        signature,
      },
      {
        headers: {
          "X-API-KEY": process.env.POLYMARKET_API_KEY,
        },
      }
    );

    if (response.status === 200) {
      logger.info("Mirror executed", {
        amount: ethers.formatUnits(amount, 6),
        outcome: tradeInfo.outcome,
      });
      await sendMessage(
        `✅ MIRROR EXECUTED\nAmount: $${ethers.formatUnits(amount, 6)} on ${
          tradeInfo.outcome
        }\nMarket: ${tradeInfo.market}\nTx: ${response.data.txHash}`
      );
      return { success: true, txHash: response.data.txHash };
    } else {
      return { success: false, reason: response.data.error };
    }
  } catch (err) {
    logger.error("Mirror failed", { error: err.message });
    await sendMessage(`❌ Mirror FAILED: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

module.exports = { executeMirror };
