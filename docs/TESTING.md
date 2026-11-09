# 测试

## 测试层级

| 层级 | 位置 | 重点 |
|---|---|---|
| 纯单元测试 | `tests/unit/` | 格式、几何、SemVer、剖面、导航和解析算法 |
| 浏览器测试 | `tests/*-test.cjs` | 地图、交互、布局、照片、导出、语言和可访问性 |
| 夹具检测 | `tests/viewer-test.cjs`, `tests/fixtures/` | GPX/KML/KMZ 解析和格式边界 |
| 宿主自测 | `tools/Harness/SelfTests.cs` | KMZ、偏好、导出状态机、原子文件和缓存身份 |
| live smoke | `tests/smoke/` | CyclOSM 真实瓦片端点，独立于主 CI |

## 命令

```powershell
npm run check
npm run test:unit
$env:CHROMIUM = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm test
npm run test:host
npm run test:version
npm run test:live
```

`npm test` 先跑所有纯单元测试，再逐个执行浏览器套件。失败时 `tests/support/artifacts.cjs` 写入截图、
`result.json` 和 Playwright `trace.zip` 到 `test-results/<suite>/`。

## 测试原则

- 不依赖系统语言：需要中文或英文标签时显式设置 Playwright locale。
- 不依赖固定等待：等待 DOM、动画、地图缩放值或明确的业务状态。
- 大文件测试使用生成夹具，真实轨迹不进入仓库。
- 修复功能时同时补充失败场景，不只修改现有断言迎合实现。
- UI 测试优先验证用户看到和操作到的结果，不直接依赖内部数组下标。

## CI

`.github/workflows/build.yml` 在 push 和 PR 上执行静态检查、夹具复现、Release 构建、宿主测试、检测测试和
全部浏览器测试。live smoke 独立运行，不阻塞主 CI。
