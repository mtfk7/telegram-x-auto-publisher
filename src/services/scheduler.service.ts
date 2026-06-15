import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { getScheduledPosts, updateScrapedPost } from '../database/sqlite';
import { publishToAllAccounts } from './browser.service';
import { downloadImage } from './scrape.service';
import { log, logError, logDebug } from '../utils/logger';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

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
    logError('Failed to send scheduler notification', err);
  }
}

/**
 * Process all due scheduled posts sequentially.
 */
async function processScheduledPosts(bot: Telegraf<any>): Promise<void> {
  if (isProcessing) {
    logDebug('Scheduler: already processing, skipping tick');
    return;
  }

  const duePosts = getScheduledPosts();
  if (duePosts.length === 0) return;

  isProcessing = true;
  log(`Scheduler: ${duePosts.length} post(s) due for publishing`, 'INFO');

  for (const post of duePosts) {
    if (!post.image_url) {
      log(`Scheduler: post #${post.id} has no image, skipping`, 'INFO');
      updateScrapedPost(post.id, { status: 'skipped' });
      continue;
    }

    const tempDir = config.tempDir;
    fs.mkdirSync(tempDir, { recursive: true });

    // Determine file extension from URL
    const urlExt = path.extname(new URL(post.image_url).pathname);
    const ext = urlExt || '.jpg';
    const tempPath = path.join(tempDir, `scheduler_post_${post.id}${ext}`);

    try {
      // Download image
      await downloadImage(post.image_url, tempPath);

      const caption = post.caption || '';
      const results = await publishToAllAccounts(tempPath, caption);

      const successResults = results.filter((r) => r.success);

      if (successResults.length > 0) {
        const postedUrls = successResults.map((r) => r.tweetUrl).filter(Boolean).join('\n');
        updateScrapedPost(post.id, {
          status: 'posted',
          posted_url: postedUrls || null,
        });

        // Build success notification
        let msg = `📅 Post terjadwal #${post.id} berhasil!\n\n`;
        for (const r of results) {
          const label = r.xUsername ? `${r.accountName} (${r.xUsername})` : r.accountName;
          if (r.success) {
            msg += `✅ ${label}: ${r.tweetUrl}\n`;
          } else {
            msg += `❌ ${label}: ${r.error}\n`;
          }
        }
        msg += `\n🔗 Sumber: ${post.source_url}`;
        await notifyBot(bot, msg);
      } else {
        // All failed
        let msg = `📅 Post terjadwal #${post.id} GAGAL\n\n`;
        for (const r of results) {
          const label = r.xUsername ? `${r.accountName} (${r.xUsername})` : r.accountName;
          msg += `❌ ${label}: ${r.error}\n`;
        }
        await notifyBot(bot, msg);
      }

      log(
        `Scheduler: post #${post.id} done - ${successResults.length}/${results.length} akun berhasil`,
        'INFO'
      );
    } catch (err) {
      logError(`Scheduler: failed to process post #${post.id}`, err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await notifyBot(bot, `📅 Post terjadwal #${post.id} error: ${errMsg}`);
    } finally {
      // Cleanup temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  isProcessing = false;
}

/**
 * Start the scheduler that checks for due posts every 60 seconds.
 */
export function startScheduler(bot: Telegraf<any>): void {
  if (schedulerInterval) return;

  log('Scheduler: started (checking every 60s)', 'INFO');

  // Run immediately once, then every 60 seconds
  processScheduledPosts(bot).catch((err) => logError('Scheduler error', err));

  schedulerInterval = setInterval(() => {
    processScheduledPosts(bot).catch((err) => logError('Scheduler error', err));
  }, 60_000);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    log('Scheduler: stopped', 'INFO');
  }
}
