# Studio2 v10.3 — Vercel Vite Build Fix

Versi ini mengganti shell Next.js menjadi Vite + React supaya build Vercel tidak menggantung di `Creating an optimized production build`.

Fitur tetap mengikuti v10.2:

- Mobile-first Command Studio UI.
- Import XLSX → review/editor → import batch kecil ke Odoo.
- Export single model.
- Smart Bundle Export: Project, Contact, Product, Sales, Knowledge.
- API Odoo tetap di `/api/odoo` sebagai Vercel Serverless Function.

## Deploy di Vercel

Gunakan setting berikut:

- Framework Preset: **Vite**
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`
- Root Directory: root repo

Pastikan struktur root repo:

```text
package.json
index.html
vite.config.mjs
api/odoo.js
src/
public/
vercel.json
```

## Kenapa v10.3 dibuat?

v10.2 memakai Next.js. Pada beberapa deploy, proses build berhenti lama di tahap optimized production build. v10.3 memindahkan UI menjadi Vite static SPA sehingga build jauh lebih ringan. XLSX library juga tidak dibundel saat build; SheetJS dimuat di browser saat admin upload/download XLSX.

## Catatan

Kalau UI tidak bisa membaca XLSX, pastikan browser punya akses internet ke CDN SheetJS.
