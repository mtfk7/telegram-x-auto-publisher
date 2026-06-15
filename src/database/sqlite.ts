import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config, getAccountProfileDir } from '../config';

export type PostStatus = 'pending' | 'processing' | 'published' | 'failed';

export interface Post {
  id: number;
  telegram_id: number;
  username: string | null;
  reply_text: string;
  tweet_url: string | null;
  reply_tweet_url: string | null;
  status: PostStatus;
  error_message: string | null;
  created_at: string;
}

export type AccountStatus = 'inactive' | 'active' | 'expired';

export interface Account {
  id: number;
  name: string;
  x_username: string | null;
  profile_dir: string;
  twitter_cookies: string | null;
  status: AccountStatus;
  created_at: string;
}

function initDb(): DatabaseSync {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      username TEXT,
      reply_text TEXT NOT NULL,
      tweet_url TEXT,
      reply_tweet_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      x_username TEXT,
      profile_dir TEXT NOT NULL,
      twitter_cookies TEXT,
      status TEXT NOT NULL DEFAULT 'inactive',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add twitter_cookies column if missing (for existing DBs)
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN twitter_cookies TEXT`);
  } catch {
    // Column already exists, ignore
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_scraped_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scraped_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watched_user_id INTEGER NOT NULL,
      source_username TEXT NOT NULL,
      source_url TEXT NOT NULL UNIQUE,
      caption TEXT,
      image_url TEXT,
      post_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      posted_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (watched_user_id) REFERENCES watched_users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS captions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add caption_id to scraped_posts if missing
  try {
    db.exec(`ALTER TABLE scraped_posts ADD COLUMN caption_id INTEGER`);
  } catch {
    // Column already exists, ignore
  }

  return db;
}

const db = initDb();

export function createPost(
  telegramId: number,
  username: string | undefined,
  replyText: string
): Post {
  const result = db
    .prepare(
      `INSERT INTO posts (telegram_id, username, reply_text, status)
       VALUES (?, ?, ?, 'pending')`
    )
    .run(telegramId, username ?? null, replyText);

  return getPostById(Number(result.lastInsertRowid))!;
}

export function getPostById(id: number): Post | undefined {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as Post | undefined;
}

export function updatePost(
  id: number,
  data: Partial<
    Pick<Post, 'status' | 'tweet_url' | 'reply_tweet_url' | 'error_message'>
  >
): void {
  const fields: string[] = [];
  const values: SQLInputValue[] = [];

  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  if (data.tweet_url !== undefined) {
    fields.push('tweet_url = ?');
    values.push(data.tweet_url);
  }
  if (data.reply_tweet_url !== undefined) {
    fields.push('reply_tweet_url = ?');
    values.push(data.reply_tweet_url);
  }
  if (data.error_message !== undefined) {
    fields.push('error_message = ?');
    values.push(data.error_message);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getRecentPosts(telegramId: number, limit = 10): Post[] {
  return db
    .prepare(
      `SELECT * FROM posts WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(telegramId, limit) as unknown as Post[];
}

// ── Account CRUD ──

export function createAccount(name: string): Account {
  const profileDir = getAccountProfileDir(name);
  const result = db
    .prepare(
      `INSERT INTO accounts (name, profile_dir, status) VALUES (?, ?, 'inactive')`
    )
    .run(name, profileDir);
  return getAccountById(Number(result.lastInsertRowid))!;
}

export function getAccountById(id: number): Account | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
}

export function getAccountByName(name: string): Account | undefined {
  return db.prepare('SELECT * FROM accounts WHERE name = ?').get(name) as Account | undefined;
}

export function getAllAccounts(): Account[] {
  return db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() as unknown as Account[];
}

export function getActiveAccounts(): Account[] {
  return db
    .prepare(`SELECT * FROM accounts WHERE status = 'active' ORDER BY created_at ASC`)
    .all() as unknown as Account[];
}

export function updateAccount(
  id: number,
  data: Partial<Pick<Account, 'status' | 'x_username' | 'twitter_cookies'>>
): void {
  const fields: string[] = [];
  const values: SQLInputValue[] = [];

  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  if (data.x_username !== undefined) {
    fields.push('x_username = ?');
    values.push(data.x_username);
  }
  if (data.twitter_cookies !== undefined) {
    fields.push('twitter_cookies = ?');
    values.push(data.twitter_cookies);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteAccount(id: number): void {
  const account = getAccountById(id);
  if (account && fs.existsSync(account.profile_dir)) {
    fs.rmSync(account.profile_dir, { recursive: true, force: true });
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

// ── Watched Users CRUD ──

export interface WatchedUser {
  id: number;
  username: string;
  added_at: string;
  last_scraped_at: string | null;
}

export type ScrapedPostStatus = 'pending' | 'posted' | 'skipped';

export interface ScrapedPostRecord {
  id: number;
  watched_user_id: number;
  source_username: string;
  source_url: string;
  caption: string | null;
  image_url: string | null;
  post_date: string | null;
  status: ScrapedPostStatus;
  posted_url: string | null;
  caption_id: number | null;
  created_at: string;
}

export function addWatchedUser(username: string): WatchedUser {
  const clean = username.replace(/^@/, '').toLowerCase();
  const existing = getWatchedUserByName(clean);
  if (existing) return existing;

  const result = db
    .prepare('INSERT INTO watched_users (username) VALUES (?)')
    .run(clean);
  return getWatchedUserById(Number(result.lastInsertRowid))!;
}

function getWatchedUserById(id: number): WatchedUser | undefined {
  return db.prepare('SELECT * FROM watched_users WHERE id = ?').get(id) as WatchedUser | undefined;
}

export function getWatchedUserByName(username: string): WatchedUser | undefined {
  const clean = username.replace(/^@/, '').toLowerCase();
  return db.prepare('SELECT * FROM watched_users WHERE username = ?').get(clean) as WatchedUser | undefined;
}

export function getWatchedUsers(): WatchedUser[] {
  return db.prepare('SELECT * FROM watched_users ORDER BY added_at ASC').all() as unknown as WatchedUser[];
}

export function removeWatchedUser(username: string): boolean {
  const clean = username.replace(/^@/, '').toLowerCase();
  const result = db.prepare('DELETE FROM watched_users WHERE username = ?').run(clean);
  return (result.changes ?? 0) > 0;
}

export function updateLastScraped(id: number): void {
  db.prepare(`UPDATE watched_users SET last_scraped_at = datetime('now') WHERE id = ?`).run(id);
}

// ── Scraped Posts CRUD ──

export function createScrapedPost(data: {
  watchedUserId: number;
  sourceUsername: string;
  sourceUrl: string;
  caption?: string;
  imageUrl?: string;
  postDate?: string;
}): ScrapedPostRecord | null {
  // Skip duplicates based on source_url
  const existing = db
    .prepare('SELECT id FROM scraped_posts WHERE source_url = ?')
    .get(data.sourceUrl) as { id: number } | undefined;
  if (existing) return null;

  const result = db
    .prepare(
      `INSERT INTO scraped_posts (watched_user_id, source_username, source_url, caption, image_url, post_date, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      data.watchedUserId,
      data.sourceUsername,
      data.sourceUrl,
      data.caption ?? null,
      data.imageUrl ?? null,
      data.postDate ?? null
    );
  return getScrapedPostById(Number(result.lastInsertRowid))!;
}

export function getScrapedPostById(id: number): ScrapedPostRecord | undefined {
  return db.prepare('SELECT * FROM scraped_posts WHERE id = ?').get(id) as ScrapedPostRecord | undefined;
}

export function getScrapedPostsByStatus(status: ScrapedPostStatus): ScrapedPostRecord[] {
  return db
    .prepare('SELECT * FROM scraped_posts WHERE status = ? ORDER BY created_at DESC')
    .all(status) as unknown as ScrapedPostRecord[];
}

export function updateScrapedPost(
  id: number,
  data: Partial<Pick<ScrapedPostRecord, 'status' | 'posted_url' | 'caption' | 'caption_id'>>
): void {
  const fields: string[] = [];
  const values: SQLInputValue[] = [];

  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  if (data.posted_url !== undefined) {
    fields.push('posted_url = ?');
    values.push(data.posted_url);
  }
  if (data.caption !== undefined) {
    fields.push('caption = ?');
    values.push(data.caption);
  }
  if (data.caption_id !== undefined) {
    fields.push('caption_id = ?');
    values.push(data.caption_id);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE scraped_posts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getPendingPostsCount(): number {
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM scraped_posts WHERE status = 'pending'`)
    .get() as { count: number };
  return row.count;
}

// ── Caption Bank CRUD ──

export interface CaptionRecord {
  id: number;
  text: string;
  used: number;
  created_at: string;
}

export function addCaption(text: string): CaptionRecord {
  const result = db
    .prepare('INSERT INTO captions (text, used) VALUES (?, 0)')
    .run(text);
  return getCaptionById(Number(result.lastInsertRowid))!;
}

export function getCaptionById(id: number): CaptionRecord | undefined {
  return db.prepare('SELECT * FROM captions WHERE id = ?').get(id) as CaptionRecord | undefined;
}

export function getCaptions(): CaptionRecord[] {
  return db.prepare('SELECT * FROM captions ORDER BY created_at ASC').all() as unknown as CaptionRecord[];
}

export function deleteCaption(id: number): boolean {
  const result = db.prepare('DELETE FROM captions WHERE id = ?').run(id);
  return (result.changes ?? 0) > 0;
}

/**
 * Get a random unused caption. If all are used, reset all to unused first.
 */
export function getRandomUnusedCaption(): CaptionRecord | null {
  let unused = db
    .prepare('SELECT * FROM captions WHERE used = 0 ORDER BY RANDOM() LIMIT 1')
    .get() as CaptionRecord | undefined;

  if (!unused) {
    // All used - reset all to unused
    const total = db.prepare('SELECT COUNT(*) as count FROM captions').get() as { count: number };
    if (total.count === 0) return null;

    db.prepare('UPDATE captions SET used = 0').run();

    unused = db
      .prepare('SELECT * FROM captions WHERE used = 0 ORDER BY RANDOM() LIMIT 1')
      .get() as CaptionRecord | undefined;
  }

  return unused ?? null;
}

/**
 * Get a random unused caption, excluding a specific caption ID.
 */
export function getRandomUnusedCaptionExcluding(excludeId: number): CaptionRecord | null {
  let unused = db
    .prepare('SELECT * FROM captions WHERE used = 0 AND id != ? ORDER BY RANDOM() LIMIT 1')
    .get(excludeId) as CaptionRecord | undefined;

  if (!unused) {
    // Try any unused excluding the current one
    unused = db
      .prepare('SELECT * FROM captions WHERE used = 0 AND id != ? ORDER BY RANDOM() LIMIT 1')
      .get(excludeId) as CaptionRecord | undefined;

    if (!unused) {
      // All used except this one - reset all, then pick excluding current
      db.prepare('UPDATE captions SET used = 0 WHERE id != ?').run(excludeId);
      unused = db
        .prepare('SELECT * FROM captions WHERE used = 0 AND id != ? ORDER BY RANDOM() LIMIT 1')
        .get(excludeId) as CaptionRecord | undefined;
    }
  }

  return unused ?? null;
}

export function markCaptionUsed(id: number): void {
  db.prepare('UPDATE captions SET used = 1 WHERE id = ?').run(id);
}

export function getUnusedCaptionCount(): number {
  const row = db
    .prepare('SELECT COUNT(*) as count FROM captions WHERE used = 0')
    .get() as { count: number };
  return row.count;
}

export function getCaptionCount(): number {
  const row = db
    .prepare('SELECT COUNT(*) as count FROM captions')
    .get() as { count: number };
  return row.count;
}
