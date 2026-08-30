# 让 AI 和 IM 使用类型化财务工具

> Milestone：10
>
> 状态：ready-for-agent
>
> Blocked by：补齐投资账户的原币工作流
>
> 建议提交：`feat: route ai writes through currency ledger`

## 交付结果

网页聊天和 IM 的所有财务写入都调用与网页相同的类型化业务 Interface。`run_sql` 只保留安全读取，无法绕过币种、迁移锁、转账双腿和写前确认。

## 允许范围

- 增加普通交易、转账、账户、预算分配、目标、对账和分类备注的类型化工具。
- 更新账户快照、Schema 说明、视觉记账和系统提示，使金额明确携带币种和最小单位。
- 收紧 SQL guard，禁止 AI 写财务表、汇率、迁移状态和内部设置。
- 网页聊天与 IM 复用现有确认策略。

## 验收条件

- AI 创建普通交易和跨币种转账时调用 Currency Ledger Module。
- 无法确定账户入账金额时，AI 必须询问或生成待确认输入，不能套用参考汇率。
- 升级前可用的账户、预算、目标、对账和备注写入保持功能对等。
- 开启确认时写操作等待确认；关闭确认时仍经过业务校验。
- `run_sql` 的读取能力保留，所有写语句和受保护表访问被拒绝。
- IM 的引用确认、取消和会话隔离回归通过。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/ai.currency-tools.test.mjs server/ai.sqlguard.test.mjs server/im/router.test.mjs server/routes.im.test.mjs
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
