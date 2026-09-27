import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifests } from '../scripts/manifests.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'echojoy-manifests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['package.json', '.claude-plugin', 'skills']) {
    await cp(join(source, name), join(root, name), { recursive: true });
  }
  return root;
}

async function addSkill(root, category, folder, name = folder) {
  const directory = join(root, 'skills', category, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Verifies a new catalog entry.\n---\n\nPerform the requested catalog check.\n`);
}

test('new categorized skills must be registered; sync repairs the catalog without changing source', async (t) => {
  const root = await fixture(t);
  const originalCount = (await manifests(root)).length;
  await addSkill(root, 'productivity', 'catalog-check');
  await assert.rejects(manifests(root), /Manifest drift/);
  await manifests(root, 'sync');
  assert.equal((await manifests(root)).length, originalCount + 1);
  const before = await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8');
  await manifests(root, 'sync');
  assert.equal(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8'), before);
});

test('duplicate names across categories cannot silently shadow another skill', async (t) => {
  const root = await fixture(t);
  await addSkill(root, 'productivity', 'duplicate-check');
  await addSkill(root, 'engineering', 'duplicate-check');
  await assert.rejects(manifests(root, 'sync'), /Duplicate skill name/);
});

test('invalid frontmatter and folder names fail before manifest generation', async (t) => {
  const root = await fixture(t);
  await addSkill(root, 'engineering', 'wrong-folder', 'different-name');
  await assert.rejects(manifests(root, 'sync'), /must match directory/);
  await writeFile(join(root, 'skills/engineering/wrong-folder/SKILL.md'), '---\nname: [invalid\n---\nInstructions\n');
  await assert.rejects(manifests(root, 'sync'), /flow sequence/i);
});

test('package version drives plugin version and marketplace paths must stay at the root', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  pkg.version = '0.2.0';
  await writeFile(path, JSON.stringify(pkg));
  await assert.rejects(manifests(root), /Manifest drift/);
  await manifests(root, 'sync');
  assert.equal(JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8')).version, '0.2.0');
  const marketplacePath = join(root, '.claude-plugin/marketplace.json');
  const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
  marketplace.plugins[0].source = '../';
  await writeFile(marketplacePath, JSON.stringify(marketplace));
  await assert.rejects(manifests(root), /source must be/);
});
