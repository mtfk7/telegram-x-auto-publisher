import { Context } from 'telegraf';
import { Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { BotContext, createDefaultSession } from '../types';
import { mainMenuKeyboard, scraperMenuKeyboard } from '../keyboards';
import {
  addWatchedUser,
  getWatchedUsers,
  removeWatchedUser,
  getWatchedUserByName,
  updateLastScraped,
  createScrapedPost,
  getScrapedPostById,
  getScrapedPostsByStatus,
  updateScrapedPost,
  getPendingPostsCount,
  ScrapedPostRecord,
  getRandomUnusedCaption,
  getRandomUnusedCaptionExcluding,
  markCaptionUsed,
  getCaptionById,
} from '../../database/sqlite';
import {
  scrapeUserPosts,
  downloadImage,
  hasScraperSession,
} from '../../services/scrape.service';
import {
  publishToAllAccounts,
  BrowserServiceError,
} from '../../services/browser.service';
import { getActiveAccounts } from '../../database/sqlite';
import { log, logError } from '../../utils/logger';
import { escapeHtml } from '../../utils/telegram';

function getSession(ctx: Context & BotContext) {
  if (!ctx.session) {
    ctx.session = createDefaultSession();
  }
  return ctx.session;
}

function buildInlineKeyboard(postId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📤 Post Sekarang', `post:${postId}`)],
    [
      Markup.button.callback('🔄 Ganti Caption', `swap:${postId}`),
      Markup.button.callback('✏️ Tulis Sendiri', `manual:${postId}`),
    ],
    [
      Markup.button.callback('✅ Tandai Sudah Dipost', `posted:${postId}`),
      Markup.button.callback('⏭ Lewati', `skip:${postId}`),
    ],
  ]);
}

/**
 * Send a preview of a scraped post to Telegram.
 * Auto-picks a random unused caption from the bank.
 */
async function sendPostPreview(
  ctx: Context & BotContext,
  post: ScrapedPostRecord
): Promise<void> {
  // Auto-pick caption from bank
  let displayCaption = post.caption;
  let bankLabel = '';

  if (!post.caption_id) {
    const bankCaption = getRandomUnusedCaption();
    if (bankCaption) {
      displayCaption = bankCaption.text;
      bankLabel = `\n_(Bank #${bankCaption.id})_`;
      markCaptionUsed(bankCaption.id);
      updateScrapedPost(post.id, { caption: bankCaption.text, caption_id: bankCaption.id });
      post.caption = bankCaption.text;
      post.caption_id = bankCaption.id;
    }
  } else {
    // Already has a caption assigned
    const cap = getCaptionById(post.caption_id);
    if (cap) {
      bankLabel = `\n_(Bank #${cap.id})_`;
    }
  }

  const caption =
    `📸 *Scraped Post #${post.id}*\n\n` +
    `*Caption:*\n${displayCaption ? escapeMarkdownV2(displayCaption) : '_tidak ada caption_'}${bankLabel}\n\n` +
    `👤 Sumber: @${post.source_username}\n` +
    `🔗 [Link asli](${post.source_url})\n` +
    (post.post_date ? `📅 Tanggal: ${post.post_date.split('T')[0]}\n` : '') +
    `\nID: ${post.id}`;

  if (post.image_url) {
    const tempDir = config.tempDir;
    fs.mkdirSync(tempDir, { recursive: true });
    const ext = getImageExt(post.image_url);
    const tempPath = path.join(tempDir, `scrape_preview_${post.id}${ext}`);

    try {
      await downloadImage(post.image_url, tempPath);
      await ctx.replyWithPhoto(
        { source: tempPath },
        {
          caption,
          parse_mode: 'Markdown',
          ...buildInlineKeyboard(post.id),
        }
      );
    } catch (err) {
      logError(`Gagal download gambar untuk preview post ${post.id}`, err);
      await ctx.reply(
        caption + '\n\n⚠️ Gagal memuat gambar.',
        {
          parse_mode: 'Markdown',
          ...buildInlineKeyboard(post.id),
        }
      );
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  } else {
    await ctx.reply(caption, {
      parse_mode: 'Markdown',
      ...buildInlineKeyboard(post.id),
    });
  }
}

/**
 * Send ALL pending scraped post previews at once.
 */
async function sendAllPendingPreviews(ctx: Context & BotContext): Promise<void> {
  const pendingPosts = getScrapedPostsByStatus('pending');
  if (pendingPosts.length === 0) return;

  await ctx.reply(`📦 ${pendingPosts.length} konten ditemukan. Pilih yang mau dipost:`);

  for (const post of pendingPosts) {
    await sendPostPreview(ctx, post);
  }
}

function getImageExt(url: string): string {
  if (url.includes('.png')) return '.png';
  if (url.includes('.webp')) return '.webp';
  if (url.includes('.gif')) return '.gif';
  return '.jpg';
}

function escapeMarkdownV2(text: string): string {
  // Basic Markdown escaping for Telegram
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

// ── /adduser handler ──

export async function handleAddUser(ctx: Context & BotContext): Promise<void> {
  const args = ctx.message && 'text' in ctx.message
    ? ctx.message.text.split(/\s+/).slice(1)
    : [];

  if (args.length === 0) {
    // Ask for username
    const session = getSession(ctx);
    session.state = 'waiting_scrape_username';

    await ctx.reply(
      '👤 *Tambah User untuk Dipantau*\n\n' +
      'Kirim username X yang ingin dipantau.\n' +
      'Contoh: `@username` atau `username`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const username = args[0].replace(/^@/, '');
  const user = addWatchedUser(username);

  await ctx.reply(
    `✅ User *${user.username}* berhasil ditambahkan ke daftar pantau.\n\n` +
    `Gunakan /scrape @${user.username} untuk mengambil postingannya.`,
    { parse_mode: 'Markdown', ...mainMenuKeyboard }
  );
}

// ── Handle username input when state is waiting_scrape_username ──

export async function handleScrapeUsernameInput(ctx: Context & BotContext): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_scrape_username') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text?.trim() : '';
  if (!text) return false;

  if (text === '❌ Batal') {
    session.state = 'idle';
    await ctx.reply('Dibatalkan.', mainMenuKeyboard);
    return true;
  }

  const username = text.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    await ctx.reply('❌ Username tidak valid. Gunakan huruf, angka, dan underscore saja.');
    return true;
  }

  const user = addWatchedUser(username);
  session.state = 'idle';

  await ctx.reply(
    `✅ User *${user.username}* berhasil ditambahkan ke daftar pantau.\n\n` +
    `Gunakan /scrape @${user.username} untuk mengambil postingannya.`,
    { parse_mode: 'Markdown', ...mainMenuKeyboard }
  );

  return true;
}

// ── /listuser handler ──

export async function handleListUsers(ctx: Context & BotContext): Promise<void> {
  const users = getWatchedUsers();

  if (users.length === 0) {
    await ctx.reply(
      '👤 Belum ada user yang dipantau.\n\nGunakan /adduser @username untuk menambah.',
      mainMenuKeyboard
    );
    return;
  }

  let text = '👤 *Daftar User yang Dipantau*\n\n';

  for (const user of users) {
    const lastScrape = user.last_scraped_at
      ? new Date(user.last_scraped_at).toLocaleString('id-ID')
      : 'belum pernah';
    text += `• @${user.username}\n`;
    text += `  Terakhir scrape: ${lastScrape}\n\n`;
  }

  const pendingCount = getPendingPostsCount();
  text += `\n📦 Konten pending: ${pendingCount}`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainMenuKeyboard });
}

// ── /scrape handler ──

export async function handleScrape(ctx: Context & BotContext): Promise<void> {
  const args = ctx.message && 'text' in ctx.message
    ? ctx.message.text.split(/\s+/).slice(1)
    : [];

  if (args.length === 0) {
    // Show list of watched users to choose from
    const users = getWatchedUsers();
    if (users.length === 0) {
      await ctx.reply(
        '👤 Belum ada user yang dipantau.\n\nGunakan /adduser @username untuk menambah.',
        mainMenuKeyboard
      );
      return;
    }

    let text = '🔍 *Scrape Postingan*\n\nKetik username yang ingin di-scrape:\n\n';
    for (const user of users) {
      text += `• @${user.username}\n`;
    }
    text += '\nContoh: /scrape username';

    await ctx.reply(text, { parse_mode: 'Markdown' });
    return;
  }

  const username = args[0].replace(/^@/, '');

  // Ensure user is in watch list
  let watchedUser = getWatchedUserByName(username);
  if (!watchedUser) {
    watchedUser = addWatchedUser(username);
  }

  // Check scraper session (ct0 + auth_token cookies)
  if (!hasScraperSession()) {
    await ctx.reply(
      '⚠️ Cookie Twitter belum diatur.\n\n' +
      'Tambahkan `TWITTER_COOKIES=ct0=...; auth_token=...` di `.env`\n\n' +
      'Cara mendapat: F12 → Application → Cookies → x.com',
      { parse_mode: 'Markdown', ...mainMenuKeyboard }
    );
  }

  await ctx.reply(`🔍 Sedang scraping @${username}...\nMohon tunggu, ini bisa memakan waktu 30-60 detik.`);

  try {
    const posts = await scrapeUserPosts(username);

    if (posts.length === 0) {
      await ctx.reply(
        `🔍 Scraping @${username} selesai.\n\nTidak ditemukan postingan dengan foto.`,
        mainMenuKeyboard
      );
      updateLastScraped(watchedUser.id);
      return;
    }

    // Store posts in DB (skip duplicates)
    let newCount = 0;
    let dupCount = 0;

    for (const post of posts) {
      const record = createScrapedPost({
        watchedUserId: watchedUser.id,
        sourceUsername: username,
        sourceUrl: post.sourceUrl,
        caption: post.caption,
        imageUrl: post.imageUrl,
        postDate: post.postDate,
      });

      if (record) {
        newCount++;
      } else {
        dupCount++;
      }
    }

    updateLastScraped(watchedUser.id);

    log(`Scrape @${username}: ${newCount} baru, ${dupCount} duplikat`, 'INFO');

    await ctx.reply(
      `✅ Scraping @${username} selesai!\n\n` +
      `📸 ${newCount} postingan baru ditemukan\n` +
      `🔄 ${dupCount} sudah ada (duplikat)`,
      mainMenuKeyboard
    );

    // Send ALL new previews at once
    if (newCount > 0) {
      await sendAllPendingPreviews(ctx);
    }
  } catch (error) {
    logError(`Gagal scraping @${username}`, error);
    const rawMsg = error instanceof Error ? error.message : 'Unknown error';
    // Truncate long error messages to avoid Telegram Markdown parse errors
    const message = rawMsg.length > 300 ? rawMsg.slice(0, 300) + '...' : rawMsg;
    await ctx.reply(
      `❌ Gagal scraping @${username}.\n\n${message}\n\n` +
      `Pastikan TWITTER_COOKIES sudah diatur di .env`,
      { ...mainMenuKeyboard }
    );
  }
}

// ── /post handler - show next pending post ──

export async function handlePostCommand(ctx: Context & BotContext): Promise<void> {
  const pendingPosts = getScrapedPostsByStatus('pending');

  if (pendingPosts.length === 0) {
    await ctx.reply(
      '📦 Tidak ada konten pending.\n\n' +
      'Gunakan /scrape @username untuk mengambil postingan baru.',
      mainMenuKeyboard
    );
    return;
  }

  await ctx.reply(`📦 ${pendingPosts.length} konten pending.`);
  for (const post of pendingPosts) {
    await sendPostPreview(ctx, post);
  }
}

// ── Callback query handler for inline buttons ──

export async function handleScrapePreviewCallback(ctx: Context & BotContext): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

  const data = ctx.callbackQuery.data;
  const match = data.match(/^(post|posted|skip|swap|manual):(\d+)$/);
  if (!match) return;

  const action = match[1];
  const postId = parseInt(match[2], 10);
  const post = getScrapedPostById(postId);

  if (!post) {
    await ctx.answerCbQuery('Post tidak ditemukan.');
    return;
  }

  if (action === 'post') {
    await handlePostAction(ctx, post);
  } else if (action === 'posted') {
    await handleMarkPostedAction(ctx, post);
  } else if (action === 'skip') {
    await handleSkipAction(ctx, post);
  } else if (action === 'swap') {
    await handleSwapCaption(ctx, post);
  } else if (action === 'manual') {
    await handleManualCaptionRequest(ctx, post);
  }
}

// ── Post Now action ──

async function handlePostAction(ctx: Context & BotContext, post: ScrapedPostRecord): Promise<void> {
  // Check for active accounts
  const activeAccounts = getActiveAccounts();
  if (activeAccounts.length === 0) {
    await ctx.answerCbQuery('Tidak ada akun X aktif!', { show_alert: true });
    return;
  }

  if (!post.image_url) {
    await ctx.answerCbQuery('Post ini tidak memiliki gambar!', { show_alert: true });
    return;
  }

  await ctx.answerCbQuery('⏳ Sedang memposting...');

  // Download image
  const tempDir = config.tempDir;
  fs.mkdirSync(tempDir, { recursive: true });
  const ext = getImageExt(post.image_url);
  const tempPath = path.join(tempDir, `scrape_post_${post.id}${ext}`);

  try {
    await downloadImage(post.image_url, tempPath);

    const caption = post.caption || '';
    const results = await publishToAllAccounts(tempPath, caption);

    const successResults = results.filter(r => r.success);

    // Update status
    if (successResults.length > 0) {
      const postedUrls = successResults.map(r => r.tweetUrl).filter(Boolean).join('\n');
      updateScrapedPost(post.id, {
        status: 'posted',
        posted_url: postedUrls || null,
      });
    }

    // Delete the preview message
    if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
      await ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => null);
    }

    // Build result message
    let msg = `✅ *Berhasil dipost!* (#${post.id})\n\n`;
    for (const r of results) {
      const label = r.xUsername ? `${r.accountName} (${r.xUsername})` : r.accountName;
      if (r.success) {
        msg += `✅ *${label}*: [Tweet](${r.tweetUrl})\n`;
      } else {
        msg += `❌ *${label}*: ${r.error}\n`;
      }
    }
    msg += `\n🔗 Sumber: ${post.source_url}`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });

    log(`Post scraped #${post.id} published: ${successResults.length}/${results.length} akun`, 'INFO');
  } catch (error) {
    logError(`Gagal posting scraped post #${post.id}`, error);
    const errMsg = error instanceof BrowserServiceError
      ? error.message
      : (error as Error).message;

    await ctx.reply(`❌ Gagal posting #${post.id}.\n\n${errMsg}`);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

// ── Mark as Posted (without actually posting) ──

async function handleMarkPostedAction(ctx: Context & BotContext, post: ScrapedPostRecord): Promise<void> {
  await ctx.answerCbQuery('Ditandai sudah dipost.');
  updateScrapedPost(post.id, { status: 'posted' });

  // Delete the preview message
  if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => null);
  }

  await ctx.reply(`✅ #${post.id} ditandai sudah dipost. (${post.source_url})`);
}

// ── Skip action ──

async function handleSkipAction(ctx: Context & BotContext, post: ScrapedPostRecord): Promise<void> {
  await ctx.answerCbQuery('Dilewati.');
  updateScrapedPost(post.id, { status: 'skipped' });

  // Delete the preview message
  if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => null);
  }

  await ctx.reply(`⏭ #${post.id} dilewati.`);
}

// ── Swap Caption action ──

async function handleSwapCaption(ctx: Context & BotContext, post: ScrapedPostRecord): Promise<void> {
  const currentCaptionId = post.caption_id;
  let newCaption;

  if (currentCaptionId) {
    newCaption = getRandomUnusedCaptionExcluding(currentCaptionId);
  } else {
    newCaption = getRandomUnusedCaption();
  }

  if (!newCaption) {
    await ctx.answerCbQuery('Tidak ada caption lain di bank. Tambahkan lebih banyak caption.', { show_alert: true });
    return;
  }

  // Mark new caption as used
  markCaptionUsed(newCaption.id);

  // Update post record
  updateScrapedPost(post.id, { caption: newCaption.text, caption_id: newCaption.id });
  post.caption = newCaption.text;
  post.caption_id = newCaption.id;

  await ctx.answerCbQuery(`Caption diganti ke Bank #${newCaption.id}`);

  // Edit the message with new caption
  const bankLabel = `\n_(Bank #${newCaption.id})_`;
  const captionText =
    `📸 *Scraped Post #${post.id}*\n\n` +
    `*Caption:*\n${escapeMarkdownV2(newCaption.text)}${bankLabel}\n\n` +
    `👤 Sumber: @${post.source_username}\n` +
    `🔗 [Link asli](${post.source_url})\n` +
    (post.post_date ? `📅 Tanggal: ${post.post_date.split('T')[0]}\n` : '') +
    `\nID: ${post.id}`;

  if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
    const msg = ctx.callbackQuery.message;
    if ('photo' in msg && msg.photo && msg.photo.length > 0) {
      await ctx.editMessageCaption(captionText, {
        parse_mode: 'Markdown',
        ...buildInlineKeyboard(post.id),
      });
    } else {
      await ctx.editMessageText(captionText, {
        parse_mode: 'Markdown',
        ...buildInlineKeyboard(post.id),
      });
    }
  }
}

// ── Manual Caption action ──

async function handleManualCaptionRequest(ctx: Context & BotContext, post: ScrapedPostRecord): Promise<void> {
  const session = getSession(ctx);
  session.state = 'waiting_manual_caption';
  session.captionPostId = post.id;

  await ctx.answerCbQuery('Kirim caption baru...');
  await ctx.reply(
    `✏️ *Tulis Caption Manual* (untuk post #${post.id})\n\n` +
    `Kirim caption yang ingin dipakai.\n` +
    `Ketik /batal untuk membatalkan.`,
    { parse_mode: 'Markdown' }
  );
}

// ── Handle manual caption text input ──

export async function handleManualCaptionInput(ctx: Context & BotContext): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_manual_caption') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : null;
  if (!text) return false;

  if (text === '/batal' || text === '❌ Batal') {
    session.state = 'idle';
    session.captionPostId = undefined;
    await ctx.reply('❌ Dibatalkan.', mainMenuKeyboard);
    return true;
  }

  const postId = session.captionPostId;
  if (!postId) {
    session.state = 'idle';
    await ctx.reply('⚠️ Session tidak valid.', mainMenuKeyboard);
    return true;
  }

  const post = getScrapedPostById(postId);
  if (!post) {
    session.state = 'idle';
    session.captionPostId = undefined;
    await ctx.reply('⚠️ Post tidak ditemukan.', mainMenuKeyboard);
    return true;
  }

  // Update post caption (manual caption, no bank ID)
  updateScrapedPost(post.id, { caption: text, caption_id: null });

  session.state = 'idle';
  session.captionPostId = undefined;

  // Re-send preview with updated caption
  const updatedPost = getScrapedPostById(post.id)!;
  await ctx.reply(`✅ Caption diperbarui untuk post #${post.id}. Preview:`);
  await sendPostPreview(ctx, updatedPost);
  return true;
}

// ── Scrape All watched users ──

export async function handleScrapeAll(ctx: Context & BotContext): Promise<void> {
  const users = getWatchedUsers();

  if (users.length === 0) {
    await ctx.reply(
      '👤 Belum ada user yang dipantau.\n\nGunakan /adduser @username untuk menambah.',
      mainMenuKeyboard
    );
    return;
  }

  await ctx.reply(`🔍 Scraping ${users.length} user...\nMohon tunggu.`);

  let totalNew = 0;
  let totalDup = 0;
  const errors: string[] = [];

  for (const user of users) {
    try {
      const posts = await scrapeUserPosts(user.username);

      let newCount = 0;
      for (const post of posts) {
        const record = createScrapedPost({
          watchedUserId: user.id,
          sourceUsername: user.username,
          sourceUrl: post.sourceUrl,
          caption: post.caption,
          imageUrl: post.imageUrl,
          postDate: post.postDate,
        });
        if (record) newCount++;
      }

      totalNew += newCount;
      totalDup += posts.length - newCount;
      updateLastScraped(user.id);
    } catch (err) {
      errors.push(`@${user.username}: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  let msg = `✅ *Scrape All Selesai*\n\n📸 ${totalNew} postingan baru\n🔄 ${totalDup} duplikat`;
  if (errors.length > 0) {
    msg += `\n\n⚠️ Error:\n${errors.map(e => `• ${e}`).join('\n')}`;
  }

  await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard });

  // Send ALL pending previews at once
  await sendAllPendingPreviews(ctx);
}

// ── Scraper Menu ──

export async function handleScraperMenu(ctx: Context & BotContext): Promise<void> {
  const hasSession = hasScraperSession();

  let statusText = '';
  if (hasSession) {
    statusText = '🟢 Cookie Twitter sudah diatur';
  } else {
    statusText = '🔴 Cookie Twitter belum diatur';
  }

  const pendingCount = getPendingPostsCount();
  const watchedCount = getWatchedUsers().length;

  await ctx.reply(
    `🔍 *Menu Scraper*\n\n` +
    `Status: ${statusText}\n` +
    `Akun dipantau: ${watchedCount}\n` +
    `Konten pending: ${pendingCount}\n\n` +
    `Pilih menu di bawah:`,
    { parse_mode: 'Markdown', ...scraperMenuKeyboard }
  );
}



export async function handleCheckScraperSession(ctx: Context & BotContext): Promise<void> {
  const hasSession = hasScraperSession();

  let text = '🔎 *Status Scraper*\n\n';

  if (!hasSession) {
    text += '🔴 *Cookie Twitter belum diatur*\n\n';
    text += 'Tambahkan di `.env`:\n';
    text += '`TWITTER_COOKIES=ct0=VALUE; auth_token=VALUE`\n\n';
    text += 'Cara mendapat cookie:\n';
    text += '1. Login ke x.com di browser\n';
    text += '2. F12 → Application → Cookies → x.com\n';
    text += '3. Copy nilai `ct0` dan `auth_token`\n';
  } else {
    text += '🟢 *Cookie Twitter sudah diatur*\n\n';
    text += 'Jika scraping gagal, update ct0 dan auth_token dari browser.';
  }

  await ctx.reply(text, { parse_mode: 'Markdown', ...scraperMenuKeyboard });
}
