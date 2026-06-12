import path from 'path';
import { config, getAccountProfileDir } from '../config';
import { getBrowserLabel } from '../utils/browser';
import { loginToX, hasSession, BrowserServiceError } from '../services/browser.service';
import { getAllAccounts, createAccount, updateAccount } from '../database/sqlite';

async function main(): Promise<void> {
  const accountName = process.argv[2];

  console.log('=== Login X.com (Multi-Account) ===\n');
  console.log(`Browser : ${getBrowserLabel(config.browser)}`);
  console.log(`Profiles: ${config.profilesDir}\n`);

  if (!accountName) {
    const accounts = getAllAccounts();
    if (accounts.length === 0) {
      console.log('Belum ada akun. Gunakan:');
      console.log('  npm run login -- <nama_akun>');
      console.log('\nContoh: npm run login -- toko1');
      process.exit(0);
    }

    console.log('Akun yang tersedia:');
    for (const a of accounts) {
      console.log(`  ${a.status === 'active' ? '🟢' : '🔴'} ${a.name} (${a.x_username ?? 'belum login'})`);
    }
    console.log('\nGunakan: npm run login -- <nama_akun>');
    process.exit(0);
  }

  // Find or create account
  let account = getAllAccounts().find(a => a.name === accountName);
  if (!account) {
    console.log(`Akun "${accountName}" belum ada, membuat baru...`);
    account = createAccount(accountName);
  }

  const profileDir = account.profile_dir;
  console.log(`Login akun: ${account.name}`);
  console.log(`Profile   : ${profileDir}\n`);
  console.log('Browser akan terbuka ke x.com.');
  console.log('Klik "Sign in" di pojok kanan atas, lalu login seperti biasa.');
  console.log('Jangan tutup browser sampai muncul halaman utama X.\n');

  try {
    const result = await loginToX(profileDir);
    updateAccount(account.id, {
      status: 'active',
      x_username: result.username ?? account.x_username,
    });

    console.log(`\n✅ Login berhasil! Profil tersimpan di ${profileDir}`);
    if (result.username) console.log(`   Username: ${result.username}`);
    console.log('Sekarang set BROWSER_HEADLESS=true di .env lalu jalankan bot.');
  } catch (error) {
    if (error instanceof BrowserServiceError && error.code === 'RATE_LIMITED') {
      console.error('\n❌', error.message);
      console.error('\nJika masih gagal, hapus profil lalu coba lagi:');
      console.error(`  rmdir /s /q "${path.resolve(profileDir)}"`);
      process.exit(1);
    }
    throw error;
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
