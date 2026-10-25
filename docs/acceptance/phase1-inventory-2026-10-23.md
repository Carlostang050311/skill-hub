# Phase 1：库存持久化与共享扫描快照验收

日期：2026-10-23

## 交付内容

- 新增 `@skillhub/storage`，使用 `node:sqlite` 保存 `inventory.db`。
- 增加 schema version、`scan_runs`、`scan_roots`、`skills` 和当前运行指针。
- 每次扫描生成 UUID `scanRunId`，历史运行可再次读取。
- roots 配置生成完整 SHA-256 签名，不同 `--home` 或 `--root` 不会误用快照。
- CLI、`skillhub-eval`、Web、MCP 的扫描入口统一经过库存层。
- Web 写入安装、修复、恢复后刷新当前库存，避免页面继续展示旧版本。
- 根项目声明 Node `>=22.5.0`，因为库存层和现有评测库使用 `node:sqlite`。

## 自动验证

- `npm test -- --reporter=dot`：32 个测试文件、162 个用例通过。
- `npm run build`：core、storage、CLI、eval、MCP、Web 构建通过。
- 库存单元测试覆盖：扫描往返、历史运行、非 refresh 复用、不同 roots 隔离。
- CLI 单元测试覆盖：JSON `scanRunId` 和隔离 `inventory.db` 生成。

## 真实 CLI 验证

使用隔离目录 `.skillhub/phase1-cli-20261023`，写入一个 fixture Skill 后运行：

```text
node packages/cli/dist/cli.js scan --home <fixture-home> --json
node packages/cli/dist/cli.js list --home <fixture-home> --json
```

结果：1 条 Skill、`scanRunId` 为合法 UUID、`list` 返回 1 条、`<fixture-home>/.skillhub/inventory.db` 存在。隔离现场保留在本地，不写入真实用户 Skill 目录。

使用同一隔离 home 启动 Next 生产服务（`127.0.0.1:3459`）后，HTTP smoke 结果为：`GET /` 返回 200、页面包含应用标题、`GET /api/recommend?task=fixture` 返回 1 条推荐，说明 Web 入口能够读取共享库存。

## 浏览器验收边界

本轮尝试启动真实 Next/Edge 验收。第一次运行在受管环境中因真实 `C:\Users\carlo` 不允许创建 `inventory.db` 失败；将验证进程 home 改为隔离 fixture 后，Edge 又因当前环境的 DevTools/profile 权限退出。因此本轮没有把浏览器截图或交互结果标记为已验证，2026-10-08 的浏览器证据仍保持历史状态。

## 尚未完成

- 目前入口仍在每次显式扫描时刷新，尚未实现文件监听和按文件指纹增量扫描。
- SQLite 仍通过 `node:sqlite`，尚未封装可替换驱动的迁移 adapter。
- 多进程锁、坏数据库恢复和迁移回滚将在下一阶段补齐。
