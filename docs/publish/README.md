# 构建记发布指南

主稿：[docs/build-story.md](../build-story.md)（5998 字，已去 AI 味）。各平台正文直接粘贴主稿全文，以下是每个平台需要额外准备的东西。

## 掘金（主发）

- 标题：`1 亿 token，两天，一个 Agent Skill 管理平台——skill-hub 构建记`
- 摘要（填「编辑推荐语」）：
  > 领到 1 亿 token 额度后，我决定做一个市面上没有的东西：agent skill 的本地管理与评测平台。两天时间、四个阶段、97 个测试、9 轮评测——这篇记录每个决策、每笔 token 花销，和踩过的每一个坑。
- 标签（最多 3 个）：`AI 编程` `Agent` `开源项目`
- 封面：可用 docs/screenshots/01-overview.png 裁 16:9
- 发布后把 link 加到 README.md 的「真实运行数据」节末尾

## 知乎（同步）

- 回答体或文章体均可；建议发想法+文章：想法用一句话钩子（"给 AI agent 用的 skill 积累了 300 多个之后，我发现没人管它们的质量"），文章正文同掘金
- 知乎对代码块渲染良好，无需改动；开头补一句「本文首发于掘金」
- 话题：`AI 编程` `Claude` `程序员`

## 小红书（引流）

- 文案：[docs/xiaohongshu-card.md](../xiaohongshu-card.md)
- 卡片图：用本机 `guizang-social-card-skill` 生成（3:4 三连图），内容取文案要点；生成后在 skill-hub 的 /eval 页确认它执行级评分 100（没错，这个 skill 我们评测过）

## 节奏建议

掘金先发 → 24 小时后知乎同步（避免平台查重）→ 小红书当天跟进。所有外链统一指向 GitHub 仓库与质量榜：https://carlostang050311.github.io/skill-hub/leaderboard/
