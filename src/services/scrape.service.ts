import { chromium, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { resolveBrowserLaunch } from '../utils/browser';
import { log, logError, logDebug } from '../utils/logger';

export interface ScrapedPost {
  sourceUrl: string;
  caption: string;
  imageUrl: string;
  postDate: string;
}

let scrapeInProgress = false;

/**
 * Dedicated browser profile for scraping (separate from publishing accounts).
 */
function getScraperProfileDir(): string {
  return path.join(config.profilesDir, '_scraper');
}

async function launchScraperContext(headless?: boolean): Promise<BrowserContext> {
  const profileDir = getScraperProfileDir();
  fs.mkdirSync(profileDir, { recursive: true });

  const launch = resolveBrowserLaunch(config.browser);

  return chromium.launchPersistentContext(profileDir, {
    ...launch,
    headless: headless ?? config.browser.headless,
    viewport: { width: 1366, height: 768 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
}

/**
 * Scroll down the page to load more tweets.
 */
async function scrollTimeline(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.evaluate('window.scrollBy(0, window.innerHeight)');
    await page.waitForTimeout(1500);
    logDebug(`Scroll ${i + 1}/${times} selesai`);
  }
}

/**
 * Extract tweets with images from the currently loaded timeline.
 */
async function extractTweetsWithImages(page: Page): Promise<ScrapedPost[]> {
  const posts: ScrapedPost[] = [];
  const seen = new Set<string>();

  // Get all tweet articles on the page
  const articles = page.locator('article[data-testid="tweet"]');
  const count = await articles.count();
  logDebug(`Ditemukan ${count} tweet di timeline`);

  for (let i = 0; i < count; i++) {
    try {
      const article = articles.nth(i);

      // Check if tweet has images (media preview with photos)
      const images = article.locator(
        'img[src*="pbs.twimg.com/media"], img[src*="pbs.twimg.com/tweet_video_thumb"]'
      );
      const imageCount = await images.count();
      if (imageCount === 0) continue;

      // Get the first/largest image URL
      let imageUrl = await images.first().getAttribute('src');
      if (!imageUrl) continue;

      // Upgrade to large quality
      if (imageUrl.includes('pbs.twimg.com/media')) {
        // Remove existing size params and add large
        imageUrl = imageUrl.replace(/\?format=.+$/, '');
        imageUrl = imageUrl.replace(/&name=\w+$/, '');
        if (!imageUrl.includes('?')) {
          imageUrl += '?format=jpg&name=large';
        }
      }

      // Get tweet URL from the timestamp link
      const timeLink = article.locator('a[href*="/status/"]').first();
      const href = await timeLink.getAttribute('href').catch(() => null);
      if (!href) continue;

      const sourceUrl = href.startsWith('http') ? href : `https://x.com${href}`;

      // Skip duplicates
      if (seen.has(sourceUrl)) continue;
      seen.add(sourceUrl);

      // Get tweet text/caption
      const textEl = article.locator('[data-testid="tweetText"]').first();
      const caption = await textEl.innerText().catch(() => '');

      // Get post date from <time> element
      const timeEl = article.locator('time').first();
      const datetime = await timeEl.getAttribute('datetime').catch(() => '');
      const postDate = datetime || '';

      posts.push({
        sourceUrl,
        caption: caption.trim(),
        imageUrl,
        postDate,
      });

      logDebug(`Tweet ditemukan: ${sourceUrl} (${caption.slice(0, 50)}...)`);
    } catch (err) {
      logDebug(`Gagal extract tweet #${i}: ${err}`);
      continue;
    }
  }

  return posts;
}

/**
 * Scrape recent photo posts from a given X username's timeline.
 */
export async function scrapeUserPosts(
  username: string,
  maxScrolls = 5
): Promise<ScrapedPost[]> {
  if (scrapeInProgress) {
    throw new Error('Scraping lain sedang berjalan. Tunggu sampai selesai.');
  }

  scrapeInProgress = true;
  const cleanUsername = username.replace(/^@/, '');
  log(`Memulai scraping @${cleanUsername}...`, 'INFO');

  const context = await launchScraperContext();
  const page = context.pages()[0] || (await context.newPage());

  try {
    // Navigate to user profile
    logDebug(`Navigasi ke https://x.com/${cleanUsername}`);
    await page.goto(`https://x.com/${cleanUsername}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for timeline to load
    logDebug('Menunggu timeline...');
    await page.waitForSelector('article[data-testid="tweet"]', {
      timeout: 20000,
    }).catch(() => null);

    await page.waitForTimeout(2000);

    // Scroll to load more tweets
    await scrollTimeline(page, maxScrolls);

    // Extract tweets with images
    const posts = await extractTweetsWithImages(page);

    log(`Scraping @${cleanUsername}: ${posts.length} postingan foto ditemukan`, 'INFO');
    return posts;
  } catch (error) {
    logError(`Gagal scraping @${cleanUsername}`, error);
    throw new Error(
      `Gagal scraping @${cleanUsername}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    await context.close();
    scrapeInProgress = false;
    logDebug('Browser scraper ditutup');
  }
}

/**
 * Download an image from URL to local file path.
 */
export async function downloadImage(imageUrl: string, destPath: string): Promise<void> {
  logDebug(`Mengunduh gambar: ${imageUrl}`);

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Gagal mengunduh gambar: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);

  logDebug(`Gambar disimpan: ${destPath} (${buffer.length} bytes)`);
}

/**
 * Check if the scraper profile exists (has a browser session).
 */
export function hasScraperSession(): boolean {
  return fs.existsSync(getScraperProfileDir());
}

/**
 * Get the scraper profile directory path.
 */
export function getScraperProfilePath(): string {
  return getScraperProfileDir();
}

/**
 * Launch scraper browser for manual login (interactive).
 */
export async function loginScraper(): Promise<void> {
  const context = await launchScraperContext(false); // always visible for login
  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto('https://x.com', { waitUntil: 'domcontentloaded' });
    console.log('Browser terbuka. Login ke X.com, lalu tutup browser.');
    console.log('Session scraper akan tersimpan untuk scraping selanjutnya.\n');

    // Wait for login to complete
    await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', {
      timeout: 300000,
    });

    console.log('✅ Login scraper berhasil!');
  } finally {
    await context.close();
  }
}
