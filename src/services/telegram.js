require('dotenv').config();
const { Telegraf } = require('telegraf');

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

let sendMessage = async (text) => {
  console.warn('Telegram not configured - message blocked:', text);
  return false;
};

if (token && chatId) {
  const bot = new Telegraf(token);

  bot.launch().catch((err) => {
    console.error('Telegram bot launch failed:', err.message);
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  sendMessage = async (text) => {
    const logger = require('../utils/logger');

    try {
      await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
      logger.info('Telegram alert sent', { text });
      return true;
    } catch (error) {
      logger.error('Failed to send Telegram message', {
        message: error.message,
        description: error.description,
        stack: error.stack
      });
      return false;
    }
  };
} else {
  console.error('Telegram DISABLED: Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID in .env');
}

module.exports = { sendMessage };