# skill-hub 领域模型

本文件定义业务对象和不变量。它是后续 SQLite schema、CLI JSON、Web API 和 MCP 返回值的共同来源，不等同于已经落地的数据库表。

## 核心对象

```text
Source
  └── Skill
        └── SkillSnapshot
              ├── FileSnapshot
              ├── QualityReport
              ├── TrustReport
              └── Compatibility

ScenarioSet
  └── Scenario

EvaluationPlan
  └── EvaluationRun
        └── EvaluationJob
              ├── ModelResponse
              ├── JudgeResult
              └── ArtifactEvidence

RecommendationEvent
RepairProposal
Backup
ProviderConfig
```

## 对象定义

| 对象 | 含义 | 稳定标识 |
| --- | --- | --- |
| Source | 一个扫描根、Git 仓库或插件来源 | `sourceId` |
| Skill | 逻辑上的 Skill 名称，不等于某个目录 | `skillId` |
| SkillSnapshot | 某一来源、副本在某一时刻的完整目录版本 | `snapshotId` + 完整 digest |
| FileSnapshot | snapshot 中的单个文件、大小、修改时间和 digest | `snapshotId + relativePath` |
| ScenarioSet | 一组用例及其版本 | `scenarioSetId` + digest |
| EvaluationRun | 一次不可变评测运行 | `runId` |
| EvaluationJob | 评测运行中的一个模型作业 | `jobId` |
| ModelResponse | 模型原始响应、延迟和 token/cost 元数据 | `responseId` |
| JudgeResult | 评审结果和 rubric 版本 | `judgeId` |
| ArtifactEvidence | 真实文件检查证据 | `evidenceId` |
| RecommendationEvent | 推荐曝光到结果的反馈事件 | `eventId` |
| RepairProposal | 对指定 snapshot 的编辑预览和应用记录 | `proposalId` |
| Backup | 覆盖前的可恢复目录及校验信息 | `backupId` |
| ProviderConfig | Provider 名称和非秘密配置引用 | `providerId` |

## 不变量

1. `SkillSnapshot` 不可变。目录内容变化必须生成新 snapshot，不能覆盖旧 hash。
2. 评测必须绑定 `snapshotId`、`scenarioSetId`、prompt/rubric/evaluator digest、provider 和 model。
3. 同一个逻辑 Skill 可以有多个 Source、安装副本和并行版本；不能用 Skill 名称作为来源注册表唯一键。
4. 评测结果只能从绑定的 snapshot 读取；当前库存变化时旧结果进入 `stale`，不修改历史原件。
5. 任何写入都必须具备幂等 key、schema version 和原子提交边界。
6. `blocked` 信任状态禁止执行级评测和自动安装；`unknown` 只能在用户明确确认后运行。
7. 删除和覆盖必须有 expected digest；找不到目标时只能显式选择“恢复到缺失目标”。

## 状态机

### Skill snapshot

```text
discovered → parsed → indexed
                   ├── diagnostics
                   └── stale（文件变化）
```

### Evaluation run

```text
planned → running → completed
                  ├── failed
                  ├── cancelled
                  └── interrupted → retryable
```

### Trust

```text
unknown → reviewed → trusted
    └──────────────→ blocked
trusted ───────────→ blocked
```

## ID 和摘要策略

- 展示层可以显示 16 位短指纹，便于阅读。
- 来源、安装、备份、评测绑定和安全决策保存完整 SHA-256。
- 路径只保存规范化绝对路径或相对 snapshot 路径；跨平台比较统一使用 `node:path` 和 `/` 分隔的相对路径。
- 所有可持久化对象带 `schemaVersion`，迁移由 storage 层执行。
