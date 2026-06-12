import fs from 'fs';
import path from 'path';
import { config } from '../config';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function ensureTempDir(): void {
  if (!fs.existsSync(config.tempDir)) {
    fs.mkdirSync(config.tempDir, { recursive: true });
  }
}

export function isAllowedPhotoMime(mime?: string): boolean {
  return mime ? ALLOWED_MIME_TYPES.has(mime) : false;
}

export function getExtensionFromMime(mime: string): string {
  return MIME_TO_EXT[mime] || '.jpg';
}

export function isWithinSizeLimit(sizeBytes: number): boolean {
  const maxBytes = config.maxPhotoSizeMb * 1024 * 1024;
  return sizeBytes <= maxBytes;
}

export function buildTempPhotoPath(telegramId: number, ext: string): string {
  ensureTempDir();
  const filename = `${telegramId}_${Date.now()}${ext}`;
  return path.join(config.tempDir, filename);
}

export async function downloadTelegramFile(
  fileUrl: string,
  destPath: string
): Promise<void> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error('Gagal mengunduh foto dari Telegram.');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}
