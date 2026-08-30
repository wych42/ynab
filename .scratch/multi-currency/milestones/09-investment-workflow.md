# 补齐投资账户的原币工作流

> Milestone：09
>
> 状态：ready-for-agent
>
> Blocked by：交付当前和历史统一净资产
>
> 建议提交：`feat: add native-currency investment tracking`

## 交付结果

投资账户继续采用 YNAB 的余额跟踪模型。用户按账户币种查看余额和变化，通过对账更新市场价值；估值调整进入统一净资产，不进入预算和 Income v Expense。

## 允许范围

- 增加投资账户原币余额与变化视图。
- 复用 Currency Ledger Module 的对账 Interface 记录估值调整。
- 让投资账户明细和统一净资产展示同一笔调整的原币与列报结果。
- 保持投资账户为预算外账户。

## 验收条件

- USD 投资账户估值上升后，USD 原币余额和统一净资产同步增加。
- 估值调整不增加任何币种的 `Ready to Assign`、收入或支出。
- 历史净资产只在调整日期及之后反映变化。
- 页面不出现证券持仓、数量、成本基础、收益和税务字段。
- 既有非投资账户对账行为保持不变。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/investment.currency.test.mjs src/pages/InvestmentAccountPage.test.tsx
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
