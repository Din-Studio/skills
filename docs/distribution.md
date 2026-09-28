# Skills 分发调研与设计

调研日期：2026-09-27。实测工具：Node.js `22.20.0`、Skills CLI `1.7.0`、Claude Code `2.1.283`。

## 结论

采用单仓库、单份技能源码、两种安装入口：Claude Code 从仓库自带的 marketplace 安装 `echojoy-skills` 插件；Codex、Cursor 等通过 `npx skills` 安装选中的技能。两者读取同一批 `SKILL.md`，无需复制技能树或发布 npm 包。

| 关注点 | 本仓库选择 | 原因 |
| --- | --- | --- |
| 技能源文件 | `skills/<category>/<name>/` | 延续参考仓库分类结构，便于扩充 |
| Claude 入口 | 根目录 `.claude-plugin/marketplace.json` 和 `plugin.json` | 一个仓库同时承载 marketplace 与插件 |
| 插件路径 | `source: "./"` | 相对 marketplace 根目录解析 |
| 插件技能发现 | 显式列出每个技能目录 | 不依赖 Claude 对分类层级的隐式递归 |
| 跨 agent 安装 | Vercel `skills` CLI | 识别标准技能与 Claude 插件清单，支持按技能、agent 和范围选择 |
| 元数据同步 | `npm run sync` | 避免手工维护路径和版本的漂移 |
| 发布方式 | Git 仓库 | Skills CLI 从来源仓库读取文件；npm 仅提供安装器 |
| Codex 原生插件 | 本次不增加 | 需求指定 Codex 经 `npx skills` 安装，无需第二套插件元数据 |

## 参考仓库中保留与调整的部分

检查了本地 `mattpocock_skills`，对应提交 `3cca18b368ae95cdbdebbff572ccafa662551015`，其包版本为 `1.2.3`。它将正式技能放在 engineering、productivity 等分类中，并用插件清单逐一注册，通过脚本同步 package 与插件版本。

本仓库沿用上述组织方式，并把技能路径同步也自动化。不复制参考仓库的业务技能、品牌、许可证或已有 marketplace 身份。当前发布 `ly-image`、`ly-video` 和 `performance`，原维护技能 `echojoy-skill-author` 已移除。

参考仓库 README 说明它已进入官方 marketplace，因此可以直接按插件名安装。新仓库没有这一前提，必须先添加 `Din-Studio/skills` marketplace，再安装 `echojoy-skills@echojoy`。该流程由 [Claude Code marketplace 文档](https://code.claude.com/docs/en/plugin-marketplaces) 明确支持。

## 技能发现与隔离

Agent Skills 的标准单元是一个包含 YAML frontmatter 和指令正文的 `SKILL.md`，其他资源在技能目录内。标准要求 `name`、`description`，并规定名称、长度和相对引用方式。[Agent Skills 规范](https://agentskills.io/specification)

Claude 的 `skills` 字段接受技能容器目录或直接包含 `SKILL.md` 的目录。它是对默认 `skills/` 扫描的补充。因此，插件清单不能当作可靠的文件排除列表。本仓库对每个正式技能生成直接路径，并禁止同名技能。[Claude 插件 manifest 参考](https://code.claude.com/docs/en/plugins-reference)

Skills CLI 支持常规 skills 目录、分类目录以及 `.claude-plugin` 中声明的路径。上游实现还会按名称去重；重名可能导致某个技能被遮蔽。显式路径既适配参考仓库结构，也减少对扫描深度的依赖。[Skills CLI 文档](https://github.com/vercel-labs/skills#skill-discovery)、[插件路径解析源码](https://github.com/vercel-labs/skills/blob/main/src/plugin-manifest.ts)

由此采用以下仓库约定：

- 所有正式技能置于发布树，名称在全仓库唯一。
- 草稿使用 `drafts/<topic>.md` 等普通文件，不命名为 `SKILL.md`。
- 模板使用 `SKILL.template.md`，避免 `--full-depth` 时变成假技能。
- 不把 `.gitignore`、目录名或 Claude 清单当作 Skills CLI 的排除机制。
- 不维护 `.claude/skills`、`.codex/skills`、`.agents/skills` 的源码副本。

## 安装、资源路径和更新

Claude 插件按包安装，技能名包含插件前缀。Skills CLI 可以按技能安装，目标位置由 agent 和安装范围决定。原始分类目录不应出现在技能对安装后位置的假设中；依赖必须随技能携带，或明确要求用户提供外部 checkout。[Claude marketplace 文档](https://code.claude.com/docs/en/plugin-marketplaces)、[Skills CLI 文档](https://github.com/vercel-labs/skills)

Skills CLI 默认采用共享副本与 agent 链接的安装方式，也支持 `--copy`。不要将它误写成始终直接链接源码目录；修改源码后应重新安装本地技能。远程来源安装使用 `update` 管理，本地路径安装主要用于开发检查。[安装方式](https://github.com/vercel-labs/skills#installation-methods)

当前 CLI 的实际帮助列出 `list`、`update`、`remove`，没有 `check`。更新支持 `-p`、`-g` 和指定技能名称，README 使用这些实际选项。CI 固定 `skills@1.7.0`；面向使用者的安装入口保留 `@latest`，后续升级 CI 版本前需重新验证安装流程。

实测 `remove <name> --agent codex claude-code` 后，共享目录可能仍被本机其他已检测到的 agent 使用，因此 CLI 会保留副本。省略 `--agent` 才会清理该技能的所有 agent 安装及共享副本。README 将完全卸载和按 agent 清理分开说明。[Skills CLI 1.7.0 卸载实现](https://github.com/vercel-labs/skills/blob/v1.7.0/src/remove.ts)

Claude 插件显式版本影响缓存更新，所以每次正式发布技能内容都应提升插件版本。版本只在 `package.json` 维护，由脚本同步到插件清单，避免同时在 marketplace 再记录一份。[Claude manifest 的 version 说明](https://code.claude.com/docs/en/plugins-reference#version)

## 验证边界

本地脚本检查 YAML、名称、目录层级、重名、空正文、占位符和清单漂移，并用回归测试验证新增技能、错误元数据和版本更新。Claude 官方校验负责其 manifest schema。真实安装检查负责确认安装器确实产生目标技能文件并保留附带资源。

这些检查不等同于验证模型能正确完成技能任务。新技能仍需通过目标 agent 的真实请求验证触发、执行结果和边界。远程 GitHub 安装还取决于提交已推送、仓库访问权限和网络状态。

以下为初始化时的历史验证记录，当时的维护技能现已移除；当前技能列表见 README，当前校验结果需重新运行验证命令确认：

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 结构、清单及 4 项回归测试通过 |
| skill-creator 的格式校验器 | 基础技能通过 |
| Claude 两份 manifest 的 `--strict` 校验 | 均通过 |
| `npm run test:install -- --claude` | 临时项目中两条安装、列出和卸载流程通过 |
| 安装资源核对 | `SKILL.md`、参考文档、模板与源码逐文件一致 |
| Claude 组件清单 | 识别 1 个技能 `echojoy-skill-author` |
| 模型触发与任务执行 | 尚未进行真实模型会话评测 |
| GitHub 远程安装 | 未验证；本次初始化没有提交或推送 |
