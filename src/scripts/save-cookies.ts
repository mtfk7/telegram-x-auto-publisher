/**
 * Login to Twitter from local machine and save session cookies.
 * Run this locally (residential IP), then transfer the cookie file to VPS.
 *
 * Usage:
 *   npx ts-node src/scripts/save-cookies.ts
 *
 * Then upload data/twitter-session.json to VPS:
 *   scp data/twitter-session.json root@157.66.34.227:/opt/telegram-x-auto-publisher/data/
 */
import { Scraper } from '@the-convocation/twitter-scraper';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const username = process.env.TWITTER_USERNAME;
  const password = process.env.TWITTER_PASSWORD;
  const email = process.env.TWITTER_EMAIL;

  if (!username || !password) {
    console.error('❌ Set TWITTER_USERNAME and TWITTER_PASSWORD in .env');
    process.exit(1);
  }

  const scraper = new Scraper();

  console.log(`🔐 Logging in as @${username}...`);
  try {
    await scraper.login(username, password, email || undefined);
  } catch (err: any) {
    console.error(`❌ Login failed: ${err.message}`);
    process.exit(1);
  }

  const loggedIn = await scraper.isLoggedIn();
  if (!loggedIn) {
    console.error('❌ Login succeeded but session is not valid');
    process.exit(1);
  }

  console.log('✅ Login successful!');

  // Save cookies
  const cookies = await scraper.getCookies();
  const serialized = cookies.map((c: any) => c.toJSON());
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  fs.mkdirSync(dataDir, { recursive: true });
  const sessionFile = path.join(dataDir, 'twitter-session.json');
  fs.writeFileSync(sessionFile, JSON.stringify(serialized, null, 2));
  console.log(`✅ Cookies saved to ${sessionFile} (${serialized.length} cookies)`);

  console.log('\n📤 Upload to VPS:');
  console.log(`   scp ${sessionFile} root@<VPS_IP>:/opt/telegram-x-auto-publisher/data/`);
}

main().catch(console.error);
