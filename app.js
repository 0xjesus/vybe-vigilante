import primate from '@thewebchimp/primate';
import TelegramBotService  from '#services/telegram.service.js';
 const botService = new TelegramBotService(
    process.env.TELEGRAM_BOT_TOKEN,
  );

  botService.initialize();
  await botService.launch();

await primate.setup();
await primate.start();




