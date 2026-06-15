import { Context } from 'telegraf';
import { BotContext, createDefaultSession } from '../types';
import {
  accountMenuKeyboard,
  mainMenuKeyboard,
  cancelKeyboard,
} from '../keyboards';
import {
  createAccount,
  getAllAccounts,
  getAccountByName,
  deleteAccount,
  updateAccount,
  Account,
} from '../../database/sqlite';
import {
  loginToX,
  hasSession,
  getSessionInfo,
  BrowserServiceError,
  SessionStatus,
} from '../../services/browser.service';
import { escapeHtml } from '../../utils/telegram';
import { log, logError } from '../../utils/logger';

function getSession(ctx: Context & BotContext) {
  if (!ctx.session) {
    ctx.session = createDefaultSession();
  }
  return ctx.session;
}

const STATUS_ICON: Record<Account['status'], string> = {
  active: '🟢',
  expired: '🟡',
  inactive: '🔴',
};

const SESSION_ICON: Record<SessionStatus, string> = {
  active: '🟢',
  expired: '🟡',
  missing: '🔴',
};

// ── Account Menu ──

export async function handleAccountMenu(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();
  const activeCount = accounts.filter(a => a.status === 'active').length;

  await ctx.reply(
    `👥 *Manajemen Akun X*\n\n` +
    `Total akun: ${accounts.length}\n` +
    `Aktif: ${activeCount}\n\n` +
    `Pilih menu di bawah:`,
    { parse_mode: 'Markdown', ...accountMenuKeyboard }
  );
}

// ── Add Account ──

export async function handleAddAccount(ctx: Context & BotContext): Promise<void> {
  const session = getSession(ctx);
  session.state = 'waiting_account_name';
  session.photoPath = undefined;
  session.replyText = undefined;

  await ctx.reply(
    '➕ *Tambah Akun X Baru*\n\n' +
    'Kirim nama untuk akun ini (contoh: `toko1`, `personal`, `bisnis`).\n' +
    'Nama hanya boleh huruf, angka, dan underscore.',
    { parse_mode: 'Markdown', ...cancelKeyboard }
  );
}

export async function handleAccountNameInput(ctx: Context & BotContext): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_account_name') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text?.trim() : '';
  if (!text) return false;

  if (text === '❌ Batal') return false;

  // Validate name
  if (!/^[a-zA-Z0-9_]+$/.test(text)) {
    await ctx.reply('❌ Nama tidak valid. Gunakan huruf, angka, dan underscore saja.');
    return true;
  }

  if (text.length > 30) {
    await ctx.reply('❌ Nama terlalu panjang. Maksimal 30 karakter.');
    return true;
  }

  // Check if exists
  const existing = getAccountByName(text);
  if (existing) {
    await ctx.reply(`❌ Akun dengan nama "${text}" sudah ada. Kirim nama lain.`);
    return true;
  }

  // Create account
  const account = createAccount(text);
  log(`Akun baru dibuat: ${account.name} (ID: ${account.id})`, 'INFO');

  session.state = 'idle';

  await ctx.reply(
    `✅ Akun *${account.name}* berhasil dibuat!\n\n` +
    `Sekarang membuka browser untuk login ke X...\n` +
    `Login seperti biasa, jangan tutup browser sampai selesai.`,
    { parse_mode: 'Markdown', ...mainMenuKeyboard }
  );

  // Auto-launch login for this account
  try {
    const result = await loginToX(account.profile_dir);

    // Update account with X username and set as active
    updateAccount(account.id, {
      status: 'active',
      x_username: result.username ?? null,
    });

    await ctx.reply(
      `✅ Login berhasil untuk akun *${account.name}*!` +
      (result.username ? `\nUsername: ${result.username}` : '') +
      `\n\nAkun ini sekarang aktif dan akan menerima postingan.`,
      { parse_mode: 'Markdown', ...accountMenuKeyboard }
    );
  } catch (error) {
    const message = error instanceof BrowserServiceError
      ? error.message
      : 'Login gagal.';

    await ctx.reply(
      `❌ Login akun *${account.name}* gagal.\n\n${message}\n\n` +
      `Akun tetap tersimpan tapi belum aktif. Coba login lagi nanti.`,
      { parse_mode: 'Markdown', ...accountMenuKeyboard }
    );
  }

  return true;
}

// ── List Accounts ──

export async function handleListAccounts(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();

  if (accounts.length === 0) {
    await ctx.reply(
      '👥 Belum ada akun terdaftar.\n\nTekan *➕ Tambah Akun* untuk menambah.',
      { parse_mode: 'Markdown', ...accountMenuKeyboard }
    );
    return;
  }

  let text = '👥 *Daftar Akun X*\n\n';

  for (const account of accounts) {
    const icon = STATUS_ICON[account.status];
    const xName = account.x_username ?? 'belum login';
    text += `${icon} *${account.name}*\n`;
    text += `   X: ${xName}\n`;
    text += `   Status: ${account.status}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown', ...accountMenuKeyboard });
}

// ── Remove Account ──

export async function handleRemoveAccountStart(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();

  if (accounts.length === 0) {
    await ctx.reply(
      '👥 Belum ada akun untuk dihapus.',
      accountMenuKeyboard
    );
    return;
  }

  const session = getSession(ctx);
  session.state = 'waiting_account_remove';

  let text = '🗑 *Hapus Akun*\n\nKetik nama akun yang ingin dihapus:\n\n';
  for (const account of accounts) {
    text += `• ${account.name} (${account.x_username ?? 'belum login'})\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown', ...cancelKeyboard });
}

export async function handleRemoveAccountInput(ctx: Context & BotContext): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_account_remove') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text?.trim() : '';
  if (!text) return false;

  if (text === '❌ Batal') return false;

  const account = getAccountByName(text);
  if (!account) {
    await ctx.reply(`❌ Akun "${text}" tidak ditemukan. Coba lagi atau ketik Batal.`);
    return true;
  }

  deleteAccount(account.id);
  session.state = 'idle';

  log(`Akun dihapus: ${account.name} (ID: ${account.id})`, 'INFO');

  await ctx.reply(
    `✅ Akun *${account.name}* berhasil dihapus beserta profile browser-nya.`,
    { parse_mode: 'Markdown', ...accountMenuKeyboard }
  );

  return true;
}

// ── Login specific account ──

export async function handleLoginAccount(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();

  if (accounts.length === 0) {
    await ctx.reply(
      '👥 Belum ada akun. Tambah akun dulu via menu Akun X.',
      accountMenuKeyboard
    );
    return;
  }

  // Show list of accounts for login (re-use remove flow but for login)
  const session = getSession(ctx);
  session.state = 'waiting_account_name'; // reuse state for selecting account to login

  let text = '🔑 Pilih akun untuk login ulang (ketik namanya):\n\n';
  for (const account of accounts) {
    const icon = STATUS_ICON[account.status];
    text += `${icon} ${account.name} (${account.x_username ?? 'belum login'})\n`;
  }

  await ctx.reply(text, cancelKeyboard);
}

// ── Check cookies for all accounts ──

export async function handleCheckAllCookies(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();

  if (accounts.length === 0) {
    await ctx.reply(
      '👥 Belum ada akun. Tambah akun dulu via menu Akun X.',
      accountMenuKeyboard
    );
    return;
  }

  await ctx.reply('🔍 Mengecek sesi semua akun...', mainMenuKeyboard);

  let text = '🍪 <b>Status Semua Akun</b>\n\n';

  for (const account of accounts) {
    const icon = STATUS_ICON[account.status];
    text += `${icon} <b>${escapeHtml(account.name)}</b>`;
    if (account.x_username) {
      text += ` (${escapeHtml(account.x_username)})`;
    }
    text += '\n';

    try {
      const info = await getSessionInfo(account.profile_dir);
      text += `   Sesi: ${SESSION_ICON[info.status]} ${info.status}\n`;
      text += `   Login: ${info.loggedIn ? '✅' : '❌'}\n`;
      if (info.username) {
        text += `   X: ${escapeHtml(info.username)}\n`;
      }
      text += `   auth_token: ${info.hasAuthToken ? '✅' : '❌'}\n`;
      text += `   ct0: ${info.hasCt0 ? '✅' : '❌'}\n`;

      // Auto-update account status based on session
      if (info.status === 'active' && account.status !== 'active') {
        updateAccount(account.id, { status: 'active', x_username: info.username ?? account.x_username });
      } else if (info.status === 'expired' && account.status === 'active') {
        updateAccount(account.id, { status: 'expired' });
      }
    } catch {
      text += `   ⚠️ Gagal mengecek sesi\n`;
    }

    text += '\n';
  }

  await ctx.reply(text, { parse_mode: 'HTML', ...mainMenuKeyboard });
}

// ── Back to main menu ──

export async function handleBackToMenu(ctx: Context & BotContext): Promise<void> {
  const session = getSession(ctx);
  session.state = 'idle';
  await ctx.reply('⬅️ Kembali ke menu utama.', mainMenuKeyboard);
}

// ── Set Account Cookies (cookie injection) ──

export async function handleSetAccountCookies(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();

  if (accounts.length === 0) {
    await ctx.reply(
      '👥 Belum ada akun. Tambah akun dulu via menu Akun X.',
      accountMenuKeyboard
    );
    return;
  }

  const session = getSession(ctx);
  session.state = 'waiting_account_cookie_select';

  let text = '🍪 *Set Cookie Akun*\n\n';
  text += 'Pilih akun untuk set cookie (ketik namanya):\n\n';
  for (const account of accounts) {
    const icon = STATUS_ICON[account.status];
    const hasCookies = account.twitter_cookies ? '✅' : '❌';
    text += `${icon} ${account.name} (${account.x_username ?? 'belum login'}) - Cookie: ${hasCookies}\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown', ...cancelKeyboard });
}

export async function handleAccountCookieSelect(ctx: Context & BotContext): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_account_cookie_select') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text?.trim() : '';
  if (!text) return false;
  if (text === '❌ Batal') return false;

  const account = getAccountByName(text);
  if (!account) {
    await ctx.reply(`❌ Akun "${text}" tidak ditemukan. Coba lagi atau ketik Batal.`);
    return true;
  }

  session.state = 'waiting_account_cookie_input';
  session.selectedAccountName = account.name;

  await ctx.reply(
    `🍪 *Set Cookie untuk ${account.name}*\n\n` +
    `Kirim cookies X dalam format:\n` +
    '`ct0=VALUE; auth_token=VALUE`\n\n' +
    `Cara mendapat:\n` +
    `1. Login ke x.com di browser\n` +
    `2. F12 → Application → Cookies → x.com\n` +
    `3. Copy nilai \`ct0\` dan \`auth_token\``,
    { parse_mode: 'Markdown', ...cancelKeyboard }
  );

  return true;
}

export async function handleAccountCookieInput(ctx: Context & BotContext): Promise<boolean> {
  const session = getSession(ctx);
  if (session.state !== 'waiting_account_cookie_input') return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text?.trim() : '';
  if (!text) return false;
  if (text === '❌ Batal') return false;

  const accountName = session.selectedAccountName;
  if (!accountName) {
    session.state = 'idle';
    await ctx.reply('❌ Sesi habis. Coba lagi.', accountMenuKeyboard);
    return true;
  }

  // Validate cookies format
  const hasCt0 = text.includes('ct0=');
  const hasAuthToken = text.includes('auth_token=');
  if (!hasCt0 || !hasAuthToken) {
    await ctx.reply(
      '❌ Format tidak valid. Harus mengandung `ct0=` dan `auth_token=`.\n' +
      'Contoh: `ct0=abc123; auth_token=def456`',
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  const account = getAccountByName(accountName);
  if (!account) {
    session.state = 'idle';
    await ctx.reply('❌ Akun tidak ditemukan.', accountMenuKeyboard);
    return true;
  }

  // Save cookies and activate account
  updateAccount(account.id, {
    twitter_cookies: text,
    status: 'active',
  });

  session.state = 'idle';
  session.selectedAccountName = undefined;

  log(`Cookie set untuk akun: ${account.name}`, 'INFO');

  await ctx.reply(
    `✅ Cookie berhasil disimpan untuk akun *${account.name}*!\n\n` +
    `Akun sekarang aktif dan siap untuk posting.\n` +
    `Cookie akan di-inject ke browser saat posting.`,
    { parse_mode: 'Markdown', ...accountMenuKeyboard }
  );

  return true;
}
