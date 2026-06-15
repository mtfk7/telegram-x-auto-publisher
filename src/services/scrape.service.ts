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
 * Create a Scraper instance with login-based authentication.
 * Saves and reuses session cookies to avoid repeated logins.
 */
async function createScraper(): Promise<Scraper> {
  const scraper = new Scraper();
  const { username, password, email } = config.twitter;

  if (!username || !password) {
    logDebug('TWITTER_USERNAME/PASSWORD tidak diatur, scraping tanpa autentikasi');
    return scraper;
  }

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
      logDebug('Saved session expired, re-logging in...');
    } catch (err) {
      logDebug(`Failed to load saved cookies: ${err}`);
    }
  }

  // Step 2: Login with credentials
  logDebug(`Logging in as @${username}...`);
  try {
    await scraper.login(username, password, email || undefined);
  } catch (err) {
    logError('Twitter login failed', err);
    throw new Error(`Login Twitter gagal: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  const loggedIn = await scraper.isLoggedIn();
  if (!loggedIn) {
    throw new Error('Login Twitter berhasil tapi session tidak valid');
  }

  logDebug('Login berhasil!');
  await saveCookies(scraper);
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
 * Check if Twitter credentials are configured for scraping.
 */
export function hasScraperSession(): boolean {
  return !!config.twitter.username && !!config.twitter.password;
}
