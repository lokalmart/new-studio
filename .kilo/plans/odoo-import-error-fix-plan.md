# Rencana: Perbaikan Import Data Odoo pada Web App Vercel

## Tujuan

Membenahi web app Vercel agar import data ke Odoo tidak langsung error, tidak menulis data berbahaya tanpa validasi, dan menampilkan error per baris yang bisa diperbaiki user sebelum eksekusi.

Fokus utama adalah memperbaiki alur import XLSX/JSON yang saat ini berjalan dari UI browser ke `POST /api/odoo?action=import_batch`, lalu menulis langsung ke Odoo.

## Diagnosa Awal

Berdasarkan inspeksi kode di workspace saat ini:

- UI memanggil import langsung tanpa preview: `public/app.js:63`.
- API menjalankan `create`, `write`, atau `unlink` langsung di `handleImportBatch`: `api/odoo.js:667`.
- Field yang tidak dikenal atau readonly dilewati diam-diam di `buildVals`: `api/odoo.js:343`.
- Error ditangani per row, tetapi import tetap bisa sukses parsial: `api/odoo.js:737`.
- Delete/unlink masih bisa dieksekusi dari import biasa: `api/odoo.js:710`.
- Tidak ada validasi batch size, model berbahaya, field wajib, atau preview sebelum write.
- Vercel function timeout saat ini `60` detik di `vercel.json:14`, sehingga import besar dapat timeout.
- `GET /api/odoo` hanya menampilkan action lama dan belum ada preview/import plan action: `api/odoo.js:753`.

## Asumsi

- Import utama saat ini menggunakan file XLSX yang dibaca browser dengan SheetJS CDN.
- Target Odoo adalah Odoo Online atau Odoo self-hosted yang bisa diakses dari Vercel Function.
- Credential Odoo idealnya disimpan di Vercel Environment Variables, bukan browser.
- User ingin import data produk/contact/project/model custom tanpa error massal.

## Strategi Perbaikan

### 1. Reproduksi Error dan Klasifikasi Penyebab

Langkah:
1. Cek status koneksi dengan `GET /api/odoo`.
2. Jalankan `POST /api/odoo?action=test`.
3. Ambil schema model target dengan `POST /api/odoo?action=schema`.
4. Kirim sample kecil `import_batch` dari XLSX yang biasanya error.
5. Catat kategori error:
   - koneksi/env tidak lengkap,
   - model tidak ditemukan,
   - field tidak ditemukan,
   - field readonly/immutable,
   - external ID tidak valid,
   - relasi many2one/many2many gagal,
   - batch terlalu besar/timeout,
   - permission Odoo tidak cukup,
   - delete/unlink tidak diizinkan.

Output:
- Daftar error aktual sebelum implementasi.
- Satu sample payload minimal yang bisa dipakai untuk testing manual.

### 2. Stabilkan Koneksi dan Error API

File target:
- `api/odoo.js`
- `public/app.js`
- `README.md`

Langkah:
1. Pastikan `GET /api/odoo` menampilkan status ENV dan action yang benar.
2. Pastikan semua error dari Odoo JSON-RPC dibungkus dengan pesan yang jelas.
3. Tambahkan validasi koneksi di awal setiap action write.
4. Jika ENV tidak lengkap, UI harus tetap bisa fallback browser, tetapi dengan warning jelas.
5. Tambahkan daftar ENV wajib ke UI dan README:
   - `ODOO_URL`
   - `ODOO_DB`
   - `ODOO_USERNAME`
   - `ODOO_PASSWORD` atau `ODOO_API_KEY`

Acceptance criteria:
- `GET /api/odoo` menampilkan `env_configured` dan `env_missing` yang akurat.
- Error koneksi tidak menghasilkan response non-JSON.
- UI menampilkan mode koneksi aktif: Vercel ENV atau browser fallback.

### 3. Tambahkan Import Preview / Dry Run

File target:
- `api/odoo.js`
- `public/app.js`

Action baru yang disarankan:
- `import_preview`

Input:
```json
{
  "model": "product.template",
  "rows": [],
  "allow_delete": false,
  "max_rows": 200
}
```

Output:
```json
{
  "ok": true,
  "dry_run": true,
  "summary": {
    "total": 10,
    "will_create": 3,
    "will_update": 5,
    "will_skip": 1,
    "will_error": 1,
    "will_delete": 0
  },
  "results": [
    {
      "row": 2,
      "model": "product.template",
      "status": "warning",
      "operation": "update",
      "warnings": ["Field tidak dikenal: x_foto_url"],
      "errors": []
    }
  ]
}
```

Validasi yang wajib dilakukan:
1. `_model` tidak kosong.
2. Model ada di Odoo.
3. `_external_id`, `x_studio2_odoo_id`, `id`, atau natural key bisa menentukan record.
4. Field target ada di schema.
5. Field readonly/immutable tidak ditulis.
6. Relasi external ID bisa di-resolve.
7. Banyak2many external IDs bisa di-resolve.
8. `__action` valid.
9. `delete/unlink` diblokir kecuali `allow_delete: true`.
10. Model berbahaya wajib preview eksplisit:
    - `res.users`
    - `ir.model`
    - `ir.model.fields`
    - `ir.model.access`
    - `account.move`
    - `stock.move`
    - `payment.transaction`
11. Row kosong dilewati atau ditandai, bukan membuat record kosong.

Acceptance criteria:
- Import tidak boleh dieksekusi sebelum preview selesai.
- UI menampilkan jumlah create/update/skip/error.
- Row error punya nomor baris XLSX dan pesan yang bisa diperbaiki.

### 4. Ubah UI Import Menjadi Preview → Confirm → Apply

File target:
- `public/app.js`
- `public/styles.css` bila perlu

Alur UI baru:
1. Upload XLSX.
2. Pilih sheet/model.
3. Klik `Preview Import`.
4. Tampilkan ringkasan:
   - total row,
   - row akan dibuat,
   - row akan diupdate,
   - row akan dilewati,
   - row error.
5. Tampilkan tabel row bermasalah dengan:
   - nomor baris,
   - model,
   - action,
   - external ID,
   - field error,
   - saran perbaikan.
6. Tombol `Import Sheet Aktif` hanya aktif jika preview tidak punya error fatal.
7. Batch size default 10–20, maksimal 50.

Acceptance criteria:
- User tidak bisa import langsung tanpa preview.
- Error import tampil sebelum data masuk Odoo.
- UI tidak mengirim batch besar ke Vercel Function.

### 5. Perbaiki `handleImportBatch` Agar Lebih Aman

File target:
- `api/odoo.js`

Perbaikan yang disarankan:
1. Tambahkan limit default:
   - `limit` atau `max_rows`, misalnya 200.
2. Tambahkan `allow_delete: false` default.
3. Tambahkan `dry_run` agar bisa dipakai sebagai preview.
4. Tambahkan validasi `vals` kosong:
   - update tanpa field yang bisa ditulis dianggap skip/warning, bukan sukses.
   - create tanpa field wajib dianggap error.
5. Normalisasi action:
   - `upsert`, `create_or_update`, `insert_or_update` → create/update.
   - `update`, `write` → update only.
   - `create`, `new`, `insert` → create only.
   - `skip`, `ignore` → skip.
   - `delete`, `unlink` → hanya jika `allow_delete: true`.
6. Jangan gunakan `x_studio2_odoo_id` sebagai fallback utama jika `_external_id` ada dan tidak cocok.
7. Perbaiki warning unknown field agar masuk ke `results`.
8. Untuk `ir.model.fields`, jangan menulis ulang property teknis field yang sudah ada.
9. Untuk `ir.model.access`, jangan menulis ulang `name`, `model_id`, `group_id`.
10. Tambahkan `batch_id` atau `import_session_id` untuk tracking log sementara.

Acceptance criteria:
- Import kecil yang valid tetap berhasil.
- Row bermasalah tidak menghentikan seluruh batch.
- Row berbahaya tidak tertulis tanpa approval.
- Response import selalu punya `summary` dan `results`.

### 6. Perbaiki Timeout dan Batas Vercel

File target:
- `vercel.json`
- `api/odoo.js`
- `public/app.js`

Langkah:
1. Batasi import browser maksimal 200 row per sheet.
2. Gunakan batch kecil 10–20 row.
3. Jika tetap timeout, naikkan `maxDuration` sesuai plan Vercel yang dipakai.
4. Jika Vercel Function masih tidak stabil untuk import besar, tambahkan mode import bertahap dari UI.
5. Pastikan build cache dibersihkan saat deploy ulang.

Acceptance criteria:
- Import 20–50 row selesai tanpa timeout.
- Import besar dipecah menjadi beberapa batch kecil.
- UI memberi warning jika data terlalu besar.

### 7. Dokumentasi Import Aman

File target:
- `README.md`
- UI help text di `public/app.js`

Dokumentasi minimal:
1. Cara setup ENV Vercel.
2. Format kolom XLSX:
   - `_model`
   - `__action`
   - `_external_id`
   - `x_studio2_odoo_id`
   - field Odoo target
3. Aturan action:
   - `upsert`
   - `create_or_update`
   - `update`
   - `create`
   - `skip`
   - `delete/unlink` hanya dengan approval.
4. Contoh import aman untuk:
   - `product.template`
   - `res.partner`
   - `project.project`
   - `project.task`
5. Cara membaca error per row.
6. Cara deploy ulang:
   - clear build cache,
   - pastikan framework preset Other,
   - pastikan `/api/odoo` rewrite aktif.

Acceptance criteria:
- User non-teknis bisa memahami error import.
- Admin bisa memperbaiki XLSX sebelum import ulang.

## Testing Manual

### API

1. `GET /api/odoo`
   - Harapannya: `ok: true`, `connection.env_configured` akurat.

2. `POST /api/odoo?action=test`
   - Harapannya: login Odoo berhasil.

3. `POST /api/odoo?action=schema&model=product.template`
   - Harapannya: schema field valid.

4. `POST /api/odoo?action=import_preview` dengan sample valid.
   - Harapannya: preview menunjukkan create/update/skip.

5. `POST /api/odoo?action=import_preview` dengan field salah.
   - Harapannya: error per row, tidak menulis ke Odoo.

6. `POST /api/odoo?action=import_batch` setelah preview valid.
   - Harapannya: create/update berhasil dan response punya `summary`.

7. `POST /api/odoo?action=import_batch` dengan `__action=unlink`.
   - Harapannya: diblokir kecuali `allow_delete: true`.

### UI

1. Upload XLSX valid.
2. Klik preview import.
3. Pastikan tombol import aktif hanya jika tidak ada error fatal.
4. Import batch kecil.
5. Cek Odoo untuk memastikan record dibuat/update sesuai preview.
6. Upload XLSX dengan field salah.
7. Pastikan error tampil sebelum import.
8. Pastikan tidak ada data salah masuk Odoo.

## Kriteria Selesai

- Import tidak lagi langsung menulis tanpa preview.
- Error ditampilkan per baris sebelum eksekusi.
- Delete/unlink diblokir secara default.
- Field unknown/readonly tidak membuat error samar.
- Batch size dibatasi agar Vercel Function tidak timeout.
- ENV Vercel dan fallback browser jelas.
- Dokumentasi import aman tersedia.

## Pertanyaan yang Perlu Dikonfirmasi Sebelum Implementasi

1. Apakah import besar perlu tetap satu klik, atau boleh dipaksa menjadi preview + batch kecil?
2. Apakah `unlink/delete` benar-benar diperlukan, atau cukup `skip/archive/inactive`?
3. Model Odoo prioritas yang paling sering error saat ini apa: produk, contact, project/task, atau model custom?
4. Apakah deployment Vercel saat ini masih memakai workspace root ini, atau harus pindah ke branch/worktree lain?
5. Apakah user ingin AI bridge diaktifkan sekaligus, atau fokus dulu ke import biasa yang stabil?
