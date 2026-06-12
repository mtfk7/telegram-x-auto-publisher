import { Context } from 'telegraf';
import { BotContext } from '../types';
import { captionMenuKeyboard, mainMenuKeyboard } from '../keyboards';
import {
  addCaption,
  getCaptions,
  deleteCaption,
  getCaptionCount,
  getUnusedCaptionCount,
} from '../../database/sqlite';

export async function handleCaptionMenu(ctx: Context & BotContext): Promise<void> {
  const total = getCaptionCount();
  const unused = getUnusedCaptionCount();
  const used = total - unused;

  await ctx.reply(
    `🏷 *Bank Caption*\n\n` +
    `Total: ${total}\n` +
    `Terpakai: ${used}\n` +
    `Tersedia: ${unused}\n\n` +
    `Pilih menu:`,
    { parse_mode: 'Markdown', ...captionMenuKeyboard }
  );
}

export async function handleAddCaption(ctx: Context & BotContext): Promise<void> {
  ctx.session.state = 'waiting_caption_text';
  await ctx.reply(
    '✏️ Kirim caption yang ingin ditambahkan.\n\n' +
    'Tips: Kirim satu per satu. Ketik /batal untuk membatalkan.',
    mainMenuKeyboard
  );
}

export async function handleCaptionTextInput(ctx: Context & BotContext): Promise<boolean> {
  if (ctx.session.state !== 'waiting_caption_text') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : null;
  if (!text) return false;

  if (text === '/batal' || text === '❌ Batal') {
    ctx.session.state = 'idle';
    await ctx.reply('❌ Dibatalkan.', mainMenuKeyboard);
    return true;
  }

  const caption = addCaption(text);
  ctx.session.state = 'idle';

  const total = getCaptionCount();
  await ctx.reply(
    `✅ Caption berhasil ditambahkan! (#${caption.id})\n\n` +
    `Total caption: ${total}\n\n` +
    `Kirim lagi atau pilih menu:`,
    captionMenuKeyboard
  );
  return true;
}

export async function handleListCaptions(ctx: Context & BotContext): Promise<void> {
  const captions = getCaptions();

  if (captions.length === 0) {
    await ctx.reply('📭 Bank caption masih kosong.\nKlik "Tambah Caption" untuk menambahkan.', captionMenuKeyboard);
    return;
  }

  const lines = captions.map((c, i) => {
    const status = c.used ? '✅' : '⬜';
    const preview = c.text.length > 50 ? c.text.substring(0, 50) + '...' : c.text;
    return `${i + 1}. ${status} [#${c.id}] ${preview}`;
  });

  // Split into chunks if too long
  const chunkSize = 20;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize);
    await ctx.reply(
      `📋 *Daftar Caption* (${i + 1}-${Math.min(i + chunkSize, lines.length)}/${lines.length})\n\n` +
      `${chunk.join('\n')}\n\n` +
      `✅ = Terpakai | ⬜ = Tersedia`,
      { parse_mode: 'Markdown' }
    );
  }
}

export async function handleRemoveCaption(ctx: Context & BotContext): Promise<void> {
  const captions = getCaptions();
  if (captions.length === 0) {
    await ctx.reply('📭 Tidak ada caption untuk dihapus.', captionMenuKeyboard);
    return;
  }

  ctx.session.state = 'waiting_caption_remove';
  await ctx.reply(
    '🗑 Kirim nomor caption yang ingin dihapus (misal: 1, 3, 5).\n' +
    'Ketik /batal untuk membatalkan.',
    mainMenuKeyboard
  );

  // Show the list for reference
  const lines = captions.map((c, i) => {
    const preview = c.text.length > 40 ? c.text.substring(0, 40) + '...' : c.text;
    return `${i + 1}. [#${c.id}] ${preview}`;
  });
  await ctx.reply(lines.join('\n'));
}

export async function handleCaptionRemoveInput(ctx: Context & BotContext): Promise<boolean> {
  if (ctx.session.state !== 'waiting_caption_remove') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : null;
  if (!text) return false;

  if (text === '/batal' || text === '❌ Batal') {
    ctx.session.state = 'idle';
    await ctx.reply('❌ Dibatalkan.', captionMenuKeyboard);
    return true;
  }

  const captions = getCaptions();
  const index = parseInt(text) - 1;

  if (isNaN(index) || index < 0 || index >= captions.length) {
    await ctx.reply(`⚠️ Nomor tidak valid. Pilih 1-${captions.length}.`);
    return true;
  }

  const target = captions[index];
  deleteCaption(target.id);
  ctx.session.state = 'idle';

  const total = getCaptionCount();
  await ctx.reply(
    `✅ Caption #${target.id} berhasil dihapus.\n\n` +
    `Sisa caption: ${total}`,
    captionMenuKeyboard
  );
  return true;
}
