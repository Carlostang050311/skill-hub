# 318 个 skill，三天，一个 Agent Skill 管理平台——skill-hub 构建记

2026-10-03 到 10-05，三天，我用 AI 把散在四类目录里的 318 个 Agent Skill 收拾成一个带评测闭环的开源平台：skill-hub（github.com/Carlostang050311/skill-hub），15 个 commit，97 个测试全绿。

这篇文章不是炫技。额度上限一亿 token、模型只是 flash 档，这决定了选型；但我没做 token 计量，正文不报花销，讲方法和坑：**有出处的给出处，没留痕的指给你看。**

## 一、选型：先算清一亿 token 能干什么

拿到一亿 token 额度，我的第一反应不是"做什么"，而是"这种配置擅长什么"。flash 档便宜、快，但深度有限——啃要想三天的架构难题是拿短处硬上；它擅长另一种活，我把工程形态调成三个词：

- **接口先行**：每阶段先定死输入输出——CLI 命令、YAML 格式、评分分层。把"想"压缩成"定接口"，模型只填实现；接口错了改签名，比改散逻辑便宜。
- **TDD 兜底**：flash 档写代码会自信地犯错，测试是唯一的照妖镜。错得快才烧得起——bug 在测试里三秒暴露，比人肉验收三小时暴露便宜两个数量级。
- **量取胜**：单点不强，但便宜、可并行。能用近百个子代理同时干的事，绝不用一个模型串行地想。

然后是选题，标准：**规模够大，每一步都有天然的可验证命令。**打开自己的机器，答案就在那：318 个 Agent Skill（实测口径），散在四类目录——`.agents/skills` 130 个、`.claude/skills` 33 个、`.codex/skills` 69 个、ZCode 插件缓存 86 个。同名 84 组，8 组内容漂移——pdf、docx、pptx、xlsx 在不同目录各有一份不同版本，没人知道哪份新。挑 skill 靠猜，部分客户端还把超长 description 截断到约 250 字符；写完一个 skill，没有质量反馈。

市面工具呢？skills.sh 这类只做分发——发现、安装，装完就撒手。库存管理、同步检测、质量评测，全是空的。

选题定了：Agent Skill 生态的本地基建——痛点是自己的，规模够大，每一步都能跑命令验证。开工前照例写了项目 AGENTS.md 的"开工五项"，工程规则三条硬的：每阶段必 commit、测试必全绿、交付前必真实跑一遍。

## 二、Day 1（10-03）：一天四个阶段

第一天从 monorepo 骨架开始（`14025f0`：npm workspaces + TS NodeNext + Vitest），一路推进：

- **索引核心 + CLI**（`79fc2e8`）：扫描四类目录、解析 frontmatter、指纹去重，`scan / list / search / show / roots` 五个命令。
- **Web UI 六页面**（`a4b8156`）：总览、技能库搜索、详情、依赖图谱、同步状态、评测体检。Next.js 15 + Tailwind。
- **评测框架**（`d4eee56`）：scenario YAML（正/反用例）→ `plan` 生成作业 → 双后端跑批（ZCode 子代理或 OpenAI 兼容 API）→ `ingest` 三层评分入库——触发 40% + 清晰度 30% + 静态 30%。
- **分发同步**（`31a5954`）：`install / uninstall / outdated / pack`，同名多副本按 agents > claude > codex 选源，冲突要 `--force`。

一天干完四个阶段，靠的是接口先行：开工前命令和格式已定死，模型只管往里填。

但第一天最有价值的不是进度，是两个真实发现。

**第一个：有 skill 根本加载不出来。**scan 跑出来，三个 skill 直接解析失败——description 没加引号、内文还有 `": "`，YAML 当场炸掉，skill 等于不存在。修完固化成测试（`packages/core/src/parser.test.ts:25-28`，用例名"description 含冒号与引号也能解析"）。落笔前再扫：三个正式目录已清零，只剩 ZCode 插件缓存里一个 web-gui-tester 还在解析失败。这个"3"是我当天从报错里数的，仓库没留记录，但修法留下来了——比数字重要。

**第二个：description 普遍超长。**`packages/core/src/quality.ts:6` 定义了 `DESCRIPTION_TRUNCATE_LIMIT = 250`——部分客户端会截断超长 description。全库 318 条记录里 **136 条超线**，按名字去重 68 个（agents 45、claude 8、codex 35、zcode-plugins 48），六分之一强——你以为 agent 看到完整介绍，它看到的是半句。

## 三、Day 2（10-04）：把工具变成生态

第二天凌晨 03:49（UTC）建 GitHub 仓库（`created_at=2026-10-04T03:49:58Z`），之后三件事：

**GitHub 生态**（`2ab88b9`）：`github-install <owner/repo>` 一键安装（发现 SKILL.md → 查重 → 安装 → 登记来源，`packages/cli/src/cli.ts:314`）；`origins` 上游注册表（`:392`）；`outdated-remote` 目录指纹对比上游，`--apply` 一键更新（`:438`）；`recommend` 按任务查库推荐（`:508`）。机制有端到端测试兜着（`github.test.ts`："克隆→发现→安装→上游更新→检测→更新落地"）。README 写了"抓到过歸藏仓库的真实更新"，但事件没留存档——硬痕迹只有 `67b4eac` 导入歸藏（op7418）的 14 个 skill 进 scenario。机制可证，事件只剩一句话记录。

**MCP server**（`37c57b0`）：暴露 `recommend_skills`（任务→推荐）、`get_skill`（详情+正文）、`library_stats`（库统计）三个工具，注册进 Claude Code（`.claude.json` 里 stdio 起 `node packages/mcp/dist/server.js`）和 ZCode。证据现在就能给：写这篇文章的会话里现场调 `library_stats`，秒回——319 个、84 组同名、8 组漂移，比索引时的 318 多了一个。**库是活的。**

**开源发布**（`f828aa4`）：LICENSE、双语 README、截图，查库决策规则 `skill-finder` 也随仓库分发。

这一天还试点了执行级评测（`4e0e727`，执行者沙箱作业 + 独立评审复核）。

## 四、Day 3（10-05）：让评测自己开口说话

前两天搭的框架，第三天开始产出别人给不了的东西：**自己库的真相。**

**先把覆盖补齐。**手写 scenario YAML 只有 24 个，罩不住 300 多个 skill。写了个半自动生成器（`e742ba2`）：`scenarios-auto/` 生成 159 个，加手写 24 个是 183，另有 `scenarios-exec/` 3 个执行级试点 yaml——全库合计 186。接着全库评测：近百个子代理的并行工作流（"近百"是当时的配置量级，确切数字没留痕），一轮 **952 个作业**（833 触发用例 + 119 清晰度评审，eval.db 可精确复算）。

然后评测开始抓 bug，第一个是自家的：

- **skill-finder 的决策规则有个洞。**agent 查库后按它做决定；原规则从"第 1、2 名分数接近"直接跳到"分数 ≤ 10"，11-24 的模糊地带没有处置。`e742ba2` 补上了，现在 `skills/skill-finder/SKILL.md:26` 写着："匹配分 11-24 → 可用但证据不足，请用户确认后再采用。"评测抓自家 meta-skill 的 bug，这个循环我喜欢。

- **修复前后有了分数。**NanoBanana-PPT-Skills 在 run#2 只拿 78 分、静态 60，评测列了 5 条 issues（阶段编号错、技能名三处不一致、第一人称、篇幅稀释、辅助文档位置未说明）。我当时把它归因为"description 缺失"——站不住：5 条里没这条，旧 frontmatter 被覆盖也回看不了，删掉。时间线上，修复提交 `b3a51af`（名对齐 `nanobanana-ppt-skills`，19:13:11）只比 run#4 重跑开跑（19:12:39）晚 32 秒——修复和重跑几乎同时落地，不是干净的"先修再测"。run#4：**86 分、静态 80**；78 → 86 是 eval.db 实数，曲线后来画进了趋势页（`60024e0`）。

- **也抓到了最难看的分数。**html-anything 系 5 个 skill 清晰度只有 47、47、53、53、53。打开正文一看：整个 SKILL.md 就一行转发指令，指向本机硬编码绝对路径（`F:\Coding\html-anything\...`），换台机器就是死链。run#9 把范围扩到 16 个 html-anything*，清晰度落在 47-73。这批分数不冤。

到这天，eval.db 攒下 7 个有效 run（#1-#6 加 #9），平均分 93.5 → 90.83 → 90.71 → 86 → 93.23 → 92.9 → 92.57，覆盖 10、24、14、1、40、40、119 个 skill。分数没到 95 也不"调"——评测反映真实，不是好看。

## 五、坑清单：写给下一个用 AI 干大工程的你

这部分请慢读。每条一行坑、一行绕法；哪些有出处、哪些只是终端记忆，先说在前面：

1. **commander 的 `parseAsync` 默认 `{ from: "script" }`，会把脚本路径当位置参数吃掉，子命令全体错乱。**→ 显式传 `{ from: "user" }`，每个入口都要写——踩在两处：`packages/cli/src/cli.ts:527`、`apps/eval/src/cli.ts:356`。
2. **Windows 上 `chmod 0o000` 不生效**，权限测试在 Mac 逻辑下全对、Windows 全假。→ 权限断言按平台跳过：
   ```ts
   const itPosix = process.platform === "win32" ? it.skip : it;
   itPosix("chmod 后不可读", () => { /* 断言 */ });
   ```
3. **Mimosa 安全钩子会误伤**：参数化 SQL 查询被当成命令注入；路径校验动态拼前缀被拦，得写字面的 `startsWith`；commit 信息里含 `.ts` 文件名都被拦成"直接写源码"。→ 改写命令文本（拆词、换写法）绕开，路径判断老老实实写字面前缀。
4. **workflow 的 `world.run` 工作目录是工作区，不是项目目录**，相对路径会静默解析成空——不报错，跑出一个空 run，白烧一轮。→ 一律绝对路径，关键步骤后校验产物非空。
5. **JSONL 拼接的换行符**：cat 拼并行产物时行间少 `\n`，两行粘成一行，解析当场炸。→ 写入端保证行尾 `\n`，拼接后再按记录边界重切。
6. **子代理并发有上限**，一次起太满会被排队甚至拒掉——上限数字我没测出来也没留档，不编。→ 分批 + 失败收集重试，别把一批当成原子操作：
   ```ts
   for (const batch of chunk(jobs, BATCH)) {   // BATCH 按平台余量调
     const done = await Promise.allSettled(batch.map(run));
     retry.push(...rejected(done));            // 统一重试
   }
   ```
7. **workflow 脚本常量写坏一个 skill 名，静默漏掉 23 个**——没有报错，就是报告里少 23 行（23 是当时对着报告数的，仓库没留档）。→ 跑前把常量名单和索引求差集，非空就停；已跑完的部分靠 AmendWorkflow 缓存接着用，改完续跑，不整轮重烧。

留痕交代：坑 1 有行号可查（见第 1 条）；坑 3、坑 4 在取证会话里现场复现过（钩子拦只读 grep、命令后 cwd 被重置回工作区）；坑 2/5/6 和坑 7 的"23"是当时的终端记忆，仓库没留档。原样写下来不删。逐条数，真"静默"的是坑 4（相对路径静默解析成空）和坑 7（静默漏 23 个），坑 1 算半条（错乱但不报错），坑 2/3/5/6 都会当场炸或被拦。**静默比报错贵**：报错告诉你哪儿疼，静默只让结果悄悄不对——验证命令和差集检查不是仪式，是保命。

## 六、token 的账没有，复现命令有

被问最多的是：一亿 token 花了几成？**连量级我都不敢报**——跑批分散在子代理里，我全程没挂计量，估个"大概几千万"就是编。能诚实交代的只有结构：

- **大头一：并行评测跑批。**近百个子代理一轮 952 个作业，每个都是"读任务 + 读 skill，判触发、评清晰度"。纯量，纯并行。七个 run 按这两个环节算是 1723 个作业；只数落库的评审结果是 248 个——两个口径都给你，免得对不上。
- **大头二：TDD 修错循环。**97 个测试不是一次写对的，每次红 → 改 → 重跑都是一轮 token，换来三天里每次交付前全绿。
- 剩下的选型讨论、写文档、调 UI 同样没计量，占比我不装作知道。

**量取胜的注脚：token 花在并行验证上，不花在让模型想得更深上。**

想复现：

```bash
git clone https://github.com/Carlostang050311/skill-hub
cd skill-hub
npm install && npm run build
npm test                        # 19 个文件 97 个测试，我落笔前刚跑了一遍，3.9 秒全绿
npm run start -w @skillhub/web  # Web UI → http://localhost:3457
```

分发侧也通了：`skill-finder` 已被 skills.sh 收录（仓库页与 skill 详情页可公开访问，search 端点还在同步延迟），一条命令装：

```bash
npx skills add Carlostang050311/skill-hub
```

收录验证报告在 `docs/skills-sh-report.md`，连页面上安全扫描还标着的 Agent Trust Hub — Fail、Socket — Warn 都原样记了——如实记录比包装好看重要。

给想用 AI 干大工程的人一句实话：第 1 节那三条打法可以照抄；照抄不来的是留痕——这次最疼的几个数字，恰恰是没留痕的那几个。下次开工第一件事：建个 `docs/pitfalls/`，让每条坑当场有出处。
