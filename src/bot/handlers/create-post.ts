import { Context } from 'telegraf';
import fs from 'fs';
import { config } from '../../config';
import { log, logError } from '../../utils/logger';
import {
  buildTempPhotoPath,
  downloadTelegramFile,
  getExtensionFromMime,
  isAllowedPhotoMime,
  isWithinSizeLimit,
} from '../../utils/file';
import {
  cancelKeyboard,
  mainMenuKeyboard,
  previewKeyboard,
} from '../keyboards';
import { BotContext, createDefaultSession } from '../types';
import { createPost, updatePost } from '../../database/sqlite';
import {
  publishToAllAccounts,
  BrowserServiceError,
} from '../../services/browser.service';
import { getActiveAccounts } from '../../database/sqlite';
import { resetSession } from './menu';

function getSession(ctx: Context & BotContext) {
  if (!ctx.session) {
    ctx.session = createDefaultSession();
  }
  return ctx.session;
}

export async function handleCreatePostStart(
  ctx: Context & BotContext
): Promise<void> {
  const activeAccounts = getActiveAccounts();
  if (activeAccounts.length === 0) {
    await ctx.reply(
      '⚠️ Belum ada akun X aktif.\nTambah dan login akun dulu via menu *👥 Akun X*.',
      { parse_mode: 'Markdown', ...mainMenuKeyboard }
    );
    return;
  }

  const session = getSession(ctx);
  session.state = 'waiting_photo';
  session.photoPath = undefined;
  session.replyText = undefined;

  await ctx.reply(
    '📷 Silakan kirim foto yang ingin diposting.\n\n' +
      'Format: JPG, PNG, WEBP\n' +
      `Ukuran maks: ${config.maxPhotoSizeMb} MB`,
    cancelKeyboard
  );
}

export async function handlePhoto(
  ctx: Context & BotContext
): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_photo') return false;

  const photos = ctx.message && 'photo' in ctx.message ? ctx.message.photo : null;
  if (!photos || photos.length === 0) return false;

  const photo = photos[photos.length - 1];
  if (!isWithinSizeLimit(photo.file_size || 0)) {
    await ctx.reply(
      `❌ Ukuran foto melebihi ${config.maxPhotoSizeMb} MB. Kirim foto yang lebih kecil.`
    );
    return true;
  }

  const file = await ctx.telegram.getFile(photo.file_id);
  if (!file.file_path) {
    await ctx.reply('❌ Gagal memproses foto. Coba lagi.');
    return true;
  }

  const ext = pathExtFromFilePath(file.file_path);
  const photoPath = buildTempPhotoPath(ctx.from!.id, ext);
  const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

  try {
    await downloadTelegramFile(fileUrl, photoPath);
  } catch {
    await ctx.reply('❌ Gagal mengunduh foto. Coba lagi.');
    return true;
  }

  session.photoPath = photoPath;
  session.state = 'waiting_text';

  await ctx.reply(
    '✅ Foto diterima.\n\nSekarang kirim caption untuk tweet.',
    cancelKeyboard
  );
  return true;
}

function pathExtFromFilePath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return '.jpg';
}

export async function handleDocument(
  ctx: Context & BotContext
): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_photo') return false;

  const doc =
    ctx.message && 'document' in ctx.message ? ctx.message.document : null;
  if (!doc) return false;

  if (!isAllowedPhotoMime(doc.mime_type)) {
    await ctx.reply('❌ Format tidak didukung. Gunakan JPG, PNG, atau WEBP.');
    return true;
  }

  if (!isWithinSizeLimit(doc.file_size || 0)) {
    await ctx.reply(
      `❌ Ukuran file melebihi ${config.maxPhotoSizeMb} MB. Kirim file yang lebih kecil.`
    );
    return true;
  }

  const file = await ctx.telegram.getFile(doc.file_id);
  if (!file.file_path) {
    await ctx.reply('❌ Gagal memproses file. Coba lagi.');
    return true;
  }

  const ext = getExtensionFromMime(doc.mime_type!);
  const photoPath = buildTempPhotoPath(ctx.from!.id, ext);
  const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

  try {
    await downloadTelegramFile(fileUrl, photoPath);
  } catch {
    await ctx.reply('❌ Gagal mengunduh file. Coba lagi.');
    return true;
  }

  session.photoPath = photoPath;
  session.state = 'waiting_text';

  await ctx.reply(
    '✅ Foto diterima.\n\nSekarang kirim caption untuk tweet.',
    cancelKeyboard
  );
  return true;
}

export async function handleReplyText(
  ctx: Context & BotContext
): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_text') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : null;
  if (!text) return false;

  if (text.length > config.maxReplyTextLength) {
    await ctx.reply(
      `❌ Teks terlalu panjang. Maksimum ${config.maxReplyTextLength} karakter.`
    );
    return true;
  }

  session.replyText = text;
  session.state = 'preview';

  await sendPreview(ctx);
  return true;
}

async function sendPreview(ctx: Context & BotContext): Promise<void> {
  const session = getSession(ctx);

  await ctx.replyWithPhoto(
    { source: session.photoPath! },
    {
      caption:
        '📋 *Konfirmasi posting?*\n\n' +
        'Foto: ✅\n' +
        `Caption: ✅\n\n` +
        `"${session.replyText}"\n\n` +
        'Ketik *YA* untuk publish, atau pilih opsi di bawah.',
      parse_mode: 'Markdown',
      ...previewKeyboard,
    }
  );
}

export async function handlePreviewAction(
  ctx: Context & BotContext
): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'preview') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text?.trim() : '';
  if (!text) return false;

  const normalized = text.toUpperCase();

  if (normalized === 'YA' || normalized === '✅ YA - PUBLISH') {
    await handlePublish(ctx);
    return true;
  }

  if (text === '📷 Edit Foto' || normalized === 'EDIT FOTO') {
    session.state = 'waiting_photo';
    session.photoPath = undefined;
    await ctx.reply('📷 Kirim foto baru.', cancelKeyboard);
    return true;
  }

  if (text === '✏️ Edit Teks' || normalized === 'EDIT TEKS') {
    session.state = 'waiting_text';
    session.replyText = undefined;
    await ctx.reply('✏️ Kirim caption yang baru.', cancelKeyboard);
    return true;
  }

  if (text === '❌ Batal' || normalized === 'BATAL') {
    await handleCancel(ctx);
    return true;
  }

  await ctx.reply(
    'Pilih salah satu:\n• YA — Publish\n• Edit Foto\n• Edit Teks\n• Batal',
    previewKeyboard
  );
  return true;
}

async function handlePublish(ctx: Context & BotContext): Promise<void> {
  const session = getSession(ctx);

  if (!session.photoPath || !session.replyText || !ctx.from?.id) {
    log('Gagal publish: Data sesi tidak lengkap', 'ERROR');
    await ctx.reply('❌ Data tidak lengkap. Mulai ulang dengan Buat Post.');
    resetSession(ctx);
    return;
  }

  const photoPath = session.photoPath;
  const replyText = session.replyText;
  const telegramId = ctx.from.id;
  const username = ctx.from.username;

  log(`User ${telegramId} (${username ?? 'unknown'}) meminta publish post`, 'INFO');
  
  resetSession(ctx);

  const post = createPost(telegramId, username, replyText);
  updatePost(post.id, { status: 'processing' });

  const activeAccounts = getActiveAccounts();
  await ctx.reply(
    `⏳ Sedang mempublish ke ${activeAccounts.length} akun X...\nMohon tunggu.`,
    mainMenuKeyboard
  );

  try {
    const results = await publishToAllAccounts(photoPath, replyText);

    const successResults = results.filter(r => r.success);
    const failResults = results.filter(r => !r.success);

    if (successResults.length > 0 && failResults.length === 0) {
      // All succeeded
      updatePost(post.id, {
        status: 'published',
        tweet_url: successResults.map(r => r.tweetUrl).join('\n'),
      });
    } else if (successResults.length > 0) {
      // Partial success
      updatePost(post.id, {
        status: 'published',
        tweet_url: successResults.map(r => r.tweetUrl).join('\n'),
        error_message: failResults.map(r => `${r.accountName}: ${r.error}`).join('; '),
      });
    } else {
      // All failed
      updatePost(post.id, {
        status: 'failed',
        error_message: failResults.map(r => `${r.accountName}: ${r.error}`).join('; '),
      });
    }

    log(`Post ID ${post.id}: ${successResults.length}/${results.length} akun berhasil`, 'INFO');

    // Build result message
    let msg = `📊 *Hasil Posting*\n\n`;
    for (const r of results) {
      const label = r.xUsername ? `${r.accountName} (${r.xUsername})` : r.accountName;
      if (r.success) {
        msg += `✅ *${label}*: [Tweet](${r.tweetUrl})\n`;
      } else {
        msg += `❌ *${label}*: ${r.error}\n`;
      }
    }

    await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard });
  } catch (error) {
    logError(`Post ID ${post.id} gagal dipublish`, error);

    const errorMessage =
      error instanceof BrowserServiceError
        ? error.message
        : 'Terjadi kesalahan saat mempublish.';

    updatePost(post.id, { status: 'failed', error_message: errorMessage });

    await ctx.reply(`❌ *Posting gagal.*\n\n${errorMessage}`, {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard,
    });
  } finally {
    if (fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath);
    }
  }
}

export async function handleCancel(ctx: Context & BotContext): Promise<void> {
  const session = getSession(ctx);
  if (session.photoPath && fs.existsSync(session.photoPath)) {
    fs.unlinkSync(session.photoPath);
  }
  resetSession(ctx);
  await ctx.reply('❌ Posting dibatalkan.', mainMenuKeyboard);
}

export async function handleCancelInFlow(
  ctx: Context & BotContext
): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state === 'idle') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  if (text !== '❌ Batal') return false;

  await handleCancel(ctx);
  return true;
}
