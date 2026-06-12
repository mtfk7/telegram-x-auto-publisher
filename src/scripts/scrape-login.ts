import { loginScraper } from '../services/scrape.service';

async function main(): Promise<void> {
  console.log('=== Login Scraper Browser ===\n');
  console.log('Browser akan terbuka ke x.com.');
  console.log('Login seperti biasa, lalu browser akan otomatis tertutup.\n');

  try {
    await loginScraper();
    console.log('\n✅ Session scraper tersimpan. Sekarang bisa scrape via Telegram.');
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
