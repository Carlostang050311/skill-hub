---
name: skill-finder
description: "在动手之前先查本机 skill 库：当用户提出任务请求，而你不确定库里是否已有现成 skill、或想在多个候选 skill 里挑最合适的时，用 skillhub recommend 按任务描述检索并推荐。适用：用户说'有没有能做 X 的 skill'、'用现成工具做这件事'、任务看起来像某个 skill 的典型场景、或你记忆里的 skill 与实际安装情况可能不一致。不适用：用户已明确指定用哪个 skill、任务明显没有对应 skill。"
---

# Skill Finder —— 先查库，再动手

本机装了 300+ 个 skill，散落在 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills` 和插件缓存里，而且**你记忆中的 skill 列表可能过时**（库会被随时导入新 skill）。接到任务时，先花一条命令查库，避免重复造轮子或漏用现成能力。

## 用法

把用户的任务描述（保留原话里的领域关键词，中英文都可以）传给：

```bash
npm run skillhub -- recommend "<任务描述>" --limit 5
# 或直接跑构建产物
node <skill-hub 仓库>/packages/cli/dist/cli.js recommend "<任务描述>"
```

skill-hub 仓库位于 `F:\Coding\skill-hub`。输出是带匹配分和命中原因的排序列表。

## 决策规则

1. **匹配分 ≥ 25 且第一名明显相关** → 直接采用该 skill，向用户说明"库里已有现成的：X"。
2. **第 1、2 名分数接近（差 ≤ 5）** → 给用户摆出两个候选和各自理由，让用户挑；不要擅自替用户在同类 skill 里二选一。
3. **推荐条目带质量警告/截断惩罚** → 提一句"这个 skill 有 N 条质量警告，详见 skill-hub Web 界面"，别隐瞒后直接用。
4. **没有任何推荐或分数 ≤ 10** → 如实告诉用户库里没有现成的，按普通流程干活；不要硬凑。
5. 推荐 ≠ 承诺：recommend 只匹配说明书（name/description），不保证执行效果。第一次用某个 skill 完成任务后，建议用户去 skill-hub 跑一轮评测。

## 示例

用户："帮我把这篇评测文章做成小红书图文卡片"

```bash
npm run skillhub -- recommend "把评测文章做成小红书图文卡片"
# 1. html-anything-card-xiaohongshu  匹配分 35
# 2. guizang-social-card-skill  匹配分 27
```

两个候选分数接近 → 按规则 2，摆给用户挑；若用户不挑，用匹配分高的那个。

## 维护

- 这个 skill 依赖 skill-hub 项目（`F:\Coding\skill-hub`）已构建（`npm run build`）。
- 上游仓库更新后：在 skill-hub 里跑 `npm run skillhub -- outdated-remote --apply` 同步。
