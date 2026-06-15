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
 * Save cookies to a JSON file for session reuse.
 */
async function saveCookies(scraper: Scraper): Promise<void> {
  try {
    const cookies = await scraper.getCookies();
    const serialized = cookies.map((c: any) => c.toJSON());
    fs.writeFileSync(config.twitterSessionFile, JSON.stringify(serialized, null, 2));
    logDebug(`Session cookies saved (${serialized.length} cookies)`);
  } catch (err) {
    logDebug(`Failed to save cookies: ${err}`);
  }
}

/**
 * Load cookies from a JSON file.
 */
function loadSavedCookies(): any[] | null {
  try {
    if (!fs.existsSync(config.twitterSessionFile)) return null;
    const raw = fs.readFileSync(config.twitterSessionFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    logDebug(`Loaded ${parsed.length} cookies from session file`);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Create a Scraper instance with cookie-based authentication.
 *
 * Flow:
 * 1. Try loading saved session from file (fast path)
 * 2. If no session: create guest auth, warmup to get fresh ct0, then inject auth_token
 *
 * The key insight: we MUST use the library's own ct0 (not browser's stale ct0)
 * because Twitter validates that x-csrf-token header matches the session's ct0.
 */
async function createScraper(): Promise<Scraper> {
  const scraper = new Scraper();
  const authToken = config.twitterCookies
    .split(';')
    .map((c) => c.trim())
    .find((p) => p.toLowerCase().startsWith('auth_token='));

  if (!authToken) {
    logDebug('auth_token not found in TWITTER_COOKIES, scraping tanpa autentikasi');
    return scraper;
  }

  const authTokenValue = authToken.split('=')[1];

  // Step 1: Try loading saved session cookies
  const savedCookies = loadSavedCookies();
  if (savedCookies) {
    try {
      await scraper.setCookies(savedCookies);
      const loggedIn = await scraper.isLoggedIn();
      if (loggedIn) {
        logDebug('Session cookies valid, skipping login');
        return scraper;
      }
      logDebug('Saved session expired, re-authenticating...');
    } catch (err) {
      logDebug(`Failed to load saved cookies: ${err}`);
    }
  }

  // Step 2: Warmup - make a guest request to get a fresh ct0 from Twitter
  // This triggers guest token activation and stores a fresh ct0 in the cookie jar
  logDebug('Warming up guest auth to get fresh ct0...');
  const auth = (scraper as any).auth;
  if (!auth || !auth.cookieJar) {
    throw new Error('Cannot access library auth instance');
  }

  try {
    await scraper.getProfile('twitter');
  } catch {
    // Expected to fail (unauthenticated), but the response sets cookies in the jar
  }

  // Step 3: Check that we got a fresh ct0
  const preCookies = await scraper.getCookies();
  const freshCt0 = preCookies.find((c: any) => c.key === 'ct0');
  if (!freshCt0) {
    logError('Failed to get fresh ct0 from guest auth', new Error('No ct0 cookie after warmup'));
  }
  logDebug(`Fresh ct0 obtained: ${freshCt0?.value?.slice(0, 12)}...`);

  // Step 4: Inject auth_token into the EXISTING auth's cookie jar
  // We do NOT call scraper.setCookies() because that creates a new auth (loses guest token)
  const cookieJar = auth.cookieJar();
  await cookieJar.setCookie(
    `auth_token=${authTokenValue}; Domain=x.com; Path=/; Secure`,
    'https://x.com'
  );
  logDebug(`auth_token injected: ${authTokenValue.slice(0, 8)}...`);

  // Step 5: Verify
  const finalCookies = await scraper.getCookies();
  const ct0 = finalCookies.find((c: any) => c.key === 'ct0');
  const authTk = finalCookies.find((c: any) => c.key === 'auth_token');
  logDebug(`Final cookie check - ct0: ${ct0 ? 'YES' : 'NO'}, auth_token: ${authTk ? 'YES' : 'NO'}`);

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
 * Check if Twitter auth_token is configured for scraping.
 */
export function hasScraperSession(): boolean {
  return config.twitterCookies.includes('auth_token=');
}
