import { getSessionInfo } from '../services/browser.service';
import { getAllAccounts } from '../database/sqlite';

async function main(): Promise<void> {
  console.log('Mengecek cookies & sesi X (Multi-Account)...\n');

  const accounts = getAllAccounts();

  if (accounts.length === 0) {
    console.log('Belum ada akun terdaftar. Tambah akun via menu Akun X.');
    process.exit(0);
  }

  for (const account of accounts) {
    console.log(`\n=== Akun: ${account.name} (${account.x_username ?? 'belum login'}) ===`);
    console.log(`Profile dir: ${account.profile_dir}\n`);

    try {
      const info = await getSessionInfo(account.profile_dir);

      console.log(`Status       : ${info.status}`);
      console.log(`Login        : ${info.loggedIn ? 'Ya' : 'Tidak'}`);
      if (info.username) console.log(`Akun         : ${info.username}`);
      if (info.profileUrl) console.log(`Profil       : ${info.profileUrl}`);
      console.log(`Total cookies: ${info.cookieCount}`);
      console.log(`X cookies    : ${info.xCookieCount}`);
      console.log(`auth_token   : ${info.hasAuthToken ? 'Ada' : 'Tidak ada'}`);
      console.log(`ct0          : ${info.hasCt0 ? 'Ada' : 'Tidak ada'}`);
      if (info.cookiesUpdatedAt) {
        console.log(`Terakhir update: ${info.cookiesUpdatedAt}`);
      }
      console.log(`\n${info.message}`);
    } catch (err) {
      console.error(`Gagal mengecek akun ${account.name}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
