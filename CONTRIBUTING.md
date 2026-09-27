# 维护 EchoJoy Skills

## 添加技能

在源码 checkout 中工作。安装后的插件缓存和 agent 技能目录是分发结果，不是源码。

1. 在 `skills/<category>/<name>/` 新建技能，例如 `skills/productivity/meeting-notes/`。已有分类可直接复用；只在需要时增加新分类。
2. 编写 `SKILL.md`，提供 YAML `name`、`description` 和实际任务指令。`name` 与目录名一致，且在整个仓库内唯一。
3. 将需要的脚本、参考资料和模板放在技能自己的目录里，并从 `SKILL.md` 链接。不要依赖相邻技能一定已安装。
4. 在 README 技能表中添加入口。
5. 执行校验和安装检查。

可使用 Skills CLI 生成初始文件：

```bash
mkdir -p skills/productivity
cd skills/productivity
npx skills@latest init meeting-notes
```

完成指令内容并删除占位符后，再同步清单。所有 `skills/` 内的 `SKILL.md` 都属于发布内容；草稿放在 `drafts/`，使用 `proposal.md` 等普通文件名。模板也不能叫 `SKILL.md`。

`skills/<category>/<name>/` 是本仓库约定，不是 Agent Skills 标准强制的分类结构。格式依据见 [Agent Skills 规范](https://agentskills.io/specification)。

## 验证

在仓库根目录执行：

```bash
npm ci
npm run sync
npm run check
npx --yes skills@1.7.0 add . --list
npm run test:install
```

`sync` 根据 `skills/` 和 `package.json` 更新插件路径、名称、描述及版本。`check` 只检查，不修改文件。不要手动维护 `plugin.json` 的 `skills` 数组。

灵影技能的公共运行时维护在 `scripts/lingying/runtime.mjs`；`npm run sync` 会生成两份技能内的 `scripts/runtime.mjs`，`npm run check` 检查副本一致性。不要直接修改生成副本。每个技能的入口、指令和参考文档仍放在各自目录内；安装后的执行不依赖维护脚本或相邻技能。修改运行时后运行 `tests/lingying.test.mjs` 中的本地 HTTP 协议测试，不需要生产凭据或付费任务。

`test:install` 在系统临时目录安装、列出并卸载技能，核对每个技能目录的全部文件。已安装 Claude Code 时，可运行 `npm run test:install -- --claude`，同时验证 marketplace 安装和技能清单。脚本使用临时 `CLAUDE_CONFIG_DIR`，不会把测试插件注册到日常用户配置。

安装了 Claude Code 时，还应执行官方校验：

```bash
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
claude --plugin-dir .
```

在启动的会话中检查 `/echojoy-skills:<name>`，用一个实际请求运行技能。再测试一个不应该触发该技能的相近请求。为 Codex 验证时，在临时项目中通过 `npx skills` 安装该技能，重新启动 agent，并执行同样的任务。校验通过与实际行为正确需要分别确认。

CI 执行格式与清单校验、清单回归测试，以及固定版本的 Skills CLI 发现和真实安装检查。CI 不调用付费模型，也不证明技能能正确处理所有请求。

## 更新和删除

修改技能后执行相同校验。删除或重命名技能时，更新调用方和 README，然后运行 `npm run sync`。Skills CLI 按名称选择技能，重命名会改变安装标识；发布说明应告诉使用者如何移除旧名称并安装新名称。

不要用 `.gitignore`、移除清单条目或 `in-progress` 目录名当作安装隔离。Skills CLI 和 Claude Code 有各自的发现规则，仓库只在发布树内保留正式技能。

## 发布版本

`package.json` 是版本来源。准备发布时执行：

```bash
npm version patch --no-git-tag-version
npm run check
```

`npm version` 会调用仓库的 `version` 脚本，同步 `.claude-plugin/plugin.json`。按变更需要将 `patch` 改为 `minor` 或 `major`。检查 `package.json`、`package-lock.json` 和插件清单都已更新。

审阅后提交并推送这些文件及技能内容到默认分支。首次推送完成后，README 的 GitHub 安装命令才可使用。没有 npm 发布步骤。Claude 插件内容变更需要随发布提升版本，否则缓存可能继续使用旧版本；marketplace 不再复制一份插件版本。

维护者决定许可证后，再增加对应许可证文件和元数据；本次初始化没有替仓库选择开源许可证。
