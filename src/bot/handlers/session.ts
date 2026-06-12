import { Context } from 'telegraf';
import { mainMenuKeyboard } from '../keyboards';
import { getSessionInfo, SessionStatus } from '../../services/browser.service';
import { getAllAccounts } from '../../database/sqlite';
import { BotContext } from '../types';
import { escapeHtml } from '../../utils/telegram';
import { handleCheckAllCookies } from './accounts';

const SESSION_ICON: Record<SessionStatus, string> = {
  active: '🟢',
  expired: '🟡',
  missing: '🔴',
};

export async function handleCheckCookies(ctx: Context & BotContext): Promise<void> {
  const accounts = getAllAccounts();

  // If multi-account, use the multi-account view
  if (accounts.length > 1) {
    return handleCheckAllCookies(ctx);
  }

  // Single account or no accounts - show simple view
  if (accounts.length === 0) {
    await ctx.reply(
      '👥 Belum ada akun. Tambah akun dulu via menu Akun X.',
      mainMenuKeyboard
    );
    return;
  }

  const account = accounts[0];
  await ctx.reply('🔍 Mengecek cookies & sesi X...', mainMenuKeyboard);

  const info = await getSessionInfo(account.profile_dir);

  let text =
    `🍪 <b>Cek Cookies X</b>\n` +
    `Akun: <b>${escapeHtml(account.name)}</b>` +
    (account.x_username ? ` (${escapeHtml(account.x_username)})` : '') +
    `\n\n` +
    `Status: ${SESSION_ICON[info.status]} ${info.status}\n` +
    `Login: ${info.loggedIn ? '✅ Ya' : '❌ Tidak'}\n`;

  if (info.username) {
    text += `X User: ${escapeHtml(info.username)}\n`;
  }
  if (info.profileUrl) {
    text += `Profil: ${escapeHtml(info.profileUrl)}\n`;
  }

  text +=
    `\n<b>Cookies:</b>\n` +
    `Total: ${info.cookieCount}\n` +
    `X/Twitter: ${info.xCookieCount}\n` +
    `auth_token: ${info.hasAuthToken ? '✅ Ada' : '❌ Tidak ada'}\n` +
    `ct0: ${info.hasCt0 ? '✅ Ada' : '❌ Tidak ada'}\n`;

  if (info.cookiesUpdatedAt) {
    text += `\nTerakhir update: ${escapeHtml(info.cookiesUpdatedAt)}\n`;
  }

  text += `\n${escapeHtml(info.message)}`;

  if (info.status !== 'active') {
    text += '\n\n💡 Login ulang via menu Akun X.';
  }

  await ctx.reply(text, { parse_mode: 'HTML', ...mainMenuKeyboard });
}
