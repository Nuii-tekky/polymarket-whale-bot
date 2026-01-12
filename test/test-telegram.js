const { sendMessage } = require('../src/services/telegram');

(async () => {
  console.log('Sending test message...');
  const success = await sendMessage('FUCKK OFF');
  console.log(success ? '✅ Sent!' : '❌ Failed');
  process.exit();
})(); 