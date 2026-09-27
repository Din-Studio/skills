import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function skillFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    requireValue(!entry.isSymbolicLink(), `Skill resources must be real files, not symlinks: ${path}`);
    if (entry.isDirectory()) files.push(...await skillFiles(path));
    else if (entry.name === 'SKILL.md') files.push(path);
  }
  return files;
}

export async function discoverSkills(root) {
  const names = new Set();
  const skills = [];
  for (const file of await skillFiles(join(root, 'skills'))) {
    const parts = relative(root, file).split(sep);
    requireValue(parts.length === 4, `Expected skills/<category>/<name>/SKILL.md: ${file}`);
    const [, category, folder] = parts;
    requireValue(kebab.test(category), `Invalid category: ${category}`);
    const content = await readFile(file, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    requireValue(match, `Missing YAML frontmatter: ${file}`);
    const data = parse(match[1]);
    requireValue(data && typeof data === 'object' && !Array.isArray(data), `Invalid frontmatter: ${file}`);
    requireValue(typeof data.name === 'string' && kebab.test(data.name) && data.name.length <= 64,
      `Invalid skill name: ${file}`);
    requireValue(data.name === folder, `Skill name must match directory: ${file}`);
    requireValue(!names.has(data.name), `Duplicate skill name: ${data.name}`);
    names.add(data.name);
    requireValue(typeof data.description === 'string' && data.description.trim().length > 0 && data.description.length <= 1024,
      `Description must contain 1–1024 characters: ${file}`);
    requireValue(match[2].trim().length > 0, `Empty skill body: ${file}`);
    requireValue(!/\[(?:TODO|TBD)[^\]]*\]/i.test(content), `Unfinished scaffold: ${file}`);
    requireValue(data.metadata?.internal !== true && data.metadata?.internal !== 'true',
      `Keep unpublished skills outside skills/ and do not name drafts SKILL.md: ${file}`);
    if (data.compatibility !== undefined) {
      requireValue(typeof data.compatibility === 'string' && data.compatibility.length > 0 && data.compatibility.length <= 500,
        `Invalid compatibility: ${file}`);
    }
    if (data.metadata !== undefined) {
      requireValue(data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        && Object.values(data.metadata).every((value) => typeof value === 'string'), `Metadata values must be strings: ${file}`);
    }
    skills.push({ name: data.name, path: `./${parts.slice(0, -1).join('/')}` });
  }
  requireValue(skills.length > 0, 'At least one installable skill is required.');
  return skills.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export async function manifests(root, mode = 'check') {
  requireValue(['sync', 'check'].includes(mode), 'Usage: node scripts/manifests.mjs [sync|check]');
  const skills = await discoverSkills(root);
  const pkg = await json(join(root, 'package.json'));
  const pluginPath = join(root, '.claude-plugin/plugin.json');
  const marketplacePath = join(root, '.claude-plugin/marketplace.json');
  const plugin = await json(pluginPath);
  const marketplace = await json(marketplacePath);
  requireValue(typeof pkg.name === 'string' && kebab.test(pkg.name), 'Invalid package name.');
  requireValue(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version), 'Invalid package version.');
  requireValue(typeof marketplace.name === 'string' && kebab.test(marketplace.name), 'Invalid marketplace name.');
  requireValue(typeof marketplace.owner?.name === 'string' && marketplace.owner.name.trim(), 'Marketplace owner is required.');
  requireValue(typeof plugin.author?.name === 'string' && plugin.author.name.trim(), 'Plugin author is required.');
  requireValue(typeof pkg.description === 'string' && pkg.description.trim(), 'Package description is required.');
  requireValue(marketplace.plugins?.length === 1, 'This repository distributes one plugin.');
  const entry = marketplace.plugins[0];
  requireValue(entry.source === './', 'Marketplace source must be ./ (repository root).');
  requireValue(entry.skills === undefined && entry.version === undefined,
    'Keep skills and version in plugin.json only.');
  const expectedPlugin = { ...plugin, name: pkg.name, version: pkg.version, description: pkg.description, skills: skills.map((skill) => skill.path) };
  const expectedMarketplace = { ...marketplace, plugins: [{ ...entry, name: pkg.name, description: pkg.description }] };
  for (const [path, actual, expected] of [[pluginPath, plugin, expectedPlugin], [marketplacePath, marketplace, expectedMarketplace]]) {
    if (mode === 'sync') await writeFile(path, `${JSON.stringify(expected, null, 2)}\n`);
    else requireValue(JSON.stringify(actual) === JSON.stringify(expected), `Manifest drift in ${relative(root, path)}. Run npm run sync.`);
  }
  return skills;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const skills = await manifests(root, process.argv[2] ?? 'check');
    console.log(`Validated ${skills.length} skill(s); manifests ${process.argv[2] === 'sync' ? 'synchronized' : 'in sync'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
