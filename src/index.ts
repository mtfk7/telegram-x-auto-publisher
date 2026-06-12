import fs from 'fs';
import { config } from './config';
import { createBot, registerBotCommands } from './bot/bot';
import { ensureTempDir } from './utils/file';

async function main(): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  ensureTempDir();

  const bot = createBot();
  await registerBotCommands(bot);

  await bot.launch();
  console.log('Telegram bot started');
  console.log('Arsitektur: Telegram → Node.js → Playwright → X.com');

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    bot.stop(signal);
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
