# 让账户和设置明确携带币种

> Milestone：04
>
> 状态：implemented
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

- 启动日期：2026-08-31
- Grok session：`01a053bf-663c-7280-8ac7-f7411cf9745e`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：首轮目标套件共有 23 个失败，证明公共账户 API、账户币种业务规则、设置入口和账户页面都缺少目标能力。独立审查追加两个失败用例：整数形式的旧 `startingBalance` 仍被公共 API 接受；真实 SQLite 触发器用于证明创建中断时的新币种账本必须回滚。
- GREEN：targeted 5 个文件和 26 个测试通过；全量 47 个文件和 393 个测试通过；typecheck、production build 与 `git diff --check` 通过。
- 验收：公共账户 API 必须提交内置 `currencyCode` 和 `startingBalanceMinor`，不再根据旧符号推断或接受含义不明的余额字段。创建账户、启用账本和期初流水在同一事务完成，真实数据库故障证明三者一起回滚。空且零余额账户可以修改币种，存在余额或非期初流水时返回稳定错误。Settings 可以从服务端目录启用可选币种并选择已启用的汇总币种；账户列表、明细和 Sidebar 按账户币种格式化，并只计算同币种小计。交易与对账输入的多币种改造保留给统一写入里程碑。
- Commit：本里程碑提交 `feat: add account currency workflows`
