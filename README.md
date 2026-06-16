# New Studio v10.10 — Metadata Upsert Fix

Perbaikan khusus untuk import schema Odoo custom model/field.

## Perbaikan

- Koneksi Odoo bisa dibaca dari Vercel ENV: `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` atau `ODOO_API_KEY`.
- Import `__action=upsert` dan `__action=create_or_update` didukung.
- Upsert `ir.model` tidak lagi menulis field teknis `model` saat record sudah ada, karena Odoo melarang perubahan field Model.
- Upsert `ir.model.fields` memakai natural key `model_id + name` jika external ID belum ditemukan.
- Saat update `ir.model.fields`, field identitas teknis seperti `name`, `model_id`, `ttype`, `relation`, dan `state` tidak ditulis ulang.
- Error import tetap ditampilkan per row agar mudah dibaca.

## Cara deploy

1. Hapus isi repo lama atau replace seluruh root.
2. Upload isi ZIP ke root repo.
3. Pastikan root berisi `package.json`, `vercel.json`, `index.html`, `server.js`, `api/odoo.js`, `public/`, `scripts/`.
4. Deploy ulang di Vercel dengan Clear Build Cache.

## ENV Vercel

```text
ODOO_URL=https://namadb.odoo.com
ODOO_DB=nama_database
ODOO_USERNAME=email_admin
ODOO_PASSWORD=password_atau_api_key
```

`ODOO_API_KEY` juga bisa dipakai sebagai pengganti `ODOO_PASSWORD`.
