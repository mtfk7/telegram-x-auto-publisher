import { Telegraf, session, Context } from 'telegraf';
import { config } from '../config';
import { whitelistMiddleware } from './middleware/auth';
import { BotContext, createDefaultSession, SessionData } from './types';
import {
  handleStart,
  handleHelp,
  handleHistory,
  handleSystemStatus,
} from './handlers/menu';
import {
  handleCreatePostStart,
  handlePhoto,
  handleDocument,
  handleReplyText,
  handlePreviewAction,
  handleCancelInFlow,
} from './handlers/create-post';
import { handleLoginX } from './handlers/login';
import { handleCheckCookies } from './handlers/session';
import {
  handleAccountMenu,
  handleAddAccount,
  handleAccountNameInput,
  handleListAccounts,
  handleRemoveAccountStart,
  handleRemoveAccountInput,
  handleBackToMenu,
  handleCheckAllCookies,
  handleSetAccountCookies,
  handleAccountCookieSelect,
  handleAccountCookieInput,
} from './handlers/accounts';
import {
  handleAddUser,
  handleListUsers,
  handleScrape,
  handlePostCommand,
  handleScrapePreviewCallback,
  handleScrapeUsernameInput,
  handleScrapeAll,
  handleScraperMenu,
  handleCheckScraperSession,
  handleManualCaptionInput,
} from './handlers/scrape';
import {
  handleCaptionMenu,
  handleAddCaption,
  handleCaptionTextInput,
  handleListCaptions,
  handleRemoveCaption,
  handleCaptionRemoveInput,
} from './handlers/caption';

type AppContext = Context & BotContext;

export function createBot(): Telegraf<AppContext> {
  const bot = new Telegraf<AppContext>(config.telegram.botToken);

  bot.use(session({ defaultSession: (): SessionData => createDefaultSession() }));
  bot.use(whitelistMiddleware);

  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('login', handleLoginX);
  bot.command('cookies', handleCheckCookies);
  bot.command('session', handleCheckCookies);
  bot.command('accounts', handleListAccounts);
  bot.command('addaccount', handleAddAccount);

  // Scrape commands
  bot.command('adduser', handleAddUser);
  bot.command('listuser', handleListUsers);
  bot.command('scrape', handleScrape);
  bot.command('scrapeall', handleScrapeAll);
  bot.command('post', handlePostCommand);
  bot.command('captions', handleCaptionMenu);

  // Inline button callbacks for scrape previews (post, swap, manual, posted, skip)
  bot.action(/^(post|posted|skip|swap|manual):\d+$/, handleScrapePreviewCallback);

  bot.hears('📝 Buat Post', handleCreatePostStart);
  bot.hears('📋 Riwayat Post', handleHistory);
  bot.hears('📊 Status Sistem', handleSystemStatus);
  bot.hears('🔑 Login X', handleLoginX);
  bot.hears('🍪 Cek Cookies', handleCheckCookies);
  bot.hears(['❓ Bantuan', 'Bantuan'], handleHelp);

  // Account management
  bot.hears('👥 Akun X', handleAccountMenu);
  bot.hears('➕ Tambah Akun', handleAddAccount);
  bot.hears('📋 Daftar Akun', handleListAccounts);
  bot.hears('🗑 Hapus Akun', handleRemoveAccountStart);
  bot.hears('🍪 Set Cookie Akun', handleSetAccountCookies);

  // Scraper management
  bot.hears('🔍 Scraper', handleScraperMenu);
  bot.hears('🔎 Cek Login Scraper', handleCheckScraperSession);
  bot.hears('🔄 Scrape Semua Akun', handleScrapeAll);

  // Caption bank management
  bot.hears('🏷 Bank Caption', handleCaptionMenu);
  bot.hears('➕ Tambah Caption', handleAddCaption);
  bot.hears('📋 Daftar Caption', handleListCaptions);
  bot.hears('🗑 Hapus Caption', handleRemoveCaption);

  bot.hears('⬅️ Kembali', handleBackToMenu);

  bot.on('photo', async (ctx) => {
    if (await handlePhoto(ctx)) return;
  });

  bot.on('document', async (ctx) => {
    if (await handleDocument(ctx)) return;
  });

  bot.on('text', async (ctx) => {
    if (await handleCancelInFlow(ctx)) return;
    if (await handlePreviewAction(ctx)) return;
    if (await handleReplyText(ctx)) return;
    // Caption input handlers
    if (await handleCaptionTextInput(ctx)) return;
    if (await handleCaptionRemoveInput(ctx)) return;
    // Manual caption input for scraped posts
    if (await handleManualCaptionInput(ctx)) return;
    // Account flow handlers (must be last to not interfere)
    if (await handleAccountNameInput(ctx)) return;
    if (await handleRemoveAccountInput(ctx)) return;
    if (await handleAccountCookieSelect(ctx)) return;
    if (await handleAccountCookieInput(ctx)) return;
    // Scrape username input handler
    if (await handleScrapeUsernameInput(ctx)) return;
  });

  bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('⚠️ Terjadi kesalahan. Coba lagi atau ketik /start.').catch(() => {});
  });

  return bot;
}

export async function registerBotCommands(bot: Telegraf<AppContext>): Promise<void> {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Menu utama' },
    { command: 'help', description: 'Panduan & command lengkap' },
    { command: 'accounts', description: 'Daftar akun X' },
    { command: 'addaccount', description: 'Tambah akun X baru' },
    { command: 'login', description: 'Login ke akun X' },
    { command: 'cookies', description: 'Cek cookies & sesi X' },
    { command: 'adduser', description: 'Pantau akun X untuk scraping' },
    { command: 'listuser', description: 'Daftar akun yang dipantau' },
    { command: 'scrape', description: 'Ambil postingan terbaru' },
    { command: 'post', description: 'Lihat & post konten pending' },
    { command: 'captions', description: 'Kelola bank caption' },
  ]);
}
