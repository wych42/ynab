# 多币种最终独立验收

状态：已完成本轮独立验收记录，全部147个稳定用例逐项映射。确认的P0产品缺陷已修复并真实复验；仍有一项P0的原生读屏证据不足。部分验证不计为通过，不作147项全绿声明。

最终检出与隔离运行版本：`d4bb3d1107ffb935a881d09da8a293f152dc5559`。实际浏览器首次基线为产品提交3a6b72c；最终d4bb3d1完成独立typecheck、91文件757测试与构建，并由协调者重启后复验。中间失败保留供追溯。

## 发布判断

现有证据未留下确认的P0产品缺陷；预算、报表回退、金额计算、revision冲突取消及再次保存等已确认问题均闭合。原用例要求听原生屏幕阅读器，这一项只完成DOM、aria-live和焦点验证，仍为P0部分验证。若发布条件要求所有P0完整通过，则证据门禁尚未全满足；若接受这项明确限制，可由协调者作发布决定。验收者未部署、未替用户豁免该条件。

未来/非法估值日期处理，以及新冲突文案仍有内联中英字符串，两项P2未满足原用例。原生200%缩放、断外网、助手自然语言回答等部分场景亦未完整执行；详见逐项结果。

协调者已明确决定按用户先体验目标发布到ser8：确认的P0产品缺陷清零后，接受原生读屏尚未验证及两项P2缺口。体验发布可行；严格全矩阵验收尚未全部通过。本记录仅记录该决定，不把计划部署表述为已部署。

## 证据边界

仅在 http://localhost:3101 与 /private/tmp/ynab-ui-acceptance.u14fEj 操作；没有写正式数据库。固定八账户、CNY/SGD/USD/JPY活动与EUR空账户经HTTP创建。GBP商户计价未启用GBP账本。额外临时账户及其唯一测试交易已按API正常删除，原始八账户保留。API脚本、原始响应、浏览器截图与日志均保留在 evidence/acceptance-*。

初轮真实失败包括未分类负数归类、投资默认日期、预算非法链接提示和焦点、窄屏主控件、冲突取消焦点、账户详情query路由及缺少页面说明/入口；后续均有对应新版本观察。通用浏览器脚本含控件类型和等待时机错误，后续单项证据明确覆盖这些脚本失败；不得直接把初始脚本所有PASS当完整用例通过。共享确认重复场景使用window.confirm接受/拒绝shim，后端409、草稿、焦点和实际写入均为真实运行；原生确认文案已另行观察。

最终计数：{"通过":125,"部分验证":19,"不适用":1,"失败":2}。P0统计：{"通过":78,"部分验证":1}。

## 全量用例映射

| 用例 | 优先级 | 结果 | 原可观察结果 | 实际证据与局限 |
| --- | --- | --- | --- | --- |
| MC-UI-URL-001 | P0 | 通过 | 使用净资产默认币种 CNY；hash 立刻变成 `#/budget?currency=CNY`；标题区选择器写「预算账本」，选中 CNY；待分配按 CNY 格式化 | BudgetPage.currency.test.tsx、hashRoute.test.ts 全量通过；覆盖默认补参、最近账本、显式USD、迟到响应丢弃及未知参数。 |
| MC-UI-URL-002 | P0 | 通过 | 显示 SGD 账本；URL 补 `currency=SGD`；不改家庭净资产默认币种 | BudgetPage.currency.test.tsx、hashRoute.test.ts 全量通过；覆盖默认补参、最近账本、显式USD、迟到响应丢弃及未知参数。 |
| MC-UI-URL-003 | P0 | 通过 | 请求 `GET /api/budget/:month?currency=USD`；页面数字和符号都是 USD；不读侧栏全局状态 | BudgetPage.currency.test.tsx、hashRoute.test.ts 全量通过；覆盖默认补参、最近账本、显式USD、迟到响应丢弃及未知参数。 |
| MC-UI-URL-004 | P0 | 通过 | URL 变成 `currency=SGD`；CNY 数字不会闪一帧当成 SGD；迟到的 CNY 响应被丢掉 | BudgetPage.currency.test.tsx、hashRoute.test.ts 全量通过；覆盖默认补参、最近账本、显式USD、迟到响应丢弃及未知参数。 |
| MC-UI-URL-005 | P0 | 通过 | 回到 CNY 账本和 CNY 数字；前进回到 SGD | 浏览器实际后退/前进恢复CNY/SGD；刷新及独立context复制SGD链接一致。acceptance-browser-initial.json；补充复验见最终浏览器证据。 |
| MC-UI-URL-006 | P0 | 通过 | 仍是 SGD 账本。家庭设置和另一配置的最近账本不变 | 浏览器实际后退/前进恢复CNY/SGD；刷新及独立context复制SGD链接一致。acceptance-browser-initial.json；补充复验见最终浏览器证据。 |
| MC-UI-URL-007 | P1 | 通过 | 仍是 SGD。月份可以继续只留在页内状态，但币种必须活在 URL 里 | 浏览器实际后退/前进恢复CNY/SGD；刷新及独立context复制SGD链接一致。acceptance-browser-initial.json；补充复验见最终浏览器证据。 |
| MC-UI-URL-008 | P0 | 通过 | 侧栏账户列表从未被 SGD 过滤；回来后若 URL 仍带 SGD 则继续 SGD | 真实预算SGD后侧栏仍列全部账户；Sidebar.currency.test.tsx验证最近账本导航。 |
| MC-UI-URL-009 | P1 | 部分验证 | 金额按两位小数；选择器选项只来自已启用币种 | 启用CAD的HTTP已执行；未建CAD账户后完整检查金额格式。 |
| MC-UI-URL-010 | P0 | 通过 | 不经过侧栏也能切账本；焦点留在选择器或标题区 | ca08a02真实CNY→SGD后焦点回到budget-ledger-currency。acceptance-final-budget.json。 |
| MC-UI-URL-011 | P2 | 通过 | 忽略未知参数，账本仍是 SGD，页面不转圈 | BudgetPage.currency.test.tsx、hashRoute.test.ts 全量通过；覆盖默认补参、最近账本、显式USD、迟到响应丢弃及未知参数。 |
| MC-UI-URL-012 | P1 | 通过 | 进入最近账本对应的带参 URL；点击本身不切换账本 | 真实预算SGD后侧栏仍列全部账户；Sidebar.currency.test.tsx验证最近账本导航。 |
| MC-UI-GLOB-001 | P0 | 通过 | 侧栏底部没有币种下拉；语言切换仍在 | Sidebar.currency.test.tsx、ReportsPage.currency.test.tsx及实际侧栏快照；无全局选择器，各币种独立小计，报表默认全部。 |
| MC-UI-GLOB-002 | P0 | 通过 | 预算内、预算外、已关闭账户全部出现；每行用自己的账户币种；CNY / SGD / USD / JPY 小计分开，没有一笔跨币种总和 | Sidebar.currency.test.tsx、ReportsPage.currency.test.tsx及实际侧栏快照；无全局选择器，各币种独立小计，报表默认全部。 |
| MC-UI-GLOB-003 | P0 | 通过 | 报表不再跟预算账本走。收支默认「全部」，净资产默认家庭 CNY | Sidebar.currency.test.tsx、ReportsPage.currency.test.tsx及实际侧栏快照；无全局选择器，各币种独立小计，报表默认全部。 |
| MC-UI-GLOB-004 | P1 | 通过 | 可以显示「预算 · SGD」，旁边没有第二个可点的全局币种控件 | Sidebar.currency.test.tsx、ReportsPage.currency.test.tsx及实际侧栏快照；无全局选择器，各币种独立小计，报表默认全部。 |
| MC-UI-GLOB-005 | P0 | 通过 | 旧「侧栏切换器」断言删除或改写成「选择器不存在」；账户行分币种小计保留 | Sidebar.currency.test.tsx、ReportsPage.currency.test.tsx及实际侧栏快照；无全局选择器，各币种独立小计，报表默认全部。 |
| MC-UI-GLOB-006 | P1 | 通过 | 账户页不消费这个键。无参数进预算页时，这个键只作回退 | Sidebar.currency.test.tsx、ReportsPage.currency.test.tsx及实际侧栏快照；无全局选择器，各币种独立小计，报表默认全部。 |
| MC-UI-GLOB-007 | P1 | 通过 | 抽屉里没有全局币种；切页面后抽屉收起 | 协调者独立390px真实打开抽屉并点Accounts关闭，x0→-288且无select；root-verification.md。 |
| MC-UI-ACC-001 | P0 | 通过 | 默认全部账户；预算内 / 预算外 / 已关闭之下再按币种分组；各组原币小计；页顶没有未经换算的家庭总额 | AccountsPage.test.tsx完整通过；实际USD局部筛选及createCurrency=EUR表单预填已观察，五种启用目录可见。 |
| MC-UI-ACC-002 | P1 | 通过 | 只剩美元卡和先锋券商；侧栏和预算账本不变 | AccountsPage.test.tsx完整通过；实际USD局部筛选及createCurrency=EUR表单预填已观察，五种启用目录可见。 |
| MC-UI-ACC-003 | P0 | 通过 | 账户页、侧栏、交易页都不出现把 100,000 CNY 和 5,000 SGD 加在一起的数字 | AccountsPage.test.tsx完整通过；实际USD局部筛选及createCurrency=EUR表单预填已观察，五种启用目录可见。 |
| MC-UI-ACC-004 | P1 | 通过 | 进入净资产报表，折算币种取家庭默认 CNY | ca08a02真实账户页DOM有家庭净资产链接，EUR预填仍正确。acceptance-final-account.json。 |
| MC-UI-ACC-005 | P0 | 通过 | 币种下拉只有已启用五项；预填 CNY 且字段一直可见；有「管理币种」；提交 CAD 不会出现在选项里 | AccountsPage.test.tsx完整通过；实际USD局部筛选及createCurrency=EUR表单预填已观察，五种启用目录可见。 |
| MC-UI-ACC-006 | P0 | 通过 | 预填 SGD，选项仍只有已启用币种 | AccountsPage.test.tsx完整通过；实际USD局部筛选及createCurrency=EUR表单预填已观察，五种启用目录可见。 |
| MC-UI-ACC-007 | P0 | 通过 | 4xx，GBP 账本未被启用；数据库 `currency_ledgers` 无 GBP | routes.currency-accounts / routes.currency-transfers / AccountDetailPage.currency测试；额外真实HTTP验证GBP拒绝与SGD100→CNY550双腿。acceptance-api-results.json。 |
| MC-UI-ACC-008 | P0 | 通过 | 只读「账户币种：USD」；没有可点下拉 | routes.currency-accounts / routes.currency-transfers / AccountDetailPage.currency测试；额外真实HTTP验证GBP拒绝与SGD100→CNY550双腿。acceptance-api-results.json。 |
| MC-UI-ACC-009 | P1 | 通过 | 出现明确的改币种动作；改成 JPY 后余额按零位小数显示 | routes.currency-accounts / routes.currency-transfers / AccountDetailPage.currency测试；额外真实HTTP验证GBP拒绝与SGD100→CNY550双腿。acceptance-api-results.json。 |
| MC-UI-ACC-010 | P0 | 通过 | 主金额是账户入账 USD；预算扣 USD | routes.currency-accounts / routes.currency-transfers / AccountDetailPage.currency测试；额外真实HTTP验证GBP拒绝与SGD100→CNY550双腿。acceptance-api-results.json。 |
| MC-UI-ACC-011 | P0 | 通过 | 表单同时要两端金额；展示「转出 SGD 100.00 → 入账 ¥550.00」和隐含汇率；参考汇率不改写输入 | routes.currency-accounts / routes.currency-transfers / AccountDetailPage.currency测试；额外真实HTTP验证GBP拒绝与SGD100→CNY550双腿。acceptance-api-results.json。 |
| MC-UI-TX-001 | P0 | 通过 | 默认全部账户全部币种；每一行按所属账户币种格式化；JPY 无小数 | TransactionsPage.currency/test测试及acceptance-filters.json；未分类筛选与USD叠加后只剩London shop；批量只计笔数、主金额与商户金额/转账双腿标签有断言。 |
| MC-UI-TX-002 | P0 | 通过 | 同时看到「账户入账 US$22.00」和次级「商户计价 €20.00」，两套标签不能省略 | TransactionsPage.currency/test测试及acceptance-filters.json；未分类筛选与USD叠加后只剩London shop；批量只计笔数、主金额与商户金额/转账双腿标签有断言。 |
| MC-UI-TX-003 | P0 | 通过 | 同一行有转出、入账、两端金额和对方账户，标签是「转出 / 入账」 | TransactionsPage.currency/test测试及acceptance-filters.json；未分类筛选与USD叠加后只剩London shop；批量只计笔数、主金额与商户金额/转账双腿标签有断言。 |
| MC-UI-TX-004 | P1 | 通过 | 只剩星展相关流水；预算页账本不变 | TransactionsPage.currency/test测试及acceptance-filters.json；未分类筛选与USD叠加后只剩London shop；批量只计笔数、主金额与商户金额/转账双腿标签有断言。 |
| MC-UI-TX-005 | P0 | 通过 | 只显示已选笔数。禁止出现相加总额，也禁止用汇率折出假合计 | TransactionsPage.currency/test测试及acceptance-filters.json；未分类筛选与USD叠加后只剩London shop；批量只计笔数、主金额与商户金额/转账双腿标签有断言。 |
| MC-UI-TX-006 | P1 | 通过 | 未分类过滤仍可用，并可与币种筛选共存 | TransactionsPage.currency/test测试及acceptance-filters.json；未分类筛选与USD叠加后只剩London shop；批量只计笔数、主金额与商户金额/转账双腿标签有断言。 |
| MC-UI-TX-007 | P1 | 通过 | 交易列表不被 JPY 过滤 | TransactionsPage.currency/test测试及acceptance-filters.json；未分类筛选与USD叠加后只剩London shop；批量只计笔数、主金额与商户金额/转账双腿标签有断言。 |
| MC-UI-EN-001 | P0 | 通过 | 已启用 CNY USD SGD EUR JPY；添加列表只有 CAD、GBP，不能手填 | SettingsPage.currency、routes.currency-disable/accounts测试及acceptance-settings-english.json；初始五币、未启用拒绝、使用中限制、默认值配置。 |
| MC-UI-EN-002 | P0 | 通过 | CAD 进入新建账户、预算账本、收支筛选、净资产「折算为」；不自动建账户、交易或分配 | 真实Settings启用CAD，不增加八个账户；预算、账户预填、收支Inactive、投资筛选、净资产按钮同步；HTTP停用200后预算/新建账户/收支均移除CAD。金额无变化；defaultUSD独立配置测试另见root-verification。acceptance-enable/disable-propagation.json。 |
| MC-UI-EN-003 | P0 | 通过 | 标记「使用中」，停用控件不可用 | SettingsPage.currency、routes.currency-disable/accounts测试及acceptance-settings-english.json；初始五币、未启用拒绝、使用中限制、默认值配置。 |
| MC-UI-EN-004 | P0 | 通过 | 被拒绝，提示先改净资产默认币种 | SettingsPage.currency、routes.currency-disable/accounts测试及acceptance-settings-english.json；初始五币、未启用拒绝、使用中限制、默认值配置。 |
| MC-UI-EN-005 | P0 | 通过 | CAD 从新建账户、预算选择器、普通筛选消失；历史若无 CAD 数据则列表为空；数据库账本行按方案保留或停用，但金额不删 | 真实Settings启用CAD，不增加八个账户；预算、账户预填、收支Inactive、投资筛选、净资产按钮同步；HTTP停用200后预算/新建账户/收支均移除CAD。金额无变化；defaultUSD独立配置测试另见root-verification。acceptance-enable/disable-propagation.json。 |
| MC-UI-EN-006 | P0 | 通过 | 界面无 GBP；HTTP 拒绝且不隐式启用 | SettingsPage.currency、routes.currency-disable/accounts测试及acceptance-settings-english.json；初始五币、未启用拒绝、使用中限制、默认值配置。 |
| MC-UI-EN-007 | P1 | 通过 | 因为已有账户，EUR 为「使用中」，不能停用 | SettingsPage.currency、routes.currency-disable/accounts测试及acceptance-settings-english.json；初始五币、未启用拒绝、使用中限制、默认值配置。 |
| MC-UI-EN-008 | P1 | 部分验证 | 选项里没有 GBP | 真实HTTP已启用/停用CAD且账户无新增；尚未同时走完所有页面的选项传播。acceptance-api-results.json。 |
| MC-UI-EN-009 | P0 | 通过 | 家庭默认变成 SGD；当前预算 URL、收支筛选不变；无参数打开净资产时才用 SGD | SettingsPage.currency、routes.currency-disable/accounts测试及acceptance-settings-english.json；初始五币、未启用拒绝、使用中限制、默认值配置。 |
| MC-UI-EN-010 | P1 | 通过 | 这些状态只活在对应页面 URL | SettingsPage.currency、routes.currency-disable/accounts测试及acceptance-settings-english.json；初始五币、未启用拒绝、使用中限制、默认值配置。 |
| MC-UI-ORIG-001 | P0 | 通过 | 保存成功；账户余额和 USD 预算只用入账 USD；不创建 GBP 账本；GBP 不进收支汇总 | AccountDetailPage.currency、currency-ledger、routes.currency-transfers测试；真实HTTP未启用GBP辅助金额保存，不自动推导入账，单侧字段拒绝。 |
| MC-UI-ORIG-002 | P0 | 通过 | 有整份内置目录，但没有 USD；已启用和未启用都可出现 | AccountDetailPage.currency、currency-ledger、routes.currency-transfers测试；真实HTTP未启用GBP辅助金额保存，不自动推导入账，单侧字段拒绝。 |
| MC-UI-ORIG-003 | P0 | 通过 | 不能自动用参考汇率算出 22.00 USD；保存要么要求入账金额，要么拒绝 | AccountDetailPage.currency、currency-ledger、routes.currency-transfers测试；真实HTTP未启用GBP辅助金额保存，不自动推导入账，单侧字段拒绝。 |
| MC-UI-ORIG-004 | P1 | 通过 | 辅助字段保持空；界面不要强迫填写 | AccountDetailPage.currency、currency-ledger、routes.currency-transfers测试；真实HTTP未启用GBP辅助金额保存，不自动推导入账，单侧字段拒绝。 |
| MC-UI-ORIG-005 | P1 | 通过 | 两个辅助字段必须一起空或一起有值；只剩一个则 4xx，页面报错 | AccountDetailPage.currency、currency-ledger、routes.currency-transfers测试；真实HTTP未启用GBP辅助金额保存，不自动推导入账，单侧字段拒绝。 |
| MC-UI-ORIG-006 | P1 | 通过 | 转账不用原始消费字段；两端实际金额才是权威 | AccountDetailPage.currency、currency-ledger、routes.currency-transfers测试；真实HTTP未启用GBP辅助金额保存，不自动推导入账，单侧字段拒绝。 |
| MC-UI-ORIG-007 | P2 | 部分验证 | JPY 入账仍拒小数；EUR 原始金额按两位校验 | JPY拒小数与EUR最小单位分别有测试；未在同一JPY账户表单完整执行EUR10.4消费场景。 |
| MC-UI-CF-001 | P0 | 通过 | 默认「查看币种：全部」；URL 表示全部，例如 `#/reports/cashflow` 或不带 currency | ReportsPage.currency/net-worth及routes.reports-cashflow测试，实际默认全部摘要与单币种链接；换汇、估值排除有HTTP/模块断言。 |
| MC-UI-CF-002 | P0 | 通过 | 主要区域有 CNY SGD USD JPY 的收入、支出、净流入、活动状态；EUR 只在筛选器里，带「无活动」 | ca08a02真实HTTP及浏览器USD收入0、支出37，分类构成为22分类支出+15Uncategorized。acceptance-browser-final-results.json。 |
| MC-UI-CF-003 | P0 | 通过 | 没有任何跨币种相加；不能并排五份带独立纵轴的全年图。迷你趋势线可有可无，首版用数字摘要即可 | ReportsPage.currency/net-worth及routes.reports-cashflow测试，实际默认全部摘要与单币种链接；换汇、估值排除有HTTP/模块断言。 |
| MC-UI-CF-004 | P0 | 通过 | 进入 CNY 详情；URL 带 `currency=CNY`；「查看币种：CNY」仍可见 | ReportsPage.currency/net-worth及routes.reports-cashflow测试，实际默认全部摘要与单币种链接；换汇、估值排除有HTTP/模块断言。 |
| MC-UI-CF-005 | P0 | 通过 | 有十二个月收支、分类构成、商家、收入来源、预算内现金流说明。没有「当前净值」「净值走势」这种家庭净资产口径 | ReportsPage.currency/net-worth及routes.reports-cashflow测试，实际默认全部摘要与单币种链接；换汇、估值排除有HTTP/模块断言。 |
| MC-UI-CF-006 | P1 | 不适用 | 名称是「该币种账户净余额」，并写明含哪些预算内和预算外账户 | 单币种收支没有保留账户净余额块，该行仅约束选择保留该块时的名称与口径。 |
| MC-UI-CF-007 | P0 | 通过 | 换汇不进普通收入或支出；可出现在币种调拨说明里 | ReportsPage.currency/net-worth及routes.reports-cashflow测试，实际默认全部摘要与单币种链接；换汇、估值排除有HTTP/模块断言。 |
| MC-UI-CF-008 | P0 | 通过 | 估值调整不进收入 | ReportsPage.currency/net-worth及routes.reports-cashflow测试，实际默认全部摘要与单币种链接；换汇、估值排除有HTTP/模块断言。 |
| MC-UI-CF-009 | P1 | 部分验证 | 状态可复现；后退回到全部视图 | 组件与hash路由测试通过；初轮浏览器脚本在等待选中态前读取导致提前失败，完整刷新/后退需最终补验。 |
| MC-UI-CF-010 | P1 | 通过 | 不受 JPY 账本影响，仍默认全部 | ReportsPage.currency/net-worth及routes.reports-cashflow测试，实际默认全部摘要与单币种链接；换汇、估值排除有HTTP/模块断言。 |
| MC-UI-CF-011 | P0 | 通过 | 不再断言 `nativeReport("CNY")` 由活动币种触发；改为全部摘要 + 单币种详情 | ReportsPage.currency/net-worth及routes.reports-cashflow测试，实际默认全部摘要与单币种链接；换汇、估值排除有HTTP/模块断言。 |
| MC-UI-INV-001 | P0 | 通过 | 有独立「投资」入口，不并进账户页，也不藏在收支里 | ca08a02无query投资API200，USD/SGD两个账户与独立小计，USD及账户复合筛选，跳入先锋券商详情并出现Update valuation。acceptance-browser-final-results.json。 |
| MC-UI-INV-002 | P0 | 通过 | 列出全部投资账户，保留原币；字段只有余额、余额变化、投入、取回、净投入、最近估值日 | ca08a02无query投资API200，USD/SGD两个账户与独立小计，USD及账户复合筛选，跳入先锋券商详情并出现Update valuation。acceptance-browser-final-results.json。 |
| MC-UI-INV-003 | P0 | 通过 | 同币种可以小计；USD 和 SGD 不相加 | ca08a02无query投资API200，USD/SGD两个账户与独立小计，USD及账户复合筛选，跳入先锋券商详情并出现Update valuation。acceptance-browser-final-results.json。 |
| MC-UI-INV-004 | P0 | 通过 | 投资页和账户摘要都不出现这些词 | ca08a02无query投资API200，USD/SGD两个账户与独立小计，USD及账户复合筛选，跳入先锋券商详情并出现Update valuation。acceptance-browser-final-results.json。 |
| MC-UI-INV-005 | P1 | 通过 | 进入已有投资账户详情；对账文案仍是更新估值 | ca08a02无query投资API200，USD/SGD两个账户与独立小计，USD及账户复合筛选，跳入先锋券商详情并出现Update valuation。acceptance-browser-final-results.json。 |
| MC-UI-INV-006 | P1 | 通过 | 进入净资产页，不在投资页做汇率换算 | 投资所在报表导航有家庭净资产链接，目的页自行换算。 |
| MC-UI-INV-007 | P1 | 通过 | 收支页和预算页不受影响 | ca08a02无query投资API200，USD/SGD两个账户与独立小计，USD及账户复合筛选，跳入先锋券商详情并出现Update valuation。acceptance-browser-final-results.json。 |
| MC-UI-NW-001 | P0 | 通过 | 标题区为「折算为 [CNY]」加估值日；无参数 URL 使用家庭默认；列出各账户原币余额 | acceptance-networth-url.json验证SGD临时币种/日期、前后退、独立context复制及无存储写入；acceptance-api-results.json固定日期净资产手算数据。 |
| MC-UI-NW-002 | P0 | 通过 | 家庭净资产默认仍是 CNY；URL 变为类似 `#/reports/net-worth?currency=SGD&asOf=2026-09-04` | acceptance-networth-url.json验证SGD临时币种/日期、前后退、独立context复制及无存储写入；acceptance-api-results.json固定日期净资产手算数据。 |
| MC-UI-NW-003 | P0 | 通过 | 仍折算为 SGD、同一估值日；该配置的 localStorage / sessionStorage 不被写入临时币种 | acceptance-networth-url.json验证SGD临时币种/日期、前后退、独立context复制及无存储写入；acceptance-api-results.json固定日期净资产手算数据。 |
| MC-UI-NW-004 | P0 | 通过 | 资产、负债、净资产和历史曲线都用所选汇总币种；账户行同时有原币、换算、汇率、日期、来源 | acceptance-networth-url.json验证SGD临时币种/日期、前后退、独立context复制及无存储写入；acceptance-api-results.json固定日期净资产手算数据。 |
| MC-UI-NW-005 | P0 | 通过 | 隐藏统一总数；原币余额和缺失列表仍在；不把缺失账户当 0 | ReportsPage.net-worth和routes.reports-net-worth真实测试缺率null总数；浏览器按真实schema注入缺率响应后隐藏统一总数、保留原币与SGD→CNY缺失。acceptance-missing-rate-verified.json。浏览器层为响应注入。 |
| MC-UI-NW-006 | P1 | 通过 | 该账户不进入 8 月 | reports.currency.test.mjs覆盖账户起始日之前排除和未来交易忽略。 |
| MC-UI-NW-007 | P1 | 通过 | 写明变化同时包含账户收支、投资估值和汇率变动，不能当成收入减支出 | ca08a02英文页面明确账户活动/投资估值/汇率变动均影响净资产；中文对应组件测试全绿。acceptance-final-networth.json。 |
| MC-UI-NW-008 | P1 | 通过 | 初始折算变为 USD；旧的带 `currency=SGD` 的链接仍显示 SGD | 协调者真实修改家庭默认USD，无参数新文档采用USD；显式SGD及日期保留，finally恢复CNY；root-verification.md。 |
| MC-UI-NW-009 | P2 | 失败 | 回退到合法估值日并说明原因，或 4xx 后页面给出可用日期，不转圈 | 5ffc990实际asOf=bad返回错误页、日期值为空且仅generic Retry；2099-01-01直接估值未回退，不符合该P2用例要求。d4bb3d1仅改notice没有日期逻辑；acceptance-final-report-fallback.json。已报协调者，保留非阻断缺口。 |
| MC-UI-FX-001 | P0 | 通过 | 汇率写成 `1 USD = ¥7.20`；来源是「人工汇率」 | 真实中英页面显示人工/ECB/无需换算，英文Manual rate/European Central Bank reference rate/No conversion needed；ReportsPage.polish断言未知来源可读回退。 |
| MC-UI-FX-002 | P0 | 通过 | 中文「欧洲央行参考汇率」，英文对应可读名；页面无 `frankfurter_ecb`、`identity`、`manual` | 真实中英页面显示人工/ECB/无需换算，英文Manual rate/European Central Bank reference rate/No conversion needed；ReportsPage.polish断言未知来源可读回退。 |
| MC-UI-FX-003 | P0 | 通过 | 「无需换算」或等价文案，不是 `identity` | 真实中英页面显示人工/ECB/无需换算，英文Manual rate/European Central Bank reference rate/No conversion needed；ReportsPage.polish断言未知来源可读回退。 |
| MC-UI-FX-004 | P1 | 通过 | 写明汇率只用于估值，真实换汇用银行两端实际金额 | ca08a02净资产英文常驻说明仅估值及实际两端入账金额；中文对应组件测试全绿。acceptance-final-networth.json。 |
| MC-UI-FX-005 | P1 | 通过 | 默认只显示覆盖情况、最后更新、手动刷新、人工覆盖入口；缓存明细在高级 / 诊断 | 真实设置默认区逐一列CNY无需换算和USD/SGD/EUR/JPY本地可用、2026-09-04汇率日期；acceptance-final-coverage-empty.json。 |
| MC-UI-FX-006 | P1 | 通过 | 两种语言都是人能读的名字，不是标识符 | 真实中英页面显示人工/ECB/无需换算，英文Manual rate/European Central Bank reference rate/No conversion needed；ReportsPage.polish断言未知来源可读回退。 |
| MC-UI-FX-007 | P2 | 部分验证 | 默认视图仍然脱敏 | 设置默认缓存明细折叠且高级入口存在；未逐条检查展开诊断所有来源值。 |
| MC-UI-EMPTY-001 | P0 | 通过 | 文案「EUR 还没有预算内账户」；提供「创建 EUR 账户」和「切换预算账本」；不铺零值分类表 | BudgetPage.empty与budgetEmptyState测试，全新家庭acceptance-fresh.json保留欢迎/示例入口；EUR无活动摘要不占主要卡片；TransactionsPage现有空结果测试。 |
| MC-UI-EMPTY-002 | P1 | 通过 | 说明没有可分配资金的原因，不是一张无解释的零表 | BudgetPage.empty与budgetEmptyState测试，全新家庭acceptance-fresh.json保留欢迎/示例入口；EUR无活动摘要不占主要卡片；TransactionsPage现有空结果测试。 |
| MC-UI-EMPTY-003 | P1 | 通过 | 欢迎 / 演示入口仍可用，不能和「某币种无账户」空状态混成一个 | BudgetPage.empty与budgetEmptyState测试，全新家庭acceptance-fresh.json保留欢迎/示例入口；EUR无活动摘要不占主要卡片；TransactionsPage现有空结果测试。 |
| MC-UI-EMPTY-004 | P1 | 通过 | 主区无 EUR 卡片；筛选器里 EUR 为无活动 | BudgetPage.empty与budgetEmptyState测试，全新家庭acceptance-fresh.json保留欢迎/示例入口；EUR无活动摘要不占主要卡片；TransactionsPage现有空结果测试。 |
| MC-UI-EMPTY-005 | P1 | 通过 | 说明没有投资账户，并给新建或去账户页的入口 | 真实投资currency=CNY空筛选显示No investment accounts match these filters及新增投资账户的Accounts链接；acceptance-final-investment-empty.json。 |
| MC-UI-EMPTY-006 | P1 | 通过 | `txp_noResults`，不是空白表头 | BudgetPage.empty与budgetEmptyState测试，全新家庭acceptance-fresh.json保留欢迎/示例入口；EUR无活动摘要不占主要卡片；TransactionsPage现有空结果测试。 |
| MC-UI-EMPTY-007 | P2 | 部分验证 | 筛选器无 GBP，或回退全部并提示 | 账户筛选只列enabledCurrencies，未通过伪造非法账户筛选状态完整验证回退。 |
| MC-UI-CAT-001 | P0 | 通过 | 确认文案写明会影响所有币种账本；取消则不写 | 真实UI重命名/隐藏/删除/创建组/创建分类逐一触发影响全部账本提示；confirm false shim模拟拒绝后草稿保留，categoryRevision保持10且无新增名字。金额隔离另有跨币HTTP断言。acceptance-final-category-confirmations.json，原生确认交互首次单独观察，重复接受/拒绝由shim驱动。 |
| MC-UI-CAT-002 | P0 | 通过 | 名称已改；SGD 和 CNY 的分配、目标、可用仍隔离 | 真实HTTP共享改名，CNY1500与SGD300金额保留且stale categoryRevision为409；note测试覆盖共享确认与拒绝保留草稿。acceptance-api-results.json。 |
| MC-UI-CAT-003 | P0 | 通过 | 同样提示影响全部账本 | 真实UI重命名/隐藏/删除/创建组/创建分类逐一触发影响全部账本提示；confirm false shim模拟拒绝后草稿保留，categoryRevision保持10且无新增名字。金额隔离另有跨币HTTP断言。acceptance-final-category-confirmations.json，原生确认交互首次单独观察，重复接受/拒绝由shim驱动。 |
| MC-UI-CAT-004 | P0 | 通过 | 提示结构共享；金额仍按当前账本隔离 | 真实UI重命名/隐藏/删除/创建组/创建分类逐一触发影响全部账本提示；confirm false shim模拟拒绝后草稿保留，categoryRevision保持10且无新增名字。金额隔离另有跨币HTTP断言。acceptance-final-category-confirmations.json，原生确认交互首次单独观察，重复接受/拒绝由shim驱动。 |
| MC-UI-CAT-005 | P1 | 通过 | 备注共享；不误伤分配额 | 真实HTTP共享改名，CNY1500与SGD300金额保留且stale categoryRevision为409；note测试覆盖共享确认与拒绝保留草稿。acceptance-api-results.json。 |
| MC-UI-CAT-006 | P0 | 通过 | 409；页面保留输入并展示最新名称 | 真实HTTP共享改名，CNY1500与SGD300金额保留且stale categoryRevision为409；note测试覆盖共享确认与拒绝保留草稿。acceptance-api-results.json。 |
| MC-UI-REV-001 | P0 | 通过 | B 得 409 和最新预算；服务端保持 A 的值 | 真实HTTP同币stale不覆盖、异币独立；双context页面123.45草稿与1600.00最新并列，取消不写，明确重试321.09成功。acceptance-conflict.json、acceptance-conflict-cancel.json。 |
| MC-UI-REV-002 | P0 | 通过 | 不丢输入，不静默覆盖 | 真实HTTP同币stale不覆盖、异币独立；双context页面123.45草稿与1600.00最新并列，取消不写，明确重试321.09成功。acceptance-conflict.json、acceptance-conflict-cancel.json。 |
| MC-UI-REV-003 | P0 | 通过 | 每次成功都推进该币种 revision | 独立真实HTTP逐一验证assign/move/goal/auto/copy/cover/reconcile/account create-close-delete及transaction create-bulk-delete均仅CNY revision+1；有交易账户禁止删除为正确保护，清理交易后删除成功。acceptance-revision-all.json与acceptance-revision-delete-completion.json，原脚本最后FAIL是清理前置条件不足。 |
| MC-UI-REV-004 | P0 | 通过 | CNY 和 SGD 的 revision 都 +1 | 真实HTTP同币stale不覆盖、异币独立；双context页面123.45草稿与1600.00最新并列，取消不写，明确重试321.09成功。acceptance-conflict.json、acceptance-conflict-cancel.json。 |
| MC-UI-REV-005 | P1 | 通过 | 互不 409；各自页面 URL 也不互相改写 | 真实HTTP同币stale不覆盖、异币独立；双context页面123.45草稿与1600.00最新并列，取消不写，明确重试321.09成功。acceptance-conflict.json、acceptance-conflict-cancel.json。 |
| MC-UI-REV-006 | P1 | 通过 | 焦点进冲突说明；关闭后回到金额输入 | d4bb3d1真实备注409取消后TEXTAREA聚焦、草稿完整、Save仍1个；无需修改草稿直接再Save→Retry写成功。custom456.78取消仍聚焦且不清空；自动分配取消无unhandled并保留外部值。acceptance-final-note/custom/auto-d4bb3d1.json；金额焦点亦有独立证据。 |
| MC-UI-REV-007 | P1 | 通过 | 只说「另一设备已更新」，不出现成员名或内部 revision 数字当主文案 | 真实英文共享备注409与预算409分别显示Shared categories/Budget updated on another device，不编造成员；待提交草稿和最新值并列，取消不写、再次明确Retry写成功。共享确认文字原生观察，随后接受confirm使用shim以避开工具自动处理。acceptance-final-category-conflict.json。 |
| MC-UI-REV-008 | P2 | 通过 | 两种冲突文案分得清：结构影响全部账本，金额只影响当前账本 | 真实英文共享备注409与预算409分别显示Shared categories/Budget updated on another device，不编造成员；待提交草稿和最新值并列，取消不写、再次明确Retry写成功。共享确认文字原生观察，随后接受confirm使用shim以避开工具自动处理。acceptance-final-category-conflict.json。 |
| MC-UI-LINK-001 | P0 | 通过 | 提示「CAD 已停用，已显示 CNY」（或当前默认）；选择器没有 CAD；`history.replace` 成可用币种；不转圈 | ca08a02真实CAD/AUD回退后说明持续显示且URL替换为最近SGD；小写cny/CN也明确提示。acceptance-final-budget.json。 |
| MC-UI-LINK-002 | P0 | 通过 | 同样提示并回退；不把 AUD 画进选择器 | ca08a02真实CAD/AUD回退后说明持续显示且URL替换为最近SGD；小写cny/CN也明确提示。acceptance-final-budget.json。 |
| MC-UI-LINK-003 | P0 | 通过 | 回退到全部视图或默认已启用币种，并说明原因 | d4bb3d1真实中英CAD现金流回退All/全部，净资产回退CNY且保留2026-09-04；replace后提示持续且准确。acceptance-final-notice-d4bb3d1.json。 |
| MC-UI-LINK-004 | P0 | 通过 | 折算回家庭默认；估值日仍可用则保留；replace URL | d4bb3d1真实中英CAD现金流回退All/全部，净资产回退CNY且保留2026-09-04；replace后提示持续且准确。acceptance-final-notice-d4bb3d1.json。 |
| MC-UI-LINK-005 | P1 | 部分验证 | 不会在非法币种和回退结果之间死循环；replace 不得再推一条坏记录 | 现金流CAD回退已观察；净资产CAD保留估值日；尚需最终验证持续说明、非法空值/小写全部变体和后退不循环。 |
| MC-UI-LINK-006 | P1 | 部分验证 | 一律当非法，提示并回退，不 500 | cny和CN已实际明确回退；空字符串在同页面导航中保留上次CN提示，未证明空值被独立识别；不得据此通过整条。 |
| MC-UI-LINK-007 | P1 | 通过 | 进入新的收支全部或明确的报表入口，不空白 | 真实#/reports旧书签进入全部现金流，未空白。 |
| MC-UI-LINK-008 | P2 | 通过 | 现有精确正则 `^#/accounts/([\w-]+)$` 不能把详情打成列表 | 5ffc990真实账户详情?x=1显示Checking、Account currency CNY、交易明细，无列表回退；acceptance-final-app-route.json。 |
| MC-UI-I18N-001 | P0 | 通过 | 「预算账本」「查看币种」「折算为」「净资产默认币种」「账户入账」「商户计价」「转出」「入账」「使用中」「无活动」都在 | i18n.p0测试及实际设置英文页、JPY真实行，角色文案/默认币种说明齐全，JPY无小数。 |
| MC-UI-I18N-002 | P0 | 通过 | 组件 + 浏览器 | 按该行角色词范围，英文Budget ledger/View currency/Convert to/Default net-worth currency/Account amount/Original amount/Sent/Received/In use/Inactive均有组件与实际页面证据；系统Uncategorized英文已复验。用户自定义中文账户/分类不算系统漏译。acceptance-browser-final-results、final-account、settings-english、final-notice-d4bb3d1及i18n.p0测试。 |
| MC-UI-I18N-003 | P0 | 通过 | 中英都改 | i18n.p0测试及实际设置英文页、JPY真实行，角色文案/默认币种说明齐全，JPY无小数。 |
| MC-UI-I18N-004 | P0 | 通过 | 组件 | i18n.p0测试及实际设置英文页、JPY真实行，角色文案/默认币种说明齐全，JPY无小数。 |
| MC-UI-I18N-005 | P1 | 通过 | 都无小数；不靠单独 `$` 判断币种 | i18n.p0测试及实际设置英文页、JPY真实行，角色文案/默认币种说明齐全，JPY无小数。 |
| MC-UI-I18N-006 | P1 | 部分验证 | 四种说明在中英都完整 | 主要页面中英已观察，但未完整逐字检查所有新状态；asOf仍是英文内部可访问名，存在页面内联双语字符串。系统生成未分类中文正待修复。 |
| MC-UI-I18N-007 | P1 | 部分验证 | 单独出现的 `CNY` 旁都有角色说明 | 主要页面中英已观察，但未完整逐字检查所有新状态；asOf仍是英文内部可访问名，存在页面内联双语字符串。系统生成未分类中文正待修复。 |
| MC-UI-I18N-008 | P2 | 失败 | 新文案进 i18n，避免再堆 `lang === "zh" ? ...` | 静态检查src/useWriteClient.tsx仍以en ?中英字符串构造冲突内容，BudgetPage隐藏/恢复入口仍lang === zh内联；不满足该P2要求所有新文案进入i18n。现有中英呈现不因此推断错误。 |
| MC-UI-A11Y-001 | P0 | 通过 | 选择器可聚焦；`aria-label` 为「预算账本」；Esc 关掉检查器，逻辑沿用现有 inspector 测试 | 真实Space+s+Enter切SGD并保焦点，键盘Meta+A输入金额→Tab触发409→Tab到Cancel→Escape回原input及123.00草稿，Inspector Escape关闭1→0。acceptance-keyboard-conflict.json及组件Esc测试。 |
| MC-UI-A11Y-002 | P0 | 通过 | 选中项有 `aria-pressed` 或 `aria-current`；角色名被读屏读到，不只是 `CNY` | ReportsPage.currency/net-worth测试验证aria-current/aria-pressed与角色名；真实净资产按钮可操作。 |
| MC-UI-A11Y-003 | P0 | 部分验证 | `aria-live` 读出原因，不只靠颜色 | 真实409标题role=status、aria-live=assertive，回退notice role=status、aria-live=polite，聚焦与文字均已观察；本工具未完成原生屏幕阅读器听读。acceptance-keyboard-conflict.json、acceptance-final-notice-d4bb3d1.json。该P0保留部分验证，不计通过。 |
| MC-UI-A11Y-004 | P1 | 部分验证 | 能读到「账户入账」「商户计价」或「转出」「入账」，次级金额不是无名数字 | 键盘Tab触发实际409及role=status/aria-live存在、金额标签可读；未启动真实读屏软件完成整套朗读。冲突/回退及警告同时有文字。 |
| MC-UI-A11Y-005 | P1 | 通过 | 操作在焦点下可见，不依赖 hover | ca08a02交易行Tab到Delete后父层opacity>0.99；320/390预算主控件均在视口内；语言EN按钮aria-pressed=true、中文false。acceptance-browser-final-results.json、acceptance-final-budget/networth.json。 |
| MC-UI-A11Y-006 | P1 | 通过 | 币种控件在标题区，不用先滚侧栏；预算表可横滑但选择器始终在视口内 | ca08a02交易行Tab到Delete后父层opacity>0.99；320/390预算主控件均在视口内；语言EN按钮aria-pressed=true、中文false。acceptance-browser-final-results.json、acceptance-final-budget/networth.json。 |
| MC-UI-A11Y-007 | P1 | 部分验证 | 原币和换算列仍能对应，不互相覆盖 | CSS zoom=2已有截图与金额列不重叠几何；原生Meta+=未改变浏览器缩放，不声称原生200%已通过。root-verification.md及acceptance-networth-200percent.png。 |
| MC-UI-A11Y-008 | P1 | 通过 | 有 `aria-pressed`；`document.documentElement.lang` 仍切 `zh-CN` / `en-US` | ca08a02交易行Tab到Delete后父层opacity>0.99；320/390预算主控件均在视口内；语言EN按钮aria-pressed=true、中文false。acceptance-browser-final-results.json、acceptance-final-budget/networth.json。 |
| MC-UI-A11Y-009 | P2 | 通过 | `aria-label` 走 i18n，不再写死 `"menu"` | 5ffc990真实390px菜单aria-label中英分别为打开导航菜单/Open navigation menu；acceptance-final-app-route.json。 |
| MC-UI-A11Y-010 | P1 | 部分验证 | 不只靠颜色区分；警告有图标或文字 | 键盘Tab触发实际409及role=status/aria-live存在、金额标签可读；未启动真实读屏软件完成整套朗读。冲突/回退及警告同时有文字。 |
| MC-UI-REG-001 | P0 | 通过 | 全绿。失败不得靠 skip | d4bb3d1使用Node20.20.2，typecheck通过、91文件757测试全通过且无skip、build14.35s通过；acceptance-typecheck/tests/build-d4bb3d1.log、acceptance-vitest-d4bb3d1.json。 |
| MC-UI-REG-002 | P0 | 通过 | SGD 工资不加进 CNY 待分配；100 SGD / 550 CNY 双腿守恒；缺汇率无总数 | 全量金额/隔离/投资/转账/JPY与新IA测试；ChatPage.confirm及ai.currency-tools断言确认卡双币种摘要。 |
| MC-UI-REG-003 | P0 | 通过 | 拒小数；中英都无假小数 | 全量金额/隔离/投资/转账/JPY与新IA测试；ChatPage.confirm及ai.currency-tools断言确认卡双币种摘要。 |
| MC-UI-REG-004 | P0 | 通过 | 不再要求侧栏全局选择器；预算请求来自 URL；报表默认全部 | 全量金额/隔离/投资/转账/JPY与新IA测试；ChatPage.confirm及ai.currency-tools断言确认卡双币种摘要。 |
| MC-UI-REG-005 | P1 | 通过 | 过滤仍有效 | 全量金额/隔离/投资/转账/JPY与新IA测试；ChatPage.confirm及ai.currency-tools断言确认卡双币种摘要。 |
| MC-UI-REG-006 | P1 | 部分验证 | 仍只显示迁移页 | 迁移门禁、助手工具提示/确认、demo分别有模块组件测试；自然语言回答/外网断开/实际demo载入/同context双标签未完整操作。独立context复制预算已通过。 |
| MC-UI-REG-007 | P1 | 通过 | 收支不变，净资产变；按钮仍是更新估值 | 全量金额/隔离/投资/转账/JPY与新IA测试；ChatPage.confirm及ai.currency-tools断言确认卡双币种摘要。 |
| MC-UI-REG-008 | P1 | 部分验证 | 按账户币种分组回答，不相加；问「折合 CNY」才用汇率并报日期和来源 | 迁移门禁、助手工具提示/确认、demo分别有模块组件测试；自然语言回答/外网断开/实际demo载入/同context双标签未完整操作。独立context复制预算已通过。 |
| MC-UI-REG-009 | P1 | 通过 | 同时列出两端金额和币种 | 全量金额/隔离/投资/转账/JPY与新IA测试；ChatPage.confirm及ai.currency-tools断言确认卡双币种摘要。 |
| MC-UI-REG-010 | P1 | 部分验证 | 可用；已缓存净资产仍显示汇率日期 | 迁移门禁、助手工具提示/确认、demo分别有模块组件测试；自然语言回答/外网断开/实际demo载入/同context双标签未完整操作。独立context复制预算已通过。 |
| MC-UI-REG-011 | P2 | 部分验证 | 多币种账户仍能看；侧栏无全局选择器 | 迁移门禁、助手工具提示/确认、demo分别有模块组件测试；自然语言回答/外网断开/实际demo载入/同context双标签未完整操作。独立context复制预算已通过。 |
| MC-UI-REG-012 | P1 | 部分验证 | URL 各管各的；写入同一账本才 409 | 迁移门禁、助手工具提示/确认、demo分别有模块组件测试；自然语言回答/外网断开/实际demo载入/同context双标签未完整操作。独立context复制预算已通过。 |

## 未取得的证据

真实读屏、原生200%缩放、断外网工作、助手自由问答，以及每一个分类/预算写入口各自完整的双会话冲突取消重试，尚无全套运行证据。金额编辑、共享备注、自定义分配、自动分配已有真实冲突操作，所有写路径revision推进另有HTTP与模块断言。已有模块或共享hook测试仅证明明确断言的部分。

分类组隐藏/恢复没有在原产品意图或稳定用例里明确要求为新增入口，不把这项扩为阻断。退款净额口径未在本批页面用例里明确，不据此新增验收要求。

## 中文检查

交付前按好好说话技能再次检查了中文：保留全部用例ID、金额、版本和证据边界，清除了中间状态的完成暗示。部分验证、P2失败和工具限制均直接说明，未改写为全绿承诺。
