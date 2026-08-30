# 建立绿色基线和 CI 门槛

> Milestone：00
>
> 状态：ready-for-agent
>
> Blocked by：none
>
> 建议提交：`test: establish multi-currency baseline`

## 交付结果

在 CI 同款 Node 20 下得到可重复的绿色基线，并让 CI 同时执行 typecheck、测试和 production build。这个里程碑不实现任何多币种业务行为。

## 执行要求

- 修改前完整阅读仓库根目录 `AGENTS.md`、[里程碑总表](./README.md)、[产品方案](../plan.md) 和[测试计划](../test-plan.md)。
- 你负责执行本文件列出的全部测试命令，并在最终报告中保留每条命令的退出结果。协调者不会代跑测试。
- 如果现有测试失败，先保存失败证据，再用最小改动修复测试基础设施，并重新执行完整质量门槛。
- 不要创建 commit，不要 push，不要修改本里程碑允许范围以外的文件。
- 完成后保留工作区改动，报告修改文件、首次失败原因、最终测试结果和剩余风险。

## 允许范围

- 运行现有全量测试，确认当前真实基线。
- 如果现有测试因 jsdom Storage、测试服务器监听时机或测试基础设施失败，先保留失败证据，再做最小修复。
- 在 `.github/workflows/ci.yml` 中加入 `npm run build`。
- 只修改测试环境、测试辅助配置和 CI。不得修改产品行为来迁就测试。

## 验收条件

- Grok 的命令事件证明使用 Node 20。
- `npm run typecheck`、`npm test` 和 `npm run build` 全部退出 0。
- 没有 `.only`、新增无理由 `.skip`、放宽断言或删除现有测试。
- CI 在 `dev` push 和目标为 `dev` 的 PR 上按 typecheck、test、build 的顺序执行。
- diff 中没有多币种 Schema、金额逻辑或页面功能。

## Grok 必须执行的命令

```bash
mise exec node@20 -- node -v
mise exec node@20 -- npm run typecheck
mise exec node@20 -- npm test
mise exec node@20 -- npm run build
git diff --check
git status --short
```

如果第一次 `npm test` 失败，最终报告必须同时给出第一次失败原因和修复后的通过结果。

## 执行记录

- Grok session：待填写
- RED：待填写
- GREEN：待填写
- 验收：待填写
- Commit：待填写
