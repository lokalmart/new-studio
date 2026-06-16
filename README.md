# Lokalmart New Studio v10.7 Repo Fix

Ini versi root-ready untuk repo `lokalmart/new-studio`.

## Masalah yang diperbaiki

- `index.html` kosong / tidak ada UI yang dibuild.
- `server.js` tidak ada, sehingga Vercel bisa membaca project sebagai Node app tanpa entrypoint.
- Build dibuat zero-install: tidak memakai Next.js/Vite/React dependency agar tidak tersangkut di `npm install`.
- API Odoo tetap tersedia di `/api/odoo.js` dan direwrite ke `/api/odoo`.
- UI static ada di `index.html` + `public/app.js` + `public/styles.css`.

## Fitur inti

- Koneksi Odoo JSON-RPC.
- Import XLSX per sheet atau semua sheet.
- Validasi data produk hasil barcode scanner: foto, harga, barcode/default code.
- Export multi-model menjadi multi-sheet XLSX.
- Bulk select: pilih yang tampil, pilih semua dimuat, bersihkan tampil, bersihkan semua.
- Smart Bundle Export: Project, Contact, Product, Sales, Knowledge.

## Cara deploy Vercel

1. Hapus isi repo lama dulu.
2. Upload semua isi folder ini ke root repo.
3. Pastikan root repo berisi:

```text
package.json
vercel.json
server.js
index.html
api/odoo.js
public/app.js
public/styles.css
scripts/build.js
```

4. Di Vercel:
   - Framework Preset: Other
   - Root Directory: kosong/root
   - Install Command: dari `vercel.json`
   - Build Command: dari `vercel.json`
   - Output Directory: `dist`

5. Deploy ulang dengan Clear Build Cache.

## Tes cepat

- Buka `/` untuk UI.
- Buka `/api/odoo` untuk health check API.
