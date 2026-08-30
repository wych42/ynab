# 隔离各币种的预算和原币收支

> Milestone：05
>
> 状态：ready-for-agent
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
mise exec node@20 -- npm test -- server/engine.currency-budget.test.mjs server/reports.native-currency.test.mjs src/pages/BudgetPage.currency.test.tsx
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
