---
name: performance
description: Writes and revises Chinese video-generation prompts focused on character performance - event-driven facial timing, gaze, body movement, support, and prop or environment interaction. Use to turn a plot, novel excerpt, script, or action description into video prompts (create), or to revise an existing video prompt (edit) - "写视频提示词", "把这段小说写成视频提示词", "优化/修改这段提示词", "人物表演", or /performance. Text only; does not submit generation jobs (use ly-video for that). Not for scenes without people or for software performance tuning.
---

# Character performance video prompts

Turn story material into video prompts whose characters act through visible, event-driven process, or revise an existing prompt the same way. Deliver copyable text only. Never submit generation jobs; if the user also wants the video generated, hand the finished prompt to `ly-video` or their chosen tool after delivering it.

The core rule: **write the external event, then the visible reaction on each channel, then the end state.** An emotion word ("惊讶", "压抑怒意") is the reading you want viewers to arrive at, never a substitute for action. Text prompts only convey stage intent: they cannot guarantee exact timings, FACS action units, or contact forces, so never write AU codes, numeric intensities, or millisecond curves.

## Choose the mode

- The user says `create` or `edit`: follow it.
- Otherwise use **edit** when the input is itself a video prompt (shot language, `画面描述`, time ranges, `@[图N]`-style references) or the user asks to modify/optimize a prompt; use **create** for plots, novel text, scripts, and action descriptions.
- If both readings are plausible, ask one short question.

Always read [output format](references/prompt-format.md) before writing. Read the theory files the material needs:

- Any emotion word, facial reaction, close-up, dialogue, or listening → [face](references/face.md): look up the plot beat and the emotion at the intended intensity (微弱 / 中等 / 明显), then write the listed visible changes in event order
- Sitting/standing, walking, turning, gestures → [body](references/body.md)
- Props, doors, furniture, handovers, shared objects, obstacles → [environment](references/environment.md)

## Create

1. **Extract** characters (names, identity anchors, any user-supplied `@[图N]` references), objects and their initial states, the event chain, dialogue verbatim, and any duration, aspect ratio, style, or negative constraints the user gave. Do not invent identities or references the user did not provide; invented details go in `说明` as assumptions.
2. **Slice.** If duration is unspecified, use the shortest duration that fits the events, at most 15 seconds per clip. Longer material becomes several clips split at event boundaries. Each clip ends with `结束状态` (positions, what each hand holds, door/object states, residual expression); the next clip starts from exactly that state.
3. **Build a performance card per clip** (internal, not output): external event, character task, baseline; then three tracks linked by before / overlap / after, and only then mapped to approximate time ranges:
   - Face / gaze / head: a concrete gaze target; each local action has onset, peak, release, or residue. Channels do not all start and stop on the same frame.
   - Body / support / path: who bears weight, when support changes, where the character moves.
   - Contact / object state: which body part touches which object part, and the object's before and after state.
4. **Render** the prompt with the create contract in the output format reference.
5. **Self-check** against the distortion checklists in the theory files you read, then fix what fails.

## Edit

1. **List what must survive**: plot events and their order, dialogue text, character names, `@[...]` references and what they are bound to, duration and aspect ratio, section headers such as `【色调】`, and every negative constraint (e.g. 不要字幕, 不要bgm). Change these only when the user explicitly asks.
2. **Diagnose** the original with the distortion checklists: emotion labels without process, reactions with no triggering event, whole-face or whole-body synchrony, missing gaze targets, contact gaps, object-state jumps, speech-versus-mouth conflicts, camera motion confused with body motion, and more action than the duration can hold.
3. **Apply** the user's explicit instruction first, then improve performance, camera, and structure within the survival list.
4. **Surface conflicts** instead of silently deleting content: state the conflict and the resolution you chose (for example, lips pressed only in speech gaps).
5. **Render** the complete revised prompt with `修改说明` and `保持不变`, using the edit contract.

## Rules for both modes

- One main performance per clip; do not mix mutually exclusive actions or gaze choices. Offer a variant only when the user asks or a real ambiguity changes the performance, and say which track differs.
- Dialogue stays verbatim. While a character speaks, readable mouth shapes take priority over lower-face expression; add before/during/after behaviour and, for two-person scenes, a listener track.
- Do not claim evidence the shot cannot show: a close-up cannot prove foot contact or leaving a chair.
- Do not add blinks, asymmetry, tremor, or micro-movements "for naturalness"; each must have a story or event reason.
- Keep camera movement separate from character movement.
- Write in Chinese unless the user's material is in another language, then follow the user's language.
- In `说明`, list assumptions and what plain text cannot guarantee; keep it short.

## Resources

- [references/prompt-format.md](references/prompt-format.md): create and edit output contracts with worked examples; read every time.
- [references/face.md](references/face.md): facial region vocabulary, intensity ladder, emotion × intensity and plot-beat lookup tables, blends and masking, action lifecycle, speech and listener rules, facial distortion checklist.
- [references/body.md](references/body.md): action units, support transfer, turning, gestures with speech, body distortion checklist.
- [references/environment.md](references/environment.md): object cards, contact and support graph, state ledger, interaction scenarios, interaction distortion checklist.
