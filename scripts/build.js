const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const name of ['index.html']) fs.copyFileSync(path.join(root, name), path.join(dist, name));
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dst, item);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(path.join(root, 'public'), dist);
console.log('Studio3 static build complete:', dist);
