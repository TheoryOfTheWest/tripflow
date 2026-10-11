import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const html = await readFile('dist/index.html', 'utf8');
const base = process.env.VITE_BASE_PATH || '/tripflow/';
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
for (const asset of assets) {
  if (!asset.startsWith(base)) throw new Error(`Asset outside base path ${base}: ${asset}`);
  await access(resolve('dist', asset.slice(base.length)));
}
if (!assets.some((v) => v.endsWith('.js'))) throw new Error('Missing application bundle');
console.log(`Pages base path and ${assets.length} entry assets verified: ${base}`);
