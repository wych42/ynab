# 统一金额规则和币种目录

> Milestone：01
>
> 状态：implemented
>
> Blocked by：建立绿色基线和 CI 门槛
>
> 建议提交：`feat: add currency-aware money foundation`

## 交付结果

后端和前端通过同一份受版本控制的币种目录解释最小货币单位。业务代码获得稳定的 Money Module，能够校验、解析、格式化和换算金额。

## 允许范围

- 新增唯一的币种目录，内置 CNY、USD、SGD、CAD、EUR、GBP、JPY；默认启用 CNY、USD、SGD、JPY、EUR。
- 新增 `server/money.mjs`、`src/money.ts` 和数据驱动测试。
- 引入 `decimal.js`，所有汇率计算使用十进制定点输入，最后一步才按目标币种精度四舍五入。
- 为旧 `fmtMoney` 提供明确的兼容边界，但暂不改造全部业务页面。

## 验收条件

- JPY 使用零位小数，其余六种币种使用两位小数。
- 精确覆盖测试计划中的解析、格式化、安全整数和半单位四舍五入矩阵。
- 超出币种精度的用户输入直接拒绝。
- 前后端行为测试共享同一组用例或同一权威数据，不能复制两份可能漂移的目录。
- 临时扩充测试目录加入 AUD 时不需要修改数据库 Schema。
- 不新增数据库迁移、Route 或页面功能。

## Grok 必须执行的测试

```bash
mise exec node@20 -- npm test -- server/money.test.mjs src/money.test.ts
mise exec node@20 -- npm run typecheck
mise exec node@20 -- npm test
mise exec node@20 -- npm run build
git diff --check
```

## 执行记录

- 启动日期：2026-08-31
- Grok session：`01a05374-234f-7280-b849-1207bf853ccc`，模型 `grok-4.6`，reasoning effort `xhigh`
- RED：先建立前后端共享测试矩阵，targeted tests 因 `server/money.mjs` 和 `src/money.ts` 不存在而按预期失败。审查又补充最大安全整数格式化用例，证明原实现会把 CNY 金额末位 `.91` 错误显示为 `.90`。
- GREEN：targeted 2 个文件和 68 个测试通过；全量 39 个文件和 316 个测试通过；typecheck、production build 与 `git diff --check` 通过。
- 验收：七币种目录、默认启用集合、精度、解析、格式化、十进制换算、安全整数、正负半单位舍入和 AUD 临时扩充均有前后端共享用例。目录与算法只有 `shared/` 一份权威实现，后端和前端入口只负责导出；格式化使用 BigInt 与 `formatToParts`，不会丢失合法最小单位。没有 Schema、Route 或页面功能改动。
- Commit：本里程碑提交 `feat: add currency-aware money foundation`
