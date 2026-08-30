# 让 AI 和 IM 使用类型化财务工具

> Milestone：10
>
> 状态：implemented
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

- Grok session：`01a0547f-9081-79e3-89bb-aaf79fe9376a`
- RED：目标套件 37 failed / 57 passed（10 files 中 8 failed）。失败原因对齐需求：缺少 `pending_tool`/`pending_args`；`post_transaction` 等写工具未被识别，确认状态仍是 `idle`；`INSERT`/`WITH ... DELETE` 仍被当成可执行 SQL；`fx_rates`/`schema_migrations` 可读；工具列表只有 `run_sql`；遗留 `pending_sql` 批准后仍会写库；Chat 卡片仍展示 SQL。
- GREEN：首轮 targeted 7 files 61 tests；全量 67 files 579 tests。独立验收修正后，最终 targeted 7 files 67 tests；全量 67 files 585 tests；typecheck、production build、`git diff --check` 全部通过。
- 验收修正：独立审查发现损坏 JSON、数组和 `null` 会被当成空参数写操作排队；服务端摘要还会混入模型提供的 `purpose`，Web 与 IM 会重复显示。修正 RED 为 5 failed / 30 passed。修正后非法参数返回配对的 `invalid_tool_arguments`，不入确认队列、不改财务数据；unknown tool 返回配对的 `unknown_tool`。合法 pending 继续保存 purpose，但新确认卡片只显示服务端根据工具参数和账本元数据生成的摘要。
- 验收：网页聊天与 IM 的财务写入走 `server/finance-tools.mjs` dispatcher，复用 `postTransaction`/`postTransfer`/`createAccountRecord`/`reconcileAccount` 以及抽出的 `assignBudget`/`setGoal`/`updateCategoryNote`。`run_sql` 用 SQLite `stmt.readonly` 只允许安全读取，写 SQL 与受保护表返回稳定错误且不入确认队列。新 pending 持久化 tool name + JSON args；旧 `pending_sql` 批准时返回 `sql_write_not_allowed`。确认开关、IM 引用/取消/`/new`/会话隔离保持。
- Commit：本里程碑提交 `feat: route ai writes through currency ledger`
