# Formify 自动测试框架

## 目标

这套框架用于在真实 Obsidian Vault 中重复执行 Formify 的补充集成测试，并把结果写入：

- `/Users/study_superior/Desktop/沙箱仓库/System/formify-tests/<run-id>/`

当前明确不覆盖：

- `FACT-011` AI action 的真实 provider 返回
- 外部 `MCP-003` 的全 server / 全工具穷举实测

## 统一测试钩子开关

插件新增统一开关：

- `plugin.settings.testing.enableTestHooks`

框架在执行时会自动：

1. 构建并同步插件到测试 Vault
2. 重载 `formify` 插件
3. 打开测试钩子
4. 运行补测
5. 生成报告
6. 关闭测试钩子

默认不会长期保留开启状态。

## 运行方式

在插件目录执行：

```bash
cd /Users/study_superior/Desktop/Code/Formify/plugin
npm run test:framework
```

可选环境变量：

```bash
FORMIFY_TEST_VAULT=/Users/study_superior/Desktop/沙箱仓库
FORMIFY_BASELINE_RUN_ID=20260307-090505
```

## 目录结构

- `run-all.mjs`
  统一入口，负责完整流程编排
- `generate-fixtures.mjs`
  生成本轮测试夹具
- `run-supplemental-suite.mjs`
  执行补测用例
- `build-report.mjs`
  合并基线覆盖矩阵并输出本轮报告
- `shared.mjs`
  CLI、路径、构建、插件重载、钩子开关等共享能力

## 输出文件

每次运行都会生成：

- `coverage-matrix.csv`
- `report.md`
- `issues.md`
- `logs/supplemental-results.json`
- `logs/test-hook-info.json`
- `fixtures/`

## 设计约束

- 只在独立测试目录和插件自有数据目录写入测试痕迹
- 不要求修改业务源码才能关闭测试钩子
- 尽量通过真实命令、真实 `.cform`、真实 UI/服务链执行
- 对无法稳定纯自动化的场景，至少落到覆盖矩阵并标记为 `FAIL` / `PARTIAL` / `UNTESTED`
