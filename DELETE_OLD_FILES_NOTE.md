# Delete old files note

Sebelum upload v10.7 ini, hapus file lama yang berpotensi membuat Vercel salah deteksi:

```text
next.config.mjs
src/
app/
package-lock.json
pnpm-lock.yaml
yarn.lock
node_modules/
```

Repo root harus langsung memuat `package.json`, `vercel.json`, `server.js`, `index.html`, `api/odoo.js`, `public/`, dan `scripts/`.
