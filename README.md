# New Studio v10.8 — Vercel ENV Connection + Import Diagnostics

Versi ini memperbaiki dua hal penting:

1. Koneksi Odoo bisa disimpan di **Vercel Environment Variables**, bukan diketik di browser.
2. Error import tidak lagi berhenti dengan pesan generik `API Odoo error`; Studio akan menampilkan row mana yang gagal dan alasan dari Odoo.

## Environment Variables Vercel

Tambahkan di Vercel → Project → Settings → Environment Variables:

```text
ODOO_URL=https://namadb.odoo.com
ODOO_DB=nama_database
ODOO_USERNAME=email_admin_odoo
ODOO_PASSWORD=password_atau_api_key
```

Alternatif untuk password:

```text
ODOO_API_KEY=api_key_odoo
```

Jika ENV lengkap, backend akan **memakai ENV sebagai source of truth** dan UI akan menampilkan `Env Vercel aktif`.

## Fallback browser

Jika ENV belum lengkap, UI tetap bisa memakai koneksi dari browser/localStorage. Ini hanya fallback untuk tes cepat.

## Import behavior

- `__action` yang didukung: `upsert`, `create_or_update`, `create`, `update`, `write`, `delete`, `unlink`, `skip`, `ignore`.
- Jika sebagian row gagal, import batch berikutnya tetap bisa lanjut.
- Error row ditampilkan di log agar mudah diperbaiki.

## Deploy

Framework Preset: `Other`
Output Directory: `dist`

Pastikan root repo berisi:

```text
package.json
vercel.json
server.js
index.html
api/odoo.js
public/
scripts/
```
