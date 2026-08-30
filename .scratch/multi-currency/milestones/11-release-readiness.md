# 完成文档、演示数据和发布验收

> Milestone：11
>
> 状态：ready-for-agent
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

- Grok session：待填写
- RED：待填写
- GREEN：待填写
- 迁移演练：待填写
- 浏览器验收：待填写
- 验收：待填写
- Commit：待填写
