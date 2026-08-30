# 交付当前和历史统一净资产

> Milestone：08
>
> 状态：blocked
>
> Blocked by：建立可替换的汇率模块
>
> 建议提交：`feat: add reporting-currency net worth`

## 交付结果

Reports Module 和页面同时交付原币收支与统一净资产。当前值和历史曲线都按账户、估值日和汇总币种复算，并展示汇率来源与缺失项。

## 允许范围

- 实现 `buildNativeReport` 与 `buildNetWorthReport`。
- 按账户换算到汇总币种最小单位后再合计。
- 统一使用余额符号区分资产与负债。
- 历史月份使用月末当日或之前最近可用汇率，并尊重账户开始日期。
- Reports 页分成原币收支和统一净资产两个清楚的视图。

## 验收条件

- 固定家庭夹具得到资产 CNY 204,000.00、负债 CNY 5,000.00、净资产 CNY 199,000.00。
- 零余额币种缺失汇率不影响完整性；非零余额币种缺失汇率时不输出统一总数。
- 账户明细之和严格等于汇总总额。
- 今天的人工汇率不会重算过去月份。
- 后创建账户不会出现在 `starting_balance_date` 之前。
- 信用卡正余额作为资产，负余额绝对值作为负债。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/reports.currency.test.mjs src/pages/ReportsPage.currency.test.tsx
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
