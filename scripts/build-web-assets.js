const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'dist', 'renderer');
const indexPath = path.join(outputDir, 'index.html');
const version = require(path.join(root, 'package.json')).version;
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/\s*<script src="\/?api(?:-web)?[^>]*><\/script>/g, '');
html = html.replace('</body>', `<script src="/api.js?v=${version}"></script><script src="/api-web.js?v=${version}"></script><script src="/api-overrides.js?v=${version}"></script></body>`);
fs.writeFileSync(indexPath, html, 'utf8');
fs.copyFileSync(path.join(root, 'src', 'renderer', 'api-standalone.js'), path.join(outputDir, 'api.js'));
fs.copyFileSync(path.join(root, 'src', 'renderer', 'api-web-extension.js'), path.join(outputDir, 'api-web.js'));
fs.copyFileSync(path.join(root, 'src', 'renderer', 'api-standalone-overrides.js'), path.join(outputDir, 'api-overrides.js'));
