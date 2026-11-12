import { readFile, access } from 'node:fs/promises';
const html = await readFile('dist/index.html', 'utf8');
if (/\/src\/|\.tsx?["']/.test(html)) throw new Error('開発用ソースを公開しようとしています。npm run build の dist を使用してください。');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
if (!scripts.length) throw new Error('ビルド済みのJavaScriptがありません。');
for (const path of scripts) {
  if (!path.startsWith('/yohaku/assets/') || !path.endsWith('.js')) throw new Error(`不正な公開パス: ${path}`);
  await access('dist/' + path.slice('/yohaku/'.length));
}
console.log('Pages build verified: compiled JavaScript and /yohaku/ asset paths');
