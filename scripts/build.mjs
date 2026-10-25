import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'dist');
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const entry of ['index.html', 'src', 'public']) {
  const from = path.join(root, entry);
  await stat(from);
  if (entry === 'public') {
    await cp(from, dest, { recursive: true });
  } else {
    await cp(from, path.join(dest, entry), { recursive: true });
  }
}
console.log('MoConvert static build complete -> dist/ (no external dependencies)');
