# skill-hub

本地优先的 Agent Skill 管理与评测平台：把散落在多个 agent 目录的 skill 变成带元数据的数据库 + 可执行的评测闭环。

## 为什么

Skill 本质 = frontmatter（name/description）+ 正文指令 + 附属资源文件。围绕它只有三个根本问题：**发现**（我有什么、哪个适用）、**质量**（好不好用没信号）、**分发**（怎么装进 N 个 agent 目录并保持同步）。市面工具只做了分发（skills.sh 等）；skill-hub 补上本地库存管理和质量评测。

## 当前状态

- **Phase 0 已完成**：索引核心 + CLI。扫描 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills` 与 Claude/ZCode 插件缓存，解析 frontmatter，计算内容指纹（跨目录去重/漂移检测）、静态质量信号（description 截断风险、缺失资源引用、name 规范等）、显式引用与正文提及两路依赖信号。
- **Phase 1 已完成**：Web UI（Next.js 15 + Tailwind v4，端口 3457）。六个页面：总览、技能库（搜索/来源筛选）、skill 详情（正文渲染 + 引用/提及网络 + 安装到其他 agent 目录）、依赖图谱（链接实线 / 提及虚线）、同步状态（同名漂移检测 + 一键对齐最新）、评测体检。
- **Phase 2 已完成**：评测框架（`apps/eval`）。scenario YAML（触发正/反用例）→ `skillhub-eval plan` 生成作业 → 模型端跑批（ZCode 子代理或 OpenAI 兼容 API）→ `skillhub-eval ingest` 评分入库（`~/.skillhub/eval.db`）→ Web /eval 页展示报告。三层评分：触发准确性 40% + 指令清晰度 30% + 静态质量 30%。
- **Phase 3 已完成**：分发同步。`skillhub install/uninstall/outdated/pack`：一键安装（同名多副本按 agents > claude > codex 选源，冲突需 `--force`）、卸载、按修改时间的落后检测、导出带 manifest 的发布目录（推 Git 仓库即可被 skills.sh 索引）。Web 端 `POST /api/install` + 同步页「对齐最新」按钮；插件缓存目录只作来源不作安装目标。
- **v1.1 已完成**：GitHub 生态与 agent 查库。`github-install <owner/repo>`（SSH→HTTPS 自动回退克隆、发现 SKILL.md、查重安装、自动登记来源）、`origins` 来源注册表、`outdated-remote`（目录指纹对比上游，`--apply` 一键更新）、`recommend`（任务描述→推荐 skill，中英文关键词 + 质量信号参与排序），并配套 meta-skill `skill-finder` 让编码代理在干活前自动查库。

## 快速开始

```bash
npm install
npm run build
npm run skillhub -- scan    # 扫描本机全部 skill 目录
npm run skillhub -- list    # 列出全部 skill
npm run skillhub -- search <关键词>
npm run skillhub -- show <name>
npm run skillhub -- roots

npm run start -w @skillhub/web   # Web UI → http://localhost:3457

# 分发同步
npm run skillhub -- install tdd --to claude    # 安装到指定 agent 目录（冲突需 --force）
npm run skillhub -- outdated                   # 同名多副本的落后检测
npm run skillhub -- uninstall tdd --from claude
npm run skillhub -- pack tdd --out dist        # 导出发布目录 + manifest

# GitHub 生态
npm run skillhub -- github-install anthropics/skills --list   # 发现远程仓库里的 skill
npm run skillhub -- github-install op7418/guizang-social-card-skill --to agents
npm run skillhub -- origins list                # 上游来源注册表（github-install 自动登记）
npm run skillhub -- origins add <name> <owner/repo>   # 手动导入的 skill 补登记
npm run skillhub -- outdated-remote             # 对照 GitHub 上游检测更新（--apply 应用）

# 让 agent 自己查库
npm run skillhub -- recommend "把这篇文章做成小红书图文卡片"   # 按任务描述推荐 skill
# 已配套 meta-skill：~/.agents/skills/skill-finder

# 评测（ZCode 子代理后端）
npm run skillhub-eval -- plan --scenarios scenarios --out .skillhub/eval-jobs.jsonl
# …模型端执行作业 JSONL，产出结果 JSONL（每行 {"id","raw"}）…
npm run skillhub-eval -- ingest --jobs .skillhub/eval-jobs.jsonl --results .skillhub/eval-results.jsonl
```

常用参数：`--json`（JSON 输出）、`--home <dir>`（覆盖主目录）、`--root <path>`（追加目录，可重复）、`--only-custom`（只扫指定目录）。

## 开发

```bash
npm test    # Vitest 全量测试
npm run build
```

工程规则见 [AGENTS.md](AGENTS.md)：每次修改必须有 commit，测试全绿才交付。
