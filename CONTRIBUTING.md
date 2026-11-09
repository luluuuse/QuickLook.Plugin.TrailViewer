# 贡献指南

## 开始之前

1. 阅读 [架构](docs/ARCHITECTURE.md) 和 [开发环境](docs/DEVELOPMENT.md)。
2. 确认改动属于解析、地图、标记点、剖面、导出、宿主或文档中的明确模块。
3. 从 `main` 创建短生命周期分支。

## 实现要求

- 保持 GPX/KML/KMZ 兼容和现有快捷键行为。
- 不把真实轨迹、照片或本地绝对路径提交到仓库。
- 新行为必须覆盖失败路径、空数据和窄窗口。
- 测试不依赖系统语言、固定 sleep 或内部数组顺序。
- 产品版本只在准备发布时修改，日常提交不升号。
- 用户可感知的变化写入 `CHANGELOG.md` 的 `Unreleased`。

## 提交前检查

```powershell
npm ci
npm run check
npm test
npm run test:host
```

涉及版本、tag 或 Release workflow 时，再阅读 [发布流程](docs/RELEASING.md)。

## 提交与合并

- 一个提交解决一个清晰问题。
- 提交信息说明原因和结果，不只写“修改代码”。
- UI 行为变化附带浏览器测试；纯算法变化附单元测试；宿主边界变化附 Harness 自测。
- 文档中的命令、链接和路径必须能在当前仓库直接找到。

## 文档

- 用户入口：`README.md` / `README.zh-CN.md`
- 版本历史：`CHANGELOG.md`
- 使用、架构、开发、测试、发布：`docs/`
- 当前开发交接：仓库外的 `handoff.md`，只保存当前状态，不复制稳定知识。

提交 PR 前运行 `npm run docs:check`。
