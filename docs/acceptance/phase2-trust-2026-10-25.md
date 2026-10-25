# Phase 2 / P0-P1 修复验收（2026-10-25）

对应 docs/review-2026-10-23.md 的分阶段待办与代码审查发现。

## 本轮交付

### P0 信任门（Phase 3 最小切片）

- 新增 `packages/core/src/trust.ts`：`~/.skillhub/trusted-skills.json` 信任名单（损坏移现场拒绝静默清空，同 origins 模式）。
- `skillhub-eval exec plan` 默认拒绝执行不在名单内的 skill，列出名字并要求 `--confirm-untrusted`（单次放行）或 `skillhub-eval trust add <name>`（永久信任）；`trust list/add/remove` 子命令管理。
- 产物检查子进程（artifacts.ts）已带 15s 超时、64KB maxBuffer 与净化环境变量（上一轮完成）。
- 产品文案边界：README 双语信任声明（本轮前已加）。

### P1 修复（评审"代码审查发现"逐项）

| 发现 | 修复 | 位置 |
| --- | --- | --- |
| `--home` 不贯穿 GitHub 路径 | `ORIGINS_FILE`/`GITHUB_CACHE_ROOT` 常量改为 `originsFile(home)`/`githubCacheRoot(home)`；github-install 补 `--home`；outdated-remote 补 `--home`；全部调用点走 home 派生 | packages/cli/src/cli.ts |
| DB 连接不关闭 | 全部 7 处 openDb 调用（web evaldb ×2、eval cli ingest/report/export、workbench 已有）包 try/finally close | apps/web/lib/evaldb.ts、apps/eval/src/cli.ts |
| 备份竞态 | 交换前最后一刻对目标重做指纹校验；EXDEV 临时 original 在成功路径清理 | packages/core/src/backups.ts |
| 破坏性删除无保护 | uninstall 删除前自动备份到 `~/.skillhub/uninstall-backups`（listBackups/restoreSkillBackup 可恢复）；pack 拒绝输出目录与来源目录重合 | packages/core/src/distribute.ts |
| origins 损坏静默清空 | loadOrigins 损坏时移至 `.corrupt-<ts>` 并抛错（拒绝覆盖）；saveOrigins 原子写（tmp + rename） | packages/core/src/github.ts |

origins 按 `origin+revision+target` 的完整建模重构仍留待后续（当前键保持 skill 名，同 targetDir 覆盖语义不变）。

### Phase 2 最小切片（可信评测核心）

- 评分策略版本：`EVAL_STRATEGY_VERSION = 2` 写入每条 RunReport；旧报告无版本按 legacy 呈现，不隐式重算。
- 结果绑定：RunReport 新增 `skillSnapshotHashes`（skill → 评测时 SKILL.md 内容 hash），与既有的 Job 级 skillHash/scenarioHash、stale 检测互补。
- 重复运行统计：eval.db schema v1→v2 幂等迁移（runs 加 strategy_version/snapshot_hashes_json，存量库历史保留）；`skillHistory` + `repeatStats`（以最新指纹为基准的次数/均值/标准差/区间）；新 CLI `skillhub-eval stats <skill>` 输出历史与稳定性。

## 自动验证

- `npm test`：32 个测试文件、170 个用例通过（本轮新增 5 个：uninstall 备份恢复、origins 损坏恢复、原子写、策略版本与指纹往返、v1 旧库迁移）。
- `npm run build`：全部包通过。
- 真实 CLI：exec plan 信任门（未信任拒绝 → trust add → 放行）、stats 对存量库（v1 迁移后历史完整呈现、旧记录如实标注"未绑定"）均已实测。
