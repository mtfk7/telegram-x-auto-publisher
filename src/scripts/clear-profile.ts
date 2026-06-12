import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { getAllAccounts, deleteAccount } from '../database/sqlite';

const accountName = process.argv[2];

if (accountName) {
  // Clear specific account profile
  const account = getAllAccounts().find(a => a.name === accountName);
  if (!account) {
    console.log(`Akun "${accountName}" tidak ditemukan.`);
    process.exit(0);
  }

  const profileDir = path.resolve(account.profile_dir);
  if (!fs.existsSync(profileDir)) {
    console.log(`Profil akun "${accountName}" tidak ada, tidak perlu dihapus.`);
    process.exit(0);
  }

  deleteAccount(account.id);
  console.log(`✅ Profil dan data akun "${accountName}" dihapus.`);
  process.exit(0);
}

// Clear ALL profiles
const profilesDir = path.resolve(config.profilesDir);

if (!fs.existsSync(profilesDir)) {
  console.log('Tidak ada profil browser untuk dihapus.');
  process.exit(0);
}

const entries = fs.readdirSync(profilesDir);
if (entries.length === 0) {
  console.log('Folder profil kosong, tidak perlu dihapus.');
  process.exit(0);
}

for (const entry of entries) {
  const entryPath = path.join(profilesDir, entry);
  fs.rmSync(entryPath, { recursive: true, force: true });
  console.log(`✅ Profil dihapus: ${entry}`);
}

console.log(`\nSemua profil dihapus dari ${profilesDir}`);
console.log('Tambah akun baru via menu Akun X lalu login.');
