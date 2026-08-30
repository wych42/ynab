# 加入兼容的多币种 Schema

> Milestone：02
>
> 状态：implemented
>
> Blocked by：统一金额规则和币种目录
>
> 建议提交：`feat: add compatible currency schema`

## 交付结果

启动迁移只增加多币种所需的兼容表和字段。旧数据库进入待确认状态，金额和旧币种不会被后台猜测或改写；空数据库可以初始化默认币种账本。

## 允许范围

- 新增 `currency_ledgers`、`fx_rates` 和必要索引。
- 为账户、交易、分类、分配和目标加入后续迁移需要的兼容字段或过渡结构。
- Bootstrap 暴露迁移状态、支持币种和已启用币种。
- 有存量财务数据时锁定财务写操作，读取与备份仍可用。
- 增加真实临时 SQLite、HTTP 和财务夹具测试辅助代码。

## 验收条件

- 旧库启动后不修改任何既有金额，也不根据 `currency_symbol` 自动选择币种。
- 有存量数据时返回 `currencyMigrationRequired`，财务写入得到稳定错误。
- 空数据库创建 CNY、USD、SGD、JPY、EUR 五个账本，CAD 和 GBP 保持未启用。
- 数据库只约束三位大写代码；公共 Interface 仍通过 Money Module 拒绝目录外代码。
- 同一 Schema 在测试目录加入 AUD 后可以保存 AUD 账本。
- 迁移只追加版本，重复启动幂等。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/db.currency-schema.test.mjs server/routes.currency-bootstrap.test.mjs
mise exec node@20 -- npm run typecheck
mise exec node@20 -- npm test
mise exec node@20 -- npm run build
git diff --check
```

## 执行记录

- 启动日期：2026-08-31
- Grok session：`01a05388-1d0c-78a3-9548-3ce3fc40475c`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：真实临时 SQLite 与 HTTP 测试先因缺少 `currency-state`、bootstrap 币种字段和迁移锁而失败。审查追加 AI/IM 回归后，网页确认、IM `confirmPending` 和免确认 Agent 均能在 pending 状态写出账户，证明只锁普通 Route 不足。
- GREEN：targeted 2 个文件和 21 个测试通过；全量 41 个文件和 337 个测试通过；typecheck、production build 与 `git diff --check` 通过。
- 验收：只追加 migration 10。旧库金额逐行保持不变，账户、分配和目标币种仍为空，不读取旧符号，不创建猜测账本；空库初始化五个默认账本。Bootstrap 返回七个支持币种、已启用币种、可空汇总币种和迁移状态。普通财务 Route 与 AI/IM 共用 SQL 写边界在 pending 时都返回稳定锁错误，读取、备份、聊天记录和 SELECT 保持可用。
- Commit：本里程碑提交 `feat: add compatible currency schema`
