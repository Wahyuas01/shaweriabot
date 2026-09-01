# Shaweria UCP Bot — Versi Vercel (Webhook, Tanpa VPS)

Bot ini TIDAK nyala 24/7 seperti bot Discord biasa. Discord akan mengirim
HTTP request ke satu URL setiap ada yang pakai `/daftar`, `/akun`, atau
`/gantipassword` — Vercel yang menjalankan kode sesaat, lalu "tidur" lagi.
Gratis, tidak perlu VPS.

## ⚠️ WAJIB DICEK DULU: Database harus bisa diakses dari internet

Vercel menjalankan function ini dari server Vercel sendiri, **bukan** dari
dalam jaringan Optiklink. Kalau MySQL kamu cuma bisa diakses lewat
`localhost` di dalam container Optiklink, bot Vercel ini **tidak akan
bisa konek** ke database yang sama dengan gamemode.

Solusi kalau begitu — pindahkan database ke layanan MySQL yang bisa
diakses publik dan gratis, misalnya:
- **Aiven** (free tier MySQL, ada trial)
- **Railway** (MySQL plugin, free credit)
- **FreeSQLDatabase.com** / **db4free.net** (gratis tapi kecil, cocok untuk testing)
- **PlanetScale** (MySQL-compatible, ada free tier — cek dulu masih tersedia atau tidak)

Lalu **gamemode SA-MP** (`sw_config.inc`) DAN **bot Vercel** ini sama-sama
diarahkan ke host database yang sama itu.

## 1. Setup Discord Developer Portal

1. Buka https://discord.com/developers/applications → pilih aplikasi bot kamu (atau buat baru)
2. Catat **Application ID** dan **Public Key** dari halaman "General Information"
3. Di tab **Bot**, catat/reset **Token** (dipakai sekali saja untuk daftarin command, lihat langkah 3)

## 2. Deploy ke Vercel

1. Push folder `discord-bot-vercel/` ini ke repo GitHub
2. Buka https://vercel.com → Import Project → pilih repo tersebut
3. Di **Project Settings > Environment Variables**, isi semua variabel dari `.env.example`:
   `DISCORD_PUBLIC_KEY`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`
   (`DISCORD_APP_ID` dan `DISCORD_TOKEN` tidak wajib di Vercel, hanya dipakai lokal di langkah 3)
4. Deploy. Setelah selesai, kamu dapat URL seperti `https://shaweria-ucp.vercel.app`

## 3. Daftarkan slash command (sekali saja, dari komputer lokal)

```bash
cd discord-bot-vercel
npm install
cp .env.example .env
# isi DISCORD_APP_ID dan DISCORD_TOKEN di .env lokal
npm run register-commands
```

## 4. Sambungkan Discord ke URL Vercel

1. Kembali ke Discord Developer Portal → General Information
2. Isi **"Interactions Endpoint URL"** dengan: `https://<domain-vercel-kamu>/api/interactions`
3. Discord otomatis kirim test PING ke situ — kalau muncul centang hijau/tersimpan, berarti verifikasi signature berhasil dan endpoint aktif
4. Kalau gagal tersimpan (error merah), cek:
   - `DISCORD_PUBLIC_KEY` di Vercel sudah benar dan sama persis dengan Developer Portal
   - Deployment Vercel sudah live (bukan masih build/error)

## 5. Tes

Di server Discord komunitas, coba `/daftar nama_ic:John_Doe password:test123456`,
lalu cek tabel `users` di database — harus muncul baris baru. Lanjut coba login
in-game pakai nama & password itu di server SA-MP.

## Struktur

```
discord-bot-vercel/
├── api/
│   └── interactions.js     # serverless function utama (endpoint webhook)
├── register-commands.js    # script one-off daftarkan slash command
├── package.json
└── .env.example
```
