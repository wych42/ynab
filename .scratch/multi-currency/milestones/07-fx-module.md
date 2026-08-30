# 建立可替换的汇率模块

> Milestone：07
>
> 状态：implemented
>
> 启动时间：2026-08-31 03:37:25 +08
>
> Blocked by：统一交易、对账和换汇写入
>
> 建议提交：`feat: add extensible fx module`

## 交付结果

`server/fx.mjs` 通过稳定 Interface 提供汇率选择、换算、缓存和同步。自动来源由可替换 Provider 注入，首版默认 `frankfurter_ecb`；人工汇率独立存在并优先。

## 允许范围

- 实现 `getRate`、`convert`、`syncRates` 和 Provider Interface。
- 实现 `FrankfurterEcbAdapter`、`InMemoryFxAdapter` 与 Provider 注册表。
- 缓存规范化记录，保存实际来源日期、定点字符串、来源和抓取时间。
- 支持直连、反向、经 EUR 交叉换算、工作日回退、人工覆盖、超时和错误归一化。
- Settings 提供缓存状态、刷新和人工覆盖管理。

## 验收条件

- Frankfurter 请求使用 v2，并固定 `providers=ECB`。
- 标准测试不访问公网，生产 Adapter 使用受控 `fetch`。
- 人工同日汇率优先于自动来源，未来日期汇率永不参与估值。
- 周末或假日返回实际采用的最近工作日。
- 断网时已有缓存可用；缺少缓存返回结构化缺失项。
- 替换 InMemory Provider 不需要修改报表 Interface 或财务 Schema。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/fx.test.mjs server/fx.provider-contract.test.mjs server/routes.fx.test.mjs src/pages/SettingsPage.fx.test.tsx
mise exec node@20 -- npm run typecheck
mise exec node@20 -- npm test
mise exec node@20 -- npm run build
git diff --check
```

## 执行记录

- Grok session：`01a0542e-3215-7f32-940f-5668dae4143d`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：目标 4 个测试文件失败。`server/fx.mjs` 不存在，provider/module/route 文件在收集阶段 0 tests；Settings 页面缺少 `fx-section`，5 个页面测试失败。
- GREEN：首轮 targeted 4 个文件 41 tests；连同 bootstrap/Settings 回归 7 个文件 65 tests；首轮全量 60 个文件 510 tests。独立验收修正后，targeted 7 个文件 76 tests，全量 60 个文件 521 tests。typecheck、production build 与 `git diff --check` 全部通过。
- 验收修正：独立审查后补齐网络错误归一化、空刷新失败、缓存边界校验和 DELETE 同级校验。修正后 targeted 7 个文件 76 tests；全量 60 个文件 521 tests。
- 验收：`getRate` / `convert` / `syncRates` 与人工写入构成 FX Interface。Frankfurter v2 固定 `providers=ECB`，测试注入 `fetch`，不访问公网。同币种 identity、直接/反向/同日 EUR 交叉、工作日回退、同日 manual 优先、较新自动优先于较旧 manual、未来记录排除、缓存命中、离线缓存、完全缺失、替换 Provider、缓存事务回滚和正负半单位舍入均通过。Route 覆盖人工增删改、刷新失败保留缓存、稳定错误码和迁移写锁。Settings 显示默认来源、缓存日期/来源，可录入与删除人工汇率。传输层错误归一为 `fx_provider_network_error`；整批空刷新失败并保留缓存；非法 Provider batch 整批回滚；DELETE 校验已启用币种和未来日期。
- Commit：本里程碑提交 `feat: add extensible fx module`
