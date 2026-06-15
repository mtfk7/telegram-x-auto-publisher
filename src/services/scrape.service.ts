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
 * 2. If no session: fetch fresh ct0 via direct HTTP, inject ct0 + auth_token into cookie jar
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

  // Step 2: Get fresh ct0 via direct HTTP request to Twitter API
  logDebug('Fetching fresh ct0 from Twitter...');
  const auth = (scraper as any).auth;
  if (!auth || !auth.cookieJar) {
    throw new Error('Cannot access library auth instance');
  }

  // Trigger guest token activation (needed for API requests)
  if (!auth.guestToken) {
    try {
      await auth.updateGuestToken();
    } catch (err) {
      logDebug(`Guest token update failed: ${err}`);
    }
  }
  logDebug(`Guest token: ${auth.guestToken ? auth.guestToken.slice(0, 8) + '...' : 'NONE'}`);

  // Make a direct request to get a fresh ct0 from Twitter's response
  const bearerToken = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const guestHeaders: Record<string, string> = {
    'authorization': `Bearer ${decodeURIComponent(bearerToken)}`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'x-guest-token': auth.guestToken || '',
    'content-type': 'application/json',
  };

  try {
    const res = await fetch('https://api.x.com/graphql/NimuplG1OB7Fd2btCLdBOw/UserByScreenName?variables=%7B%22screen_name%22%3A%22twitter%22%7D', {
      method: 'GET',
      headers: guestHeaders,
    });

    // Extract ct0 from response set-cookie header
    const setCookieHeaders = res.headers.getSetCookie?.() || [];
    let freshCt0 = '';

    for (const cookieStr of setCookieHeaders) {
      const match = cookieStr.match(/^ct0=([^;]+)/);
      if (match) {
        freshCt0 = match[1];
        break;
      }
    }

    if (!freshCt0) {
      // Try parsing from single set-cookie header
      const singleHeader = res.headers.get('set-cookie') || '';
      const ct0Match = singleHeader.match(/ct0=([^;]+)/);
      if (ct0Match) {
        freshCt0 = ct0Match[1];
      }
    }

    if (freshCt0) {
      logDebug(`Fresh ct0 from response: ${freshCt0.slice(0, 12)}...`);
    } else {
      logDebug('No ct0 in response headers, checking cookie jar...');
    }

    // Also try reading ct0 from the jar (library may have stored it)
    const jarCookies = await scraper.getCookies();
    const jarCt0 = jarCookies.find((c: any) => c.key === 'ct0');
    const ct0ToUse = freshCt0 || jarCt0?.value || '';

    if (!ct0ToUse) {
      throw new Error('Failed to obtain ct0 from Twitter');
    }

    logDebug(`Using ct0: ${ct0ToUse.slice(0, 12)}...`);

    // Step 3: Inject ct0 + auth_token into the auth's cookie jar
    const cookieJar = auth.cookieJar();
    const cookieUrl = 'https://x.com';

    await cookieJar.setCookie(
      `ct0=${ct0ToUse}; Domain=x.com; Path=/; Secure; SameSite=Lax`,
      cookieUrl
    );
    await cookieJar.setCookie(
      `auth_token=${authTokenValue}; Domain=x.com; Path=/; Secure`,
      cookieUrl
    );

    logDebug(`Injected ct0 + auth_token into cookie jar`);

    // Step 4: Verify
    const verifyCookies = await scraper.getCookies();
    const ct0 = verifyCookies.find((c: any) => c.key === 'ct0');
    const authTk = verifyCookies.find((c: any) => c.key === 'auth_token');
    logDebug(`Final check - ct0: ${ct0 ? 'YES' : 'NO'}, auth_token: ${authTk ? 'YES' : 'NO'}`);
  } catch (err) {
    logError('Failed to set up scraper auth', err);
    throw new Error(`Gagal menyiapkan scraper: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
 * Check if Twitter auth_token is configured for scraping.
 */
export function hasScraperSession(): boolean {
  return config.twitterCookies.includes('auth_token=');
}
