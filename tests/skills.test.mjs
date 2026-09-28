import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSkills } from '../scripts/manifests.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

test('every relative Markdown link in a published skill resolves inside that skill', async () => {
  for (const skill of await discoverSkills(root)) {
    const skillDir = resolve(root, skill.path);
    for (const file of await markdownFiles(skillDir)) {
      const content = await readFile(file, 'utf8');
      for (const [, raw] of content.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(?:https?:|mailto:|#)/.test(raw)) continue;
        const target = resolve(dirname(file), raw.split('#')[0]);
        const where = `${relative(root, file)} -> ${raw}`;
        assert.ok(target === skillDir || target.startsWith(skillDir + sep), `Link leaves the skill: ${where}`);
        await assert.doesNotReject(access(target), `Broken link: ${where}`);
      }
    }
  }
});

test('performance eval cases are well formed', async () => {
  const evals = JSON.parse(await readFile(join(root, 'tests/performance-evals.json'), 'utf8'));
  assert.ok(Array.isArray(evals.cases) && evals.cases.length > 0);
  const ids = evals.cases.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate eval id.');
  for (const entry of evals.cases) {
    assert.ok(typeof entry.prompt === 'string' && entry.prompt.trim(), `Empty prompt: ${entry.id}`);
    assert.ok(typeof entry.expected === 'string' && entry.expected.trim(), `Empty expected: ${entry.id}`);
  }
});
