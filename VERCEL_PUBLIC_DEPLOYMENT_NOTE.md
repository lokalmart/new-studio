# Vercel Deployment Note

Agar Studio tidak meminta credential Odoo di browser, isi Environment Variables:

- `ODOO_URL`
- `ODOO_DB`
- `ODOO_USERNAME`
- `ODOO_PASSWORD` atau `ODOO_API_KEY`

Setelah menambah ENV, lakukan **Redeploy**. Environment Variable Vercel baru tidak selalu masuk ke deployment lama sebelum redeploy.

Jika Vercel masih memakai file lama, gunakan **Redeploy → Clear Build Cache**.
