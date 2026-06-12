import fs from 'fs';
import os from 'os';
import path from 'path';

export type BrowserType = 'brave' | 'chrome' | 'chromium';

export interface BrowserLaunchConfig {
  type: BrowserType;
  executable?: string;
  channel?: string;
}

const BRAVE_PATHS = [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  path.join(
    os.homedir(),
    'AppData',
    'Local',
    'BraveSoftware',
    'Brave-Browser',
    'Application',
    'brave.exe'
  ),
];

function findBraveExecutable(): string | undefined {
  return BRAVE_PATHS.find((p) => fs.existsSync(p));
}

export function resolveBrowserLaunch(
  config: BrowserLaunchConfig
): { executablePath?: string; channel?: 'chrome' } {
  if (config.executable) {
    if (!fs.existsSync(config.executable)) {
      throw new Error(`Browser tidak ditemukan: ${config.executable}`);
    }
    return { executablePath: config.executable };
  }

  if (config.type === 'brave') {
    const brave = findBraveExecutable();
    if (!brave) {
      throw new Error(
        'Brave tidak ditemukan. Install Brave atau set BROWSER_EXECUTABLE di .env'
      );
    }
    return { executablePath: brave };
  }

  if (config.type === 'chrome') {
    return { channel: 'chrome' };
  }

  return {};
}

export function getBrowserLabel(config: BrowserLaunchConfig): string {
  if (config.executable) return path.basename(config.executable);
  if (config.type === 'brave') return 'Brave';
  if (config.type === 'chrome') return 'Chrome';
  return 'Chromium (bundled)';
}
