import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { manifests } from './manifests.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(tmpdir(), 'echojoy-install-'));
const project = join(scratch, 'project');
const env = { ...process.env, DISABLE_TELEMETRY: '1', CLAUDE_CONFIG_DIR: join(scratch, 'claude-config') };

function run(command, args, cwd = project) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function compareTree(source, installed) {
  const entries = await readdir(source, { withFileTypes: true });
  assert.deepEqual((await readdir(installed)).sort(), entries.map((entry) => entry.name).sort());
  for (const entry of entries) {
    if (entry.isDirectory()) await compareTree(join(source, entry.name), join(installed, entry.name));
    else assert.deepEqual(await readFile(join(installed, entry.name)), await readFile(join(source, entry.name)));
  }
}

try {
  await mkdir(project);
  const skills = await manifests(root);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const cli = (...args) => run(npx, ['--yes', 'skills@1.7.0', ...args]);
  const discovered = cli('add', root, '--list');
  for (const skill of skills) assert.ok(discovered.includes(skill.name), `Not discovered: ${skill.name}`);
  cli('add', root, '--agent', 'codex', 'claude-code', '--skill', '*', '-y');
  assert.deepEqual((await readdir(join(project, '.agents/skills'))).sort(), skills.map((skill) => skill.name).sort(),
    'Installed catalog differs from published skills (possible draft or template leakage).');
  const listed = cli('list', '--agent', 'codex');
  for (const skill of skills) {
    const installed = join(project, '.agents/skills', skill.name);
    assert.ok(listed.includes(skill.name), `Not installed: ${skill.name}`);
    await compareTree(join(root, skill.path), installed);
    await compareTree(join(root, skill.path), join(project, '.claude/skills', skill.name));
    // Omit --agent to remove all links and the shared canonical copy.
    cli('remove', skill.name, '-y');
    await assert.rejects(access(installed), { code: 'ENOENT' });
    await assert.rejects(access(join(project, '.claude/skills', skill.name)), { code: 'ENOENT' });
  }
  console.log(`PASS: Skills CLI discovered, installed, and removed ${skills.length} skill(s), preserving all bundled resources.`);

  for (const kind of ['image', 'video']) {
    const name = `ly-${kind}`;
    const skill = skills.find((entry) => entry.name === name);
    if (!skill) continue;
    cli('add', root, '--agent', 'codex', '--skill', name, '--copy', '-y');
    assert.deepEqual(await readdir(join(project, '.agents/skills')), [name], 'Individual install brought sibling skills.');
    const installed = join(project, '.agents/skills', name);
    await compareTree(join(root, skill.path), installed);
    const help = JSON.parse(run(process.execPath, [join(installed, 'scripts', `${kind}.mjs`), '--help']));
    assert.equal(help.ok, true);
    assert.ok(help.data.usage.some((command) => command.startsWith('generate')));
    cli('remove', name, '-y');
  }
  console.log('PASS: Lingying skills install and execute individually without sibling skills.');

  if (process.argv.includes('--claude')) {
    const plugin = JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8'));
    const marketplace = JSON.parse(await readFile(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
    const id = `${plugin.name}@${marketplace.name}`;
    run('claude', ['plugin', 'validate', join(root, '.claude-plugin/plugin.json'), '--strict']);
    run('claude', ['plugin', 'validate', join(root, '.claude-plugin/marketplace.json'), '--strict']);
    run('claude', ['plugin', 'marketplace', 'add', root]);
    run('claude', ['plugin', 'install', id, '--scope', 'project']);
    assert.ok(run('claude', ['plugin', 'list']).includes(id));
    const inventory = run('claude', ['plugin', 'details', plugin.name]);
    for (const skill of skills) assert.ok(inventory.includes(skill.name), `Missing plugin skill: ${skill.name}`);
    run('claude', ['plugin', 'uninstall', id, '--scope', 'project']);
    console.log('PASS: Claude marketplace install, component inventory, and uninstall.');
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
