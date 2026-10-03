# skill-hub

本地优先的 Agent Skill 管理与评测平台：把散落在多个 agent 目录的 skill 变成带元数据的数据库 + 可执行的评测闭环。

## 开工五项

- **背景痛点**：skill 散落在 `~/.agents/skills`（115 个）、`~/.claude/skills`（33 个）、ZCode/Claude 插件缓存等多处，同名重叠、内容漂移无人知道；挑 skill 靠猜（部分客户端把超长 description 截断到约 250 字符）；写完 skill 没有质量反馈闭环。
- **需求输出格式**：本地全栈 Web 应用 + CLI（npm 包形态），SQLite 存储，中文 UI，评测报告可导出 markdown/HTML。
- **约束边界**：Windows + Git Bash 优先（规避已知坑：CRLF、路径、python Store 桩——全用 Node 生态规避）；纯本地运行不依赖云服务；开源 ready；评测 provider 双后端（ZCode 子代理跑批 + OpenAI 兼容 API 接口）。
- **参考范例**：skills.sh / vercel-labs skills CLI（发现+安装）、Promptfoo（评测思路）、LobeHub marketplace。
- **验收标准**：每阶段末有可运行的验证命令 + 真实渲染检查，逐条写入交付说明。

## 工程规则

1. 必须创建对应的 git commit，以便后期跟踪和管理。
2. 必须编写和更新相关的测试，交付前所有测试必须全绿（`npm test`）。
3. 交付前必须真实运行验证：CLI 跑真实 skill 目录，Web 页面真实打开渲染检查。
4. Windows 环境：源文件统一 LF（`.gitattributes` 强制）；路径处理一律 `node:path`，不手拼字符串。
5. 分阶段交付：Phase 0 索引核心+CLI → Phase 1 Web UI → Phase 2 评测框架 → Phase 3 分发同步，每阶段独立验收。

## 架构

npm workspaces monorepo，TypeScript 全栈：

- `packages/core`：多目录 scanner、frontmatter parser、内容指纹去重、静态质量信号、依赖图谱
- `packages/cli`：commander，`skillhub scan | list | search | show | roots`
- `apps/web`（Phase 1）：Next.js 15 + Tailwind + Drizzle ORM/SQLite
- `apps/eval`（Phase 2）：评测 runner，scenario YAML + rubric 分层打分
