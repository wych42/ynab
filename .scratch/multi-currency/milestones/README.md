# 多币种实现里程碑

这组里程碑把 [产品方案](../plan.md) 和 [测试计划](../test-plan.md) 拆成十二个可独立验收、可单独提交的交付。后一个里程碑只有在前一个里程碑完成验收并形成 commit 后才能进入 `ready-for-agent`。

## 执行约定

- 每个里程碑使用一个全新的 Grok session，模型固定为 `grok-4.6`，reasoning effort 固定为 `xhigh`。
- Grok 负责写测试、确认 RED、实现、确认 GREEN、运行相关测试和完整质量门槛。
- 协调者负责编写任务、限制 Grok 权限、核对工具事件与命令结果、审查完整 diff、验收和提交。
- 协调者不重复运行测试。测试证据来自 Grok 的 `streaming-json` 工具事件、命令输出和退出状态。
- Grok 不提交、不 push。每个里程碑通过验收后，由协调者创建一个范围单一的 commit。
- 验收发现明确缺口时，只允许使用原 session ID 定向返工一次。再次失败就停止，并把缺口写回对应里程碑。
- 所有测试使用 `mise exec node@20 --`，外部汇率测试使用受控 `fetch`，不访问生产 Frankfurter。
- 每次执行前记录工作区基线；已有 `.scratch/multi-currency/` 方案文件属于本功能，其他意外改动一律停止处理。

## 交付顺序

| 文件 | 交付结果 | 状态 | 验收证据 |
| --- | --- | --- | --- |
| [建立绿色基线](./00-green-baseline.md) | Node 20 全绿，CI 加入 build | implemented | Node 20.20.2；37 files、248 tests；typecheck 和 build 通过 |
| [统一金额和币种目录](./01-money-foundation.md) | Money Module 和单一币种目录 | implemented | 共享目录；targeted 68 tests；全量 316 tests；typecheck 和 build 通过 |
| [加入兼容的多币种 Schema](./02-compatible-schema.md) | 新表、新字段和迁移锁 | implemented | targeted 21 tests；全量 337 tests；普通 Route 与 AI/IM 写锁通过 |
| [完成旧账本迁移](./03-legacy-migration.md) | 备份、确认、缩放和迁移页 | implemented | targeted 32 tests；全量 369 tests；备份、恢复、原子回滚和页面提示通过 |
| [让账户明确携带币种](./04-account-currency.md) | 账户币种、账本启用和汇总币种设置 | implemented | targeted 26 tests；全量 393 tests；创建回滚、设置和账户页面通过 |
| [隔离各币种预算](./05-budget-isolation.md) | 分配、目标、预算和原币收支隔离 | implemented | targeted 41 tests；全量 422 tests；查询参数、信用卡虚拟分类和切币竞态通过 |
| [统一交易和换汇写入](./06-currency-ledger.md) | Currency Ledger Module 和跨币种转账 | implemented | targeted 85 tests；全量 469 tests；双腿原子性、分类保护和页面精度通过 |
| [建立可替换的汇率模块](./07-fx-module.md) | Provider、缓存、人工覆盖和离线行为 | ready-for-agent | 统一财务写入边界已完成 |
| [交付统一净资产报表](./08-reporting-net-worth.md) | 当前与历史净资产完整纵切 | blocked | 等待 FX Module |
| [补齐投资账户工作流](./09-investment-workflow.md) | 原币投资余额、估值调整和净资产联动 | blocked | 等待净资产报表 |
| [收紧 AI 与 IM 写入](./10-ai-im-tools.md) | 类型化财务工具和只读 SQL | blocked | 等待统一财务 Interface |
| [完成文档和发布验收](./11-release-readiness.md) | 文档、演示数据、迁移演练和完整验收 | blocked | 等待全部功能里程碑 |

## 状态更新规则

开始执行前，把目标文件状态改为 `in-progress`，记录启动时间和 Grok session。验收通过后写入测试结果、diff 结论和 commit，并改为 `implemented`；随后把下一个里程碑改为 `ready-for-agent`。如果范围发生变化，先更新产品方案、测试计划和受影响的里程碑，再重新 dispatch。
