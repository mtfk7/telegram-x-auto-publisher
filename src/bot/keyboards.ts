import { Markup } from 'telegraf';

export const mainMenuKeyboard = Markup.keyboard([
  ['📝 Buat Post'],
  ['📋 Riwayat Post', '📊 Status Sistem'],
  ['👥 Akun X', '🔍 Scraper'],
  ['🏷 Bank Caption', '🍪 Cek Cookies'],
  ['❓ Bantuan'],
])
  .resize()
  .persistent();

export const previewKeyboard = Markup.keyboard([
  ['✅ YA - Publish'],
  ['📷 Edit Foto', '✏️ Edit Teks'],
  ['❌ Batal'],
])
  .resize()
  .persistent();

export const cancelKeyboard = Markup.keyboard([['❌ Batal']])
  .resize()
  .persistent();

export const accountMenuKeyboard = Markup.keyboard([
  ['➕ Tambah Akun'],
  ['📋 Daftar Akun', '🗑 Hapus Akun'],
  ['🍪 Set Cookie Akun'],
  ['⬅️ Kembali'],
])
  .resize()
  .persistent();

export const scraperMenuKeyboard = Markup.keyboard([
  ['🔎 Cek Login Scraper'],
  ['🔄 Scrape Semua Akun'],
  ['⬅️ Kembali'],
])
  .resize()
  .persistent();

export const captionMenuKeyboard = Markup.keyboard([
  ['➕ Tambah Caption'],
  ['📋 Daftar Caption', '🗑 Hapus Caption'],
  ['⬅️ Kembali'],
])
  .resize()
  .persistent();
