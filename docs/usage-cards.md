# 技能使用卡片元数据

技能详情会展示输入、输出、适用场景、客户端、环境要求、示例和常见失败。未声明的环境和兼容性不会被推测为已支持。仓库附带的使用提示可被 skill 自己的元数据覆盖。

```yaml
---
name: report-maker
description: 根据提供的数据制作报告，保留来源，拒绝虚构数据。
skillhub:
  aliases: [数据报告, report]
  scenarios: [制作有来源的报告]
  clients: [codex, claude]
  requirements: [Node.js]
  inputs: [数据文件和报告要求]
  outputs: [report.json]
  examples: [根据提供的 CSV 制作报告并注明来源]
  failures: [输入缺少来源时无法完成来源核查]
---
```

`clients` 用于明确兼容条件；未填写时推荐结果会提示未知，不直接排除。新增声明应根据实际环境测试填写。

场景组合可用 `skillhub kits` 查询，Web 的“场景与案例”会显示每个所需技能是否已安装。
