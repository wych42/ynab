# 交付当前和历史统一净资产

> Milestone：08
>
> 状态：implemented
>
> 启动时间：2026-08-31 04:08:07 +08
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

- Grok session：`01a0544b-94f1-7061-89d3-8c2fe40e8602`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：目标 5 个测试文件。`server/reports.mjs` 不存在，`reports.currency.test.mjs` 收集阶段 0 tests；`GET /api/reports/net-worth` 返回 HTML 而非 JSON（3 tests）；Reports 页没有原币/统一净资产切换（5 tests）。原币回归 4 tests 通过。合计 3 failed files、8 failed / 4 passed。
- GREEN：首轮 targeted 5 个文件 20 tests，全量 63 个文件 537 tests。独立验收修正后，targeted 5 个文件 23 tests，全量 63 个文件 540 tests。typecheck、production build 与 `git diff --check` 全部通过。
- 验收修正：独立审查后补齐原币符号分类、历史 `rates[]`、历史缺口曲线、开始日前流水过滤。修正 RED 7 failed / 16 passed；修正后 targeted 5 个文件 23 tests，全量 63 个文件 540 tests。typecheck、build、`git diff --check` 通过。
- 验收：`createReportsModule({ db, fx }).buildNetWorthReport({ reportingCurrency, asOf, months })` 为报表 Interface。家庭夹具当前值资产 20_400_000、负债 500_000、净资产 19_900_000；每账户先舍入合计 16 不是 15；零余额缺率仍 complete；非零缺率 totals 为 null。历史以前月份用月末，asOf 月用 asOf；各点保留实际汇率日期、来源、path 和 rate；历史缺率形成曲线缺口并在页面列出。当前和历史都过滤账户开始日前流水。原币报表与统一净资产统一按余额符号分类。Route 明确解析三个 query，非法输入返回 400，缺汇率返回 200 的不完整报表。页面切视图与切列报币种均防 stale。未实现 M09 投资工作流或 M10 AI/IM。
- Commit：本里程碑提交 `feat: add reporting-currency net worth`
