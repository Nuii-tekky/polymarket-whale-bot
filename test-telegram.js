const { sendMessage } = require('./src/services/telegram');

(async () => {
  console.log('Sending test message...');
  const success = await sendMessage('🚀 <b>Whale Bot Online</b>\n\nTest alert successful!\nTime: ' + new Date().toLocaleString());
  console.log(success ? '✅ Sent!' : '❌ Failed');
  process.exit();
})(); 