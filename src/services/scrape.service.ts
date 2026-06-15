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
    // Parse cookies from "key=value; key=value" format into full Set-Cookie strings
    const cookiePairs = config.twitterCookies
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean);

    // Use library's internal tough-cookie for reliable cookie parsing
    const toughCookiePath = require.resolve('tough-cookie', {
      paths: [require.resolve('@the-convocation/twitter-scraper')],
    });
    const { Cookie } = require(toughCookiePath);

    const cookies = cookiePairs
      .map((pair) => {
        const parsed = Cookie.parse(`${pair}; Domain=x.com; Path=/`);
        return parsed;
      })
      .filter(Boolean);

    logDebug(`Parsed ${cookies.length} cookies: ${cookies.map((c: any) => c.key).join(', ')}`);

    await scraper.setCookies(cookies);

    // Verify cookies are set correctly
    const verifyCookies = await scraper.getCookies();
    const ct0 = verifyCookies.find((c: any) => c.key === 'ct0');
    logDebug(`CSRF cookie (ct0) in jar: ${ct0 ? 'YES' : 'NO'}`);

    if (!ct0) {
      logError('ct0 cookie not found in cookie jar after setCookies', new Error(
        `Available cookies: ${verifyCookies.map((c: any) => c.key).join(', ')}`
      ));
    }

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
