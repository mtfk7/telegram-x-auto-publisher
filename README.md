# Telegram X Auto Publisher

Posting ke X (Twitter) via Telegram Bot + browser automation. Tanpa X API — cukup login sekali, sesi tersimpan otomatis.

## Arsitektur

```
Telegram Bot (Telegraf)
        ↓
   Node.js
        ↓
   Playwright (browser automation)
        ↓
   X.com
```

**Database:** SQLite (riwayat posting)

## Fitur

- **Login X** — Login manual sekali, sesi disimpan di `data/x-session.json`
- **Buat Post** — Foto + teks reply → 2 tweet (foto + reply)
- **Riwayat Post** — 10 posting terakhir
- **Status Sistem** — Cek apakah sesi masih aktif

## Prasyarat

- Node.js 18+
- Telegram Bot Token ([@BotFather](https://t.me/BotFather))
- Komputer/server tempat bot berjalan (browser dibuka di sini)

## Setup

### 1. Install

```bash
npm install
npm run browser:install
```

### 2. Konfigurasi

```bash
cp .env.example .env
```

| Variable | Keterangan |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token dari BotFather |
| `ALLOWED_TELEGRAM_IDS` | Telegram User ID Anda |
| `BROWSER_TYPE` | `brave` (default), `chrome`, atau `chromium` |
| `BROWSER_EXECUTABLE` | Path manual jika browser tidak terdeteksi |
| `BROWSER_HEADLESS` | `false` saat login, `true` saat posting |

Cari Telegram User ID: [@userinfobot](https://t.me/userinfobot)

### 3. Login ke X (sekali saja)

**Via CLI:**
```bash
# Di .env: BROWSER_CHANNEL=chrome, BROWSER_HEADLESS=false
npm run login:clear   # hapus profil lama jika pernah gagal
npm run login
```

**Via Telegram Bot:**
- Jalankan bot → pilih **Login X**
- Login manual di browser yang muncul
- Sesi tersimpan otomatis

### 4. Jalankan bot

```bash
# Set BROWSER_HEADLESS=true di .env untuk posting otomatis
npm run dev
```

## Alur Penggunaan

1. **Login X** (sekali) → sesi tersimpan
2. **Buat Post** → kirim foto → kirim teks reply
3. Konfirmasi **YA** → browser otomatis posting
4. Bot kirim link tweet

**Hasil di X:**
```
Tweet 1: [Foto]
Tweet 2: [Teks reply]
```

## Struktur File

```
data/
  posts.db          # Riwayat posting (SQLite)
  x-session.json    # Sesi login X (cookies)
temp/               # Foto sementara dari Telegram
```

## Scripts

| Command | Keterangan |
|---|---|
| `npm run dev` | Jalankan bot (development) |
| `npm run login` | Login X via CLI |
| `npm run browser:install` | Install Chromium untuk Playwright |
| `npm run build` | Compile TypeScript |
| `npm start` | Jalankan production |

## Troubleshooting Login

**"We've temporarily limited your login"**

X mendeteksi login otomatis. Lakukan ini:

1. Pastikan Brave (atau Chrome) terinstall di komputer
2. Set di `.env`: `BROWSER_TYPE=brave` dan `BROWSER_HEADLESS=false`
3. Hapus profil lama: `npm run login:clear`
4. Tunggu **15–30 menit** (jangan spam coba login)
5. Jalankan `npm run login` — browser buka ke **x.com**, klik **Sign in** manual
6. Matikan VPN jika aktif

## Catatan

- Login harus dilakukan di mesin yang sama dengan bot (browser dibuka lokal)
- Sesi disimpan di `data/browser-profile/` (profil browser asli)
- Jika sesi expired, pilih **Login X** lagi
- UI X.com bisa berubah — jika posting gagal, cek selector di `src/services/browser.service.ts`
