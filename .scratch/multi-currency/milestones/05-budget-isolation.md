# 隔离各币种的预算和原币收支

> Milestone：05
>
> 状态：implemented
>
> Blocked by：让账户和设置明确携带币种
>
> 建议提交：`feat: isolate budgets by currency`

## 交付结果

`computeBudget`、分配、目标、资金账龄和原币收支都要求明确币种。同币种的家庭账户共享一份预算，不同币种之间不会串账。

## 允许范围

- 重建 assignments 与 goals，使币种进入主键。
- 给 Budget 与原币 Reports Interface、Routes 和前端状态加入必填 `currencyCode`。
- 增加币种账本切换器，Budget 页始终显示当前币种。
- 账户、分类和备注元数据继续共享，金额性状态按币种隔离。
- 资金账龄只消费对应币种的预算内现金流入。

## 验收条件

- SGD 收入只增加 SGD `Ready to Assign`，CNY 预算完全不变。
- 两个不同名称的 CNY 家庭账户共同进入一份 CNY `Ready to Assign`。
- 同一分类在 CNY 与 SGD 拥有不同分配、目标、活动和可用金额。
- 信用卡还款、超支、补钱和期初余额规则在各币种内保持现有 YNAB 行为。
- 所有预算写 Route 缺少币种时拒绝请求。
- 原币收支不包含其他币种，也不包含预算外投资估值调整。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/engine.currency-budget.test.mjs server/reports.native-currency.test.mjs src/pages/BudgetPage.currency.test.tsx server/routes.currency-budget.test.mjs src/pages/ReportsPage.currency.test.tsx src/store.currency.test.ts src/components/Sidebar.currency.test.tsx server/db.currency-schema.test.mjs
mise exec node@20 -- npm run typecheck
mise exec node@20 -- npm test
mise exec node@20 -- npm run build
git diff --check
```

## 执行记录

- 启动日期：2026-08-31
- Grok session：`01a053da-99a3-71a2-a227-3a298e659507`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：首轮测试覆盖显式币种校验、CNY 与 SGD 预算隔离、家庭 CNY 账户合并、复合主键、原币报表和前端账本切换。独立审查追加三组回归：币种只能来自查询参数；报表忽略旧币种的迟到响应；信用卡虚拟分类必须保留并拒绝跨币种写入。
- GREEN：targeted 8 个文件和 41 个测试通过；全量 53 个文件和 422 个测试通过；typecheck、production build 与 `git diff --check` 通过。
- 验收：`computeBudget`、资金账龄、分配和目标都要求显式且已启用的币种。不同币种的金额状态完全隔离，同币种的家庭账户合并进入一份预算。预算与目标 Route 缺少 `?currency=` 时返回稳定错误，body 不能替代查询参数。新库和迁移完成库使用带币种的复合主键，待迁移旧库仍保留可空字段和旧主键。信用卡还款继续使用 `cc:<accountId>` 虚拟分类，跨币种虚拟分类写入被拒绝且不会留下部分分配。原币报表排除其他币种、内部转账、期初行、预算外流水和估值调整；预算页与报表页切换币种时不会显示或接纳迟到的旧数据。JPY 输入和展示不带小数。
- Commit：本里程碑提交 `feat: isolate budgets by currency`
