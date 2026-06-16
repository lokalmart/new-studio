# Hapus file lama sebelum deploy

Sebaiknya replace total isi repo agar tidak ada file lama yang bentrok.

Hapus jika ada:

- `next.config.mjs`
- `src/app/`
- `package-lock.json`
- `pnpm-lock.yaml`
- `dist/` hasil build lama

Root repo baru harus berisi file dari paket v10.8 ini.
