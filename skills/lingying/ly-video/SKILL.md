---
name: ly-video
description: Generates and edits videos through Lingying (灵影 / EchoJoy) Gateway. Use for “灵影生视频”, “用 ly 生成视频”, “图生视频”, “把这张图动起来”, text-to-video, image-to-video or video-to-video generation with Lingying, or /ly-video. Produces downloadable video files; excludes ordinary timeline editing, image-only generation, and requests that only ask for a storyboard or prompt.
compatibility: Requires Node.js >=22.20, network access to Lingying Gateway, and LY_ACCESS_TOKEN or LY_API_KEY (or an existing ly credential config). No ly CLI or npm install required.
---

# Lingying video generation

Use the bundled [video script](scripts/video.mjs) to produce the requested videos. Resolve its absolute path from this installed skill directory; keep the working directory in the user's project. Do not depend on the source repository or the image skill.

## Workflow

1. Infer the subject, action, shot sequence, camera movement, style, duration, aspect ratio, and reference inputs. Treat first/last frames, audio, and video references as distinct roles. Preserve the user's requested action and timing; use restrained motion defaults when unspecified. Ask only for essential missing choices or references.
2. Read [command and request details](references/commands.md) before the first invocation. Run `node <skill-dir>/scripts/video.mjs models`, then `models --model <exact-id>`. Choose an available `video` or `video_edit` model whose current `input_schema` and `feature_types` support the task. Do not assume every video model accepts images, audio, both endpoint frames, or the same duration/resolution values. Preserve explicit model choices.
3. Write a UTF-8 request JSON in the user's project, using the discovered public `id` as `model`. Put typed duration, aspect ratio, and other supported settings in `params`; bind local files or URLs to their exact schema fields in `inputs`. Keep frame/reference ordering. If the requested duration exceeds model limits, explain the constraint and agree on a shorter clip or multiple clips before changing the deliverable.
4. Run `generate --request <request.json> --dry-run` and inspect the resulting request. This only discovers models and checks local input; it does not upload or submit. When generation is requested, submit the same request with a new `--job <job.json>`. Do not generate media for a storyboard-only or preview-only request.
5. Save `data.task_id` and the receipt. Use `task --job <job.json> --wait 60 --download --output-dir <output-dir>` and continue querying that task when pending. Videos may outlive a tool call or session; retain the receipt for resumption. A wait expiry is not a failed generation. Check both `ok` and `data.status` before claiming completion.
6. Verify downloaded files exist. If playback or probing tools are available, inspect motion, framing, duration, and audio against the request. Report file paths, model, task ID, and which checks were possible. Do not silently regenerate a costly video because the first result is imperfect; explain any mismatch and keep the original output.

## Recovery

Use `task` for existing work and failed downloads. Do not resubmit after a timeout or transient polling failure. When the receipt has no task ID and says `submitting` or `submission_unknown`, reconcile with the Gateway first. For a requested batch, keep one receipt per distinct clip; never reuse one receipt for multiple submissions.

For `no_auth`, ask the user to configure credentials in the execution environment; do not print config contents or put secrets in chat/arguments. Handle gateway balance, access, schema, and upload failures according to [recovery details](references/commands.md#recovery).

## Resources

- [references/commands.md](references/commands.md): authentication, request schema, uploads, polling, and recovery; read before running.
- [scripts/video.mjs](scripts/video.mjs): executable entry point; `--help` returns JSON usage.
- [scripts/runtime.mjs](scripts/runtime.mjs): bundled API implementation, including multipart upload and task resumption; read only for implementation diagnosis.
- [LICENSE](LICENSE): MIT notice for code adapted from Lingying CLI.
