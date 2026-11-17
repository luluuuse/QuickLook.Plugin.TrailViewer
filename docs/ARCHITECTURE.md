# 架构

## 总览

QuickLook 宿主通过 C# 加载 WebView2，再把页面消息和文件路径连接起来。页面只依赖本地静态资源，在线内容
仅限于用户选择的底图瓦片。

```text
QuickLook
  → TrailViewerPanel / WebView2
  → viewer/index.html
  → GPX/KML/FIT parser
  → summary + per-kilometre splits + track layer + waypoint controller + measurement + profile
  → map focus / safe-area layout
```

## 前端模块

| 模块 | 职责 |
|---|---|
| `viewer/app.js` | 解析、模块装配和宿主消息 |
| `viewer/gpx.js`, `viewer/kml.js`, `viewer/fit.js` | 文件解析与统一模型；FIT 使用受限原生二进制读取器 |
| `viewer/route-model.js` | 共享只读轨迹几何、分段累计里程和起止偏移 |
| `viewer/track-analysis.js` | 运动时间、断点、GPS 异常、用时估算和里程切片 |
| `viewer/split-analysis.js`, `viewer/split-view.js` | 首次展开时计算的逐公里时间/速度模型、表格及详细版列契约 |
| `viewer/track-layer.js` | 轨迹线、方向/公里标记、异常与起终点 |
| `viewer/waypoint-controller.js` | 沿线导航、图钉、相册和速览联动 |
| `viewer/waypoint-insights.js` | 本地航点语义分类 |
| `viewer/profile-*.js` | 剖面数据、坡度着色、可选心率双轴、SVG 和地图光标 |
| `viewer/map-view.js`, `viewer/map-focus.js` | 安全区域、取景、选中点避让和三态布局 |
| `viewer/map-controls.js` | 底图类别、具体图源、图源菜单与署名 |
| `viewer/measure.js` | 多段手动测距、屏幕像素吸附、测距图层和实时距离 |
| `viewer/toolbox.js` | 距离测量、叠加图导出与轨迹天气的统一工具箱入口 |
| `viewer/weather.js` | 起点/终点/最高点的目标点计算、海拔可用性判断、Windy 外链生成和外链打开 |
| `viewer/icons.js` | 统一 UI 图标与地图数据符号注册表、Leaflet 原生控件图标适配 |
| `viewer/export*.js` | 离屏画布、版式和 PNG 分块传输 |

模块通过显式参数注入依赖，不共享可变全局状态。`window.trailViewer` 仅用于浏览器测试和宿主诊断。

轨迹天气不内嵌第三方地图，也不请求第三方接口：`weather.js` 根据所选点位计算坐标和缩放级别——起点/终点
取首末记录点，最高点取海拔最大的记录点，三者统一固定 14 级——拼出 Windy 分享链接，
再由宿主的 `NavigationStarting` 处理把 https 链接交给系统浏览器。Windy 的查询串只解析
`?[overlay,]lat,lon,zoom`，其余参数会被丢弃；**只有把同一个点同时写进路径（`/lat/lon?...`）才会展开
点位天气面板**，纯查询串形式只移动地图中心。因此链接固定使用路径形式，“定位准不准”再由缩放级别决定。

查询串首段是图层，默认写 `clouds`：云量最直接回答“晒还是雾”，也保留点位面板。图层名由 Windy 决定
（`clouds`、`wind`、`rain`、`temp` 等），写错会被静默忽略并退回风场，所以 `WINDY_OVERLAY` 是常量。

最高点只认可信的海拔：路网 KML 会主动跳过海拔，部分 2D 轨迹根本没有 `ele`，而全 0 的平坦导出虽然带着
高度字段却没有峰顶可言。因此 `highestPoint` 要求至少两个有效读数且全程高差 ≥ 1 米，否则该分段禁用，
不把任意采样点当作最高点。页面 CSP 保持 `default-src 'none'`，不新增
`frame-src` 或 `connect-src`。

工具箱、测距、导出和地图图层面板统一使用半透明工具表面，避免面板完全遮断底图上下文。测距的点新增、
分段、清空、撤回和重做使用内部快照历史；宿主只在测距激活时接管 `Ctrl+Z` / `Ctrl+Shift+Z`，
避免覆盖资源管理器的普通撤回。工具箱/测距与导出面板互斥显示；图源列表只渲染当前地图类型的来源。

## 宿主边界

`src/TrailViewerPanel.cs` 负责 WebView2、文件读取和快捷键路由；`OverlayTransfer.cs` 负责导出分块状态机；
`ViewerPreferences.cs` 负责跨版本偏好文件；`KmzArchive.cs` 负责受限解包：保留 KML 的内部相对目录，
并把 KML 引用的本地图片按同一目录结构写入临时文件夹，让虚拟文件主机可以直接响应照片 URL。
宿主保留原始输入路径用于导出定位，KMZ 解包路径只供页面预览；所有输入类型在创建 WebView 前统一检查
64 MB 上限。
`TiandituKeyStore.cs` 使用当前 Windows 用户的 DPAPI 保存天地图密钥。宿主在页面创建前注入当前预览的
运行时配置，页面直接请求天地图官方 WMTS；宿主不代理瓦片，也没有逐瓦片 WebMessage 往返。

前端到宿主的主要消息：

```text
ready    <summary>
error:<text>
settings <query-string>
measure-state <0|1>
export   <id> <count> <name>
exportchunk <id> <index> <count> <base64>
exportdone  <id> <count>
```

页面协议版本位于 `Directory.Build.props`，与产品版本独立。

直连模式需要页面在请求瓦片时持有 `tk`，因此密钥会存在于当前 WebView 的内存和官方瓦片请求 URL 中。
密钥在磁盘上由 DPAPI 加密；宿主不会把明文写入 viewer 地址、LocalStorage、日志或安装包。

## 产品身份与迁移

当前产品名是 `TrailViewer`。宿主数据、WebView profile、日志和 KMZ 临时目录都使用该名称；浏览器测试接口
是 `window.trailViewer`。`GpxViewer` 只保留在上游项目署名、历史归档和一次发布周期的兼容迁移逻辑中。

兼容迁移：

- `GpxViewer/viewer-settings.txt` → `TrailViewer/viewer-settings.txt`
- `GpxViewer_WebView2/` → `TrailViewer_WebView2/`
- LocalStorage `gpxviewer.*` → `trailviewer.*`
- `GPXVIEWER_USER_DATA` → `TRAILVIEWER_USER_DATA`

## 地图聚焦

`map-view.js` 测量信息卡、顶部工具、工具箱、速览、剖面、比例尺和版权行的实际矩形，得到可用地图区域。
`map-focus.js` 提供纯几何计算：舒适区、居中位移和最小避让。所有初始取景、图钉切换、弹窗和剖面光标共用
这套规则。

布局只在 `ResizeObserver`、窗口尺寸和面板状态变化时重新测量；地图平移和缩放不再触发整套 DOM 尺寸扫描。
`track-layer.js` 按缩放级别缓存距离采样，普通平移只从缓存更新视口内标记。
摘要中的距离、高程和时间范围共用一次逐点扫描；默认缺口诊断按解析后的轨迹数组缓存，供摘要和地图图层
复用。分段长度在绘制图层时计算一次，后续缩放不再重新扫描全部点求总里程。

`route-model.js` 在文件打开时为每段轨迹和路线建立累计里程，摘要、地图、剖面、导航、每公里分析和导出
共享同一份几何结果。航点使用 `spatial.js` 的视口范围查询；只有当前屏幕采样需要的图钉会加入 Leaflet
图层，因此大量航点不再一次性创建全部 DOM，但导航列表仍保留完整数据。

两步路等工具导出的路网 KML 可通过 `segment_count`、`duration_seconds` 和 `distance_meters` 识别。路网
不生成统一行程时间、运动速度、每公里表或合并剖面；KML 解析跳过轨迹点时间对象，地图使用共享 Canvas
渲染器，并关闭逐点圆点、公里数字与路网级异常标记。路网只为当前视口内的路线创建 Leaflet 折线，
并按当前缩放级别简化绘制点；原始轨迹模型仍保留完整数据供测距、照片和导出使用。路线名称提示继续由
Leaflet Canvas 命中。拖动过程中按动画帧增量更新当前视口，避免跨区拖动结束后集中创建大量折线。
标注点图钉同样只更新可见集合的差异。标注点、照片、测距和叠加图导出保持可用。

普通长轨迹的每公里分析按里程单调推进区间游标，时间边界使用二分定位；总复杂度由“公里数 × 区间数”
降为接近线性的单次区间遍历。路网模式不需要沿途排序，因此不创建重复的轨迹点导航索引。

测距的轨迹吸附 k-d tree 不在文件打开时创建，而是在首次吸附或开始测距时按需构建。航点吸附复用标记点
控制器已有的视口空间索引，同一批标注点不会为测距再建第二份索引。

心率只使用源文件中的逐点读数：FIT `record.heart_rate` 和常见 GPX TrackPointExtension。剖面控制器按缺失点
和轨迹分段拆成连续序列；开启开关后使用独立 bpm 纵轴绘制，不改变海拔数值与坡度颜色。全程平均值为所有
有效读数的算术平均值，用横虚线标出；每公里平均心率使用同一算术平均口径。

摘要和每公里分析共用 `MOVEMENT_RULES` 中的起步、停止和记录间隔阈值，并在每个记录段边界重置运动状态。
每公里统计在面板首次展开时才计算；收起状态只使用摘要中的总里程与时间可用性。

## 缓存与版本

- 产品版本来自 `Directory.Build.props`，遵循 Semantic Versioning。
- WebView2 虚拟主机名来自 `viewer/` 内容哈希和页面协议版本。
- C# 或文档变化不会无意义地刷新前端缓存；前端内容变化会自动获得新缓存身份。
- 偏好文件使用独立 schema 版本，避免被 WebView origin 生命周期绑定。
