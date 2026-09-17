# Xyverse — Dashboard Admin

Panel React untuk mengelola konten website [xyverse-web](https://github.com/xykalnotkel/xyverse-web),
Studio AI (Groq), dan status deploy. **Seluruh backend berjalan sebagai Vercel
Function** — tidak butuh server VPS, tidak ada checkout lokal.

## Arsitektur

```
┌────────────────────────── Vercel (1 project) ──────────────────────────┐
│  /            → SPA React (build Vite, dist/)                          │
│  /push.html   → halaman status GitHub mandiri                          │
│  /api/*       → Function Node (api/all.js)                       │
│                ├─ /api/auth/*   login bcrypt + cookie HMAC + Turnstile │
│                ├─ /api/blog|proyek|berita  CRUD konten                 │
│                ├─ /api/ai/*     proksi Groq (ide/tulis/meta/perbaiki)  │
│                ├─ /api/kunci    buat/cabut kunci API (khusus sesi)     │
│                └─ /api/git/*    status & uji koneksi GitHub            │
└─────────────────────────────────────────────────────────────────────────┘
                         │  GitHub Contents API (commit per simpan)
                         ▼
              repo xyverse-web (src/content/*.md)
                         │  setiap commit
                         ▼
              Vercel auto-deploy situs → https://xyverse.my.id
```

Perbandingan dengan arsitektur lama (pre-Vercel):

| Lama (VPS)                                | Baru (serverless)                                   |
| ----------------------------------------- | --------------------------------------------------- |
| Express `app.listen` di server 24/7       | Vercel Function (cold start, bayar per pemakaian)   |
| CRUD menulis `.md` ke folder `../xyverse-web` lokal | CRUD via GitHub Contents API (1 simpan = 1 commit) |
| `git add/commit/push` via CLI + token sekali pakai dari browser | Token `GH_TOKEN` di env Vercel, tidak pernah lewat peramban |
| Deploy situs: push manual dari dashboard  | Otomatis — commit → Vercel redeploy situs ±30 detik |

## Struktur

```
api/all.js           Function Vercel — gerbang /api/* (rewrite, lihat vercel.json)
server/core.js       Router inti + daftar koleksi (dipakai dev lokal & Vercel)
server/http.js       Mini router + utilitas (tanpa framework)
server/auth.js       Login, cookie sesi HMAC, Turnstile, rate limit
server/kunci.js      Kunci API: hash SHA-256 di repo admin, batas laju
server/ai.js         Studio AI (Groq) — draf-penuh memakai pemanggilan internal
server/github.js     Klien GitHub API (Contents, commits, repo info)
server/index.js      Dev server lokal (port 4500)
src/                 SPA React (dasbor, editor, studio AI, panel deploy)
public/push.html     Halaman status GitHub mandiri
scripts/hash.js      Pembuat hash bcrypt
scripts/uji-api.mjs  Uji asap router inti (GitHub API dipalsukan) — `npm test`
```

## Kunci API — akses untuk agen AI

Seluruh `/api/*` bisa diakses tanpa login peramban, cukup header:

```bash
curl -H "Authorization: Bearer xya_..." https://admin.xyverse.my.id/api/stats
```

`X-Api-Key: xya_...` juga diterima dan setara.

**Bentuk kunci.** `xya_` + 40 karakter hex (160 bit entropi). Teks polosnya
hanya muncul sekali, pada respons pembuatan — yang disimpan server hanyalah
hash SHA-256-nya.

**Penyimpanan.** Hash disimpan sebagai JSON di repo `xyverse-admin`, bawaan
`.xyverse/api-keys.json` (ubah lewat `ADMIN_API_KEYS_PATH`). Repo dipakai
sebagai "database" karena backend ini serverless: tidak ada disk yang
bertahan antar-request, dan `GH_TOKEN` sudah tersedia. Berkasnya aman
di-commit karena tidak memuat teks polos.

**Membuat kunci.** Dari panel → **Kunci API** → isi label dan masa berlaku.
Atau lewat API, dari sesi peramban:

```bash
curl -b cookie.txt -X POST https://admin.xyverse.my.id/api/kunci \
  -H 'Content-Type: application/json' \
  -d '{"label":"Agen penerjemah","kedaluwarsaHari":30}'
```

| Rute | Hak |
|---|---|
| `GET /api/kunci` | daftar kunci (tanpa hash) |
| `POST /api/kunci` | buat kunci — `{ label, kedaluwarsaHari }` atau `{ label, kedaluwarsaPada }` |
| `DELETE /api/kunci/:id` | cabut kunci |

**Kunci bootstrap.** `ADMIN_API_KEY` di lingkungan Vercel juga diterima
sebagai kunci API, tanpa perlu dibuat lewat panel. Berguna untuk bootstrap
atau untuk lingkungan yang tidak mau menulis ke repo. Kunci ini tidak bisa
dicabut lewat API — matikan lewat dashboard Vercel.

**Yang sengaja dibatasi.** Kunci API **tidak bisa** membuat atau mencabut
kunci API (`403 BUTUH_SESI`). Kalau bisa, satu kunci yang bocor bisa menanam
kunci lain yang tidak pernah muncul di daftar. Pengelolaan kunci hanya lewat
sesi peramban.

**Batas laju.** 600 permintaan/menit per kunci, per instans Function.
Melebihi itu dibalas `429`.

**Hak kunci API** sama dengan sesi: buat/ubah/hapus blog, proyek, berita, dan
dokumen legal, di kedua bahasa. Contoh alur agen:

```bash
H='-H "Authorization: Bearer xya_..."'

# ambil artikel Indonesia
curl $H "https://admin.xyverse.my.id/api/blog/parsec-vs-rdp"

# simpan terjemahannya sebagai artikel Inggris
curl $H -X PUT "https://admin.xyverse.my.id/api/blog/parsec-vs-rdp?bahasa=en" \
  -H 'Content-Type: application/json' \
  -d '{"frontmatter":{"title":"Parsec vs RDP: Which Is Better?","desc":"...","date":"2026-09-17","kategori":"Technical","baca":5},"body":"..."}'
```

## Koleksi & bahasa

Empat koleksi, semuanya dua bahasa:

| Koleksi | Folder ID | Folder EN | Kolom frontmatter |
| ------- | --------- | --------- | ----------------- |
| `blog`   | `src/content/blog/`   | `src/content/blog/en/`   | title, desc, date, kategori, penulis, baca, unggulan, draft, lang |
| `proyek` | `src/content/proyek/` | `src/content/proyek/en/` | title, desc, date, klien, layanan, stack, status, unggulan, draft, lang |
| `berita` | `src/content/berita/` | `src/content/berita/en/` | title, desc, date, tag, draft, lang |
| `legal`  | `src/content/legal/`  | `src/content/legal/en/`  | title, desc, diperbarui, ringkas, lang |

Semua rute konten menerima `?bahasa=id|en` (bawaan `id`):

```
GET    /api/blog?bahasa=en          daftar terjemahan Inggris
GET    /api/blog/parsec-vs-rdp?bahasa=en
PUT    /api/blog/parsec-vs-rdp?bahasa=en
DELETE /api/blog/parsec-vs-rdp?bahasa=en
```

Dua aturan yang perlu diingat:

- **`lang` ditentukan oleh folder tujuan, bukan oleh isi form.** Ini sengaja:
  dulu `lang` tidak ada di whitelist field, sehingga menyimpan berkas `en/`
  dari dashboard menghapus `lang: "en"` dan halaman EN hilang dari situs.
- **Slug EN = slug ID.** Keduanya hidup di folder berbeda, jadi rename di
  salah satu bahasa tidak menyentuh bahasa lainnya.

`legal` tidak punya kolom `date` (skema situs memakai `diperbarui` berupa
teks), jadi daftarnya diurutkan menurut judul, bukan tanggal.

## Uji

```bash
npm test
```

Menjalankan `tanganiApi` (kode produksi yang sama dengan Vercel Function)
dengan `fetch` GitHub dipalsukan. Mengunci perilaku: `lang` tetap tertulis
untuk berkas `en/`, tanggal tersimpan `YYYY-MM-DD`, koleksi `legal` jalan,
bahasa tak dikenal ditolak 400, dan rename EN tidak menyentuh berkas ID.

## Pengembangan lokal

```bash
npm install
cp .env.example .env   # lalu isi GH_TOKEN, ADMIN_PASS_HASH, dll.
npm run hash -- "katasandiku"   # salin hasil ke ADMIN_PASS_HASH
npm run dev              # API :4500 + panel :4400 (Vite proxy /api)
npm test                 # uji asap router inti
```

Situsnya sendiri (untuk pratinjau langsung): `npm run dev` di folder
`xyverse-web` → http://localhost:4321. Tombol "Lihat di situs" di admin
menunjuk ke sana saat mode dev.

> Tanpa `GH_TOKEN`, API tetap berjalan dalam mode **baca saja** (repo publik
> bisa dibaca tanpa token, 60 request/jam per IP). Menyimpan konten butuh
> `GH_TOKEN`.

## Deploy ke Vercel

### 1. Situs (repo `xyverse-web`)

1. Vercel → **Add New Project** → import `xykalnotkel/xyverse-web`.
2. Framework terdeteksi otomatis **Astro** — biarkan default
   (build `astro build`, output `dist`).
3. Deploy. Lalu **Settings → Domains** → tambahkan `xyverse.my.id`
   (ikutkan DNS yang diberikan Vercel).

### 2. Admin (repo ini)

1. Vercel → **Add New Project** → import `xykalnotkel/xyverse-admin`.
2. Framework terdeteksi **Vite**; folder `api/` otomatis menjadi Function.
3. Isi **Environment Variables** (Production + Preview):

   | Variabel | Contoh / catatan |
   | -------- | ---------------- |
   | `GH_TOKEN` | PAT fine-grained, izin **Contents: Read and write** pada `xyverse-web` (+ `xyverse-admin`) |
   | `GH_OWNER` | `xykalnotkel` |
   | `GH_SITE_REPO` | `xyverse-web` |
   | `GH_ADMIN_REPO` | `xyverse-admin` |
   | `GH_BRANCH` | `main` |
   | `GROQ_API_KEY` | dari console.groq.com |
   | `GROQ_MODEL` | `openai/gpt-oss-20b` (default) |
   | `ADMIN_USER` | `admin` |
   | `ADMIN_PASS_HASH` | hasil `npm run hash -- "katasandi"` |
   | `SESSION_SECRET` | **wajib** — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_API_KEY` | opsional — kunci API bootstrap, `xya_` + 40 hex |
| `ADMIN_API_KEYS_PATH` | opsional — bawaan `.xyverse/api-keys.json` di repo admin |
   | `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | sangat disarankan untuk proteksi login |
   | `VITE_SITE_URL` | `https://xyverse.my.id` |
   | `VITE_SITE_LANG` | `id` |

4. Deploy → arahkan subdomain, mis. `admin.xyverse.my.id`.

### 3. Ujikan

- Buka panel → masuk.
- Ubah satu artikel blog → simpan.
- Cek tab **Deploy**: commit baru harus muncul di `xyverse-web`
  (pesan commit `Perbarui blog/… (via dashboard)`), dan situs ter-deploy
  ulang otomatis oleh Vercel dalam ±30 detik.

## Catatan operasional

- **Rate limit GitHub**: 5000 request/jam per token — jauh di atas kebutuhan
  normal dashboard. Ada cache baca 20 detik di API untuk mengurangi panggilan.
- **Konflik simpan**: bila dua editor menyimpan berkas yang sama, yang kedua
  mendapat pesan "Berkas sudah berubah di GitHub" — muat ulang lalu simpan lagi.
- **Timeout Function**: `maxDuration: 60` dtk (cukup untuk `draf-penuh` = 3
  tahap Groq). Bila plan Vercel mendukung, batas ini bisa dinaikkan.
- **Sesi**: cookie HMAC stateless (valid lintas instans serverless) selama
  `SESSION_SECRET` konsisten. Rate limit login per IP bekerja per instans —
  tetap efektif memperlambat, ditambah Turnstile sebagai lapis utama.
- **Konten terjemahan**: CRUD mengelola kedua bahasa. Pengalih ID/EN ada di
  bilah daftar; folder `en/` dibaca dan ditulis lewat `?bahasa=en`.
- **Uji sebelum merge**: `npm test`. Terhadap kode sebelum perbaikan `lang`,
  16 pemeriksaannya gagal — jadi uji ini memang menangkap regresi itu.
