# Lokalmart New Studio v11.2 — Schema Snapshot + Preflight Gate

Tujuan versi ini: menghentikan pola import XLSX dalam gelap.

## Workflow wajib

1. Upload XLSX dari ChatGPT / barcode / export Odoo.
2. Klik **Download Schema XLSX** atau **Download AI Context TXT**.
3. Berikan file/konteks itu ke ChatGPT sebelum minta dibuatkan XLSX baru.
4. Upload XLSX hasil ChatGPT.
5. Klik **Preflight Semua**.
6. Import hanya jika preflight error = 0.

## Catatan v11.2

- Schema snapshot sekarang mendukung **partial success**. Jika 1 model opsional gagal dibaca, export tetap berhasil dan detailnya masuk ke sheet `schema.errors`.
- Ini mencegah kasus: 19/20 model berhasil tetapi UI menampilkan `Schema snapshot gagal`.

## Fitur utama

- Mengambil schema real Odoo lewat `fields_get`.
- Export context AI berisi model, fields, required fields, relation fields, selection values, access rights, dan aturan import.
- Preflight server-side tanpa write ke Odoo.
- Cek model kosong, kolom tidak ada, field required, readonly, type angka/boolean/tanggal, selection invalid, external ID relasi, duplicate external ID, access rights, urutan metadata, dan aturan khusus `ir.model.fields`.
- Import batch kecil setelah preflight OK.
- Koneksi via Vercel ENV: `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` atau `ODOO_API_KEY`.

## Deploy Vercel

Pastikan root repo berisi:

- `index.html`
- `package.json`
- `vercel.json`
- `server.js`
- `api/odoo.js`
- `public/app.js`
- `public/styles.css`
- `scripts/build.js`

Lalu deploy ulang dengan Clear Build Cache.
