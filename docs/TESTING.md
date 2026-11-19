# 测试

## 测试层级

| 层级 | 位置 | 重点 |
|---|---|---|
| 纯单元测试 | `tests/unit/` | 格式、几何、SemVer、剖面、导航和解析算法 |
| 浏览器测试 | `tests/*-test.cjs` | 地图、图标系统、测距、分段表、交互、布局、照片、导出、语言和可访问性 |
| 夹具检测 | `tests/viewer-test.cjs`, `tests/fixtures/` | GPX/KML/KMZ/FIT 解析和格式边界 |
| 宿主自测 | `tools/Harness/SelfTests.cs` | KMZ、偏好、DPAPI 密钥、导出状态机和缓存身份 |
| PR 浏览器分片 | `.github/workflows/build.yml` | core、map、tools、media、network 五组并行 |
| live smoke | `tests/smoke/` | CyclOSM、OpenHikingMap、OpenTopoMap 真实瓦片端点，独立于主 CI |

## 命令

```powershell
npm run check
npm run test:unit
$env:CHROMIUM = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:suite -- photo focus
npm run test:suite -- --list
npm test
npm run test:host
npm run test:version
npm run test:live
```

`npm test` 先跑所有纯单元测试，再逐个执行浏览器套件。失败时 `tests/support/artifacts.cjs` 写入截图、
`result.json` 和 Playwright `trace.zip` 到 `test-results/<suite>/`。

浏览器性能基线覆盖 30,000 点轨迹的解析、首屏、每公里首次展开和连续缩放，并生成 5,000 个航点验证
视口标记虚拟化。阈值刻意留有余量，用于拦截数量级回归，不作为不同机器之间的精确基准。
单元测试还生成 30,001 点、约 3,300 公里的长轨迹，确保每公里统计不再按公里重复扫描所有区间。

`npm run test:suite -- <名称...>` 只运行名称中包含任一指定文本的套件；也可以传完整文件名。
名称不存在时直接失败，避免拼写错误变成“零项测试全部通过”。`--list` 只列出将要运行的套件。

## 按改动选择测试

日常迭代不必每次运行全部 25+ 个浏览器套件。先运行 `npm run test:quick`，再按改动选择专项；正式发布、
修改共享样式或事件链时仍运行全量测试。

| 改动范围 | 建议专项 |
|---|---|
| 照片、附件弹窗、全览返回 | `photo focus` |
| 剖面、心率、速览或高程 | `profile ve scrub` |
| 测距、工具箱、坐标、摘要与附件导出 | `measure tools portrait`，并运行单元测试 |
| 标记点、导航和列表 | `nav pins insights` |
| 图层、定制图源、缩放和定位 | `terrain custom-source zoom locate` |
| 图标 | `icons`，并运行单元测试 |
| 导出 | `export` |
| GPX/KML/FIT 解析与轨迹标记 | `viewer route-info`，并运行单元测试 |
| 共享布局、键盘和全局状态 | 全部浏览器套件 |

给用户生成测试包时，建议顺序为：

```powershell
npm run test:quick
npm run test:suite -- photo focus
dotnet build src/QuickLook.Plugin.TrailViewer.csproj -c Release
npm run test:version
node scripts/pack.cjs
```

修改 C# 宿主时增加 `npm run test:host`。正式发布前执行 `npm run check`、`npm test`、宿主测试和版本检查。
先完成版本号与构建，再运行版本测试，避免构建元数据仍指向旧版本。
Build workflow 使用声明的最低 Node 20，Release workflow 使用 Node 22，两侧共同覆盖最低版本与当前环境。

当前专项入口：

- `tests/unit/icons.test.mjs`：图标注册表、尺寸、描边和未知图标回退。
- `tests/unit/weather.test.mjs`：起点、终点、顶点、无坐标文件、缩放级别和 Windy 链接格式。
- `tests/icons-test.cjs`：全部控件/数据符号、Leaflet 适配、激活态和纯文字分段列头。
  另覆盖地图设置八齿齿轮、标题栏无底图网格、四类图源 B 方案图标和分类悬停提示。
- `tests/measure-test.cjs`：多段测距、吸附、快捷键、透明标签、右侧布局、工具箱内导出页和彩色天气图钉。
- `tests/tools-test.cjs`：摘要复制、2×2 快捷工具格、坐标拾取、点位海拔备注、附件清单、双导出入口和宿主协议。
- `tests/unit/copy-coordinates.test.mjs`：摘要字段降级、路网摘要和坐标目标计算。
- `tests/unit/attachments.test.mjs`：内置/Data URI/外链分类、URL 去重、外链 3 路并发、清单续传和纯内置
  导出跳过外链。
- `tools/Harness/SelfTests.cs`：宿主消息格式、失败布尔值、剪贴板占用重试、关闭取消、DNS/SSRF 范围、
  TUN 假地址例外、图片文件头、异步附件路径、共享原子文本/字节写入、清单续传和本地回退路径。
- `tests/profile-test.cjs`：坡度剖面、可选心率开关/双轴/缺口、悬停读数和窄窗布局。
- `tests/route-info-test.cjs`：距离标记、缺口/异常聚类和重复平移时的语言节点稳定性。
- `tests/export-test.cjs`：导出版式、透明 PNG、路线名称与日期、徒步指标顺序、路网语义、工具箱内设置页、
  实时预览与画布边界、尺寸/墨色/底衬提示、连续多次导出、窄窗布局和宿主保存流程。
- `tests/terrain-test.cjs`：四类图源过滤、无底图显示模式、面板透明度、天地图密钥与 403 降级。
  另覆盖无底图说明移除、天地图密钥单行布局、图标操作和键盘可访问名称。
- 图源切换同时验证顶部入口的类别文字、类别图标和具体来源 tooltip。
- `tests/custom-source-test.cjs`：Windy 512 px 图源添加、两步路占位符转换、HTTPS 校验、列表/编辑子页、
  单行四分类、非空分类的常规选择器、重新打开分流、管理入口、图标操作、二次删除确认、持久化、删除回退和
  主次按钮样式、跨面板文字拖动选择、320 px 面板宽度与右对齐，以及宿主配置注入和保存消息。
- `tests/floating-panels-test.cjs`：工具箱、图层和标记点列表的共享顶部/标题几何、三者互斥，以及工具箱
  开合不会把手动平移后的地图拉回旧焦点。
- `tests/runner-test.cjs`：专项筛选、套件列表、未知名称和未知参数处理。
- `tests/network-test.cjs`：生成式多路线路网、时间对象跳过、拖动中视口刷新、LOD Canvas、标注点虚拟化及性能预算。
- `tests/measure-test.cjs`：测距索引懒加载、航点吸附、轨迹吸附、地图手势、面板布局和共享导出页。

## 测试原则

- 不依赖系统语言：需要中文或英文标签时显式设置 Playwright locale。
- 不依赖固定等待：等待 DOM、动画、地图缩放值或明确的业务状态。
- 大文件测试使用生成夹具，真实轨迹不进入仓库。
- 修复功能时同时补充失败场景，不只修改现有断言迎合实现。
- UI 测试优先验证用户看到和操作到的结果，不直接依赖内部数组下标。
- 天地图测试只使用假密钥；不得生成包含真实 `tk` 的持久 trace。

## CI

`.github/workflows/build.yml` 在 push 和 PR 上执行静态检查、夹具复现、Release 构建、宿主测试、检测测试和
五组并行浏览器测试。GitHub Release 工作流仍执行完整 `npm test`，避免分片遗漏发布门禁。live smoke
独立运行，不阻塞主 CI。
