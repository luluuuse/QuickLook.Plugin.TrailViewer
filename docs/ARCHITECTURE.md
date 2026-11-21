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
| `viewer/waypoint-description.js` | 航点描述中 App 自动生成的遥测模板清洗与缺失时间戳回填 |
| `viewer/route-model.js` | 共享只读轨迹几何、分段累计里程和起止偏移 |
| `viewer/track-analysis.js` | 运动时间、断点、GPS 异常、用时估算和里程切片 |
| `viewer/split-analysis.js`, `viewer/split-view.js` | 首次展开时计算的逐公里时间/速度模型、表格及详细版列契约 |
| `viewer/track-layer.js` | 轨迹线、方向/公里标记、异常与起终点 |
| `viewer/waypoint-controller.js` | 沿线导航、图钉、相册和速览联动 |
| `viewer/waypoint-insights.js` | 本地航点语义分类 |
| `viewer/profile-*.js` | 剖面数据、坡度着色、可选心率双轴、SVG 和地图光标 |
| `viewer/map-view.js`, `viewer/map-focus.js` | 安全区域、取景、选中点避让和三态布局 |
| `viewer/map-controls.js` | 底图类别、具体图源、图源菜单、地图设置页与署名 |
| `viewer/layer-registry.js` | 内置图源注册表、旧分类归一化和定制图源注册 |
| `viewer/layer-providers.js` | 普通、天地图和网格底图的 Leaflet 图层构造 |
| `viewer/layer-custom-form.js` | 定制图源表单、字段归一化与实时模板校验 |
| `viewer/layer-custom-manager.js` | 定制图源状态、列表、状态标记、保存和删除；新增表单只在定制页内展开 |
| `viewer/layer-menu-render.js` | 图层菜单按钮、提供商选择与中英文重绘 |
| `viewer/layer-key-controls.js` | 天地图密钥图层重建和网格模式切换 |
| `viewer/layer-selection.js` | 图源选择、持久化和地图图层切换 |
| `viewer/layer-settings-view.js` | 图层设置、定制图源和菜单 DOM |
| `viewer/custom-layers.js` | 用户定制图源的模板校验、本地存储和 Leaflet 图层构造 |
| `viewer/measure.js` | 多段手动测距、屏幕像素吸附（含已打测距点）、测距图层和实时距离 |
| `viewer/snap-indicator.js` | 标准化地图吸附准星（标记菱形/测距方块/轨迹十字）与轻量化吸附标签，供测距和坐标拾取共用 |
| `viewer/coordinates.js` | 起点、终点和顶点坐标目标计算；任意点由地图拾取并复用标记点吸附 |
| `viewer/attachments.js` | 内置图片本地直拷、Data URI 分块、HTTPS 外链三路并发调度 |
| `viewer/toolbox.js` | 地图分析、分享导出和环境信息的统一工具箱入口 |
| `viewer/toolbox-coordinates.js` | 坐标目标、任意点拾取、吸附和高亮提示 |
| `viewer/toolbox-attachments.js` | 附件导出入口、进度和结果状态 |
| `viewer/toolbox-main.js` | 编辑轨迹置顶通栏、2×2 快捷格、天气入口和工具箱主页面 |
| `viewer/toolbox-measure.js` | 测距总览、分段列表和操作按钮 |
| `viewer/editor-shell.js` | 四区无损轨迹编辑器的顶栏（含集成图层/标记点图标）、工具轨、抽屉与快捷键 |
| `viewer/editor-overlay.js` | 编辑态高精度轨迹、剖面裁剪预览、吸附落点与航点右键交互图层 |
| `viewer/track-ops.js` | 纯函数轨迹裁剪、拆分删段、漂移清洗、反转/往返/闭合与航点编辑 |
| `viewer/track-editor-store.js` | 无损编辑状态栈（多步撤销/重做、复原与里程差值快照） |
| `viewer/gpx-serializer.js` | UTF-8 GPX 1.1 序列化、手表友好去重与佳明航点重名检查 |
| `src/TrackSaveService.cs` | 宿主端 GPX 另存为弹窗、原子写入与覆盖原文件自动备份服务 |
| `viewer/host-bridge.js` | WebView2 消息、剪贴板和定制图源持久化桥接 |
| `viewer/test-api.js` | 浏览器测试与 Harness 诊断 API 装配 |
| `viewer/weather.js` | 起点、终点、顶点的目标点计算、海拔可用性判断、Windy 外链生成和外链打开 |
| `viewer/icons.js` | 统一 UI 图标与地图数据符号注册表、Leaflet 原生控件图标适配 |
| `viewer/export*.js` | 离屏画布、版式和 PNG 分块传输 |

`viewer/index.html` 并行加载 `viewer/css/` 下的 tokens、panels、toolbox、layers、map-data 与 photos
样式文件，不再经过串行 `@import` 瀑布。主要浮层间距、面板和模态层级通过 `--z-*` 变量统一约束。
浮层使用 `contain: layout style paint`；地图拖动期间临时关闭模糊。剖面色阶为低饱和松绿、暖琥珀、
焦糖橙和暗绯红，并对密集航点做像素抽稀。剖面填充固定为一条 SVG 路径和一个横向渐变；静态 SVG 独立
包含并提升为合成层，参考线、圆点和读数只更新 `translate3d`，鼠标移动不读取图表边界。

模块通过显式参数注入依赖，不共享可变全局状态。`window.trailViewer` 仅用于浏览器测试和宿主诊断。

轨迹天气不内嵌第三方地图，也不请求第三方接口：`weather.js` 根据所选点位计算坐标和缩放级别——起点/终点
取首末记录点，顶点取海拔最大的记录点，三者统一固定 14 级——拼出 Windy 分享链接，
再由宿主的 `NavigationStarting` 处理把 https 链接交给系统浏览器。Windy 的查询串只解析
`?[overlay,]lat,lon,zoom`，其余参数会被丢弃；**只有把同一个点同时写进路径（`/lat/lon?...`）才会展开
点位天气面板**，纯查询串形式只移动地图中心。因此链接固定使用路径形式，“定位准不准”再由缩放级别决定。

查询串首段是图层，默认写 `clouds`：云量最直接回答“晒还是雾”，也保留点位面板。图层名由 Windy 决定
（`clouds`、`wind`、`rain`、`temp` 等），写错会被静默忽略并退回风场，所以 `WINDY_OVERLAY` 是常量。

顶点只认可信的海拔：路网 KML 会主动跳过海拔，部分 2D 轨迹根本没有 `ele`，而全 0 的平坦导出虽然带着
高度字段却没有峰顶可言。因此 `highestPoint` 要求至少两个有效读数且全程高差 ≥ 1 米，否则该分段禁用，
不把任意采样点当作顶点。页面 CSP 保持 `default-src 'none'`，不新增
`frame-src` 或 `connect-src`。

定制图源由 `custom-layers.js` 负责：只接受 HTTPS 且必须含 `{z}`/`{x}`/`{y}` 的模板，读取时逐条
重新校验，任何损坏或过期的条目会被丢弃而不会让预览失败。插件**不内置任何第三方端点**，也不代理请求：
地址是否可用、是否被服务方允许（来源校验、白名单、配额）由用户自行确认，因此加载失败时只提示、不降级。
定制列表、添加和编辑采用独立子页，保存时替换当前活动图层；署名按纯文本转义。入口按图源数量分流：
空列表直接进入管理页，非空列表的分类点击和再次打开都回到常规图源选择器，标题旁的“管理图源”进入管理页。
列表行负责选择，图标按钮负责编辑与二次确认删除；瓦片加载成功/失败事件聚合成“加载中 / 已加载 / 部分可用
/ 不可用”状态。图源列表由宿主写入应用数据目录的 `custom-sources.json`，通过运行时配置注入页面；页面保存
后发送完整列表并由宿主原子写入。浏览器运行时继续使用 `localStorage`，首次升级会从旧存储迁移到宿主文件。
两步路 `{$x}`/`{$y}`/`{$z}` 在唯一校验入口中归一化，含 `@2x`/`%402x` 的地址同时选择 512 px。无底图是
低频显示模式，不占地图类别，由图层面板标题栏中、设置齿轮左侧的网格图标切换，`Q` / `E` 只循环四个
在线/定制类别。

工具箱、测距、叠加图导出和地图图层面板统一使用半透明工具表面，避免面板完全遮断底图上下文。测距的点新增、
分段、清空、撤回和重做使用内部快照历史；宿主只在测距激活时接管 `Ctrl+Z` / `Ctrl+Shift+Z`，
避免覆盖资源管理器的普通撤回。叠加图导出是工具箱内部页面，与测距、坐标和附件导出共享标题栏、返回键
和关闭逻辑。工具箱主菜单把四个高频工具排成 2×2 图标格，轨迹天气保留为下方完整功能条；标题栏的问号
进入共享返回栏的快捷键速查页，主菜单和标记点控制不再重复键位徽标。图源列表只渲染当前地图类型的来源。
工具箱、图层面板和标记点列表的顶部位置由地图布局统一写出的 `--floating-panel-top` 决定；任一窗口打开
时会先关闭另外两个，标记点列表因互斥被关闭时不恢复自己的按钮焦点。工具箱自身的开合不重放历史焦点，
因为用户可能已经手动平移；摘要展开和窗口缩放等布局变化仍会让当前点位保持在安全地图区域内。
顶部图层入口由 `updateMenuButton` 更新类别文字和类别图标，具体图源名称只进入 tooltip 和无障碍名称；
图源切换只走这一入口。界面语言由工具箱标题栏的单个语言按钮切换：地球图标（`UI_ICONS.globe`）说明这是
语言开关，旁边的 `中` / `EN` 说明当前用哪种，点击翻转；`title` 只写目标语言的本名（中文界面是
`English`，英文界面是 `中文`），`aria-label` 保留完整句子「界面语言：X，点击切换到 Y」。刷新语言时
工具箱通过 `relabel()` 就地重绘，不重建面板。标题栏不再有“快速启动”说明文字，空间留给标题和三个控件。

两种图钉卡片共用一套外壳（`.photo-popup` / `.place-popup`）：224 px 固定宽度、`--radius-md` 圆角、
Leaflet 自带关闭按钮隐藏后由卡片自己画在右上角、同一个入场动画，宽度与语言无关，切换语言不会让同一个
图钉弹出不同尺寸的卡片。照片卡片由 `waypoint-content.js` 的 `photoPreview` 构建，卡片本体是
`.photo-frame`（4:3，照片铺满），信息压在 `.photo-scrim` 渐隐层上，关闭按钮是 `.photo-card-close`。
没有照片的图钉由同一文件的 `renderPointPopup` 构建 `.place-card`：`.place-head` 里是名称和“时间 · 海拔”，
字级与照片卡片的 `.photo-card-title` / `.photo-card-meta` 完全一致（只在颜色上区分为面板文字色），
描述用 `.place-text` 在卡内滚动；`.place-card-close` 与照片卡片共用同一组样式。卡片**不再显示经纬度**：
图钉已经标出位置，六位小数的经纬度是 224 px 卡片里最宽也最少被读的一行。针对部分户外客户端把经纬度、海拔和
时间硬写入 `<description>` 的导出文件，解析阶段通过 `waypoint-description.js` 在存在有效坐标字段时剥离这些
遥测模板（保留用户真实备注），并优先从 KML `ExtendedData` `Time` 或被剥离的时间字段回填缺失的航点时间戳。
卡片的类名用
`photo-card-*` / `place-card-*` 前缀，与全览查看器的 `photo-title`/`photo-meta` 区分开——两者同名会让
`querySelector` 命中和样式互相串台。“下一张”在 popup 打开时才解析 `photoStops`（它由 `buildNavigation`
在此后填充），避免绑定 marker 时读到空数组。选中标记点与测距/坐标拾取共用 `viewer/snap-indicator.js`
的标准化双描边准星（标记点为菱形 `snap-marker`，起终点为十字 `snap-track`），锚定在图钉尖端真实坐标
（`iconAnchor: [12, 28]`）并与图钉本体的暖金 `drop-shadow` 配合，不再使用模糊蓝光晕或地图单位描边圈。

竖幅照片卡片（299 px）常高于短窗口的安全区（178–292 px），因此 `map-focus.js` 的 `focusOffset`
在内容高于安全区时改为顶部对齐而不是居中；布局刷新走 `focusSelection`，只做最小移动的
`revealPoint` 会让卡片跨在摘要卡上。`map-view.js` 的 `popupRect()` 跳过 `.photo-popup` 和
`.place-popup`，不给它们写内联 `max-height`：照片卡片会截断底部，普通卡片的描述已有自己的滚动区域，
再套一层会出现双层滚动条。

轨迹摘要复制只在 `summary-view.js` 生成缺失字段安全省略的纯文本，再由宿主写入 Windows 剪贴板。
信息卡的两行六项由 `statRow` 的 `primary`（字号层级）和 `accent`（左侧蓝色竖线）两个独立标记控制：
`primary` 表示这一项比同排更重，`accent` 表示这一项是卡片最先回答的数值。两者分开，行内重要性和
全局优先级才不会互相绑架。
点位坐标复用天气的顶点有效性规则，起点/终点取轨迹或路线首末记录点；地图拾取与普通地图点击共用
Leaflet 事件，但拾取态优先消费单击并保持工具箱打开。吸附结果保留源点海拔供地图提示和结果卡显示；
剪贴板协议仍只发送经纬度，没有可靠海拔时使用显式空状态。附件图片清单在打开文件时按 URL 去重，
相对图片只向宿主发送经过验证的相对路径并直接复制，Data URI 仍由页面分块发送；HTTPS 外链交给宿主
下载，页面最多同时调度 3 张，宿主也以 3 个下载槽限流，并缓存同一域名的公共地址检查。所有结果都经过
原子写入、重名后缀和大小/数量限制。
DNS 校验只缓存成功结果，瞬时失败会从缓存移除。下载完成后再按文件头识别 JPEG、PNG、GIF、WebP、BMP
或 AVIF，不把响应的 `Content-Type` 作为唯一可信依据。Clash/Mihomo TUN 常见的公开域名假地址
`198.18.0.0/15` 仅在域名解析阶段放行，URL 直接写该地址仍按 SSRF 风险拒绝。

附件目录中的隐藏清单 `.trailviewer-photo-export.json` 绑定原轨迹路径、长度和修改时间。每次图片成功
发布后，宿主原子更新已完成项和文件大小。重新打开同一源文件时，页面先查询清单，已完成且大小匹配的项目
不会重新复制、上传或下载；文件删除或大小改变时该项会重新调度。清单损坏或源文件变化时直接忽略旧清单。

## 宿主边界

`src/TrailViewerPanel.cs` 负责 WebView2、文件读取和快捷键路由；`OverlayTransfer.cs` 负责导出分块状态机；
`AttachmentExport.cs` 负责附件写入、外链下载和网络安全边界；
`ViewerPreferences.cs` 负责跨版本偏好文件；`CustomSourceStore.cs` 负责校验并原子保存定制图源；
`KmzArchive.cs` 负责受限解包：保留 KML 的内部相对目录，
并把 KML 引用的本地图片按同一目录结构写入临时文件夹，让虚拟文件主机可以直接响应照片 URL。
`ViewerBridge.cs` 统一 Dispatcher 封送和字符串 WebMessage，`TiandituKeyDialog.cs` 独立管理天地图密钥窗口。
`ViewerMessageRouter.cs` 统一分发 18 路页面消息，`TrailViewerPanel` 的 WebView 生命周期和消息处理位于
单独 partial 文件，主文件只保留加载、状态和清理编排。
宿主保留原始输入路径用于导出定位，KMZ 解包路径只供页面预览；所有输入类型在创建 WebView 前统一检查
64 MB 上限。
WebView2 共享环境在插件初始化时预热；每个面板仍拥有自己的文档、生命周期取消源和消息订阅。KMZ 解包、
附件复制、续传和落盘在后台执行，关闭只结束当前预览。
`TiandituKeyStore.cs` 使用当前 Windows 用户的 DPAPI 保存天地图密钥。宿主在页面创建前注入当前预览的
运行时配置，页面直接请求天地图官方 WMTS；宿主不代理瓦片，也没有逐瓦片 WebMessage 往返。
Windows 剪贴板被其他进程短暂占用时，宿主对 `CLIPBRD_E_CANT_OPEN` 做短间隔有界重试，再向页面报告结果。
重试异步等待，不占用 WPF 界面线程。页面保证同一时刻只有一个写入在途；坐标工具还会把 150 ms 内的
连续拾取合并为最后一次剪贴板写入，避免快速点选挤占宿主消息队列。

前端到宿主的主要消息：

```text
ready    <summary>
error:<text>
settings <query-string>
custom-sources <json-array>
measure-state <0|1>
text-input   <0|1>
export   <id> <count> <name>
exportchunk <id> <index> <count> <base64>
exportdone  <id> <count>
clipboard <id> <encoded-text>
attachmentlocal <batch> <index> <name> <relative-path>
attachmentresume <batch> <index-list>
attachmentbegin <batch> <index> <id> <count> <name>
attachmentchunk <id> <index> <count> <base64>
attachmentdone  <batch> <index> <id> <count>
attachmentlink  <batch> <index> <name> <encoded-url>
```

页面协议版本位于 `Directory.Build.props`，与产品版本独立。

宿主向页面返回剪贴板、附件、续传、叠加图结果、天地图密钥热更新和快捷键通知时统一使用 `PostWebMessageAsString`
的制表符消息，生产路径不再把参数值拼入 `ExecuteScriptAsync` 源码；布尔值由页面按显式 `'1'` 解析。

`text-input` 上报页面内文本字段的焦点状态。宿主的全局键盘钩子在操作系统层拦截 `W/Q/E/S/C/M/T`，
比 WebView 更早拿到按键，因此输入框里打字会被当成快捷键；钩子读到该状态为 1 时直接放行，
页面关闭预览时宿主也会复位，避免状态残留。

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
布局更新分两阶段执行：先读取一次矩形快照并写入 CSS/布局类，下一帧再读取最终几何、计算安全区域和取景，
避免同帧 Read → Write → Read。
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
标注点图钉同样只更新可见集合的差异。标注点、照片、测距和叠加图导出保持可用。路网导出只使用路线总长
和轨迹段数，不绘制并无统一语义的起终点，也不生成用时、速度或海拔统计。

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
- 共享 WebView2 环境降低连续预览的冷启动成本，页面与文件映射仍按每个预览重新建立。
- C# 或文档变化不会无意义地刷新前端缓存；前端内容变化会自动获得新缓存身份。
- 偏好文件使用独立 schema 版本，避免被 WebView origin 生命周期绑定。
