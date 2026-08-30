# 统一交易、对账和换汇写入

> Milestone：06
>
> 状态：blocked
>
> Blocked by：隔离各币种的预算和原币收支
>
> 建议提交：`feat: support cross-currency transfers`

## 交付结果

`server/currency-ledger.mjs` 成为网页、AI 和 IM 共用的财务写入边界。普通交易、同币种转账、跨币种换汇、对账和外币消费原始金额都在一个事务规则内完成。

## 允许范围

- 提供 `postTransaction`、`postTransfer` 和 `reconcileAccount` 深 Module Interface。
- Routes 改为参数解析后委托 Module，不再直接拼写财务 SQL。
- 跨币种转账保存两端实际金额，继续使用 `pair_id` 连接双腿。
- 增加 `currency_transfer` 系统分类、外币消费原始金额和换汇手续费工作流。
- 更新交易、转账和对账页面，展示每条腿所属币种。

## 验收条件

- 同币种省略目标金额时两端绝对值相同；显式给出不同金额时拒绝。
- 异币种必须提交两端金额，`100.00 SGD` 转出与 `550.00 CNY` 到账精确落库。
- 跨币种预算内转出使用换汇分类，目标币种到账进入 `Ready to Assign`。
- 任一腿失败时整个事务回滚。
- EUR 原始 `20.00` 与 USD 入账 `-22.00` 同时展示，预算只使用 USD。
- 对账调整和账户币种不可变规则继续成立。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/currency-ledger.test.mjs server/routes.currency-transfers.test.mjs src/pages/TransactionsPage.currency.test.tsx
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
