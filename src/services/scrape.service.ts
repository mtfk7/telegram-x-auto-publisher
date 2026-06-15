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
 */
async function createScraper(): Promise<Scraper> {
  const scraper = new Scraper();

  if (config.twitterCookies) {
    // Extract cookie pairs
    const cookiePairs = config.twitterCookies
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean);

    const authPair = cookiePairs.find((p) => p.toLowerCase().startsWith('auth_token='));
    const ct0Pair = cookiePairs.find((p) => p.toLowerCase().startsWith('ct0='));

    if (!authPair) {
      logError('auth_token cookie not found in TWITTER_COOKIES', new Error(
        `Available cookies: ${cookiePairs.map((c) => c.split('=')[0]).join(', ')}`
      ));
    }

    // Directly inject cookies into the library's internal auth cookie jar
    // This bypasses setCookies() which creates a new auth and skips guest token activation
    const auth = (scraper as any).auth;
    if (!auth || !auth.cookieJar) {
      logError('Cannot access library auth instance', new Error('scraper.auth not available'));
    }

    const cookieJar = auth.cookieJar();
    const cookieUrl = 'https://x.com';

    // Set ct0 cookie (CSRF token)
    if (ct0Pair) {
      const ct0Value = ct0Pair.split('=')[1];
      await cookieJar.setCookie(
        `ct0=${ct0Value}; Domain=x.com; Path=/; Secure; SameSite=Lax`,
        cookieUrl
      );
      logDebug(`ct0 injected: ${ct0Value.slice(0, 8)}...`);
    }

    // Set auth_token cookie
    if (authPair) {
      const authTokenValue = authPair.split('=')[1];
      await cookieJar.setCookie(
        `auth_token=${authTokenValue}; Domain=x.com; Path=/; Secure`,
        cookieUrl
      );
      logDebug(`auth_token injected: ${authTokenValue.slice(0, 8)}...`);
    }

    // Verify cookies via getCookies
    const verifyCookies = await scraper.getCookies();
    const ct0 = verifyCookies.find((c: any) => c.key === 'ct0');
    const authToken = verifyCookies.find((c: any) => c.key === 'auth_token');
    logDebug(`Cookie check - ct0: ${ct0 ? 'YES' : 'NO'}, auth_token: ${authToken ? 'YES' : 'NO'}`);
    logDebug('Cookie Twitter diterapkan untuk scraping');
  } else {
    logDebug('TWITTER_COOKIES tidak diatur, scraping tanpa autentikasi');
  }

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
  return !!config.twitterCookies;
}
