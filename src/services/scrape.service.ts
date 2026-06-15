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
    if (!authPair) {
      logError('auth_token cookie not found in TWITTER_COOKIES', new Error(
        `Available cookies: ${cookiePairs.map((c) => c.split('=')[0]).join(', ')}`
      ));
    }

    // Use library's internal tough-cookie for reliable cookie parsing
    const toughCookiePath = require.resolve('tough-cookie', {
      paths: [require.resolve('@the-convocation/twitter-scraper')],
    });
    const { Cookie } = require(toughCookiePath);

    // Step 1: Make an unauthenticated request to get a FRESH ct0 from Twitter
    logDebug('Mengambil ct0 baru dari Twitter...');
    try {
      await scraper.getProfile('twitter').catch(() => null);
    } catch {
      // Expected to fail, we just need the fresh ct0 cookie from the response
    }

    // Step 2: Inject our auth_token (and optionally our ct0) into the cookie jar
    const cookiesToSet: any[] = [];
    if (authPair) {
      const authCookie = Cookie.parse(`${authPair}; Domain=x.com; Path=/`);
      if (authCookie) cookiesToSet.push(authCookie);
    }

    for (const cookie of cookiesToSet) {
      if (cookie.domain && cookie.domain.startsWith('.')) {
        cookie.domain = cookie.domain.substring(1);
        cookie.hostOnly = false;
      }
    }
    await scraper.setCookies(cookiesToSet);

    // Verify cookies
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
