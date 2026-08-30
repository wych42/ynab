# 多币种发布验收记录

> 日期：2026-08-31
>
> 范围：自动化测试、API smoke、脱敏数据库副本迁移演练和浏览器手工验收。

本记录只写脱敏统计、演示夹具、命令、结果和临时路径。不写真实账户名称、真实交易内容、主键、密钥或仓库里的数据库文件。

## 命令

```bash
mise exec node@20 -- npm test -- server/demo.currency.test.mjs server/routes.auth.test.mjs server/routes.currency-bootstrap.test.mjs server/reports.currency.test.mjs server/investment.currency.test.mjs
mise exec node@20 -- node .scratch/multi-currency/scripts/rehearse-currency-migration.mjs --source /private/tmp/xiaowen-ynab-m11/source-snapshot.sqlite --work-dir /private/tmp/xiaowen-ynab-m11/rehearsal --currency CNY
mise exec node@20 -- npm run typecheck
mise exec node@20 -- npm test
mise exec node@20 -- npm run build
git diff --check
git status --short
```

演练脚本不硬编码个人数据库路径。`--work-dir` 是父目录；每次调用在其下新建独立 `run-*` 目录，不删除、不覆盖先前产物。源副本只读复制到该次运行目录。

事务中途失败和备份失败没有在这份真实副本上人为制造。对应证据来自已有自动化：

- `server/db.currency-migration.test.mjs`：确认过程中途失败后金额保持原值，并返回升级前备份；备份失败时数据不改。
- `server/currency-ledger.test.mjs`：跨币种转账第二条腿失败时，第一条腿和 `pair_id` 一起回滚。
- `server/demo.currency.test.mjs`：演示数据载入中途失败时不留下账户、流水、汇率或分配。

## 演示数据可观察结果

空库载入后，固定时钟 `2026-08-31T12:00:00.000Z`（UTC）下：

- 账户覆盖 CNY 日常、CNY 信用卡、USD 投资、SGD 日常、JPY 现金、EUR 零余额备用，另有 USD 信用卡和若干 CNY 钱包/储蓄便于浏览。
- 汇总币种 CNY。默认五币种账本保持启用，CAD/GBP 不自动启用。
- CNY「餐饮外出」当月分配 90,000 minor；SGD 同名分类 20,000 minor。CNY「应急基金」目标 3,000,000 minor；SGD 同名目标 800,000 minor。
- `100.00 SGD -> 550.00 CNY` 换汇两腿共用 `pair_id`，金额分别是 `-10,000` SGD minor 与 `+55,000` CNY minor。
- USD 信用卡外币消费：入账 `-2,200` USD minor，原始 `2,000` EUR minor。USD 原币收支只把 `2,200` 记成支出，估值调整不进收入。
- USD 投资余额 `1,050,000` minor，观察期净投入 `200,000` minor，估值日 `2026-08-31`。
- 人工汇率日期 `2026-08-28`，来源 `manual`：`USD/CNY=7.20`，`SGD/CNY=5.40`，`JPY/CNY=0.050`。载入过程不访问网络。
- JPY 现金余额 `98,800`，中英文格式都没有 `.00`。
- 按账户分别换算后，估值日 `2026-08-31` 的统一净资产为资产 `17,397,600` CNY minor、负债 `15,840` CNY minor、净资产 `17,381,760` CNY minor。这是演示夹具自己的手算结果，和测试计划里那组家庭夹具的 `199,000.00` CNY 不是同一套数。

`POST /api/demo` 在已有流水时返回 `data exists`，并继续受迁移锁保护。

## 副本迁移演练

源副本：`/private/tmp/xiaowen-ynab-m11/source-snapshot.sqlite`

SHA-256：`bfbb34869c9dff968e941d6f258aba7f3c52ccbc9a5e920ae15b6c0aaf7209d6`（演练前后相同）

父目录：`/private/tmp/xiaowen-ynab-m11/rehearsal`（其中仍保留更早一次写在父目录根下的旧产物，以及另一次独立运行 `run-fwiFAF`，本次没有覆盖它们）

本次运行目录：`/private/tmp/xiaowen-ynab-m11/rehearsal/run-7bD9j2`

工作副本：`/private/tmp/xiaowen-ynab-m11/rehearsal/run-7bD9j2/working.sqlite`

恢复副本：`/private/tmp/xiaowen-ynab-m11/rehearsal/run-7bD9j2/restored.sqlite`

机器可读结果：`/private/tmp/xiaowen-ynab-m11/rehearsal/run-7bD9j2/rehearsal-result.json`

备份目录：`/private/tmp/xiaowen-ynab-m11/rehearsal/run-7bD9j2/currency-migration-backups`

选择币种：CNY（exponent=2，金额不缩放）

升级前备份文件名：`budget-pre-currency-v11-20260831-153045.sqlite`

`PRAGMA integrity_check`：迁移后重新打开的工作库 `ok`；恢复库 `ok`。`ok` 要求这两项同时为真。

### 迁移前

| 项 | 值 |
| --- | --- |
| Schema | 11 |
| 迁移状态 | pending |
| 汇总币种 | 空 |
| 账户 / 交易 / 分配 / 目标 | 6 / 202 / 78 / 6 |
| 旧币种字段为空 | 账户 6、分配 78、目标 6 |
| 启用账本 | 无 |
| 期初合计 | 7,834,000 |
| 非期初流水合计 | 3,682,521 |
| 复算余额合计 | 11,516,521 |
| 期初与 is_start 流水合计一致 | 是 |
| 分配合计 | 9,665,779 |
| 目标合计 | 4,200,000 |

账户、交易、分配、目标的主键集合用 SHA-256 指纹保存，不输出主键本身。

### 迁移后

| 项 | 值 |
| --- | --- |
| 迁移状态 | complete |
| 汇总币种 | CNY |
| 启用账本 | CNY、USD、SGD、EUR、JPY（CNY 去重，未重复建账本） |
| 账户 / 交易 / 分配 / 目标 | 6 / 202 / 78 / 6，主键指纹与迁移前相同 |
| 金额 | 期初、流水、分配、目标合计均未缩放 |
| 回填币种 | 账户、分配、目标均为 CNY |
| 第二次确认 | `alreadyCompleted=true`，备份仍是 1 份 |

关闭并重新打开工作副本后，状态仍是 complete。对该工作库执行 `PRAGMA integrity_check=ok`。

### 恢复

从升级前备份恢复到本次运行目录的 `restored.sqlite`，只读打开：

- 状态回到 pending
- 表行数、主键指纹、余额复算、分配/目标合计与迁移前一致
- `PRAGMA integrity_check=ok`

## 浏览器手工验收

协调者在两个全新临时数据库上完成了浏览器验收。第一个实例按正常网络环境检查家庭使用主流程；第二个实例在 Node 启动前将外部 `fetch` 固定为失败，检查断网和缺汇率行为。两个实例都没有读取或修改仓库的 `data/budget.db`。

- 首次进入只启用 CNY、USD、SGD、JPY、EUR；设置页把 CAD 和 GBP 列为可添加币种。
- CNY 账本的 Ready to Assign 原为 `25,210.00 CNY`。新增第二个家庭 CNY 预算内账户并录入 `100.00 CNY` 期初余额后，同一份 Ready to Assign 变为 `25,310.00 CNY`，账户列表仍分别保留两人的账户。
- 切换 CNY 和 SGD 预算时，CNY「餐饮外出」本月分配显示 `900.00 CNY`，SGD 同分类显示 `200.00 SGD`，两边的 Ready to Assign 和分类余额各自计算。
- 交易页显示 `100.00 SGD -> 550.00 CNY` 的两端金额、换汇转出分类和跨币种换汇备注；自动化同时断言两腿共用 `pair_id` 和隐含汇率。
- USD 信用卡消费同时显示入账 `22.00 USD` 和原始金额 `20.00 EUR`。USD 原币报表只计 `22.00 USD` 支出。
- USD 投资页显示余额 `10,500.00 USD`、投入和净投入 `2,000.00 USD`、取回 `0.00 USD`、最近估值 `2026-08-31`。估值调整在投资视图和净资产中可见，普通收支没有增加。
- 正常实例的 CNY 统一净资产显示资产 `173,976.00 CNY`、负债 `158.40 CNY`、净资产 `173,817.60 CNY`；账户明细显示 `2026-08-28` 的 manual 汇率及来源。
- 断网实例仍能载入并使用原币预算、创建 CAD 原币账户，并能用演示数据内已有人工汇率显示当前净资产。历史月份缺率时逐项列出缺少的币种对。
- 断网实例增加 `100.00 CAD` 账户且没有 CAD/CNY 汇率时，页面隐藏资产、负债和净资产总数，并明确列出 `CAD -> CNY`。通过正式 HTTP Interface 补录 `CAD/CNY=5.20` 人工汇率后，总数恢复，CAD 账户显示换算 `520.00 CNY`、日期 `2026-08-31`、来源 `manual`。
- 中英文界面都按账户币种格式化金额；JPY 现金分别显示 `JP¥98,800` 和 `¥98,800`，没有虚假的 `.00`。
- 两个浏览器实例的控制台都没有 warning 或 error。

人工汇率表单本身已有 React 页面自动化覆盖。此次浏览器控制环境不能向原生日期输入框稳定派发日期变更，因此缺率恢复步骤通过同一正式 HTTP Interface 写入人工汇率，再由浏览器核对页面结果；没有绕过业务校验或直接改数据库。
