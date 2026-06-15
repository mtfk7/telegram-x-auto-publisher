import { chromium, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { resolveBrowserLaunch } from '../utils/browser';
import { log, logError, logDebug } from '../utils/logger';
import { getActiveAccounts, updateAccount, Account } from '../database/sqlite';

export class BrowserServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NO_SESSION'
      | 'SESSION_EXPIRED'
      | 'RATE_LIMITED'
      | 'UPLOAD'
      | 'TWEET'
      | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'BrowserServiceError';
  }
}

export interface PublishResult {
  tweetUrl: string;
}

export interface AccountPublishResult {
  accountName: string;
  xUsername?: string;
  success: boolean;
  tweetUrl?: string;
  error?: string;
}

export type SessionStatus = 'active' | 'expired' | 'missing';

export interface SessionInfo {
  status: SessionStatus;
  profileExists: boolean;
  loggedIn: boolean;
  username?: string;
  profileUrl?: string;
  cookieCount: number;
  xCookieCount: number;
  hasAuthToken: boolean;
  hasCt0: boolean;
  profilePath: string;
  cookiesUpdatedAt?: string;
  message: string;
}

let loginInProgress = false;
let publishInProgress = false;

function ensureDataDir(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

function getCookiesFilePath(profileDir: string): string | undefined {
  const candidates = [
    path.join(profileDir, 'Default', 'Network', 'Cookies'),
    path.join(profileDir, 'Default', 'Cookies'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function getCookiesUpdatedAt(profileDir: string): string | undefined {
  const cookiesFile = getCookiesFilePath(profileDir);
  if (!cookiesFile) return undefined;
  return fs.statSync(cookiesFile).mtime.toLocaleString('id-ID');
}

export function hasSession(profileDir: string): boolean {
  return fs.existsSync(profileDir);
}

async function launchContext(headless: boolean, profileDir: string, cookies?: string): Promise<BrowserContext> {
  ensureDataDir();
  fs.mkdirSync(profileDir, { recursive: true });

  const launch = resolveBrowserLaunch(config.browser);

  const context = await chromium.launchPersistentContext(profileDir, {
    ...launch,
    headless,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Inject X.com cookies if provided
  if (cookies) {
    const parsedCookies = cookies
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((pair) => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('=') };
      })
      .filter((c) => c.name && c.value);

    if (parsedCookies.length > 0) {
      const playwrightCookies = parsedCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: '.x.com',
        path: '/',
        secure: true,
        httpOnly: c.name === 'auth_token',
        sameSite: 'Lax' as const,
      }));

      await context.addCookies(playwrightCookies);
      logDebug(`Injected ${playwrightCookies.length} cookies into browser context`);
    }
  }

  return context;
}

async function getCleanPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  logDebug(`Membersihkan ${pages.length} tab yang terbuka...`);
  const newPage = await context.newPage();
  for (const page of pages) {
    await page.close().catch(() => null);
  }
  return newPage;
}

async function isRateLimited(page: Page): Promise<boolean> {
  const body = await page.locator('body').innerText().catch(() => '');
  const lower = body.toLowerCase();
  return (
    lower.includes('temporarily limited') ||
    lower.includes('try again later') ||
    lower.includes('unusual login activity')
  );
}

async function getLoggedInUser(page: Page): Promise<{
  username?: string;
  profileUrl?: string;
}> {
  const profileLink = page.locator('[data-testid="AppTabBar_Profile_Link"]').first();
  const href = await profileLink.getAttribute('href', { timeout: 5000 }).catch(() => null);
  if (!href || href === '/home') return {};
  const username = href.replace(/^\//, '').split('/')[0];
  return {
    username: username ? `@${username}` : undefined,
    profileUrl: `https://x.com${href}`,
  };
}

async function isLoggedIn(page: Page): Promise<boolean> {
  logDebug('Memeriksa status login X...');
  try {
    await page.goto('https://x.com/home', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch(err => logDebug(`Navigation warning: ${err.message}`));

    logDebug('Menunggu elemen UI X muncul...');
    await Promise.race([
      page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="AppTabBar_Profile_Link"]', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="loginButton"]', { timeout: 15000 }).catch(() => null)
    ]);

    const url = page.url();
    logDebug(`URL saat ini: ${url}`);

    if (url.includes('/login') || url.includes('/flow/login')) {
      log('User diarahkan ke halaman login, sesi tidak aktif', 'INFO');
      return false;
    }

    const hasTweetButton = await page.locator('[data-testid="SideNav_NewTweet_Button"]').count() > 0;
    const hasProfileLink = await page.locator('[data-testid="AppTabBar_Profile_Link"]').count() > 0;
    const loggedIn = hasTweetButton || hasProfileLink;

    logDebug(`Status login: ${loggedIn ? 'AKTIF' : 'TIDAK AKTIF'} (TweetBtn: ${hasTweetButton}, Profile: ${hasProfileLink})`);

    if (!loggedIn && url.includes('/home')) {
      logDebug('Mencoba menutup modal yang mungkin menghalangi...');
      await page.keyboard.press('Escape').catch(() => null);
      await page.waitForTimeout(1000);
      return await page.locator('[data-testid="SideNav_NewTweet_Button"]').count() > 0;
    }

    return loggedIn;
  } catch (error) {
    logError('Gagal memeriksa status login', error);
    return false;
  }
}

export async function getSessionInfo(profileDir: string): Promise<SessionInfo> {
  const profileExists = hasSession(profileDir);
  const cookiesUpdatedAt = getCookiesUpdatedAt(profileDir);

  if (!profileExists) {
    logDebug('Info sesi diminta: Profil tidak ditemukan');
    return {
      status: 'missing',
      profileExists: false,
      loggedIn: false,
      cookieCount: 0,
      xCookieCount: 0,
      hasAuthToken: false,
      hasCt0: false,
      profilePath: profileDir,
      message: 'Profil browser belum ada. Tambah akun dulu via menu Akun X.',
    };
  }

  logDebug('Info sesi diminta: Mengecek status login...');
  const context = await launchContext(true, profileDir);
  const page = await getCleanPage(context);

  try {
    const cookies = await context.cookies();
    const xCookies = cookies.filter(
      (c) => c.domain.includes('x.com') || c.domain.includes('twitter.com')
    );
    const hasAuthToken = xCookies.some((c) => c.name === 'auth_token');
    const hasCt0 = xCookies.some((c) => c.name === 'ct0');

    const loggedIn = await isLoggedIn(page);
    const user = loggedIn ? await getLoggedInUser(page) : {};

    let status: SessionStatus;
    let message: string;

    if (loggedIn && hasAuthToken && hasCt0) {
      status = 'active';
      message = `Sesi aktif sebagai ${user.username ?? 'akun X'}.`;
    } else if (hasAuthToken || hasCt0) {
      status = 'expired';
      message = 'Cookies ada tapi sesi sudah tidak valid. Login ulang diperlukan.';
    } else {
      status = 'expired';
      message = 'Cookies X tidak ditemukan. Login ulang diperlukan.';
    }

    logDebug(`Status sesi: ${status} (${message})`);

    return {
      status,
      profileExists,
      loggedIn,
      username: user.username,
      profileUrl: user.profileUrl,
      cookieCount: cookies.length,
      xCookieCount: xCookies.length,
      hasAuthToken,
      hasCt0,
      profilePath: profileDir,
      cookiesUpdatedAt,
      message,
    };
  } catch (error) {
    logError('Gagal mendapatkan info sesi', error);
    throw error;
  } finally {
    await context.close();
  }
}

export async function loginToX(profileDir: string): Promise<{ username?: string }> {
  if (loginInProgress) {
    throw new BrowserServiceError('Login sedang berjalan.', 'UNKNOWN');
  }

  loginInProgress = true;
  const context = await launchContext(false, profileDir);
  const page = await getCleanPage(context);

  try {
    await page.goto('https://x.com', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    if (await isRateLimited(page)) {
      throw new BrowserServiceError(
        'X membatasi login sementara.\n\n' +
          'Tips:\n' +
          '• Tunggu 15–30 menit lalu coba lagi\n' +
          '• Pastikan BROWSER_TYPE=brave di .env\n' +
          '• Login lewat Brave biasa dulu di komputer yang sama\n' +
          '• Matikan VPN jika aktif\n',
        'RATE_LIMITED'
      );
    }

    const alreadyLoggedIn = await page
      .locator('[data-testid="SideNav_NewTweet_Button"]')
      .count()
      .then((n) => n > 0)
      .catch(() => false);

    if (!alreadyLoggedIn) {
      console.log('Silakan klik "Sign in" di pojok kanan atas, lalu login seperti biasa.');
      console.log('Jangan tutup browser sampai login berhasil.\n');
    }

    await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', {
      timeout: 300000,
    });

    // Get the logged in username
    const user = await getLoggedInUser(page);
    return { username: user.username };
  } catch (error) {
    if (error instanceof BrowserServiceError) throw error;

    if (await isRateLimited(page).catch(() => false)) {
      throw new BrowserServiceError(
        'X membatasi login sementara. Tunggu 15–30 menit, lalu coba lagi.',
        'RATE_LIMITED'
      );
    }

    throw new BrowserServiceError(
      'Login gagal atau waktu habis. Tutup browser dan coba lagi.',
      'UNKNOWN'
    );
  } finally {
    await context.close();
    loginInProgress = false;
  }
}

export async function checkSessionValid(profileDir: string): Promise<boolean> {
  const info = await getSessionInfo(profileDir);
  return info.status === 'active';
}

function extractStatusUrl(page: Page): Promise<string> {
  const current = page.url();
  if (/\/status\/\d+/.test(current)) return Promise.resolve(current);

  return (async () => {
    const statusLink = page.locator('a[href*="/status/"]').first();
    const href = await statusLink.getAttribute('href', { timeout: 10000 }).catch(() => null);
    if (href) {
      return href.startsWith('http') ? href : `https://x.com${href}`;
    }
    throw new BrowserServiceError('Gagal mendapatkan URL tweet.', 'TWEET');
  })();
}

async function postPhotoTweet(page: Page, photoPath: string, caption: string): Promise<string> {
  logDebug('Membuka halaman home X...');

  if (!fs.existsSync(photoPath)) {
    logError(`File foto tidak ditemukan: ${photoPath}`);
    throw new Error('File foto tidak ditemukan di sistem.');
  }

  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);

  logDebug('Menunggu kotak tweet muncul...');
  await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 15000 });
  await page.click('[data-testid="tweetTextarea_0"]');
  await page.waitForTimeout(1000);

  // Upload photo FIRST
  logDebug('Menunggu input file...');
  await page.waitForSelector('[data-testid="fileInput"]', { state: 'attached', timeout: 15000 }).catch(() => null);

  logDebug('Mengunggah foto...');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null),
    (async () => {
      const fileInput = page.locator('[data-testid="fileInput"]').first();
      await fileInput.setInputFiles(path.resolve(photoPath)).catch(() => null);
    })()
  ]);

  if (fileChooser) {
    logDebug('Menggunakan fileChooser untuk upload...');
    await fileChooser.setFiles(path.resolve(photoPath));
  }

  logDebug('Menunggu preview foto...');
  try {
    await page.waitForSelector('[data-testid="attachmentItem"]', { timeout: 15000 });
  } catch {
    logDebug('attachmentItem tidak ditemukan, coba selector alternatif...');
    const hasImage = await page.locator('[data-testid="attachments"] img, [data-testid="removeMedia"]').count() > 0;
    if (!hasImage) {
      logDebug('Mencoba metode upload via tombol media...');
      const mediaButton = page.locator('[data-testid="fileInput"]');
      if (await mediaButton.count() > 0) {
        await mediaButton.first().setInputFiles(path.resolve(photoPath));
        await page.waitForSelector('[data-testid="attachmentItem"], [data-testid="attachments"] img', { timeout: 15000 });
      } else {
        throw new Error('Foto gagal diupload - preview tidak muncul.');
      }
    } else {
      logDebug('Preview foto terdeteksi via selector alternatif');
    }
  }

  logDebug('Preview foto muncul, sekarang ketik caption...');
  await page.waitForTimeout(1000);

  if (caption && caption.trim()) {
    logDebug('Mengetik caption tweet...');
    await page.locator('[data-testid="tweetTextarea_0"]').first().click().catch(() => null);
    await page.waitForTimeout(300);
    await page.keyboard.type(caption, { delay: 30 });
    await page.waitForTimeout(500);
  }

  logDebug('Menunggu tombol Post aktif...');
  const postButtonSelector = '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';
  await page.waitForSelector(`${postButtonSelector}:not([disabled])`, { state: 'visible', timeout: 15000 });

  const tweetButton = page.locator(postButtonSelector).last();

  logDebug('Mengeksekusi posting...');
  for (let i = 0; i < 15; i++) {
    const isDialogVisible = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
    const isInlineVisible = await page.locator('[data-testid="tweetButtonInline"]').isVisible().catch(() => false);

    if (!isDialogVisible && !isInlineVisible && i > 1) {
      log('✅ Deteksi: Kotak posting sudah tertutup. Berhasil!', 'INFO');
      break;
    }

    const audiencePopup = page.locator('text=Pilih audiens, text=Semua orang').first();
    if (await audiencePopup.isVisible().catch(() => false)) {
      logDebug('Pop-up audiens terdeteksi, memilih "Semua orang"...');
      await audiencePopup.click({ force: true }).catch(() => null);
      await page.waitForTimeout(1000);
    }

    if (await tweetButton.isVisible().catch(() => false)) {
      logDebug('Mengklik tombol Post (force)...');
      await tweetButton.click({ force: true }).catch(() => null);
    }

    if (i % 2 === 0) {
      logDebug('Mengirim shortcut Ctrl+Enter...');
      await page.keyboard.press('Control+Enter').catch(() => null);
    }

    await page.waitForTimeout(2000);
  }

  logDebug('Mencari URL tweet baru...');
  return extractStatusUrl(page);
}

export async function publishPhotoWithCaption(
  photoPath: string,
  caption: string,
  profileDir: string,
  accountCookies?: string | null
): Promise<PublishResult> {
  log(`Memulai proses posting: ${path.basename(photoPath)}`, 'INFO');

  // Allow posting if profile exists OR if cookies are provided
  const profileExists = hasSession(profileDir);
  const hasCookies = !!accountCookies;

  if (!profileExists && !hasCookies) {
    log('Gagal posting: Sesi X belum ada', 'ERROR');
    throw new BrowserServiceError(
      'Sesi X belum ada. Login dulu atau set cookie akun.',
      'NO_SESSION'
    );
  }

  if (publishInProgress) {
    log('Gagal posting: Ada proses lain yang sedang berjalan', 'INFO');
    throw new BrowserServiceError('Posting lain sedang berjalan.', 'UNKNOWN');
  }

  publishInProgress = true;
  logDebug(`Membuka browser (headless: ${config.browser.headless})`);
  let context: BrowserContext | null = null;

  try {
    context = await launchContext(config.browser.headless, profileDir, accountCookies || undefined);
    const page = await getCleanPage(context);

    // Login check with 60s timeout to prevent Telegraf's 90s timeout from hijacking
    const loggedIn = await Promise.race([
      isLoggedIn(page),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new BrowserServiceError('Timeout saat mengecek login.', 'SESSION_EXPIRED')), 60000)
      ),
    ]);

    if (!loggedIn) {
      log('Gagal posting: Sesi X expired atau tidak valid', 'ERROR');
      throw new BrowserServiceError(
        'Sesi X sudah expired. Update cookie akun.',
        'SESSION_EXPIRED'
      );
    }

    log('Mengupload foto dengan caption...', 'INFO');
    let tweetUrl: string;
    try {
      tweetUrl = await postPhotoTweet(page, photoPath, caption);
      log(`Tweet berhasil diposting: ${tweetUrl}`, 'INFO');
    } catch (error) {
      logError('Gagal mengupload foto', error);
      throw new BrowserServiceError('Upload media gagal.', 'UPLOAD');
    }

    log('Proses posting selesai dengan sukses', 'INFO');
    return { tweetUrl };
  } catch (error) {
    if (!(error instanceof BrowserServiceError)) {
      logError('Terjadi kesalahan tidak terduga saat posting', error);
    }
    throw error;
  } finally {
    if (context) {
      await context.close().catch(() => null);
    }
    publishInProgress = false;
    logDebug('Browser ditutup');
  }
}

/**
 * Publish photo+caption to ALL active accounts sequentially.
 */
export async function publishToAllAccounts(
  photoPath: string,
  caption: string
): Promise<AccountPublishResult[]> {
  const accounts = getActiveAccounts();

  if (accounts.length === 0) {
    return [{
      accountName: '-',
      success: false,
      error: 'Tidak ada akun aktif. Tambah akun dulu via menu Akun X.',
    }];
  }

  const results: AccountPublishResult[] = [];
  const [delayMin, delayMax] = config.postDelayMinutes;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    log(`── Posting ke akun: ${account.name} (${account.x_username ?? 'belum dikenal'}) ──`, 'INFO');
    try {
      const result = await publishPhotoWithCaption(photoPath, caption, account.profile_dir, account.twitter_cookies);
      results.push({
        accountName: account.name,
        xUsername: account.x_username ?? undefined,
        success: true,
        tweetUrl: result.tweetUrl,
      });
      log(`✅ Akun ${account.name}: Berhasil → ${result.tweetUrl}`, 'INFO');
    } catch (error) {
      const errMsg = error instanceof BrowserServiceError
        ? error.message
        : (error as Error).message;

      // Auto-expire account if session is expired
      if (error instanceof BrowserServiceError && error.code === 'SESSION_EXPIRED') {
        updateAccount(account.id, { status: 'expired' });
      }

      results.push({
        accountName: account.name,
        xUsername: account.x_username ?? undefined,
        success: false,
        error: errMsg,
      });
      log(`❌ Akun ${account.name}: GAGAL → ${errMsg}`, 'ERROR');
    }

    // Random delay between accounts (skip after last account)
    if (i < accounts.length - 1) {
      const delayMinutes = delayMin + Math.random() * (delayMax - delayMin);
      const delayMs = Math.round(delayMinutes * 60 * 1000);
      log(`Menunggu ${delayMinutes.toFixed(1)} menit sebelum posting ke akun berikutnya...`, 'INFO');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
