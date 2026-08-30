# 完成文档、演示数据和发布验收

> Milestone：11
>
> 状态：implemented
>
> Blocked by：让 AI 和 IM 使用类型化财务工具
>
> 建议提交：`feat: finish multi-currency workflows`

## 交付结果

中英文界面、README、演示数据、Schema 说明和发布流程与多币种行为一致。生产数据库副本迁移演练、自动化门槛和家庭真实流程全部留下可核对证据。

## 允许范围

- 更新 README、README.en、i18n、演示数据和内置 AI Schema 文档。
- 用脱敏的生产数据库副本执行备份、迁移、核对和恢复演练，绝不替换真实数据库。
- 补齐此前里程碑遗漏的行为测试，不新增计划外产品范围。
- 更新方案和测试计划中的状态与证据。

## 验收条件

- `plan.md` 的全部验收场景都有自动化或明确的手工证据。
- 迁移前后账户余额、交易数量、每月 `Ready to Assign`、分类可用金额和净资产完成核对。
- 备份能够恢复，迁移失败不会要求 Schema 降级。
- 默认演示数据同时覆盖 CNY、USD、SGD、JPY 和统一净资产。
- 中文和英文界面不再把所有金额描述成“分”或固定两位小数。
- 完整质量门槛全部退出 0，工作区没有调试文件、跳过测试或未解释的生成物。

## Grok 必须执行的测试和演练

```bash
mise exec node@20 -- npm run typecheck
mise exec node@20 -- npm test
mise exec node@20 -- npm run build
git diff --check
git status --short
```

迁移演练必须使用副本路径，并在执行记录中写出副本、备份、核对表和恢复验证结果。浏览器手工验收需要按 [测试计划](../test-plan.md) 的家庭使用顺序逐项记录。

## 执行记录

- Grok session：`01a054a1-f058-7b60-bc71-534fca6e2db7`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：`server/demo.currency.test.mjs` 12 tests 中 11 failed。注入库上看不到家庭多币种账户、汇总币种、SGD 分配、跨币种 pair、EUR 原始金额、人工汇率；回滚测试未抛错。当时的 `loadDemoData` 仍只往全局库写单币种演示，并且忽略注入的 database/clock。
- GREEN：`server/demo.currency.test.mjs` 12 passed。目标文件 5 files / 51 tests 通过。全量 68 files / 597 tests 通过。typecheck 与 production build 通过。演示数据经 `createAccountRecord` / `postTransaction` / `postTransfer` / `reconcileAccount` / `assignBudget` / `setGoal` / FX `putManualRate` 写入。估值日 2026-08-31 净资产 17,381,760 CNY minor。
- 迁移演练：脚本 `.scratch/multi-currency/scripts/rehearse-currency-migration.mjs`，源副本 `/private/tmp/xiaowen-ynab-m11/source-snapshot.sqlite`，父目录 `/private/tmp/xiaowen-ynab-m11/rehearsal`，本次运行目录 `/private/tmp/xiaowen-ynab-m11/rehearsal/run-7bD9j2`。父目录里更早的固定产物和另一次独立运行 `run-fwiFAF` 仍在，没有被覆盖。选择 CNY，金额不缩放；迁移后工作库与恢复库 `PRAGMA integrity_check` 均为 ok。脱敏细节见 [release-readiness.md](../release-readiness.md)。
- 浏览器验收：协调者使用两个全新临时数据库完成。正常实例验证默认与可选币种、家庭共享 CNY RTA、CNY/SGD 隔离、实际换汇、外币原始金额、投资、统一净资产和中英文 JPY 精度；断网实例验证原币操作、缓存净资产、缺率隐藏总数和人工补率恢复。控制台无 warning/error。详细数值见 [release-readiness.md](../release-readiness.md)。
- 验收：代码、自动化、API smoke、可重复副本迁移/恢复演练和浏览器家庭流程全部通过。完整 diff 没有越过 M11 范围，真实 `data/budget.db` 未被替换或修改。
- Commit：本里程碑提交 `feat: finish multi-currency workflows`
