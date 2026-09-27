// Adapted from lingying-cli, Copyright (c) 2026 Lingying, MIT.
// Maintained here; npm run sync copies this runtime into each independent skill.
import { readFile, writeFile, mkdir, open, rename, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, basename, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

const BASE = 'https://console.echojoy.cn/gateway';
const MiB = 1024 * 1024;
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const fail = (code, message, extra = {}) => { throw Object.assign(new Error(message), { code, extra }); };
const requireThat = (condition, message) => { if (!condition) fail('invalid_input', message); };
const idPath = (id) => encodeURIComponent(id);
const utf8 = new TextDecoder('utf-8', { fatal: true });

async function readJSON(path) {
  try { return JSON.parse(utf8.decode(await readFile(path))); }
  catch (error) {
    if (error.code === 'ENOENT') throw error;
    fail('invalid_json', `Cannot read UTF-8 JSON: ${path}`);
  }
}

export async function credentials(env = process.env) {
  const configPath = env.LY_CONFIG_FILE || (process.platform === 'win32'
    ? join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'ly', 'config.json')
    : join(homedir(), '.config', 'ly', 'config.json'));
  let config = {};
  if (!env.LY_ACCESS_TOKEN && !env.LY_API_KEY) {
    try { config = await readJSON(configPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    requireThat(object(config), 'Credential config must be a JSON object.');
  }
  const token = env.LY_ACCESS_TOKEN || env.LY_API_KEY || config.access_token || config.api_key;
  if (typeof token !== 'string' || !token.trim()) {
    fail('no_auth', 'Set LY_ACCESS_TOKEN or LY_API_KEY in the execution environment, or configure LY_CONFIG_FILE. Do not pass credentials as arguments.');
  }
  return token;
}

function webURL(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_url', 'Expected an absolute HTTP(S) URL.'); }
  requireThat(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
    'Only HTTP(S) URLs without embedded credentials are supported.');
  return url;
}

export class Gateway {
  constructor(token, { base = BASE, project = '', timeout = 120000 } = {}) {
    const url = webURL(base);
    requireThat(url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
      'Gateway must use HTTPS (HTTP is allowed only for loopback tests).');
    requireThat(!url.search && !url.hash, 'Gateway URL must not include a query or fragment.');
    this.base = base.replace(/\/$/, '');
    this.token = token;
    this.project = project;
    this.timeout = timeout;
  }

  async api(method, path, body, { timeout = this.timeout, allowEmpty = false } = {}) {
    const headers = { Authorization: `Bearer ${this.token}` };
    if (this.project) headers['X-Project-Id'] = this.project;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(this.base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout), redirect: 'error',
      });
    } catch { fail('network_error', `Gateway ${method} request failed or timed out.`, { outcome_unknown: method === 'POST' }); }
    let data;
    try {
      const text = await response.text();
      data = allowEmpty && response.ok && !text.trim() ? {} : JSON.parse(text);
    }
    catch { fail('invalid_response', `Gateway returned non-JSON (HTTP ${response.status}).`, { http_status: response.status }); }
    if (!response.ok) {
      fail(data?.error_code || data?.code || data?.error?.code || (response.status === 402 ? 'INSUFFICIENT_BALANCE' : 'gateway_error'),
        typeof data?.message === 'string' ? data.message : typeof data?.error?.message === 'string' ? data.error.message : `Gateway HTTP ${response.status}`,
        { http_status: response.status, ...(data?.request_id ? { request_id: data.request_id } : {}) });
    }
    return data;
  }

  async models(kind) {
    const response = await this.api('GET', '/v1/models');
    if (!Array.isArray(response?.data)) fail('invalid_response', 'Gateway model list has no data array.');
    // The source Gateway has no pagination request contract; do not silently pick from a partial catalog.
    if (response.has_more) fail('partial_catalog', 'Gateway returned a partial model catalog; pagination requires an updated API contract.');
    return response.data.filter((m) => [kind, `${kind}_edit`].includes(m.model_type));
  }

  async put(url, headers, body, size) {
    webURL(url);
    let response;
    try {
      response = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Length': String(size) },
        body, duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(this.timeout) });
      await response.arrayBuffer();
    } catch { fail('upload_failed', 'Presigned upload failed or timed out. No generation was submitted.'); }
    if (!response.ok) fail('upload_failed', `Presigned upload HTTP ${response.status}.`);
    return response.headers.get('etag');
  }

  async upload(path) {
    const info = await stat(path);
    requireThat(info.isFile() && info.size > 0 && info.size <= 1024 * MiB, 'Upload must be a nonempty regular file, at most 1 GiB.');
    const name = basename(path);
    const content_type = mime(path);
    let fileID;
    if (info.size < 50 * MiB) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      const init = await this.api('POST', '/v1/files/presigned', { name, size: info.size, content_type, hash: hash.digest('hex') });
      fileID = init.file_id;
      requireThat(typeof fileID === 'string' && fileID, 'Upload initialization returned no file_id.');
      if (!(init.deduplicated || (init.status === 'completed' && !init.upload_url))) {
        await this.put(init.upload_url, init.required_headers, createReadStream(path), info.size);
        await this.api('POST', `/v1/files/${idPath(fileID)}/completion`, undefined, { allowEmpty: true });
      }
    } else {
      const init = await this.api('POST', '/v1/files/multipart', { name, size: info.size, content_type });
      fileID = init.file_id;
      requireThat(typeof fileID === 'string' && fileID, 'Multipart initialization returned no file_id.');
      const parts = [];
      // Four bounded workers, matching the CLI's 5 MiB parts without buffering the whole video.
      let next = 0;
      let failure;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (!failure) {
          const index = next++;
          const start = index * 5 * MiB;
          if (start >= info.size) return;
          const end = Math.min(start + 5 * MiB, info.size) - 1;
          try {
            const part = await this.api('POST', `/v1/files/${idPath(fileID)}/multipart/parts`, { file_id: fileID, part_number: index + 1 });
            const etag = await this.put(part.upload_url, {}, createReadStream(path, { start, end }), end - start + 1);
            if (!etag) fail('upload_failed', 'Multipart upload response has no ETag.');
            parts[index] = { part_number: index + 1, etag };
          } catch (error) { failure ??= error; }
        }
      }));
      if (failure) throw failure;
      await this.api('POST', `/v1/files/${idPath(fileID)}/multipart/completion`, { file_id: fileID, parts }, { allowEmpty: true });
    }
    const link = await this.api('GET', `/v1/files/${idPath(fileID)}/link?url_format=direct`);
    webURL(link.download_url);
    return link.download_url;
  }
}

const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg' };
const mime = (path) => mimeTypes[extname(path).toLowerCase()] || 'application/octet-stream';

function types(schema) { return Array.isArray(schema?.type) ? schema.type : schema?.type ? [schema.type] : []; }

// Validate the common schema vocabulary, leaving provider-specific constraints to the Gateway.
export function validate(value, schema = {}, path = 'input_data') {
  if (schema === false) fail('invalid_input', `${path} is not allowed by the model schema.`);
  const expected = types(schema);
  const matches = (type) => ({ object: object(value), array: Array.isArray(value), string: typeof value === 'string',
    integer: Number.isSafeInteger(value), number: typeof value === 'number' && Number.isFinite(value),
    boolean: typeof value === 'boolean', null: value === null })[type] ?? true;
  requireThat(!expected.length || expected.some(matches), `${path} must be ${expected.join(' or ')}.`);
  if (schema.enum) requireThat(schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value)), `${path} is outside the model enum.`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined) requireThat(value >= schema.minimum, `${path} is below minimum ${schema.minimum}.`);
    if (schema.maximum !== undefined) requireThat(value <= schema.maximum, `${path} exceeds maximum ${schema.maximum}.`);
  }
  if (object(value)) {
    for (const key of schema.required || []) requireThat(Object.hasOwn(value, key), `${path}.${key} is required by the model.`);
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, key)) validate(child, schema.properties[key], `${path}.${key}`);
      else if (schema.additionalProperties === false) fail('invalid_input', `${path}.${key} is not declared by the model.`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) requireThat(value.length >= schema.minItems, `${path} needs more items.`);
    if (schema.maxItems !== undefined) requireThat(value.length <= schema.maxItems, `${path} has too many items.`);
    if (schema.items) value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`));
  }
}

export async function prepare(gateway, kind, request, requestPath) {
  requireThat(object(request), 'Request must be a JSON object.');
  for (const key of Object.keys(request)) requireThat(['model', 'prompt', 'params', 'inputs'].includes(key), `Unknown request field: ${key}`);
  requireThat(typeof request.model === 'string' && request.model, 'Request.model must be an exact discovered model id.');
  requireThat(typeof request.prompt === 'string' && request.prompt.trim(), 'Request.prompt must be nonempty.');
  requireThat(request.params === undefined || object(request.params), 'Request.params must be an object.');
  requireThat(!Object.hasOwn(request.params || {}, 'prompt'), 'Set prompt only in request.prompt.');
  requireThat(request.inputs === undefined || Array.isArray(request.inputs), 'Request.inputs must be an array.');
  const model = (await gateway.models(kind)).find((m) => m.id === request.model);
  if (!model) fail('model_not_found', `No ${kind} model with the exact requested id. Run models again; do not substitute silently.`);
  requireThat(typeof model.model_id === 'string' && model.model_id, 'Discovered model is missing model_id.');
  requireThat(object(model.input_schema), 'Discovered model is missing input_schema.');
  const schema = model.input_schema;
  const input = { ...request.params, prompt: request.prompt };
  const inputs = [];
  for (const source of request.inputs || []) {
    requireThat(object(source) && typeof source.field === 'string' && source.field, 'Each input needs an explicit schema field.');
    requireThat(Object.keys(source).every((k) => ['field', 'path', 'url'].includes(k)), 'Input accepts only field, path, or url.');
    requireThat(Boolean(source.path) !== Boolean(source.url), 'Each input needs exactly one of path or url.');
    const fieldSchema = schema.properties?.[source.field];
    requireThat(fieldSchema && types(fieldSchema).some((t) => ['array', 'string'].includes(t)), `Input field ${source.field} must be a schema string or array.`);
    const prepared = { ...source };
    if (source.path) {
      requireThat(typeof source.path === 'string', 'Input path must be a string.');
      prepared.path = resolve(dirname(requestPath), source.path);
      const info = await stat(prepared.path);
      requireThat(info.isFile() && info.size > 0 && info.size <= 1024 * MiB, 'Local input must be a nonempty regular file, at most 1 GiB.');
    } else webURL(source.url);
    prepared.array = types(fieldSchema).includes('array');
    if (prepared.array) {
      input[source.field] ??= [];
      requireThat(Array.isArray(input[source.field]), `${source.field} conflicts with params.`);
      input[source.field].push(source.url || prepared.path);
    } else {
      requireThat(!Object.hasOwn(input, source.field), `${source.field} cannot contain multiple inputs or conflict with params.`);
      input[source.field] = source.url || prepared.path;
    }
    inputs.push(prepared);
  }
  for (const key of schema.required || []) {
    if (!Object.hasOwn(input, key) && Object.hasOwn(schema.properties?.[key] || {}, 'default')) input[key] = structuredClone(schema.properties[key].default);
  }
  validate(input, schema);
  return { model, input, inputs, endpoint: `/v1/${kind === 'image' ? 'images' : 'videos'}/generations` };
}

async function saveJSON(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temp, path); }
  finally { await unlink(temp).catch((e) => { if (e.code !== 'ENOENT') throw e; }); }
}

export async function generate(gateway, kind, options) {
  const requestPath = resolve(options.request);
  const prepared = await prepare(gateway, kind, await readJSON(requestPath), requestPath);
  if (options['dry-run']) return { dry_run: true, endpoint: prepared.endpoint, model: prepared.model.id,
    request: { model_id: prepared.model.model_id, input_data: prepared.input }, local_inputs: prepared.inputs.filter((s) => s.path).length };
  requireThat(options.job, 'generate requires --job PATH (use a new receipt per intentional generation).');
  const jobPath = resolve(options.job);
  await mkdir(dirname(jobPath), { recursive: true });
  let handle;
  try { handle = await open(jobPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('job_exists', 'Receipt already exists. Use task --job to resume; do not resubmit.', { job: jobPath }); throw error; }
  const job = { version: 1, kind, model: prepared.model.id, gateway: gateway.base, project: gateway.project,
    status: 'preparing', created_at: new Date().toISOString() };
  try { await handle.writeFile(JSON.stringify(job)); } finally { await handle.close(); }
  let submitting = false;
  try {
    const input = structuredClone(prepared.input);
    for (const source of prepared.inputs) {
      if (!source.path) continue;
      const url = await gateway.upload(source.path);
      if (source.array) {
        const index = input[source.field].indexOf(source.path);
        input[source.field][index] = url;
      } else input[source.field] = url;
    }
    job.status = 'submitting';
    await saveJSON(jobPath, job);
    submitting = true;
    const response = await gateway.api('POST', prepared.endpoint, { model_id: prepared.model.model_id, input_data: input });
    if (typeof response?.data?.task_id !== 'string' || !response.data.task_id) fail('invalid_response', 'Submission response has no task_id.');
    job.task_id = response.data.task_id;
    job.status = 'submitted';
    await saveJSON(jobPath, job);
    return { task_id: job.task_id, status: job.status, model: job.model, job: jobPath };
  } catch (error) {
    const status = error.extra?.http_status;
    const definitelyRejected = [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(status);
    job.status = job.task_id ? 'submitted' : submitting
      ? (definitelyRejected ? 'rejected' : 'submission_unknown') : 'upload_failed';
    try { await saveJSON(jobPath, job); }
    catch { error.extra = { ...error.extra, receipt_write_failed: true }; }
    error.extra = { ...error.extra, job: jobPath, status: job.status, ...(job.task_id ? { task_id: job.task_id } : {}) };
    throw error;
  }
}

export function resultURLs(result) {
  const urls = new Set();
  function visit(value, key = '') {
    if (Array.isArray(value)) value.forEach((v) => visit(v, key));
    else if (object(value)) Object.entries(value).forEach(([k, v]) => visit(v, k));
    else if (typeof value === 'string' && ['url', 'download_url', 'file_url'].includes(key) && /^https?:\/\//.test(value)) urls.add(value);
  }
  visit(result);
  return [...urls];
}

async function download(url, dir, index, kind) {
  webURL(url);
  const ext = extname(new URL(url).pathname).toLowerCase();
  const suffix = Object.hasOwn(mimeTypes, ext) ? ext : kind === 'image' ? '.png' : '.mp4';
  const path = join(dir, `result-${index + 1}-${randomUUID()}${suffix}`);
  const temp = `${path}.partial`;
  try {
    // Credentials and project headers never leave the Gateway; result URLs are already signed.
    const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: 'follow' });
    if (!response.ok || !response.body) fail('download_failed', `Download HTTP ${response.status}.`);
    const file = await open(temp, 'wx', 0o600);
    await pipeline(Readable.fromWeb(response.body), file.createWriteStream());
    if (!(await stat(temp)).size) fail('download_failed', 'Downloaded file is empty.');
    await rename(temp, path);
    return path;
  } catch (error) {
    if (error.code === 'download_failed') throw error;
    fail('download_failed', 'Could not download or save the result. Resume the same task to retry download.');
  } finally { await unlink(temp).catch((e) => { if (e.code !== 'ENOENT') throw e; }); }
}

export async function task(gateway, kind, options) {
  requireThat(Boolean(options.job) !== Boolean(options.task), 'Use exactly one of --job PATH or --task ID.');
  let taskID = options.task;
  if (options.job) {
    const job = await readJSON(resolve(options.job));
    requireThat(job.kind === kind && job.gateway === gateway.base && job.project === gateway.project,
      'Receipt belongs to a different skill, Gateway, or project. Restore its original settings.');
    if (!job.task_id) fail('no_task_id', `Receipt status is ${job.status}; no task_id is available. Do not automatically resubmit. Reconcile submission with the Gateway.`, { job: resolve(options.job), status: job.status });
    taskID = job.task_id;
  }
  requireThat(typeof taskID === 'string' && taskID, 'A task_id is required.');
  const wait = options.wait === undefined ? 0 : Number(options.wait);
  requireThat(Number.isFinite(wait) && wait >= 0 && wait <= 1200, '--wait must be 0–1200 seconds.');
  const deadline = Date.now() + wait * 1000;
  let failures = 0;
  let lastStatus;
  let lastError;
  const pending = () => ({ task_id: taskID, status: lastStatus, files: [], wait_expired: Boolean(wait) });
  const files = [];
  try {
    while (true) {
      if (wait && Date.now() >= deadline) {
        if (lastError) throw lastError;
        if (lastStatus) return pending();
      }
      let response;
      try { response = await gateway.api('GET', `/v1/tasks/${idPath(taskID)}`, undefined,
        { timeout: wait ? Math.max(1, Math.min(gateway.timeout, deadline - Date.now())) : gateway.timeout }); }
      catch (error) {
        lastError = error;
        if (error.code !== 'network_error' || ++failures >= 5 || Date.now() >= deadline) throw error;
        await new Promise((r) => setTimeout(r, Math.min(3000, Math.max(0, deadline - Date.now()))));
        continue;
      }
      failures = 0;
      lastError = undefined;
      const data = response?.data;
      if (!object(data) || typeof data.status !== 'string' || !data.status) fail('invalid_response', 'Task response has no data.status.');
      if (['failed', 'cancelled', 'canceled'].includes(data.status)) fail(data.error_code || 'task_failed',
        typeof data.error === 'string' ? data.error : `Task ${data.status}.`, { status: data.status });
      if (data.status === 'success') {
        const urls = resultURLs(data.result);
        if (!urls.length) fail('missing_result', 'Task succeeded but result has no downloadable URL.');
        if (options.download) {
          const dir = resolve(options['output-dir'] || 'ly-output');
          await mkdir(dir, { recursive: true });
          for (const [i, url] of urls.entries()) files.push(await download(url, dir, i, kind));
        }
        return { task_id: taskID, status: 'success', files, urls, downloaded: Boolean(options.download) };
      }
      lastStatus = data.status;
      if (!wait || Date.now() >= deadline) return pending();
      await new Promise((r) => setTimeout(r, Math.min(3000, Math.max(0, deadline - Date.now()))));
    }
  } catch (error) { error.extra = { ...error.extra, task_id: taskID, files }; throw error; }
}

function safeMessage(error, token) {
  let message = String(error.message || 'Unexpected failure');
  if (token) message = message.split(token).join('[redacted]');
  return message.replace(/https?:\/\/[^\s"']+/g, '[url]').slice(0, 1000);
}

export async function main(kind, args = process.argv.slice(2)) {
  let token;
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      help: { type: 'boolean' }, model: { type: 'string' }, request: { type: 'string' }, job: { type: 'string' },
      task: { type: 'string' }, 'dry-run': { type: 'boolean' }, download: { type: 'boolean' },
      wait: { type: 'string' }, 'output-dir': { type: 'string' }, project: { type: 'string' },
    } });
    const command = positionals[0];
    if (values.help || !command) {
      console.log(JSON.stringify({ ok: true, data: { usage: [
        'models [--model EXACT_ID] [--project ID]',
        'generate --request request.json --dry-run [--project ID]',
        'generate --request request.json --job job.json [--project ID]',
        'task (--job job.json | --task ID) [--wait 60] [--download] [--output-dir DIR] [--project ID]',
      ], runtime: 'Node.js >=22.20', exit_codes: { 0: 'command succeeded; task may still be pending', 1: 'read data.code/message; do not blindly retry' },
      auth: 'LY_ACCESS_TOKEN > LY_API_KEY > LY_CONFIG_FILE or platform ly/config.json',
      notes: 'Always JSON. generate submits once; task resumes without submission. Relative input paths resolve beside request.json; outputs and receipts resolve from cwd.' } }));
      return;
    }
    requireThat(positionals.length === 1, 'Expected one command and named options.');
    const allowed = { models: ['model', 'project'], generate: ['request', 'job', 'dry-run', 'project'],
      task: ['job', 'task', 'wait', 'download', 'output-dir', 'project'] };
    requireThat(Object.hasOwn(allowed, command), 'Command must be models, generate, or task.');
    for (const key of Object.keys(values)) requireThat(allowed[command].includes(key), `--${key} is not supported by ${command}.`);
    token = await credentials();
    const gateway = new Gateway(token, { base: process.env.LY_GATEWAY_URL || BASE, project: values.project ?? process.env.LY_PROJECT_ID ?? '' });
    let data;
    if (command === 'models') {
      const models = await gateway.models(kind);
      if (values.model) {
        data = models.find((m) => m.id === values.model);
        if (!data) fail('model_not_found', `No ${kind} model with that exact id.`);
      } else data = { models: models.map(({ id, model_id, display_name, model_type }) => ({ id, model_id, display_name, model_type })), count: models.length };
    } else if (command === 'generate') {
      requireThat(values.request, 'generate requires --request PATH.');
      data = await generate(gateway, kind, values);
    } else data = await task(gateway, kind, values);
    console.log(JSON.stringify({ ok: true, data }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, data: { code: error.code || 'command_error', message: safeMessage(error, token), ...error.extra } }));
    process.exitCode = 1;
  }
}
