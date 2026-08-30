# 完成旧账本迁移和恢复路径

> Milestone：03
>
> 状态：ready-for-agent
>
> Blocked by：加入兼容的多币种 Schema
>
> 建议提交：`feat: migrate legacy budgets to currency ledgers`

## 交付结果

旧数据库经过本地备份和用户确认后迁移到明确币种。CNY、USD、SGD、CAD、EUR、GBP 保持原整数；JPY 只有在所有金额都能整除一百时才统一缩放。失败时可以从备份恢复。

## 允许范围

- 新增正式迁移 Interface、确认 Route 和一次性迁移页面。
- 迁移账户、交易、分配、目标和所有金额字段。
- 在数据变换前生成带版本信息、可重新打开的 SQLite 备份。
- 提供币种建议，但用户必须明确确认。
- 保留 `currency_symbol` 一个发布周期用于兼容显示。

## 验收条件

- 测试计划里的 CNY、SGD、CAD、JPY、空库和目录外代码矩阵全部通过。
- JPY 异常返回表名、记录 ID、字段和原值，事务不提交。
- 任一中途故障不留下部分迁移结果。
- 第二次调用不会重复缩放、重复建账本或重复备份。
- 页面在迁移完成前不允许绕过确认进入财务写操作。
- 备份恢复后能读到变换前的 Schema 和金额。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/db.currency-migration.test.mjs src/pages/CurrencyMigrationPage.test.tsx
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
