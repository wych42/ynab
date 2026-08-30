# 统一交易、对账和换汇写入

> Milestone：06
>
> 状态：implemented
>
> 启动时间：2026-08-31 02:58:54 +08
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
mise exec node@20 -- npm test -- server/currency-ledger.test.mjs server/routes.currency-transfers.test.mjs server/routes.transfers.test.mjs server/routes.transactions.test.mjs server/routes.reconcile.test.mjs server/routes.income.test.mjs src/pages/TransactionsPage.currency.test.tsx src/pages/AccountDetailPage.currency.test.tsx
mise exec node@20 -- npm run typecheck
mise exec node@20 -- npm test
mise exec node@20 -- npm run build
git diff --check
```

## 执行记录

- Grok session：`01a0540a-e050-7d92-9d85-0b146bb9b954`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：首轮目标命令有 4 个文件失败，原因是 `currency-ledger.mjs` 尚不存在、交易页仍用全局 `¥` 格式化，以及账户页缺少到账金额、原始金额和日元对账精度。独立审查追加转账分类保护和安全整数用例，追加后的 40 个测试中有 9 个按预期失败。
- GREEN：targeted 8 个文件 85 tests；全量 56 个文件 469 tests；typecheck、production build 与 `git diff --check` 通过。
- 验收：`postTransaction` / `postTransfer` / `reconcileAccount` 成为共享写入边界。同币种省略目标金额守恒，显式不同金额拒绝。异币种必须双金额，`100.00 SGD` / `550.00 CNY` 精确双腿，隐含汇率 `5.5 CNY/SGD`，不写汇率表。预算内跨币种转出使用 `system_key=currency_transfer`，转入进入目标币种 Ready to Assign。第二腿失败整笔回滚。EUR 原始 `20.00` 与 USD `-22.00` 同时可见，预算只用 USD。对账按账户币种解释，转账不自动清算。Route 委托 Module，跨币种缺少到账金额返回稳定 400。页面按账户币种格式化，JPY 0 位精度继续工作。分类、批量分类、批量删除和 cleared 也走 Module；转账腿分类不可改，JPY `123.4` 与字符串金额拒绝。
- Commit：本里程碑提交 `feat: support cross-currency transfers`
