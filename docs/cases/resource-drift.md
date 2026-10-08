# 正文相同，资源不同

来源：`packages/core/src/snapshot.test.ts` 的本地回归夹具。

两个客户端都有 `demo/SKILL.md`，正文一致，但 `scripts/run.mjs` 分别为旧版和新版，且双方有不同的资源文件。

原行为：只比较指导书指纹，可能判断为一致并跳过复制。

修复后：正文与资源组成目录指纹；预览列出新增、修改和移除。同步先保存完整原件，恢复能找回旧脚本和旧资源。预览后有编辑时拒绝覆盖。

验证命令：

```bash
npx vitest run packages/core/src/snapshot.test.ts
```

验收关注：只改变资源也能发现漂移；二进制和文件重命名影响指纹；构建垃圾不影响；恢复不丢失后来编辑。
