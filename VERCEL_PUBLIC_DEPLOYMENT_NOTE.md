# Vercel Public Deployment

Kalau halaman meminta login Vercel, matikan Deployment Protection untuk production deployment atau gunakan production domain.

Untuk masalah entrypoint, pastikan Framework Preset bukan Node server custom, melainkan Other/Static, dan file `vercel.json` terbaru terbaca.
