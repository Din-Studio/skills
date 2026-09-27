# Repository guidance

This repository distributes the same skills through a Claude Code plugin and the Vercel Skills CLI.

- Keep publishable source at `skills/<category>/<name>/SKILL.md`. Skill names must be unique across categories and match their directory names.
- Keep each installable skill self-contained. Installed skills may be flattened and installed individually. Repository maintenance skills must explicitly locate a source checkout before using repository-level helpers.
- Drafts and templates must not be named `SKILL.md`. Do not place drafts in `skills/`.
- Treat `package.json` as the source for plugin name, description, and version. Run `npm run sync` after changing these or adding/removing skills; do not hand-maintain the manifest skill list.
- Run `npm run check` and `npx --yes skills@1.7.0 add . --list` before handing back changes. If Claude Code is installed, validate both manifest files with `claude plugin validate <file> --strict`.
- Test installation in a temporary target project, not inside this source tree. Do not change the user's global agent configuration to test repository packaging.
- Use Chinese for repository-facing documentation unless the task asks otherwise. Skill instructions may use English for portability.
- Read `CONTRIBUTING.md` for authoring and release procedures and `docs/distribution.md` for packaging decisions.
