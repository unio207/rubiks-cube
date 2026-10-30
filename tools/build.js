// Build: inline src modules into src/shell.html -> rubiks-cube.html
// Usage: node tools/build.js
// In shell.html, write <!-- INLINE:src/name.js --> where a module's <script> should go.
// Optional attributes follow the path: <!-- INLINE:src/name.js id=src-name type=text/plain -->
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var shellPath = path.join(root, 'src', 'shell.html');
var outPath = path.join(root, 'rubiks-cube.html');

if (!fs.existsSync(shellPath)) {
  console.error('build: missing ' + shellPath + ' (the integrator writes it).');
  process.exit(1);
}

var html = fs.readFileSync(shellPath, 'utf8');
var count = 0;
html = html.replace(/<!--\s*INLINE:([\w\/.\-]+)((?:\s+[\w-]+=[\w\/.\-]+)*)\s*-->/g, function (_, rel, attrs) {
  var file = path.join(root, rel);
  if (!fs.existsSync(file)) { console.error('build: missing ' + rel); process.exit(1); }
  var code = fs.readFileSync(file, 'utf8');
  if (/<\/script/i.test(code)) { console.error('build: ' + rel + ' contains "</script"'); process.exit(1); }
  count++;
  var tag = (attrs || '').trim().split(/\s+/).filter(Boolean).map(function (a) {
    var kv = a.split('=');
    return ' ' + kv[0] + '="' + kv[1] + '"';
  }).join('');
  return '<script' + tag + '>\n' + code + '\n</script>';
});

fs.writeFileSync(outPath, html);
console.log('build: inlined ' + count + ' file(s) -> ' + outPath);
