# 加入兼容的多币种 Schema

> Milestone：02
>
> 状态：blocked
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

- Grok session：待填写
- RED：待填写
- GREEN：待填写
- 验收：待填写
- Commit：待填写
