# 补齐投资账户的原币工作流

> Milestone：09
>
> 状态：implemented
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

- Grok session：`01a05466-46e3-7f70-803a-035c7e495449`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：首轮目标 3 个文件失败。Investment Module 不存在，Module 文件在收集阶段 0 tests；Investment Route 仍返回 HTML 404；页面缺少投资摘要、更新估值入口和 stale response 处理。合计 3 failed files、7 failed / 1 passed。
- GREEN：首轮 targeted 3 个文件 17 tests。独立验收修正后，最终 targeted 6 个文件 57 tests，全量 66 个文件 559 tests；typecheck、production build 与 `git diff --check` 全部通过。
- 验收修正：独立审查发现 `reconcileAccount` 会把未来交易算入指定日期的账户余额，导致未来投入吞掉当天应写入的估值调整。修正 RED 为 2 failed / 36 passed；修正后对账只包含 `asOfDate` 当天及之前、且不早于账户开始日的流水。投资和普通 CNY、JPY 对账边界均有回归测试。
- 验收：`createInvestmentModule({ db }).getInvestmentAccount({ accountId, asOf, months })` 为只读投资 Interface，只接受预算外 `investment` 账户并返回原币余额、观察期余额变化、投入、取回、净投入、最近估值日期和月末历史。投入与取回只统计转账腿；普通流水和估值调整不会被命名为收益。页面复用 Account Detail 和现有 reconcile 写 Interface，仅投资账户显示摘要和“更新估值”，写入后刷新账户、摘要与 bootstrap，快速切换账户时丢弃旧响应。估值调整进入统一净资产，不进入任何币种的 Ready to Assign 或普通 Income v Expense。未实现持仓、数量、成本基础、收益率或税务字段，也未进入 M10 AI/IM 范围。
- Commit：本里程碑提交 `feat: add native-currency investment tracking`
