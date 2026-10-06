# skills.sh 收录验证报告

日期：2026-10-06 · 仓库：github.com/Carlostang050311/skill-hub · skill：`skills/skill-finder`

## 结论速览

| 项目 | 状态 |
| --- | --- |
| CLI 发现 skill-finder | yes（`Found 1 skill: skill-finder`） |
| 试装（触发索引） | yes，装到 `.skillhub/skills-sh-test`，验证后已删除 |
| skills.sh 收录 | listed（仓库页 + skill 详情页均已出现；search 端点尚未同步） |
| `gh skill publish` 校验 | passed（`--dry-run` EXIT=0，仅警告无错误） |
| README 更新 | yes（README.md + README.en.md） |

## 1. 预检：CLI 用法

```
npx -y skills --help        # 第 1 次：npm error ETIMEDOUT（registry.npmjs.org 直连超时），EXIT=1
npm config get registry     # https://registry.npmjs.org/（无代理配置，proxy/https-proxy 均 null）
npm ping                    # 失败，同样报网络错误
npx -y skills --help        # 第 2 次（未换源）：成功，EXIT=0
```

第 2 次输出确认用法：`skills add <owner>/<repo>`、`-y` 跳过提示、`-g` 全局、`find <关键词> --owner <owner>` 搜索、结尾提示 "Discover more skills at https://skills.sh/"。网络为间歇性不通，重试未超过 3 次约束。

## 2. 发现 + 触发索引（试装）

```
mkdir -p F:/Coding/skill-hub/.skillhub/skills-sh-test
cd F:/Coding/skill-hub/.skillhub/skills-sh-test
npx -y skills add Carlostang050311/skill-hub -y        # EXIT=0
```

关键输出：

- `Source: https://github.com/Carlostang050311/skill-hub.git` → `Repository cloned`（本次运行 github.com 直连正常，一次成功）
- `Found 1 skill` → `Skill: skill-finder` + 完整 description（发现确认）
- `79 agents`，安装到 `.\.agents\skills\skill-finder`（universal: Antigravity/Cline/Codex/Cursor/Gemini CLI 等；symlink: Claude Code；skipped: OpenClaw/CodeBuddy/Trae/Trae CN/ZCode，因对应项目目录不存在）
- `Installed 1 skill` → `Done!`

验证与清理：

```
head -4 .agents/skills/skill-finder/SKILL.md    # frontmatter 完整：name: skill-finder + description（2.7K）
rm -rf F:/Coding/skill-hub/.skillhub/skills-sh-test && ls F:/Coding/skill-hub/.skillhub/   # EXIT=0，试装目录已不存在
```

本机正式 skill 目录（`~/.agents/skills` 等）未被触碰；`.skillhub/` 下其余文件为仓库原有内容。

## 3. 收录状态

| 探测点 | 结果 |
| --- | --- |
| https://www.skills.sh/search?q=skill-finder | 结果列表为空（search 端点尚未同步，属预期延迟） |
| `npx -y skills find skill-finder --owner Carlostang050311` | `No skills found for "skill-finder" from owner "carlostang050311"`（EXIT=0，同一 search API） |
| https://www.skills.sh/Carlostang050311/skill-hub | **仓库页已收录**：显示 1 skill、0 total installs、安装命令 `npx skills add carlostang050311/skill-hub`，并列出 skill-finder |
| https://www.skills.sh/Carlostang050311/skill-hub/skill-finder | **skill 详情页已出现**：含 description 摘要、安装命令 `npx skills add https://github.com/carlostang050311/skill-hub --skill skill-finder`、"First seen: Today" |
| https://www.skills.ai | 返回空白页面，无法验证（如实记录） |

判定：**已收录（listed）**——仓库页与 skill 页均可公开访问；search 端点与 CLI `find` 尚未返回结果，属索引同步延迟，非收录失败。

注：skill 详情页显示的安全审计为 Agent Trust Hub — Fail、Socket — Warn（skills.sh 页面原始内容，如实记录，本次未处理）。

## 4. gh skill publish 校验

```
gh skill publish --help     # 可用：校验 Agent Skills 规范并经 GitHub release 发布；--dry-run 只校验不发布
cd F:/Coding/skill-hub && gh skill publish --dry-run    # EXIT=0
```

输出仅警告、无错误：

- `warning  skill-finder / playwright-cli / playwright-component-testing / playwright-trace  recommended field missing: license`（gh 的发现约定覆盖了根级与 plugins/ 下的 skill，故列出 4 个）
- `warning  no active tag protection rulesets found ...`（仓库级建议，非 skill 问题）

校验通过；未执行真正的 publish（会创建 GitHub release，超出本次授权范围，收尾统一提交时再定）。

## 5. README 更新

- `README.md`：「快速开始」之后新增「从 skills.sh 安装」小节：`npx skills add Carlostang050311/skill-hub` + 仓库页链接
- `README.en.md`：同步新增 "Install from skills.sh" 小节，内容对应

改动最小化，未 git commit（按约定收尾统一提交）。

## 6. 失败与不可用项

- `npx -y skills --help` 第 1 次调用：npm registry 直连 ETIMEDOUT → 第 2 次成功（间歇性网络，重试 1 次，未超 3 次上限）
- https://www.skills.ai ：返回空内容，无法用于验证
- 无其他失败项；github.com 克隆一次成功
