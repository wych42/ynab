# 让账户和设置明确携带币种

> Milestone：04
>
> 状态：blocked
>
> Blocked by：完成旧账本迁移和恢复路径
>
> 建议提交：`feat: add account currency workflows`

## 交付结果

每个账户都有明确币种。用户可以启用内置币种、选择汇总币种，并在创建账户时选定账户币种；账户和交易列表按所属币种格式化金额。

## 允许范围

- 账户 `currency_code` 进入必填最终状态，并出现在 Bootstrap、账户列表、账户明细和 API 类型中。
- Settings 支持启用 CAD 或 GBP，并保存 `reporting_currency`。
- 新建账户可以在同一事务中启用尚未启用的内置币种。
- 空账户允许修改币种；已有非期初流水的账户拒绝修改。
- 替换账户相关页面对全局 `currencySymbol` 的依赖。

## 验收条件

- 创建账户和修改空账户都经过服务端目录校验。
- 目录外、小写和错误长度的币种代码得到稳定错误。
- 改变汇总币种不修改账户、交易和预算金额。
- JPY 与两位小数币种的输入和列表展示使用 Money Module。
- 启用同一币种幂等，不生成第二个账本。
- 旧 `currencySymbol` 只用于兼容路径，新代码不据此推断币种。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/routes.currency-accounts.test.mjs src/pages/AccountsPage.test.tsx src/pages/SettingsPage.currency.test.tsx
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
