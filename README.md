# skill-hub

[中文](README.md) | [English](README.en.md)

本地优先的 Agent Skill 管理与评测平台：把散落在多个 agent 目录的 skill 变成带元数据的数据库 + 可执行的评测闭环。

![总览](docs/screenshots/01-overview.png)

## 为什么

Skill 本质 = frontmatter（name/description）+ 正文指令 + 附属资源文件。围绕它只有三个根本问题：**发现**（我有什么、哪个适用）、**质量**（好不好用没信号）、**分发**（怎么装进 N 个 agent 目录并保持同步）。市面工具只做了分发（skills.sh 等）；skill-hub 补上本地库存管理、跨目录同步检测与质量评测——评测是护城河：静态 lint 抓格式问题，模型评测抓语义问题。

## 功能

- **索引**：扫描 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills` 与 Claude/ZCode 插件缓存，解析 frontmatter，内容指纹去重、静态质量信号（description 截断风险、缺失资源引用、name 规范等）、显式引用 + 正文提及两路依赖信号
- **Web UI**（Next.js 15）：总览、技能库搜索、详情（正文渲染 + 引用/提及网络 + 一键安装）、依赖图谱（链接实线 / 提及虚线）、同步状态（漂移检测 + 一键对齐）、评测报告
- **评测框架**：scenario YAML（触发正/反用例）→ `plan` 生成作业 → 模型端跑批（ZCode 子代理或 OpenAI 兼容 API）→ `ingest` 三层评分入库（触发 40% + 清晰度 30% + 静态 30%）
- **分发同步**：`install/uninstall/outdated/pack`，同名多副本按 agents > claude > codex 选源，冲突需 `--force`
- **GitHub 生态**：`github-install <owner/repo>`（发现 SKILL.md → 查重 → 安装 → 登记来源）、`origins` 上游注册表、`outdated-remote` 目录指纹对比上游（`--apply` 一键更新）
- **agent 查库**：`recommend "<任务描述>"` 按任务推荐 skill（中英文关键词 + 质量信号参与排序），配套 meta-skill `skill-finder` 让编码代理干活前自动查库（随仓库 `skills/` 目录分发）

![依赖图谱](docs/screenshots/04-graph.png)

## 快速开始

```bash
npm install
npm run build
npm test                       # Vitest 全量测试

npm run skillhub -- scan       # 扫描本机全部 skill 目录
npm run skillhub -- list       # 列出全部 skill
npm run skillhub -- recommend "把这篇文章做成小红书图文卡片"

npm run start -w @skillhub/web # Web UI → http://localhost:3457
```

更多命令见 [README 使用手册](README.md#快速开始)：评测、GitHub 安装、分发同步。

![评测报告](docs/screenshots/11-eval-run3.png)

## 真实运行数据

在本机 300+ 个真实 skill 的库上：

- 索引 317 个 skill，发现 83 组同名、8 组内容漂移、3 个坏 frontmatter（未加引号的 description 含 `": "`）
- 评测 4 轮（24 个 skill、171 个作业）：触发准确率 100%，抓出 description 缺失、正文自相矛盾、依赖不匹配等真实缺陷
- 上游检测抓到歸藏仓库的真实更新

## 架构

npm workspaces monorepo，TypeScript 全栈：

```
packages/core   索引/解析/指纹/质量信号/图谱/分发/GitHub/推荐
packages/cli    skillhub 命令行
apps/web        Next.js 15 + Tailwind v4 仪表盘
apps/eval       评测 runner + node:sqlite 报告库
```

## License

[MIT](LICENSE)
