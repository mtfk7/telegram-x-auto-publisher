import { Context } from 'telegraf';
import { accountMenuKeyboard, mainMenuKeyboard } from '../keyboards';
import {
  loginToX,
  checkSessionValid,
  BrowserServiceError,
} from '../../services/browser.service';
import { getAllAccounts, updateAccount, getAccountByName } from '../../database/sqlite';
import { BotContext, createDefaultSession } from '../types';

function getSession(ctx: Context & BotContext) {
  if (!ctx.session) {
    ctx.session = createDefaultSession();
  }
  return ctx.session;
}

export async function handleLoginX(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();

  if (accounts.length === 0) {
    await ctx.reply(
      '👥 Belum ada akun terdaftar.\n\nTambah akun dulu via menu *Akun X* → *➕ Tambah Akun*.',
      { parse_mode: 'Markdown', ...accountMenuKeyboard }
    );
    return;
  }

  if (accounts.length === 1) {
    // Single account - login directly
    const account = accounts[0];

    if (account.status === 'active') {
      const valid = await checkSessionValid(account.profile_dir);
      if (valid) {
        await ctx.reply(
          `✅ Akun *${account.name}* (${account.x_username ?? '?'}) masih aktif.\n\n` +
          `Jika ingin login ulang, hapus akun lalu tambah ulang.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard }
        );
        return;
      }
      await ctx.reply(`⚠️ Sesi akun *${account.name}* sudah expired. Membuka browser untuk login ulang...`, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`🔑 Membuka browser untuk login akun *${account.name}*...`, { parse_mode: 'Markdown' });
    }

    try {
      const result = await loginToX(account.profile_dir);
      updateAccount(account.id, {
        status: 'active',
        x_username: result.username ?? account.x_username,
      });
      await ctx.reply(
        `✅ Login berhasil untuk akun *${account.name}*!` +
        (result.username ? `\nUsername: ${result.username}` : ''),
        { parse_mode: 'Markdown', ...mainMenuKeyboard }
      );
    } catch (error) {
      const message = error instanceof BrowserServiceError ? error.message : 'Login gagal.';
      await ctx.reply(`❌ ${message}`, mainMenuKeyboard);
    }
    return;
  }

  // Multiple accounts - show list to choose
  const session = getSession(ctx);
  session.state = 'waiting_account_name';

  let text = '🔑 Pilih akun untuk login (ketik namanya):\n\n';
  for (const account of accounts) {
    const icon = account.status === 'active' ? '🟢' : account.status === 'expired' ? '🟡' : '🔴';
    text += `${icon} *${account.name}* (${account.x_username ?? 'belum login'})\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown', ...accountMenuKeyboard });
}
