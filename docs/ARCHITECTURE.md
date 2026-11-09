# 架构

## 总览

QuickLook 宿主通过 C# 加载 WebView2，再把页面消息和文件路径连接起来。页面只依赖本地静态资源，在线内容
仅限于用户选择的底图瓦片。

```text
QuickLook
  → TrailViewerPanel / WebView2
  → viewer/index.html
  → GPX/KML parser
  → summary + track layer + waypoint controller + profile
  → map focus / safe-area layout
```

## 前端模块

| 模块 | 职责 |
|---|---|
| `viewer/app.js` | 解析、模块装配和宿主消息 |
| `viewer/gpx.js`, `viewer/kml.js` | 文件解析与统一模型 |
| `viewer/track-analysis.js` | 运动时间、断点、GPS 异常和用时估算 |
| `viewer/track-layer.js` | 轨迹线、方向/公里标记、异常与起终点 |
| `viewer/waypoint-controller.js` | 沿线导航、图钉、相册和速览联动 |
| `viewer/waypoint-insights.js` | 本地航点语义分类 |
| `viewer/profile-*.js` | 剖面数据、SVG 和地图光标 |
| `viewer/map-view.js`, `viewer/map-focus.js` | 安全区域、取景、选中点避让和三态布局 |
| `viewer/export*.js` | 离屏画布、版式和 PNG 分块传输 |

模块通过显式参数注入依赖，不共享可变全局状态。`window.trailViewer` 仅用于浏览器测试和宿主诊断。

## 宿主边界

`src/TrailViewerPanel.cs` 负责 WebView2、文件读取和快捷键路由；`OverlayTransfer.cs` 负责导出分块状态机；
`ViewerPreferences.cs` 负责跨版本偏好文件；`KmzArchive.cs` 负责受限解包。

前端到宿主的主要消息：

```text
ready    <summary>
error:<text>
settings <query-string>
export   <id> <count> <name>
exportchunk <id> <index> <count> <base64>
exportdone  <id> <count>
```

页面协议版本位于 `Directory.Build.props`，与产品版本独立。

## 产品身份与迁移

当前产品名是 `TrailViewer`。宿主数据、WebView profile、日志和 KMZ 临时目录都使用该名称；浏览器测试接口
是 `window.trailViewer`。`GpxViewer` 只保留在上游项目署名、历史归档和一次发布周期的兼容迁移逻辑中。

兼容迁移：

- `GpxViewer/viewer-settings.txt` → `TrailViewer/viewer-settings.txt`
- `GpxViewer_WebView2/` → `TrailViewer_WebView2/`
- LocalStorage `gpxviewer.*` → `trailviewer.*`
- `GPXVIEWER_USER_DATA` → `TRAILVIEWER_USER_DATA`

## 地图聚焦

`map-view.js` 测量信息卡、顶部工具、速览、剖面、比例尺和版权行的实际矩形，得到可用地图区域。
`map-focus.js` 提供纯几何计算：舒适区、居中位移和最小避让。所有初始取景、图钉切换、弹窗和剖面光标共用
这套规则。

## 缓存与版本

- 产品版本来自 `Directory.Build.props`，遵循 Semantic Versioning。
- WebView2 虚拟主机名来自 `viewer/` 内容哈希和页面协议版本。
- C# 或文档变化不会无意义地刷新前端缓存；前端内容变化会自动获得新缓存身份。
- 偏好文件使用独立 schema 版本，避免被 WebView origin 生命周期绑定。
