# Studio3 v10.4 — Multi-model Bulk Export & Import All Sheets

Studio3 v10.4 memperbaiki kelemahan utama v10.2: export tidak lagi terkunci pada satu model saja. Admin sekarang bisa mencentang banyak model, scan record dari berbagai model, memilih record lintas model, lalu export menjadi XLSX multi-sheet.

## Yang baru

### 1. Multi-model Single Export

Di mode **Single Model**, card model seperti Contacts, Products, Projects, Tasks, Knowledge, Sales, Categories, dan Web Categories sekarang benar-benar berfungsi sebagai checklist.

Flow baru:

1. Buka Export.
2. Pilih **Single Model**.
3. Centang beberapa model.
4. Klik **Scan model dicentang** atau **Muat semua dicentang**.
5. Pilih record lintas model.
6. Klik Export record.
7. Hasil masuk ke Review Workspace sebagai banyak sheet, misalnya:
   - `res.partner`
   - `product.template`
   - `project.project`
   - `project.task`

### 2. Bulk select record

Record picker sekarang punya tombol cepat:

- **Pilih yang tampil**
- **Pilih semua dimuat**
- **Bersihkan tampil**
- **Bersihkan semua**
- Tombol per model, misalnya `Contacts 80/80`, `Products 30/80`

Ini menghilangkan kebutuhan mencentang satu per satu.

### 3. Muat semua model dicentang

Tombol **Muat semua dicentang** akan mengambil semua halaman record dari model yang dipilih secara bertahap. Untuk menjaga Vercel tetap aman, tiap model dibatasi maksimal 2000 record sekali jalan.

### 4. Import semua sheet

Review Workspace sekarang punya tombol **Import semua sheet**. Ini cocok untuk XLSX multi-sheet hasil export bundle atau hasil validasi dari aplikasi lain.

### 5. Smart Bundle tetap ada

Smart Bundle tetap tersedia untuk Project Bundle, Contact Bundle, Product Bundle, Sales Bundle, dan Knowledge Bundle. Smart Bundle tetap bekerja berdasarkan record utama, sementara Multi-model export dipakai untuk export lintas model bebas.

## Deploy ke Vercel

Pastikan struktur repo root seperti ini:

```text
/package.json
/next.config.mjs
/vercel.json
/src/app/page.tsx
/src/app/api/odoo/route.ts
/public/manifest.webmanifest
```

Di Vercel:

- Framework preset: Next.js
- Root Directory: kosong/default root repo
- Build Command: default
- Output Directory: default

## Catatan aman

- Untuk export besar, gunakan **Muat semua dicentang** bertahap dan jangan centang terlalu banyak model berat sekaligus.
- Hindari field HTML panjang, chatter, dan image base64 kecuali memang perlu.
- Foto produk dari barcode scanner lebih aman memakai URL/file reference dulu, bukan base64 besar.
