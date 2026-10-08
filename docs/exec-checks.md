# 执行级产物验收

在 scenario 的 `execute` 中列出预期产物和程序检查。预期产物默认必须存在且非空；程序验收失败不能被模型评分掩盖。

```yaml
skill: humanizer-zh
should_trigger:
  - 润色提供的中文文章
should_not_trigger:
  - 下载一个视频
execute:
  task: 润色提供的段落“本平台将赋能生态并提升体验”，输出 revised.md，改为具体且保留原意的表述。
  artifacts: [revised.md]
  rubric:
    - 修改稿保留原意
    - 不添加未提供的事实
  checks:
    - type: non-empty
      file: revised.md
```

支持 `exists`、`non-empty`、`json`、`contains`（需要 `value`）、`node-syntax`、`node-test`。Node 检查用固定参数执行沙箱内文件，15 秒超时；产物读写目录只是工作约束，不是操作系统隔离。真实资源验收在 `exec judge` 和 `exec ingest` 中执行。

评审按原始 rubric 项计分，未知或重复项不会抬高成绩；有相互矛盾的重复判定时从严处理。
