import { Telegraf } from 'telegraf';
import { config } from '../config';
import { getAllAccounts, updateAccount } from '../database/sqlite';
import { log, logError, logDebug } from '../utils/logger';

let healthMonitorTimer: ReturnType<typeof setInterval> | null = null;
let lastCheckDate: string | null = null;

function getNotificationTarget(): number | null {
  const ids = Array.from(config.telegram.allowedIds);
  return ids.length > 0 ? ids[0] : null;
}

async function notifyBot(bot: Telegraf<any>, message: string): Promise<void> {
  const chatId = getNotificationTarget();
  if (!chatId) return;
  try {
    await bot.telegram.sendMessage(chatId, message, { parse_mode: undefined });
  } catch (err) {
    logError('Failed to send health monitor notification', err);
  }
}

/**
 * Check if a set of cookies (ct0 + auth_token) is still valid on X.com.
 */
async function checkCookieValidity(cookies: string): Promise<boolean> {
  const pairs = cookies.split(';').map((c) => c.trim()).filter(Boolean);
  const ct0 = pairs.find((p) => p.toLowerCase().startsWith('ct0='));
  const authToken = pairs.find((p) => p.toLowerCase().startsWith('auth_token='));

  if (!ct0 || !authToken) return false;

  const ct0Value = ct0.split('=')[1];
  const authValue = authToken.split('=')[1];

  try {
    const res = await fetch('https://api.x.com/1.1/account/verify_credentials.json', {
      method: 'GET',
      headers: {
        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'x-csrf-token': ct0Value,
        'cookie': `ct0=${ct0Value}; auth_token=${authValue}`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      },
    });

    logDebug(`Health check: verify_credentials returned ${res.status}`);
    return res.status === 200;
  } catch (err) {
    logDebug(`Health check: request failed - ${err}`);
    return false;
  }
}

/**
 * Run health check on all accounts and the scraper.
 */
async function runHealthCheck(bot: Telegraf<any>): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastCheckDate === today) return; // Already checked today
  lastCheckDate = today;

  log('Health Monitor: running daily check', 'INFO');

  const accounts = getAllAccounts();
  const lines: string[] = [];
  const dateStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  lines.push(`🩺 Health Check - ${dateStr}\n`);

  // Check each account
  for (const account of accounts) {
    const label = account.x_username
      ? `${account.name} (${account.x_username})`
      : account.name;

    if (!account.twitter_cookies) {
      lines.push(`🔴 ${label}: Tidak ada cookie. Set cookie via bot.`);
      continue;
    }

    const valid = await checkCookieValidity(account.twitter_cookies);
    if (valid) {
      lines.push(`🟢 ${label}: OK`);
    } else {
      lines.push(`🔴 ${label}: EXPIRED - Update cookie segera!`);
      updateAccount(account.id, { status: 'expired' });
    }
  }

  // Check scraper cookies
  if (config.twitterCookies) {
    const scraperValid = await checkCookieValidity(config.twitterCookies);
    lines.push('');
    lines.push(scraperValid
      ? '🟢 Scraper: OK'
      : '🔴 Scraper: EXPIRED - Update TWITTER_COOKIES di .env');
  }

  if (accounts.length === 0 && !config.twitterCookies) {
    lines.push('Belum ada akun atau cookie yang dikonfigurasi.');
  }

  const message = lines.join('\n');
  await notifyBot(bot, message);
  log(`Health Monitor: check complete`, 'INFO');
}

function getTimeUntilNextCheck(): number {
  const [hour, minute] = config.healthCheckHour.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);

  if (now >= target) {
    // Already past today's check time - schedule for tomorrow
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

/**
 * Start the health monitor that checks cookies daily.
 */
export function startHealthMonitor(bot: Telegraf<any>): void {
  if (healthMonitorTimer) return;

  const msUntilCheck = getTimeUntilNextCheck();
  const hoursUntil = (msUntilCheck / 3600000).toFixed(1);
  log(`Health Monitor: next check in ${hoursUntil} hours (at ${config.healthCheckHour})`, 'INFO');

  // Schedule the check
  const scheduleNext = () => {
    const ms = getTimeUntilNextCheck();
    healthMonitorTimer = setTimeout(async () => {
      try {
        await runHealthCheck(bot);
      } catch (err) {
        logError('Health Monitor: check failed', err);
      }
      // Schedule next check (tomorrow)
      scheduleNext();
    }, ms);
  };

  scheduleNext();
}

/**
 * Stop the health monitor.
 */
export function stopHealthMonitor(): void {
  if (healthMonitorTimer) {
    clearTimeout(healthMonitorTimer);
    healthMonitorTimer = null;
    log('Health Monitor: stopped', 'INFO');
  }
}
