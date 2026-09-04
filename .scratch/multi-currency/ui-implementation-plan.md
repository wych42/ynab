# 多币种页面职责重构实施方案

> 状态：待实施。
>
> 基线：`feat/multi-currency` 分支，起点 `a3b9295b8876c1f05c5ed619553c03a0ad2eb29b`。
>
> 工作方式：直接在当前 checkout 修改，不创建 worktree。实施由独立 subagent 驱动本地 Grok CLI 完成；主 agent 负责拆票、审查、提交、部署和最终复核。

## 交付目标

这次改造把页面上的币种含义彻底分开：预算页选择“预算账本”，收支页选择“查看币种”，家庭净资产页选择“折算为”，账户和交易使用数据自身的账户币种，设置页只管理“已启用币种”和“净资产默认币种”。侧栏不再提供会跨页面产生歧义的全局 Active Currency。

交付范围以 [多币种页面的产品意图](./ui-product-intent.md) 为产品基线，以 [55 条对抗式验收用例](./ui-acceptance-brainstorm.md) 为行为清单。任何实现便利都不能重新引入未经换算的跨币种合计，也不能让页面局部选择改写家庭设置。

## 已确认的现状差距

- `src/store.tsx`、`src/activeCurrency.ts` 和 `src/components/Sidebar.tsx` 仍维护全局活动币种。
- 预算页和原币报表仍共同读取全局活动币种；预算、收支和净资产的页面状态没有完整进入 URL。
- 原币收支接口一次只返回一个币种；报表页没有全部币种摘要，也没有独立的投资入口。
- 新建账户和修改空账户币种会隐式启用币种；设置页还不能安全停用空账本。
- 账户详情在币种已锁定时仍先展示可编辑下拉框；交易的第二金额没有“账户入账／商户计价”或“转出／入账”标签。
- 预算响应没有账本 revision，预算相关写入和共享分类结构写入都不能发现过期客户端。
- 汇率来源直接暴露内部标识，缓存明细没有收进高级区域。

## 实施顺序

实施拆成四个顺序 ticket。后一个 ticket 只能建立在前一个 ticket 已通过目标测试、主 agent 已审查 diff 并形成 Git checkpoint 的基础上。每张 ticket 都遵守 RED、GREEN、REFACTOR：先新增或改写会因旧行为失败的测试，确认失败原因准确，再写最小实现，最后整理结构并保持测试通过。

| 顺序 | Ticket | 主要边界 | 对应验收 |
| --- | --- | --- | --- |
| 1 | [服务端币种边界、报表接口与 revision](./tickets/01-server-currency-boundaries-reports-revisions.md) | 币种启停、账户币种约束、收支/投资聚合、账本与分类 revision | MCUI-013—017、020—025、032、035—038、048—054、066 |
| 2 | [页面局部币种、账户与交易表达](./tickets/02-page-local-currency-accounts-transactions.md) | 移除全局状态、预算 URL、空账本、账户币种锁定、交易筛选和双金额标签 | MCUI-001—012、019—030、055、057 |
| 3 | [三类报表、净资产与汇率界面](./tickets/03-reports-net-worth-fx-ui.md) | 收支全部/详情、投资、家庭净资产 URL、缺率、FX 人话表达 | MCUI-031—047、055、057 |
| 4 | [冲突恢复、共享结构提示与交付收口](./tickets/04-conflict-accessibility-regression.md) | 409 保留输入、分类确认、i18n、键盘、小屏、读屏和全量回归 | MCUI-011—012、050—051、054、058—066 |

## 关键实现决定

### 页面状态

- 删除 App Context 中的全局 `activeCurrency`。可以保留一个只服务预算无参数入口的“本设备最近预算账本”存储函数，但页面渲染以 URL 为唯一当前状态。
- 预算使用 `#/budget?currency=SGD`；收支使用 `#/reports/cashflow` 或 `#/reports/cashflow?currency=CNY`；投资使用 `#/reports/investments`；家庭净资产使用 `#/reports/net-worth?currency=CNY&asOf=2026-09-04`。
- 页面解析到不受支持或已停用币种时，返回可区分的原因，显示一次明确提示，并用 `history.replaceState` 修正 URL。请求代次必须绑定规范化后的 URL 状态，迟到响应不能覆盖当前页面。

### 币种目录与家庭启用范围

- 账户创建、空账户改币种、预算账本、收支筛选和净资产折算只接受家庭已启用币种。
- 原始消费币种继续接受整个内置支持目录，但必须与账户币种不同；它不创建账本，也不进入按账户币种统计的收支。
- 停用操作只允许处理完全未使用且不是净资产默认币种的账本。检查账户、交易、分配、目标和默认值后，在一个事务里删除 `currency_ledgers` 记录；拒绝响应提供稳定错误码和使用原因。

### 收支、投资和净资产

- 收支总览与单币种详情使用两个稳定响应类型。总览每个币种独立给出本月收入、支出、净流入和活动状态，不提供跨币种总数。
- 投资报表复用现有投资计算口径，按账户和币种列出当前估值、余额变化、投入、取回、净投入和最近估值日；同币种可小计，不计算收益率。
- 家庭净资产继续通过 FX Module 换算。只要当前总数缺少必要汇率，就返回并显示 `null`，不能补零；账户原币余额和缺失清单仍可查看。

### 乐观并发

- Schema 新增每个 `currency_ledgers` 的 `revision`，另保存家庭共享分类结构的 `category_revision`。迁移只增加兼容字段并把既有值初始化为 0，不改金额。
- 预算读取返回 `revision` 和 `categoryRevision`。所有会改变某币种预算读模型的写入都在同一个数据库事务里校验 `expectedRevision`、写业务数据并推进 revision。
- 普通预算写入推进一本账；跨币种转账原子校验并推进两本账；共享分类写入校验并推进 `categoryRevision`。不相关币种的写入不能制造冲突。
- 过期写入返回 `409 budget_revision_conflict` 或 `409 category_revision_conflict`，响应包含最新 revision 和最新可展示数据。前端保留用户输入与操作意图，显示服务端最新值，用户明确重试时才用新 revision 再提交。

## Git checkpoint

1. `docs: plan multi-currency UI acceptance`：产品意图、独立评审、验收脑暴、实施方案和四张 ticket。
2. `feat: enforce currency boundaries and revisions`：服务端约束、聚合接口、Schema 与 API 测试。
3. `feat: make currency state page-local`：侧栏、预算、账户和交易页面及组件测试。
4. `feat: separate multi-currency reports`：三类报表、净资产与汇率界面及组件测试。
5. `fix: handle budget conflicts and UI regressions`：冲突恢复、共享分类提示、i18n、可访问性和回归修复。
6. `docs: record multi-currency UI acceptance`：独立验收记录、正式部署信息和最终证据。

如果某张 ticket 的实现必须跨越下一张 ticket 的文件边界，先更新本文和对应 ticket，再继续；不能让整个改造一直处于一个未提交的大 diff。

## 交付门槛

- 实施 Grok 在每张 ticket 内留下 RED 与 GREEN 命令、退出码和测试摘要。
- 独立验收 subagent 在实现完成后执行 [验收执行计划](./ui-acceptance-plan.md)，不能修改产品代码。
- `npm run typecheck`、`npm test`、`npm run build` 和 `git diff --check` 全部通过；没有 `.only`、`.skip` 或用例降级。
- 关键 P0 用例有自动化证据；URL、双设备并发、小屏和正式服务至少有一次真实浏览器验证。
- 本地验收通过后推送 `wych42/feat/multi-currency`，在 ser8 对正式服务做窄幅更新，并核对远端 checkout、服务状态、监听地址和浏览器结果。
- 主 agent 最后独立检查提交范围、API/页面语义映射、验收日志和正式页面。子 agent 的“已完成”只是一条证据，不能代替 readback。
