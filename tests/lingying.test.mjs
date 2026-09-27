import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp, readdir, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Gateway, credentials, resultURLs, task } from '../scripts/lingying/runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const secret = 'fixture-token-never-print';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const model = (kind) => ({ id: `${kind}-public`, model_id: `${kind}-backend`, display_name: `Fixture ${kind}`,
  model_type: kind, input_schema: { type: 'object', required: ['prompt', 'quality'], additionalProperties: false,
    properties: { prompt: { type: 'string' }, quality: { type: 'string', default: 'standard' },
      duration: { type: 'integer', minimum: 1, maximum: 10 }, metadata: { type: 'object' },
      enabled: { type: 'boolean' }, images: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      videos: { type: 'array', items: { type: 'string' } }, first_frame: { type: 'string' } } },
  feature_types: { reference: { match_fields: ['images', 'videos', 'first_frame'] } } });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lingying-skill-'));
  const requests = [];
  const state = { status: 'success', submitStatus: 200, deduplicated: false, resultCount: 1, taskGets: 0 };
  let base;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    let body;
    try { body = raw.length && req.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : undefined; }
    catch { res.writeHead(400).end(); return; }
    requests.push({ method: req.method, path: req.url, headers: req.headers, body, size: raw.length });
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (state.breakConnection && req.url.includes('/tasks/')) { req.socket.destroy(); return; }
    if (req.url === '/v1/models') {
      if (state.modelsStatus) return json({ error: { code: 'FORBIDDEN', message: 'Access denied' } }, state.modelsStatus);
      return json({ data: [model('image'), model('video'), { ...model('image'), id: 'edit-public', model_type: 'image_edit' }], has_more: false });
    }
    if (req.url.endsWith('/generations')) {
      if (state.disconnectSubmit) { req.socket.destroy(); return; }
      if (state.submitStatus !== 200) return json({ error_code: 'INSUFFICIENT_BALANCE', message: 'Balance exhausted', request_id: 'request-1' }, state.submitStatus);
      return json(state.malformedSubmit ? {} : { data: { task_id: 'task-1' } });
    }
    if (req.url.startsWith('/v1/tasks/')) {
      state.taskGets++;
      if (state.taskDelay) await new Promise((r) => setTimeout(r, state.taskDelay));
      return json({ data: { status: state.pendingOnce && state.taskGets === 1 ? 'pending' : state.status,
        error_code: 'PROVIDER_FAILURE', error: 'Provider failed',
        input_data: { images: [{ url: `${base}/should-not-download.png` }] },
        result: state.missingResult ? {} : { outputs: Array.from({ length: state.resultCount }, (_, i) => ({ url: `${base}/result-${i}.png` })) } } });
    }
    if (req.url === '/v1/files/presigned') return json({ file_id: 'file-1',
      deduplicated: state.deduplicated, upload_url: `${base}/storage`, required_headers: { 'Content-Type': 'image/png', 'x-signed': 'exact-value' } });
    if (req.url === '/v1/files/multipart') return json({ file_id: 'large-1' });
    if (req.url === '/v1/files/large-1/multipart/parts') return json({ upload_url: `${base}/part-${body.part_number}` });
    if (req.url.endsWith('/completion')) {
      if (state.emptyCompletion) { res.writeHead(204).end(); return; }
      return json({ status: 'completed' });
    }
    if (req.url.includes('/link?')) return json({ download_url: `${base}/reference.png` });
    if (req.method === 'PUT') {
      res.writeHead(state.uploadFail ? 500 : 200, { ETag: `"part-${req.url}"` }); res.end(); return;
    }
    if (req.url.startsWith('/result-')) {
      res.writeHead(state.downloadFail || req.url === state.downloadFailPath ? 500 : 200, { 'Content-Type': 'image/png' }); res.end(png); return;
    }
    json({ message: 'unknown endpoint' }, 404);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  await writeFile(join(dir, 'reference.png'), png);
  const request = async (kind, extras = {}) => {
    const path = join(dir, `${kind}-request.json`);
    await writeFile(path, JSON.stringify({ model: `${kind}-public`, prompt: '橘猫转头，窗边暖光', ...extras }));
    return path;
  };
  const run = (kind, args, options = {}) => new Promise((resolve, reject) => {
    const script = options.script || join(root, `skills/lingying/ly-${kind}/scripts/${kind}.mjs`);
    const child = spawn(process.execPath, [script, ...args], { cwd: dir, env: { ...process.env,
      LY_ACCESS_TOKEN: secret, LY_API_KEY: '', LY_GATEWAY_URL: base, LY_PROJECT_ID: '', ...options.env }, timeout: 15000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', (x) => { stdout += x; });
    child.stderr.on('data', (x) => { stderr += x; });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        assert.equal(stderr, '');
        assert.equal(stdout.includes(secret), false, 'credential leaked');
        resolve({ code, ...JSON.parse(stdout) });
      } catch (error) { reject(error); }
    });
  });
  return { dir, base, requests, state, run, request, gateway: new Gateway(secret, { base }) };
}

for (const kind of ['image', 'video']) {
  test(`${kind}: independently copied skill discovers, previews, submits, resumes and saves outputs`, async (t) => {
    const f = await fixture(t);
    const isolated = join(f.dir, 'only-skill');
    await cp(join(root, `skills/lingying/ly-${kind}`), isolated, { recursive: true });
    const run = (args) => f.run(kind, args, { script: join(isolated, `scripts/${kind}.mjs`) });
    const models = await run(['models']);
    assert.equal(models.ok, true);
    assert.ok(models.data.models.every((m) => m.model_type.startsWith(kind)));
    const info = await run(['models', '--model', `${kind}-public`]);
    assert.equal(info.data.input_schema.properties.prompt.type, 'string');
    const path = await f.request(kind, { params: { duration: 5, enabled: true, metadata: { quality: '高清' } },
      inputs: [{ field: 'images', path: './reference.png' }] });
    const preview = await run(['generate', '--request', path, '--dry-run']);
    assert.equal(preview.ok, true);
    assert.equal(preview.data.request.model_id, `${kind}-backend`);
    assert.equal(preview.data.request.input_data.quality, 'standard');
    assert.equal(preview.data.request.input_data.duration, 5);
    assert.ok(f.requests.every((r) => r.method === 'GET'));
    const generated = await run(['generate', '--request', path, '--job', 'jobs/one.json', '--project', 'test-project']);
    assert.equal(generated.data.task_id, 'task-1');
    const submission = f.requests.find((r) => r.path.endsWith('/generations'));
    assert.equal(submission.path, `/v1/${kind}s/generations`);
    assert.equal(submission.headers.authorization, `Bearer ${secret}`);
    assert.equal(submission.headers['x-project-id'], 'test-project');
    assert.deepEqual(submission.body.input_data.images, [`${f.base}/reference.png`]);
    const put = f.requests.find((r) => r.method === 'PUT');
    assert.equal(put.headers.authorization, undefined);
    assert.equal(put.headers['x-project-id'], undefined);
    assert.equal(put.headers['content-type'], 'image/png');
    assert.equal(put.headers['x-signed'], 'exact-value');
    assert.equal(put.size, png.length);
    f.state.resultCount = 2;
    const result = await run(['task', '--job', 'jobs/one.json', '--download', '--output-dir', 'outputs', '--project', 'test-project']);
    assert.equal(result.data.status, 'success');
    assert.equal(result.data.files.length, 2);
    assert.deepEqual(await readFile(result.data.files[0]), png);
    const resultReads = f.requests.filter((r) => r.path.startsWith('/result-'));
    assert.ok(resultReads.every((r) => !r.headers.authorization && !r.headers['x-project-id']));
    assert.ok(!f.requests.some((r) => r.path.includes('should-not-download')));
    const receipt = await readFile(join(f.dir, 'jobs/one.json'), 'utf8');
    assert.ok(!receipt.includes(secret) && !receipt.includes('橘猫'));
    const again = await run(['generate', '--request', path, '--job', 'jobs/one.json']);
    assert.equal(again.data.code, 'job_exists');
    assert.equal(f.requests.filter((r) => r.path.endsWith('/generations')).length, 1);
  });
}

test('validation prevents submission for wrong model kind, bad types, missing files and malformed UTF-8', async (t) => {
  const f = await fixture(t);
  for (const extra of [{ model: 'video-public' }, { params: { duration: '5' } }, { params: { duration: 100 } },
    { params: { nonexistent: true } }, { inputs: [{ field: 'unknown', path: 'reference.png' }] },
    { inputs: [{ field: 'images', path: 'missing.png' }] }, { params: { prompt: 'override' } }]) {
    const result = await f.run('image', ['generate', '--request', await f.request('image', extra), '--job', 'test.json']);
    assert.equal(result.code, 1);
    assert.equal(result.ok, false);
  }
  const invalid = join(f.dir, 'invalid.json');
  await writeFile(invalid, Buffer.from([0xff, 0xfe]));
  assert.equal((await f.run('image', ['generate', '--request', invalid, '--dry-run'])).data.code, 'invalid_json');
  assert.ok(f.requests.every((r) => r.method === 'GET'));
});

test('deduplicated inputs and remote first frame keep ordering without redundant PUT', async (t) => {
  const f = await fixture(t);
  f.state.deduplicated = true;
  const path = await f.request('video', { inputs: [{ field: 'images', path: './reference.png' },
    { field: 'images', url: `${f.base}/second.png` }, { field: 'first_frame', url: `${f.base}/first.png` }] });
  const result = await f.run('video', ['generate', '--request', path, '--job', 'one.json']);
  assert.equal(result.ok, true);
  assert.ok(!f.requests.some((r) => r.method === 'PUT'));
  const input = f.requests.find((r) => r.path.endsWith('/generations')).body.input_data;
  assert.deepEqual(input.images, [`${f.base}/reference.png`, `${f.base}/second.png`]);
  assert.equal(input.first_frame, `${f.base}/first.png`);
});

test('50 MiB video follows multipart protocol with correct lengths, order and no application headers', async (t) => {
  const f = await fixture(t);
  const file = join(f.dir, 'large.mp4');
  const handle = await open(file, 'w');
  await handle.truncate(50 * 1024 * 1024 + 7);
  await handle.close();
  const path = await f.request('video', { inputs: [{ field: 'videos', path: './large.mp4' }] });
  assert.equal((await f.run('video', ['generate', '--request', path, '--job', 'large.json'])).ok, true);
  const parts = f.requests.filter((r) => r.method === 'PUT');
  assert.equal(parts.length, 11);
  assert.equal(parts.reduce((sum, p) => sum + p.size, 0), 50 * 1024 * 1024 + 7);
  assert.ok(parts.every((p) => !p.headers.authorization && !p.headers['content-type']));
  const complete = f.requests.find((r) => r.path.endsWith('/multipart/completion'));
  assert.deepEqual(complete.body.parts.map((p) => p.part_number), Array.from({ length: 11 }, (_, i) => i + 1));
  assert.ok(complete.body.parts.every((p) => p.etag));
});

test('upload failure stops before billed generation; Gateway rejection returns code and request ID', async (t) => {
  const f = await fixture(t);
  f.state.uploadFail = true;
  let path = await f.request('image', { inputs: [{ field: 'images', path: 'reference.png' }] });
  assert.equal((await f.run('image', ['generate', '--request', path, '--job', 'upload.json'])).data.status, 'upload_failed');
  assert.ok(!f.requests.some((r) => r.path.endsWith('/generations')));
  f.state.submitStatus = 402;
  path = await f.request('image');
  const result = await f.run('image', ['generate', '--request', path, '--job', 'balance.json']);
  assert.equal(result.code, 1);
  assert.equal(result.data.code, 'INSUFFICIENT_BALANCE');
  assert.equal(result.data.request_id, 'request-1');
  assert.equal(result.data.status, 'rejected');
});

test('empty successful upload-completion responses are accepted', async (t) => {
  const f = await fixture(t);
  f.state.emptyCompletion = true;
  const path = await f.request('image', { inputs: [{ field: 'images', path: 'reference.png' }] });
  const result = await f.run('image', ['generate', '--request', path, '--job', 'empty.json']);
  assert.equal(result.ok, true);
  assert.equal(result.data.task_id, 'task-1');
});

test('wait expiration after a delayed pending response does not start a doomed last query', async (t) => {
  const f = await fixture(t);
  f.state.status = 'pending';
  f.state.taskDelay = 20;
  const result = await task(f.gateway, 'video', { task: 'known', wait: '0.1' });
  assert.equal(result.status, 'pending');
  assert.equal(result.wait_expired, true);
  assert.equal(f.state.taskGets, 1);
  f.state.breakConnection = true;
  await assert.rejects(task(f.gateway, 'video', { task: 'known', wait: '0.1' }), { code: 'network_error' });
});

test('uncertain submission is persisted and never automatically resubmitted', async (t) => {
  const f = await fixture(t);
  f.state.disconnectSubmit = true;
  const path = await f.request('image');
  const result = await f.run('image', ['generate', '--request', path, '--job', 'unknown.json']);
  assert.equal(result.data.status, 'submission_unknown');
  assert.equal((await f.run('image', ['task', '--job', 'unknown.json'])).data.code, 'no_task_id');
  assert.equal((await f.run('image', ['generate', '--request', path, '--job', 'unknown.json'])).data.code, 'job_exists');
  assert.equal(f.requests.filter((r) => r.path.endsWith('/generations')).length, 1);
});

test('concurrent generation with the same receipt creates one task', async (t) => {
  const f = await fixture(t);
  const path = await f.request('image');
  const results = await Promise.all([1, 2].map(() => f.run('image', ['generate', '--request', path, '--job', 'race.json'])));
  assert.deepEqual(results.map((r) => r.code).sort(), [0, 1]);
  assert.equal(f.requests.filter((r) => r.path.endsWith('/generations')).length, 1);
});

test('server timeout and malformed submit response keep uncertain receipts', async (t) => {
  const f = await fixture(t);
  const path = await f.request('image');
  f.state.submitStatus = 408;
  let result = await f.run('image', ['generate', '--request', path, '--job', 'timeout.json']);
  assert.equal(result.data.status, 'submission_unknown');
  f.state.submitStatus = 200;
  f.state.malformedSubmit = true;
  result = await f.run('image', ['generate', '--request', path, '--job', 'malformed.json']);
  assert.equal(result.data.status, 'submission_unknown');
  assert.equal(result.data.code, 'invalid_response');
});

test('partial downloads preserve completed files and do not overwrite existing user output', async (t) => {
  const f = await fixture(t);
  f.state.resultCount = 2;
  f.state.downloadFailPath = '/result-1.png';
  await mkdir(join(f.dir, 'outputs'));
  await writeFile(join(f.dir, 'outputs/result.png'), 'user-content');
  const result = await f.run('image', ['task', '--task', 'partial', '--download', '--output-dir', 'outputs']);
  assert.equal(result.data.code, 'download_failed');
  assert.equal(result.data.files.length, 1);
  assert.deepEqual(await readFile(result.data.files[0]), png);
  assert.equal(await readFile(join(f.dir, 'outputs/result.png'), 'utf8'), 'user-content');
  assert.ok((await readdir(join(f.dir, 'outputs'))).every((f) => !f.endsWith('.partial')));
});

test('receipts cannot silently switch project or media kind; incompatible flags fail before networking', async (t) => {
  const f = await fixture(t);
  const path = await f.request('image');
  await f.run('image', ['generate', '--request', path, '--job', 'one.json', '--project', 'original']);
  assert.equal((await f.run('image', ['task', '--job', 'one.json', '--project', 'other'])).code, 1);
  assert.equal((await f.run('video', ['task', '--job', 'one.json', '--project', 'original'])).code, 1);
  const before = f.requests.length;
  assert.equal((await f.run('image', ['models', '--download'])).code, 1);
  assert.equal((await f.run('image', ['generate', '--request', path, '--dry-rnu'])).code, 1);
  assert.equal(f.requests.length, before);
});

test('pending, terminal failure, missing output, and failed downloads retain task identity', async (t) => {
  const f = await fixture(t);
  f.state.status = 'pending';
  let result = await f.run('video', ['task', '--task', 'known-task', '--wait', '0.05', '--download']);
  assert.equal(result.ok, true);
  assert.equal(result.data.wait_expired, true);
  assert.equal(result.data.status, 'pending');
  f.state.status = 'failed';
  result = await f.run('video', ['task', '--task', 'known-task']);
  assert.equal(result.code, 1);
  assert.equal(result.data.code, 'PROVIDER_FAILURE');
  assert.equal(result.data.task_id, 'known-task');
  f.state.status = 'success';
  f.state.missingResult = true;
  assert.equal((await f.run('video', ['task', '--task', 'known-task'])).data.code, 'missing_result');
  f.state.missingResult = false;
  f.state.downloadFail = true;
  result = await f.run('video', ['task', '--task', 'known-task', '--download', '--output-dir', 'out']);
  assert.equal(result.data.task_id, 'known-task');
  assert.equal(result.data.code, 'download_failed');
  assert.deepEqual(await readdir(join(f.dir, 'out')), []);
  f.state.downloadFail = false;
  result = await f.run('video', ['task', '--task', 'known-task', '--download', '--output-dir', 'out']);
  assert.equal(result.data.files.length, 1);
  assert.ok(!f.requests.some((r) => r.method === 'POST'));
});

test('auth precedence and missing credentials are deterministic and do not disclose secrets', async (t) => {
  const f = await fixture(t);
  const config = join(f.dir, 'config.json');
  await writeFile(config, JSON.stringify({ access_token: 'config-oauth', api_key: 'config-api' }));
  assert.equal(await credentials({ LY_CONFIG_FILE: config }), 'config-oauth');
  assert.equal(await credentials({ LY_CONFIG_FILE: config, LY_API_KEY: 'env-api' }), 'env-api');
  assert.equal(await credentials({ LY_CONFIG_FILE: config, LY_API_KEY: 'env-api', LY_ACCESS_TOKEN: 'env-oauth' }), 'env-oauth');
  const result = await f.run('image', ['models'], { env: { LY_ACCESS_TOKEN: '', LY_API_KEY: '', LY_CONFIG_FILE: join(f.dir, 'absent.json') } });
  assert.equal(result.data.code, 'no_auth');
  assert.equal(f.requests.length, 0);
});

test('results are deduplicated and nested file URLs are accepted', () => {
  assert.deepEqual(resultURLs({ outputs: [{ url: 'https://example.com/a.png' }, { file_url: 'https://example.com/a.png' }],
    nested: { download_url: 'https://example.com/b.png' }, arbitrary: 'https://example.com/c.png' }),
  ['https://example.com/a.png', 'https://example.com/b.png']);
});
