import { Context } from 'telegraf';
import { mainMenuKeyboard } from '../keyboards';
import { BotContext, createDefaultSession } from '../types';
import { getRecentPosts, PostStatus, getAllAccounts } from '../../database/sqlite';
import { checkSessionValid } from '../../services/browser.service';

const HELP_TEXT =
  '📖 *Panduan Telegram X Auto Publisher*\n\n' +
  '*Command Telegram:*\n' +
  '/start — Tampilkan menu\n' +
  '/help — Panduan lengkap\n' +
  '/addaccount — Tambah akun X baru\n' +
  '/accounts — Daftar akun X\n' +
  '/login — Login ke akun X\n' +
  '/cookies — Cek cookies semua akun\n\n' +
  '*Scrape & Repost:*\n' +
  '/adduser @username — Pantau akun X\n' +
  '/listuser — Daftar akun yang dipantau\n' +
  '/scrape @username — Ambil postingan terbaru\n' +
  '/scrapeall — Scrape semua akun yang dipantau\n' +
  '/post — Lihat & post konten yang belum dipost\n\n' +
  '*Bank Caption:*\n' +
  '/captions — Kelola bank caption\n' +
  '🏷 Bank Caption — Menu bank caption\n' +
  '➕ Tambah Caption — Simpan caption baru\n' +
  '📋 Daftar Caption — Lihat semua caption\n' +
  '🗑 Hapus Caption — Hapus caption\n\n' +
  '*Caption di Preview Scrape:*\n' +
  '🔄 Ganti Caption — Acak caption lain dari bank\n' +
  '✏️ Tulis Sendiri — Ketik caption manual\n\n' +
  '*Tombol Menu:*\n' +
  '📝 Buat Post — Posting foto + caption ke semua akun\n' +
  '👥 Akun X — Kelola akun (tambah, daftar, hapus)\n' +
  '📋 Riwayat Post — 10 posting terakhir\n' +
  '📊 Status Sistem — Cek sesi semua akun\n' +
  '🍪 Cek Cookies — Lihat status sesi\n' +
  '🏷 Bank Caption — Kelola caption\n' +
  '❓ Bantuan — Tampilkan panduan ini\n\n' +
  '*Alur posting manual:*\n' +
  '1. 👥 Akun X → Tambah Akun → Login X\n' +
  '2. 📝 Buat Post → kirim foto (JPG/PNG/WEBP)\n' +
  '3. Kirim caption (max 280 karakter)\n' +
  '4. Konfirmasi *YA* untuk publish ke semua akun\n\n' +
  '*Alur scrape & repost:*\n' +
  '1. Set `TWITTER_COOKIES` di `.env` (F12 → Cookies → x.com)\n' +
  '2. /adduser @username — tambah akun sumber\n' +
  '3. 🏷 Bank Caption — tambahkan caption\n' +
  '4. /scrape @username — ambil postingan foto\n' +
  '5. Preview muncul + caption otomatis dari bank\n' +
  '6. *Ganti Caption* atau *Tulis Sendiri* jika perlu\n' +
  '7. Tekan *Post Sekarang* untuk publish\n\n' +
  '*Multi-akun:*\n' +
  '• Tambah beberapa akun X\n' +
  '• 1 foto + caption → otomatis ke semua akun\n\n' +
  '*Command Terminal (di komputer server):*\n' +
  '`npm run dev` — Jalankan bot\n' +
  '`npm run build` — Compile project\n' +
  '`npm start` — Jalankan production';

export async function handleStart(ctx: Context & BotContext): Promise<void> {
  await ctx.reply(
    '👋 Selamat datang di *Telegram X Auto Publisher*!\n\n' +
      '*Quick start:*\n' +
      '1. 👥 Akun X → Tambah Akun\n' +
      '2. 📝 Buat Post\n\n' +
      'Ketik /help atau tekan *❓ Bantuan* untuk info lengkap.',
    { parse_mode: 'Markdown', ...mainMenuKeyboard }
  );
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(HELP_TEXT, {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard,
  });
}

export async function handleHistory(ctx: Context & BotContext): Promise<void> {
  if (!ctx.from?.id) return;

  const posts = getRecentPosts(ctx.from.id);

  if (posts.length === 0) {
    await ctx.reply('📋 Belum ada riwayat posting.', mainMenuKeyboard);
    return;
  }

  const statusEmoji: Record<PostStatus, string> = {
    pending: '⏳',
    processing: '🔄',
    published: '✅',
    failed: '❌',
  };

  const lines = posts.map((post, i) => {
    const date = new Date(post.created_at).toLocaleString('id-ID');
    const emoji = statusEmoji[post.status];
    let line = `${i + 1}. ${emoji} ${post.status} — ${date}\n   "${post.reply_text.slice(0, 50)}${post.reply_text.length > 50 ? '...' : ''}"`;

    if (post.tweet_url) {
      // Show first URL if multiple
      const urls = post.tweet_url.split('\n');
      line += `\n   🔗 ${urls[0]}${urls.length > 1 ? ` (+${urls.length - 1})` : ''}`;
    }
    if (post.status === 'failed' && post.error_message) {
      line += `\n   ⚠️ ${post.error_message.slice(0, 100)}`;
    }
    return line;
  });

  await ctx.reply(`📋 *Riwayat Post*\n\n${lines.join('\n\n')}`, {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard,
  });
}

export async function handleSystemStatus(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();

  let text = '📊 *Status Sistem*\n\n';

  if (accounts.length === 0) {
    text += 'Belum ada akun terdaftar.\nTambah akun via menu *👥 Akun X*.';
  } else {
    text += `Total akun: ${accounts.length}\n\n`;

    for (const account of accounts) {
      const icon = account.status === 'active' ? '🟢' : account.status === 'expired' ? '🟡' : '🔴';
      text += `${icon} *${account.name}*`;
      if (account.x_username) text += ` (${account.x_username})`;
      text += ` — ${account.status}\n`;

      // Quick session check
      if (account.status === 'active' || account.status === 'expired') {
        try {
          const valid = await checkSessionValid(account.profile_dir);
          text += `   Sesi: ${valid ? '✅ Aktif' : '⚠️ Perlu login ulang'}\n`;
        } catch {
          text += `   Sesi: ⚠️ Gagal dicek\n`;
        }
      }
    }
  }

  text += `\nDatabase: ✅ SQLite`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainMenuKeyboard });
}

export function resetSession(ctx: Context & BotContext): void {
  ctx.session = createDefaultSession();
}
