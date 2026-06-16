// Fallback entrypoint for platforms that require a Node server.
// Vercel uses vercel.json routes/static output; this file mainly prevents
// "No entrypoint found" when the project is mis-detected as a Node app.
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const root = fs.existsSync(path.join(__dirname, 'dist')) ? path.join(__dirname, 'dist') : __dirname;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (file === '/app.js' || file === '/styles.css' || file === '/manifest.webmanifest' || file === '/icon.svg') {
    file = '/' + file.replace(/^\//, '');
  }
  const direct = path.join(root, file);
  const publicFile = path.join(__dirname, 'public', file.replace(/^\//, ''));
  const target = fs.existsSync(direct) ? direct : fs.existsSync(publicFile) ? publicFile : path.join(root, 'index.html');
  res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}).listen(port, () => console.log(`Studio3 fallback server listening on ${port}`));
