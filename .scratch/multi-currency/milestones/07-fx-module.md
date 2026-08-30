# 建立可替换的汇率模块

> Milestone：07
>
> 状态：ready-for-agent
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

- Grok session：待填写
- RED：待填写
- GREEN：待填写
- 验收：待填写
- Commit：待填写
