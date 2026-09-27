import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('scripts/lingying/runtime.mjs', root));
for (const kind of ['image', 'video']) {
  const destination = new URL(`skills/lingying/ly-${kind}/scripts/runtime.mjs`, root);
  if (process.argv.includes('--check')) {
    if (!(await readFile(destination)).equals(source)) throw new Error(`Runtime drift: ${fileURLToPath(destination)}; run npm run sync.`);
  } else await writeFile(destination, source);
}
