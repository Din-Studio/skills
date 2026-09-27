---
name: ly-image
description: Generates and edits images through Lingying (灵影 / EchoJoy) Gateway. Use for “灵影生图”, “用 ly 画图”, “图生图”, “修改这张图片”, text-to-image or reference-image generation with Lingying, or /ly-image. Produces downloadable image files; excludes video generation and requests that only ask to write a prompt.
compatibility: Requires Node.js >=22.20, network access to Lingying Gateway, and LY_ACCESS_TOKEN or LY_API_KEY (or an existing ly credential config). No ly CLI or npm install required.
---

# Lingying image generation

Use the bundled [image script](scripts/image.mjs) to produce the requested images. Resolve its absolute path from this installed skill directory; keep the working directory in the user's project. Do not assume the source repository or another skill is installed.

## Workflow

1. Infer the subject, composition, style, aspect ratio, requested text, and reference images from the request. Preserve quoted text exactly. For editing, distinguish what should change from what should remain. Ask only for missing information that prevents execution; choose reasonable creative defaults otherwise.
2. Read [command and request details](references/commands.md) before the first invocation. Run `node <skill-dir>/scripts/image.mjs models`, then `models --model <exact-id>` for a suitable `image` or `image_edit` model. Inspect its current `input_schema` and `feature_types`; select a model accepting the requested references and parameters. Preserve an explicitly requested model; do not silently substitute one.
3. Write a UTF-8 request JSON in the user's project. Use the discovered public `id` as `model`; the script resolves the distinct backend `model_id`. Put typed parameters in `params`. Bind each local path or URL to an explicit schema field in `inputs`; do not guess a field from a filename.
4. Run `generate --request <request.json> --dry-run`. Check the chosen model, prompt, inputs, and parameters. This performs model discovery and local checks, but no upload or generation. Gateway validation remains authoritative. When generation is requested, proceed with the same request and a new `--job <job.json>` receipt. A request for a preview or prompt alone does not authorize submission.
5. Keep `data.task_id` and the receipt path. Run `task --job <job.json> --wait 60 --download --output-dir <output-dir>`. If pending, continue querying the same task in bounded waits and report progress. A wait expiry is not failure. Read `ok` and `data.status`: command success alone does not mean an image exists.
6. On `status: success`, inspect the downloaded images if image viewing is available. Check subject, composition, reference fidelity, and requested text. Report the files, model, task ID, and visible limitations honestly. Do not claim visual checks when unavailable, or submit extra paid variations without the user's requested scope.

## Recovery

Use `task` to recover an existing task or retry a download. Never repeat `generate` merely because submission or polling timed out. If submission has no task ID and the receipt says `submitting` or `submission_unknown`, reconcile with the Gateway before another generation. Existing receipts deliberately block reuse.

For `no_auth`, ask the user to configure the execution environment; do not ask them to paste a secret into chat, print the credential config, or put keys in commands. For balance, access, invalid parameters, missing result, or upload errors, follow [recovery details](references/commands.md#recovery).

## Resources

- [references/commands.md](references/commands.md): authentication, JSON shape, input binding, commands, and recovery; read before running.
- [scripts/image.mjs](scripts/image.mjs): executable entry point; `--help` returns JSON usage.
- [scripts/runtime.mjs](scripts/runtime.mjs): bundled API, upload, receipt, and download implementation; execute through the entry point, read only to diagnose implementation problems.
- [LICENSE](LICENSE): MIT notice for code adapted from Lingying CLI.
