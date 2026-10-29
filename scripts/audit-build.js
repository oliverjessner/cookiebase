import { readFileSync, readdirSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('src/manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.host_permissions, undefined);
assert.deepEqual(manifest.permissions, ['cookies', 'storage', 'activeTab']);
assert.ok(!manifest.content_scripts && !manifest.chrome_settings_overrides);
for (const name of readdirSync('src/ui')) if (name.endsWith('.js')) {
  const source = readFileSync(`src/ui/${name}`, 'utf8');
  assert.ok(!/\.innerHTML\s*=|\beval\(|new Function\(/.test(source), `Unsafe DOM/code in ${name}`);
}
if (existsSync('dist/ui.css')) {
  const css = readFileSync('dist/ui.css', 'utf8');
  assert.match(css, /Comfortaa/); assert.match(css, /JetBrains Mono/); assert.match(css, /Font Awesome/);
  assert.ok(!/url\(["']?https?:/.test(css));
  for (const [, url] of css.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) if (!url.startsWith('data:')) assert.ok(existsSync(`dist/${url.replace(/^\.\//, '')}`), url);
  for (const page of ['popup', 'manager']) assert.ok(!/<script[^>]*>(?!<\/script>)[\s\S]+?<\/script>/.test(readFileSync(`dist/${page}.html`, 'utf8')));
}
console.log('MV3 permission, safe DOM, local font/icon and CSP audit passed.');
