require('dotenv').config();
const { Telegraf } = require('telegraf');

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatIdsRaw = process.env.TELEGRAM_CHAT_IDS?.trim() || '';

// Parse chat IDs - comma separated, very forgiving format
const chatIds = chatIdsRaw
  .split(',')
  .map(id => id.trim())
  .filter(id => id !== '' && !isNaN(id) && Number(id) !== 0) // basic validation
  .map(id => String(id)); // Telegram accepts both string and number, string is safest

let sendMessage = async (text) => {
  console.warn('Telegram not configured - message blocked:', text);
  return false;
};

if (!token) {
  console.error('Telegram DISABLED: TELEGRAM_TOKEN is missing in .env');
} else if (chatIds.length === 0) {
  console.error('Telegram DISABLED: No valid TELEGRAM_CHAT_IDS found in .env');
} else {
  console.log(`Telegram alerts enabled for ${chatIds.length} recipient(s)`);

  const bot = new Telegraf(token);

  bot.launch().catch((err) => {
    console.error('Telegram bot launch failed:', err.message);
  });

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  sendMessage = async (text) => {
    const logger = require('../utils/logger');
    let successCount = 0;

    for (const chatId of chatIds) {
      try {
        await bot.telegram.sendMessage(chatId, text, {
          parse_mode: 'HTML',
        });

        logger.info('Telegram alert sent successfully', {
          chatId,
          text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        });

        successCount++;
      } catch (error) {
        logger.error('Failed to send Telegram message', {
          chatId,
          message: error.message,
          description: error.description || 'No description',
          code: error.code,
          stack: error.stack?.substring(0, 300),
        });
      }
    }

    const allSucceeded = successCount === chatIds.length;
    if (!allSucceeded) {
      console.warn(`Telegram: ${successCount}/${chatIds.length} messages sent successfully`);
    }

    return allSucceeded;
  };
}

module.exports = { sendMessage };