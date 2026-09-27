# EchoJoy Skills

供 Claude Code、Codex 和其他 coding agent 使用的技能仓库。技能源码统一放在 `skills/<category>/<name>/`，通过 Claude Code 插件或 Vercel Skills CLI 安装。

## 安装

远程安装需要本仓库内容已推送到 `Din-Studio/skills`，且安装者有仓库访问权限。尚未发布时，使用下方的本地安装方式。

### Claude Code 插件

在终端运行：

```bash
claude plugin marketplace add Din-Studio/skills
claude plugin install echojoy-skills@echojoy
```

也可以在 Claude Code 会话内执行：

```text
/plugin marketplace add Din-Studio/skills
/plugin install echojoy-skills@echojoy
```

会话内的 install 命令打开插件详情，按界面提示完成安装。重新启动会话后，可调用：

```text
/echojoy-skills:ly-image
```

`echojoy` 是本仓库的 marketplace 名称，`echojoy-skills` 是插件名称。插件安装整个技能集合。有关添加市场和安装流程，参见 [Claude Code 官方文档](https://code.claude.com/docs/en/plugin-marketplaces)。

### Codex 和其他 agents

需要 Node.js 22.20 或更高版本，以及 npm。命令中的包名是 **`skills`（复数）**。

```bash
# 交互选择技能、目标 agent 和安装范围
npx skills@latest add Din-Studio/skills

# 查看可安装技能
npx skills@latest add Din-Studio/skills --list

# 安装到当前项目的 Codex 技能目录
npx skills@latest add Din-Studio/skills --agent codex --skill ly-image -y

# 用户级安装，供多个项目使用
npx skills@latest add Din-Studio/skills --agent codex --skill ly-image -g -y

# 同时安装到多个 agent
npx skills@latest add Din-Studio/skills --agent codex cursor --skill ly-image -y
```

在 Codex 新会话中用 `$ly-image` 调用，或描述通过灵影生成、编辑图片的任务。运行前需配置灵影 Gateway 凭据，见下方的灵影技能说明。

其他 agent 的标识、安装位置和选项见 [Skills CLI 文档](https://github.com/vercel-labs/skills)。Claude Code 也可以通过 `--agent claude-code` 安装独立 skills；同一个 agent 建议选用一种安装方式，避免重复加载。

### 本地开发和安装

在本仓库根目录运行：

```bash
# 仅在这次 Claude Code 会话加载本地插件
claude --plugin-dir .

# 或注册本地 marketplace 并安装
claude plugin marketplace add .
claude plugin install echojoy-skills@echojoy
```

给 Codex 等 agent 测试安装时，在另一个项目目录执行，传入本仓库绝对路径：

```bash
npx skills@latest add /absolute/path/to/EchoJoySkills --agent codex --skill ly-image -y
```

本地路径安装适合开发验证；远程更新管理使用 GitHub 来源的安装。私有仓库需要已有 Git/SSH 访问权限，也可将来源写为 `git@github.com:Din-Studio/skills.git`。

## 管理已安装内容

Claude Code 插件：

```bash
claude plugin list
claude plugin marketplace update echojoy
claude plugin update echojoy-skills@echojoy
claude plugin uninstall echojoy-skills@echojoy
```

更新后重新启动会话。自建 marketplace 的自动更新由用户设置控制，不假定默认开启。

通过 Skills CLI 安装的技能：

```bash
# 查看当前项目或用户级安装
npx skills@latest list --agent codex
npx skills@latest list -g --agent codex

# 按来源更新指定技能
npx skills@latest update ly-image -p -y
npx skills@latest update ly-image -g -y

# 从当前项目的所有 agents 移除该技能
npx skills@latest remove ly-image -y

# 从用户级安装的所有 agents 移除该技能
npx skills@latest remove ly-image -g -y
```

若只移除特定 agent 的链接，可添加 `--agent claude-code` 等过滤条件；其他 agent 仍使用的共享副本会保留。Codex 等直接读取共享目录的 agent 可能仍能发现它。

这里的管理命令经过 Skills CLI `1.7.0` 核对；该版本没有 `skills check` 命令。`@latest` 会随上游变化，仓库 CI 固定版本以便复现。

## 技能

| 技能 | 类别 | 用途 |
| --- | --- | --- |
| [ly-image](skills/lingying/ly-image/SKILL.md) | lingying | 通过灵影 Gateway 生图、图生图和图片编辑，下载结果并恢复异步任务 |
| [ly-video](skills/lingying/ly-video/SKILL.md) | lingying | 通过灵影 Gateway 文生视频、图生视频和视频编辑，支持参考素材上传与任务恢复 |

### 灵影生图与生视频

两个技能均自带调用脚本，可独立安装，不需要 `ly` CLI、Go、原项目源码或额外 npm 依赖。运行需要 Node.js 22.20+ 和灵影 Gateway 凭据。

```bash
npx skills@latest add Din-Studio/skills --agent codex --skill ly-image ly-video -y
```

在新会话中使用 `$ly-image` / `$ly-video`，或 Claude 插件命令 `/echojoy-skills:ly-image` / `/echojoy-skills:ly-video`。例如：“用灵影生成一张暖色调的橘猫插画”或“用灵影把这张图片生成镜头缓缓推进的视频”。技能会发现当前模型和参数，提交任务并下载结果。

通过运行环境配置 `LY_ACCESS_TOKEN` 或 `LY_API_KEY`，也可以复用已有的 `ly` 私有配置文件；不要把凭据粘贴到对话或命令参数中。生成请求会调用灵影服务并按服务规则计费。模型、支持的参数和价格以实时发现结果为准。

每次生成会在目标项目保存任务记录。中断后提供记录路径或任务 ID，即可继续查询与下载。预览不会上传或提交，查询失败也不会自动重新生成。调用细节见各技能的 `references/commands.md`；迁移范围、研究依据和验证边界见 [灵影技能设计说明](docs/lingying.md)。

## 开发

```bash
npm ci
npm run sync
npm run check
npm run test:install
```

安装技能不需要在本仓库执行 `npm install`，也不需要把这个仓库发布到 npm。`package.json` 为维护者提供校验和版本管理工具。

```text
.claude-plugin/
  marketplace.json          Claude Code marketplace 入口
  plugin.json               插件元数据及生成的技能路径
skills/
  lingying/
    ly-image/               生图技能及独立脚本
    ly-video/               生视频技能及独立脚本
scripts/manifests.mjs        发现、验证技能并同步清单
scripts/lingying/runtime.mjs 灵影脚本的维护源
scripts/sync-lingying.mjs    将运行时同步到两个独立技能
tests/                      清单行为测试
docs/distribution.md        调研依据与分发设计
.github/workflows/validate.yml
```

添加技能、验证安装和发布版本，见 [贡献指南](CONTRIBUTING.md)。目录与分发方式的选择，见 [调研与设计说明](docs/distribution.md)。
