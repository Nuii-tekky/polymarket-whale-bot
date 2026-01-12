const { ClobClient, Side, OrderType } = require("@polymarket/clob-client");
const { ethers } = require("ethers");
const logger = require("../utils/logger");
const { sendMessage } = require("../services/telegram");

async function executeMirror(analysis, whaleWallet, amountUsd, tradeData) {
    if (!analysis.shouldMirror || !tradeData.assetId) return;

    try {
        const client = new ClobClient(
            "https://clob.polymarket.com",
            137, 
            new ethers.Wallet(process.env.PRIVATE_KEY),
            {
                key: process.env.POLYMARKET_API_KEY,
                secret: process.env.POLYMARKET_API_SECRET,
                passphrase: process.env.POLYMARKET_API_PASSPHRASE,
            },
            parseInt(process.env.POLYMARKET_SIGNATURE_TYPE || "2"), 
            process.env.VAULT_ADDRESS 
        );

        const baseSize = parseFloat(process.env.MAX_TRADE_SIZE || "100");
        const tradeSize = parseFloat((baseSize * parseFloat(analysis.mirrorPercent)).toFixed(2));

        if (tradeSize < 1) return;

        logger.info(`🚀 [SDK] Placing Order: $${tradeSize} on ${tradeData.marketName}`);

        const resp = await client.createAndPostOrder({
            tokenID: tradeData.assetId,
            price: parseFloat(tradeData.price),
            size: tradeSize,
            side: Side.BUY,
        }, {
            orderType: OrderType.FOK 
        });

        if (resp.success) {
            await sendMessage(
                `✅ **MIRROR SUCCESSFUL**\n` +
                `Market: ${tradeData.marketName}\n` +
                `Price: ${tradeData.price}\n` +
                `Size: $${tradeSize}`
            );
            return { success: true, orderId: resp.orderID };
        } else {
            throw new Error(resp.errorMsg || "Order rejected by CLOB");
        }

    } catch (err) {
        const errorMsg = err.message || "Unknown CLOB error";
        logger.error("Mirror Execution Failed", { error: errorMsg });
        await sendMessage(`❌ **Mirror Failed**: ${errorMsg}`);
    }
}

module.exports = { executeMirror };