import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseAllowedIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map(Number)
      .filter((id) => !Number.isNaN(id))
  );
}

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    allowedIds: parseAllowedIds(process.env.ALLOWED_TELEGRAM_IDS || ''),
  },
  dataDir,
  dbPath: path.join(dataDir, 'posts.db'),
  profilesDir: path.join(dataDir, 'browser-profiles'),
  tempDir: path.resolve(process.env.TEMP_DIR || './temp'),
  browser: {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    type: (process.env.BROWSER_TYPE || 'brave') as 'brave' | 'chrome' | 'chromium',
    executable: process.env.BROWSER_EXECUTABLE || undefined,
  },
  maxPhotoSizeMb: parseInt(process.env.MAX_PHOTO_SIZE_MB || '20', 10),
  maxReplyTextLength: parseInt(process.env.MAX_REPLY_TEXT_LENGTH || '280', 10),
};

export function getAccountProfileDir(accountName: string): string {
  return path.join(config.profilesDir, accountName);
}
