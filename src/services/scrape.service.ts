import { Scraper, Tweet } from '@the-convocation/twitter-scraper';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { log, logError, logDebug } from '../utils/logger';

export interface ScrapedPost {
  sourceUrl: string;
  caption: string;
  imageUrl: string;
  postDate: string;
}

let scrapeInProgress = false;

/**
 * Create a Scraper instance with cookie-based authentication.
 * Hardcodes ct0 + auth_token from env, injected directly into the auth cookie jar.
 */
async function createScraper(): Promise<Scraper> {
  const scraper = new Scraper();

  // Parse cookies from TWITTER_COOKIES env (format: ct0=VALUE; auth_token=VALUE)
  const cookiePairs = config.twitterCookies
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);

  const authPair = cookiePairs.find((p) => p.toLowerCase().startsWith('auth_token='));
  const ct0Pair = cookiePairs.find((p) => p.toLowerCase().startsWith('ct0='));

  if (!authPair || !ct0Pair) {
    logDebug('TWITTER_COOKIES must contain both ct0 and auth_token');
    return scraper;
  }

  const authValue = authPair.split('=')[1];
  const ct0Value = ct0Pair.split('=')[1];

  // Inject directly into the auth's cookie jar (preserves guest token)
  const auth = (scraper as any).auth;
  if (!auth || !auth.cookieJar) {
    throw new Error('Cannot access library auth instance');
  }

  const cookieJar = auth.cookieJar();
  const cookieUrl = 'https://x.com';

  await cookieJar.setCookie(
    `ct0=${ct0Value}; Domain=x.com; Path=/; Secure; SameSite=Lax`,
    cookieUrl
  );
  await cookieJar.setCookie(
    `auth_token=${authValue}; Domain=x.com; Path=/; Secure`,
    cookieUrl
  );

  // Verify
  const cookies = await scraper.getCookies();
  const ct0 = cookies.find((c: any) => c.key === 'ct0');
  const authTk = cookies.find((c: any) => c.key === 'auth_token');
  logDebug(`Cookie injected - ct0: ${ct0 ? 'YES' : 'NO'}, auth_token: ${authTk ? 'YES' : 'NO'}`);

  return scraper;
}

/**
 * Scrape recent photo posts from a given X username's timeline.
 * Uses @the-convocation/twitter-scraper (no browser needed).
 */
export async function scrapeUserPosts(
  username: string,
  maxTweets = 20
): Promise<ScrapedPost[]> {
  if (scrapeInProgress) {
    throw new Error('Scraping lain sedang berjalan. Tunggu sampai selesai.');
  }

  scrapeInProgress = true;
  const cleanUsername = username.replace(/^@/, '');
  log(`Memulai scraping @${cleanUsername}...`, 'INFO');

  const scraper = await createScraper();
  const posts: ScrapedPost[] = [];
  const seen = new Set<string>();

  try {
    logDebug(`Mengambil tweet dari @${cleanUsername} via API...`);

    const tweetIterator = scraper.getTweets(cleanUsername, maxTweets);

    for await (const tweet of tweetIterator) {
      try {
        // Skip tweets without photos
        if (!tweet.photos || tweet.photos.length === 0) continue;

        // Build source URL
        const sourceUrl =
          tweet.permanentUrl ||
          `https://x.com/${cleanUsername}/status/${tweet.id}`;

        // Skip duplicates
        if (seen.has(sourceUrl)) continue;
        seen.add(sourceUrl);

        // Get first photo URL
        const imageUrl = tweet.photos[0].url || '';
        if (!imageUrl) continue;

        // Get caption text
        const caption = tweet.text || '';

        // Get post date
        const postDate = tweet.timestamp
          ? new Date(tweet.timestamp * 1000).toISOString()
          : '';

        posts.push({
          sourceUrl,
          caption: caption.trim(),
          imageUrl,
          postDate,
        });

        logDebug(`Tweet ditemukan: ${sourceUrl} (${caption.slice(0, 50)}...)`);
      } catch (err) {
        logDebug(`Gagal proses tweet: ${err}`);
        continue;
      }
    }

    log(`Scraping @${cleanUsername}: ${posts.length} postingan foto ditemukan`, 'INFO');
    return posts;
  } catch (error) {
    logError(`Gagal scraping @${cleanUsername}`, error);
    throw new Error(
      `Gagal scraping @${cleanUsername}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    scrapeInProgress = false;
    logDebug('Scraping selesai');
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
 * Check if Twitter cookies are configured for scraping.
 */
export function hasScraperSession(): boolean {
  return config.twitterCookies.includes('auth_token=') && config.twitterCookies.includes('ct0=');
}
