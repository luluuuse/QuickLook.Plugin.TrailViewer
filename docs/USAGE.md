# 使用说明 / Usage

[中文](#中文) | [English](#english)

本文承接 [README](../README.md)，按功能场景说明底图、浏览分析、航点照片、轨迹编辑及工具箱的详细用法。

## 中文

### 1. 打开文件与兼容边界

- 在资源管理器中选中 `.gpx`、`.kml`、`.kmz` 或 `.fit` 文件，按 <kbd>Space</kbd> 即可预览。
- **格式范围**：支持 GPX 1.0/1.1、KML 2.2（含 `gx:Track`、`MultiGeometry`、`LinearRing` 多边形及 `gx:SimpleArrayData` 心率）、压缩 `.kmz` 及 FIT 活动/路线。
- **FIT 简要模式**：读取 GPS、时间、海拔、心率、会话用时与 `course_point` 路线点；步频、功率、温度、训练步骤等设备指标暂不展示。
- **体积与渲染上限**：GPX / KML / FIT 单文件上限 `64 MB`；`.kmz` 总上限 `1088 MB`（内含 `.kml` 文档上限 `64 MB`，照片上限 `1000 张 / 1 GB`）。超限时直接提示错误，长轨迹按视口抽样航点以保持拖动流畅。

### 2. 底图、叠加层与定制图源

#### 内置底图与透明叠加层

- **四大底图分类**：顶部图层入口按 **路网 / 地形 / 卫星 / 定制** 分组，按 <kbd>Q</kbd> / <kbd>E</kbd> 循环切换分类，切回某分类时自动恢复上次所选图源：
  - **路网**：OpenStreetMap、Esri 浅灰、Esri 深灰、天地图
  - **地形**：CyclOSM、OpenHikingMap、OpenTopoMap、Esri 世界地形图
  - **卫星**：Esri 世界影像、天地图
- **户外专题叠加层**：图层面板底部可自由开关 3 套透明叠加层（**徒步路网**、**骑行路网**、**滑雪雪道**），可叠加于任意底图并共用本地瓦片缓存。
- **无底图网格模式**：点击图层标题栏中的网格图标或按 <kbd>X</kbd> 一键开关，仅在本地网格上显示轨迹与测距，不请求在线瓦片；再次点击、再按 <kbd>X</kbd> 或切换底图分类即恢复原底图。
- **面板互斥**：工具箱、图层面板与航点列表互斥，打开其一会自动关闭另外两个。

#### 地图设置

点击图层面板右上角齿轮进入 **地图设置**：

- **天地图密钥**：首次选用天地图时按提示配置个人开发者密钥（使用当前 Windows 用户凭据加密保存），后续可在地图设置中更换或移除。
- **本地瓦片缓存**：默认开启，支持配置容量上限（`256 MB / 512 MB / 2 GB / 不限`）与保留时长（`7 天 / 30 天 / 90 天 / 永久`），可查看已用容量与瓦片数并二次确认清空；断网或刷新超时时优先回退展示已缓存旧瓦片。
- **图源节点与测速**：支持为 OpenStreetMap（官方主站 / HOT / 德国镜像）、OpenTopoMap（官方主站 / OpenMaps 镜像）和 Esri 系列（Server / Services）切换节点，并支持宿主直连网络的实时连通性探测（区分超时与不可达）。

#### 定制图源

- 最多保存 **20 个** HTTPS 定制图源，持久保存在本机应用数据目录（覆盖升级不丢失）。首次点击 **定制** 进入管理页，有图源后常规展示选择列表，点击标题旁 **管理图源** 进行增删改（删除需二次确认）。
- **11 套一键预设**：新增表单顶部内置 7 套免 Key 区域/全球预设（日本 GSI 地形、台湾鲁地图、美国 USGS 新版与经典镜像、瑞士 swisstopo 地形与航拍、Google 卫星）及 4 套专业户外预设（Tracestrack、Thunderforest、Stadia Stamen 512 px、MapTiler，填入个人 API Key 即可使用）。
- **配置字段**：
  - **瓦片地址**：仅接受 HTTPS，须包含 `{z}`、`{x}`、`{y}`（可选 `{s}`）；直接粘贴两步路 `{$x}`、`{$y}`、`{$z}` 会自动转换。
  - **瓦片大小**：`256` 或 `512`（地址含 `@2x` / `%402x` 自动选 512）。
  - **缩放级别与高级选项**：默认 `1–19`；使用 `{s}` 时填写子域（如 `abc`），TMS 坐标服务勾选“翻转 Y”，可填写纯文本署名。
- 加载状态显示为 **加载中 / 已加载 / 部分可用 / 不可用**；不可用时仅提示排查地址或服务限制，不会静默切回其他底图。

### 3. 轨迹浏览、剖面与分段

#### 轨迹摘要与热力着彩

- **摘要复制**：点击左上角轨迹摘要标题栏的复制图标，生成适用于聊天或攻略的纯文本摘要（含名称、里程、日期、用时、运动均速、爬升/下降、顶点海拔与点数，缺失字段自动省略）。
- **多维热力着彩**：点击工具箱左侧的轨迹图标或按 <kbd>L</kbd>，循环切换 **单色 / 海拔 / 配速 / 心率**（缺失对应字段时自动跳过）。
- **窄窗联动精简**：窗口宽度 `≤ 720 px` 或高度 `≤ 520 px` 时，轨迹摘要、每公里入口与缩放/定位控件自动收拢为紧凑左列栈。

#### 海拔剖面与 ClimbPro

- **坡度与游标**：曲线按坡度着色并标注最高/最低点，底部带 25% / 50% / 75% 里程刻度；悬停查看海拔、里程与时间，放大查看轨迹时需停留约 200 ms 或横向扫动才联动平移视野（避免划向任务栏误触跳动），点击可立即定位并固定游标。
- **区间刷选分析**：在剖面绘图区水平拖拽框选任意区间，实时统计里程、爬升/下降、平均坡度、用时、均速与平均心率，并同步高亮地图轨迹（点击关闭按钮或画布空白处清除）。
- **ClimbPro 主坡段**：自动识别主要爬坡段并在标题栏展示横滑列表，点击任一坡段同步聚焦地图与剖面。
- **心率叠加与一键折叠**：含逐点心率时可点击 **心率** 开关叠加独立纵轴曲线与全程平均心率虚线（缺失点断开不插值）；点击折叠按钮或按 <kbd>P</kbd> 可收起/展开剖面。

#### 每公里分段

- 带时间戳的轨迹在摘要下方提供独立的 **每公里** 折叠表（默认收起），点击展开查看各公里耗时、运动速度与表底总计；点击 **详细** 可展开累计时间、爬升/下降、平均心率与垂直速度。
- **排序与抗极值比例条**：点击任意列头循环切换降序 / 升序 / 默认顺序；数值单元格内嵌比例条，运动速度、垂直速度与单公里时间自动识别坐车/长休等异常极值（以满格斜纹与侧边竖条标识），保持正常徒步段对比清晰。
- **地图与剖面联动**：点击或 `Tab` 选中某一公里，地图与海拔剖面图同步青色高亮该区间；再次点击或收起表格清除高亮。

#### 路网轨迹

- 自动识别由多条独立路线合并而成的路网 KML，完整渲染路线与航点，跳过全局用时、均速、每公里分段和合并海拔剖面。航点、照片、测距与叠加图导出（仅显示总长与段数）仍可正常使用。

### 4. 航点与照片相册

- **沿线导航与定位**：按 <kbd>←</kbd> <kbd>→</kbd> 或 <kbd>A</kbd> <kbd>D</kbd> 按累计里程顺序切换航点（重合的起终点与航点共享节点），地图自动平滑避让并居中；点击 GPS 异常或数据缺口标签可直接放大查看。
- **航点速览列表**：点击顶部 **列表** 打开航点速览，支持 **带图片** 及危险/水源/营地/补给/下撤等本地筛选、合并近点与人工修正。
- **照片卡片与全览灯箱**：
  - 带照片的航点弹出竖幅 4:3 照片卡片，点击照片进入全览灯箱，右下角箭头直接跳至下一处带照片的航点。
  - 全览灯箱采用深色模糊背板隔离底图，多张照片时底部居中提供可点击缩略图导览条；右上角显示相对原图像素的真实缩放比例，支持滚轮最高 `800%` 缩放、拖拽平移、点击百分比复原、**在浏览器中打开原图**，并在看图时自动后台预载下一张。
- **普通航点卡片**：长描述在卡片内滚动；打开时自动过滤部分 App 写入描述中的重复经纬度/海拔/时间遥测模板（保留用户手写备注），并回填缺失时间到顶栏。

### 5. 无损轨迹编辑与多格式导出

点击工具箱顶部 **编辑轨迹** 进入离线无损编辑工作区：

- **顶部控制条**：显示文件名、修改标记、里程增减徽标、撤销/重做（<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>）、一键复原、图层与航点快捷开关及 **保存**（<kbd>Ctrl</kbd>+<kbd>S</kbd>）。
- **六大工具模块**：
  - **剪辑拼接**：剖面双柄区间裁剪、地图或剖面点击拆分删段、多段一键合并、导入本地或同目录 GPX / KML 拼接。
  - **清洗优化**：异常漂移点逐条勾选定位与清洗、轻度/标准/强力三档海拔平滑（实时预览爬升变化）、容差抽稀。
  - **路线方向**：反转方向、往返倍增、闭合环线、环线点击重设起点。
  - **绘制修点**：手绘补线（自动识别区段替换/闭合/续画/追加）、放大至 15 级以上顶点精修（拖拽/中点插点/右键删除）、框选擦除（实时统计待删点数与航点数）。
  - **时间轴**：整体时间平移、按坡度（Naismith 规则）或配速生成虚拟时间轴。
  - **航点管理**：点击轨迹吸附落点或 `Alt+点击` 自由落点，支持沿轨重排、20 米内去重及按里程间隔批量生成里程/最高点航点。
- **保存与多格式导出**：支持导出 **GPX / KML / KMZ / GeoJSON / TCX / CSV** 六种格式；导出 KML / KMZ 自动保留时间与心率，KMZ 可选下载并离线打包外链照片；GPX / KML / KMZ 支持同格式覆盖原文件并在首次覆盖前自动留存 `.bak` 备份（跨格式禁止覆盖以防损坏原文件）。

### 6. 工具箱实用工具

按工具箱内顺序排列：

#### 距离测量

- 按 <kbd>M</kbd> 开始或结束测距；左键在地图上打点（直点起点、终点或航点时同样直接落点而不弹出标记卡片），右键拖动地图、滚轮缩放，也可点击 **在地图中心打点**。
- 靠近航点、已有测距点或轨迹点（14 px 内）时自动吸附并显示对应准星，优先级为 `航点 > 测距点 > 轨迹点`。
- 支持 **结束本段** 开启新分段、**撤销打点** / <kbd>Ctrl</kbd>+<kbd>Z</kbd> 与 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做、**清空**；点击顶部 **返回** 自动结束打点并保留当前测距线在地图上。测距仅保存在内存中，不修改源文件。

#### 点位坐标

- 打开即进入连续地图拾取（左键拖动与滚轮缩放不变，底部常驻轻提示胶囊），面板固定提供 **起点 / 顶点 / 终点 / 轨迹中心** 一键复制。
- 所有结果按 6 位小数 `纬度, 经度`（WGS-84，不转换 GCJ-02）复制；拾取靠近航点或轨迹点均会自动吸附（同距离航点优先），并在地图标签与面板备注源点海拔（不写入剪贴板）。结果下方提供直达当前所选气象/山景平台的快捷按钮。

#### 叠加图导出

- 导出透明背景 PNG 到源轨迹同级目录，支持 **方版（1536×1536）**、**竖版（1080×1920）** 和 **横版（2048×1536）**，提供实时低分辨率预览。
- 可选黑/白/瑞士三套墨色、底衬、**仅轨迹**（隐藏文字与统计，文件名追加 `-bare`）与 **海拔轮廓**（底部绘制海拔剪影，文件名追加 `-ele`）；不同组合自动生成独立文件名，不互相覆盖。

#### 附件图片导出

- 统计当前文件中的内置图片、Data URI 与 HTTPS 外链，提供 **导出全部图片** 与 **导出内置图片**（不访问外网）两个入口，输出到源轨迹同级 `<文件名>-photos` 目录。
- 外链最多 3 路并发下载，仅接受公开 HTTPS 图片并校验图片文件头；目录内隐藏清单支持断点续传（源文件修改后自动失效）。单图上限 `30 MB`，整批上限 `1000 张 / 1 GB`，重名自动追加 `-2`、`-3`。

#### 气象与山景

- 支持在 **天气** 与 **山景** 两类视图间切换（各分类自动本地记住上次所选平台，点位坐标页底部快捷按钮同步生效），在系统默认浏览器中打开所选 **起点 / 顶点 / 终点**；无坐标或无有效高差（< 1 米）时自动禁用对应选项：
  - **天气**：**[Windy](https://www.windy.com/)**（14 级云层与逐小时点位预报）、**[Ventusky](https://www.ventusky.com/)**（直达点位实时与 14 天预报卡片）、**[Zoom Earth](https://zoom.earth/)**（9 级近实时卫星云图与逐小时卡片）。
  - **山景**：**[PeakFinder](https://www.peakfinder.com/)**（360° 真实山脊线认山与日出日落轨迹，有海拔时自动带入高度）、**[ShadeMap](https://shademap.app/)**（13 级真实地形山谷阴影与日照时长）。

### 7. 语言、快捷键、更新与隐私

- **界面主题**：点击工具箱底栏的三枚微缩色卡可在 **瑞士纸镜**（默认）、**冷岩墨** 与 **基础深色** 之间手动切换并持久保存，不会随底图切换自动变更。
- **界面语言**：点击工具箱标题栏的地球按钮（`中` / `EN`）就地切换中英文，不重载预览并自动记住选择（未手动选择时跟随系统语言）。
- **快捷键速查**：点击工具箱标题栏右侧 **?** 查看两列快捷键表（`W / S / A D / Q E / C / M / T / P / L / X`），文本框获焦时自动暂停全局快捷键。
- **内置检查更新**：工具箱底部显示当前版本与 **检查更新** 入口，后台每 24 小时最多静默竞速检测一次 **GitHub Releases + GitCode 国内镜像**（自动回退）。发现正式新版时，顶部显示柔和青蓝微光提示点、底部显示翠绿胶囊（`↑ vX.Y.Z`）；支持查看双语日志、忽略此版本，以及一键下载安装包（核对 **SHA256 哈希** 与插件清单完整性）并调起 QuickLook 原生安装。
- **隐私边界**：轨迹文件只在本地读取，从不上传服务器。在线底图仅向所选瓦片服务请求地图，气象与山景入口仅把选定点坐标（及 PeakFinder 可选海拔）随外链发送给当前所选平台（Windy / Ventusky / Zoom Earth / PeakFinder / ShadeMap），检查更新仅从 GitHub / GitCode 拉取版本信息与安装包。

---

## English

### 1. Opening files & limits

- Select a `.gpx`, `.kml`, `.kmz` or `.fit` file in Explorer and press <kbd>Space</kbd> to preview.
- **Supported formats:** GPX 1.0/1.1, KML 2.2 (including `gx:Track`, `MultiGeometry`, closed `LinearRing` polygons and `gx:SimpleArrayData` heart-rate arrays), zipped `.kmz` archives, and FIT activities/courses.
- **FIT brief mode:** reads GPS records, timestamps, elevation, heart rate, session totals and `course_point` markers; laps, cadence, power, temperature and workout steps are not shown.
- **Size & rendering limits:** single GPX, KML and FIT files are limited to `64 MB`; `.kmz` archives allow up to `1088 MB` total (`64 MB` inner `.kml`, `1000 images / 1 GB` embedded media). Oversized files report an error before WebView starts, and long tracks sample waypoints by viewport to stay responsive.

### 2. Basemaps, overlays & custom sources

#### Built-in basemaps & outdoor overlays

- **Four basemap categories:** the top layer menu groups sources into **Road**, **Terrain**, **Satellite** and **Custom** (<kbd>Q</kbd> / <kbd>E</kbd> cycles categories and restores each category's last selected provider):
  - **Road:** OpenStreetMap, Esri Light Gray, Esri Dark Gray, Tianditu
  - **Terrain:** CyclOSM, OpenHikingMap, OpenTopoMap, Esri World Topo
  - **Satellite:** Esri World Imagery, Tianditu
- **Transparent outdoor overlays:** toggle 3 overlays at the bottom of the layer panel (**Waymarked Hiking**, **Waymarked Cycling**, **OpenSnowMap Pistes**) over any basemap, backed by the local tile cache.
- **No-map Grid mode:** click the grid icon in the layer header or press <kbd>X</kbd> to toggle local coordinate-grid mode without fetching online tiles; click again, press <kbd>X</kbd>, or switch categories to restore the previous basemap.
- **Mutual exclusion:** the Toolbox, Layer panel and Waypoint list are mutually exclusive—opening one closes the others.

#### Map settings

Click the gear icon in the layer panel header to open **Map settings**:

- **Tianditu key:** prompted on first selection and stored encrypted for the current Windows user; can be changed or removed later in Map settings.
- **Local tile cache:** enabled by default with configurable size caps (`256 MB / 512 MB / 2 GB / Unlimited`) and retention (`7 d / 30 d / 90 d / Forever`), live usage stats, two-step clear, and automatic stale-tile fallback when offline or timed out.
- **Node switcher & probing:** switch nodes for OpenStreetMap (Official CDN / HOT / DE), OpenTopoMap (Official / OpenMaps mirror) and Esri (Server / Services), and run direct host connectivity probes distinguishing timeouts from unreachable hosts.

#### Custom sources

- Stores up to **20** HTTPS custom raster sources in local application data (preserved across upgrades). Click **Manage sources** to add, edit or delete entries (deletion requires a second confirmation).
- **11 one-click presets:** the Add form includes 7 free regional/global presets (Japan GSI, Taiwan RudyMap, US USGS New & Classic mirror, Swiss swisstopo Topo & Imagery, Google Satellite) and 4 pro outdoor presets (Tracestrack, Thunderforest, Stadia Stamen 512 px, MapTiler—supply your own API key).
- **Fields:** HTTPS URL with `{z}`, `{x}`, `{y}` (optional `{s}`; 2bulu `{$x}`/`{$y}`/`{$z}` placeholders convert automatically), tile size `256` or `512` (`@2x`/`%402x` auto-selects 512), zoom range (`1–19` default), plus optional subdomains, attribution and Flip Y for TMS sources.
- Status reads **Loading / Ready / Partially available / Unavailable**; failures warn without silently falling back to another basemap.

### 3. Track browsing, profile & splits

#### Track summary & coloring

- **Summary copy:** click the copy icon in the route summary header to copy a plain-text summary (name, distance, date, duration, moving speed, ascent/descent, peak elevation and point count; missing fields are omitted).
- **Multi-dimensional track coloring:** click the trail icon beside the Toolbox or press <kbd>L</kbd> to cycle **Single / Elevation / Speed / Heart rate** (unavailable modes are skipped automatically).
- **Responsive compact stack:** at `≤ 720 px` width or `≤ 520 px` height, the summary pill, per-km entry and zoom/locate controls collapse into a unified compact left column.

#### Elevation profile & ClimbPro

- **Gradient & scrub:** gradient-colored terrain with high/low labels and 25% / 50% / 75% distance ticks; hover for live readout (with a ~200 ms dwell / horizontal-scrub gate before panning a zoomed-in map, preventing accidental jumps when moving toward the taskbar) or click to pin and pan immediately.
- **Range brush analysis:** drag horizontally across the chart to inspect distance, ascent/descent, average grade, duration, average speed and average heart rate while highlighting the matching map segment (clear via the close button or clicking outside the chart).
- **ClimbPro major climbs:** automatically detects major climbs in a scrollable header strip; click any climb chip to focus both map and profile.
- **Heart-rate overlay & collapse:** toggle **Heart rate** when per-point data is available to plot a dual-axis curve with a whole-route average line (gaps stay broken, never interpolated); click the collapse toggle or press <kbd>P</kbd> to fold/expand the profile.

#### Per-kilometre splits

- Timed routes show a collapsible **Splits** table below the summary with distance, elapsed time, moving speed and bottom totals; toggle **Details** for cumulative time, ascent/descent, average heart rate and vertical speed.
- **Sorting & outlier-resistant bars:** click any column header to cycle descending, ascending and default order; inline proportion bars use IQR-based outlier capping (diagonal hatch and edge bar) so isolated car-ride or long-rest spikes do not crush normal hiking splits.
- **Map & profile sync:** click or `Tab` onto a split row to spotlight that kilometre in cyan on both map and elevation profile; click again or collapse to clear.

#### Route networks

- Merged multi-route networks are detected automatically and render all routes and waypoints while skipping whole-network duration, speed, per-km splits and combined profiles. Waypoints, photos, measurement and overlay export (showing total length and segment count) remain available.

### 4. Waypoints & photo albums

- **Route-ordered navigation:** press <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> to step along cumulative route distance with smooth safe-area recentering; click GPS anomaly or data-gap badges to zoom in.
- **Waypoint overview:** click **List** to open the overview with **With photos** and local semantic filters (danger/water/camp/supply/exit), nearby-point merging and manual corrections.
- **Photo cards & lightbox:**
  - Photo waypoints open a portrait 4:3 photo card; click the photo for the full-size lightbox or use the bottom-right arrow to jump directly to the next photo waypoint.
  - The lightbox uses a deepened blurred backdrop and shows a clickable bottom thumbnail strip for multi-photo waypoints, with true source-pixel percentage, wheel zoom up to `800%`, drag-to-pan, click-percentage reset, **Open in browser**, and background next-photo preloading.
- **Plain waypoint cards:** long descriptions scroll inside the card; exporter-injected coordinate, elevation or timestamp boilerplate is stripped automatically while preserving user notes and recovering missing timestamps.

### 5. Non-destructive track editor & multi-format export

Click **Edit track** at the top of the Toolbox to open the offline editor:

- **Top bar:** displays track name, modified indicator, distance delta pill, Undo/Redo (<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>), Reset, Layers/Pins toggles and **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>).
- **Six tool modules:**
  - **Clip & Merge:** dual-handle profile crop, click-to-split on map or profile with segment deletion, segment merge, and local/sibling GPX & KML append.
  - **Clean & Optimize:** checkable GPS drift list with map focus, three-level elevation smoothing (live ascent preview), and simplification.
  - **Route Direction:** reverse, out-and-back, close loop, and click-to-rotate loop start.
  - **Draw & Refine:** hand-drawn path splicing (replace span, close loop, extend or append), zoom `>= 15` vertex editing (drag, midpoint insert, right-click delete), and live-count box erase.
  - **Timeline:** timestamp shifting and grade-adjusted (Naismith) or pace-based virtual timeline generation.
  - **Waypoints:** snap onto the track or `Alt+Click` to place freely, sort along track, dedupe within 20 m, and batch-generate distance milestone or summit waypoints.
- **Save & multi-format export:** export to **GPX, KML, KMZ, GeoJSON, TCX or CSV**; KML/KMZ exports preserve timestamps and heart rate, and KMZ optionally downloads and packs remote HTTPS photos offline. GPX, KML and KMZ support same-format overwrite with an automatic `.bak` backup on first overwrite (cross-format overwrites are blocked).

### 6. Toolbox utilities

Listed in Toolbox menu order:

#### Measure distance

- Press <kbd>M</kbd> to start or finish measuring; left-click adds points (including directly on start/end or waypoint markers without opening popups) while right-drag pans and the wheel zooms (or use **Add at map centre**).
- Snaps automatically within 14 px with priority `waypoint > measured point > track point`.
- Supports **End section**, **Undo point** / <kbd>Ctrl</kbd>+<kbd>Z</kbd> & <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo, and **Clear**. Clicking **Back** stops active point collection while keeping measured lines on the map. Measurements remain in memory only.

#### Point coordinates

- Enters continuous map picking immediately (pan and zoom stay active, with a bottom key-hint capsule matching the editor style), with one-click copy buttons for **Start**, **Peak**, **End** and **Track centre**.
- Copies six-decimal `latitude, longitude` (WGS-84, never silently converted to GCJ-02), snaps to nearby waypoints and track points (waypoints win ties), and displays elevation notes (display-only, excluded from clipboard) plus a shortcut to open the picked point in the active Weather & sun service.

#### Export overlay

- Writes transparent PNG overlays beside the source track in **Square (1536×1536)**, **Portrait (1080×1920)** and **Landscape (2048×1536)** with a live low-resolution preview.
- Offers black/white/Swiss ink, backing choices, **Track only** (`-bare` suffix, hides text and stats) and **Elevation silhouette** (`-ele` suffix, bottom curve); distinct style combinations write separate file names without overwriting one another.

#### Export attachment photos

- Counts embedded files, Data URIs and HTTPS links, offering **Export all photos** and **Export embedded photos** (no network requests) into `<file name>-photos` beside the source track.
- Downloads up to 3 HTTPS images concurrently with public-host and image-signature checks; a hidden manifest enables resumable export (invalidated if the source track changes). Limited to `30 MB` per image and `1000 images / 1 GB` per batch; duplicate names receive `-2`, `-3`.

#### Weather & sun

- Switch between **Weather** and **Sun** categories (each category remembers its last chosen service locally and shares it with the shortcut in Point coordinates) to open **Start**, **Peak**, or **End** in your default browser; disabled when coordinates or reliable elevation relief (`>= 1 m`) are unavailable:
  - **Weather:** **[Windy](https://www.windy.com/)** (cloud layer at zoom 14 with hourly point forecast), **[Ventusky](https://www.ventusky.com/)** (point route with current & 14-day forecast card), and **[Zoom Earth](https://zoom.earth/)** (near-real-time satellite at zoom 9 with hourly card).
  - **Sun:** **[PeakFinder](https://www.peakfinder.com/)** (360° mountain horizon & sun/moon path, including elevation when available) and **[ShadeMap](https://shademap.app/)** (real terrain shadow and sunlight map at zoom 13).

### 7. Language, shortcuts, updates & privacy

- **Interface themes:** click the three miniature theme cards in the Toolbox footer to switch between **Swiss Paper** (default), **Slate Dark**, and **Classic Dark**; stored persistently and never auto-switched by basemaps.
- **Interface language:** click the globe button (`中` / `EN`) in the Toolbox header to switch in place without reloading; saved automatically (defaults to system language).
- **Keyboard reference:** click **?** in the Toolbox header to open the two-column shortcut table (`W / S / A D / Q E / C / M / T / P / L / X`); global shortcuts pause automatically while typing in text inputs.
- **Built-in update checker:** the Toolbox footer displays the installed version and **Check updates**, quietly racing **GitHub Releases + GitCode mirror** at most once every 24 hours with automatic failover. New stable releases show a subtle cyan glow dot on the Toolbox toggle and an emerald footer pill (`↑ vX.Y.Z`), with bilingual release notes, version muting, **SHA256 checksum & manifest verification**, and native QuickLook installer handoff.
- **Privacy:** track files are read locally and never uploaded. Online basemaps contact only their tile providers, Weather & sun sends only the chosen point coordinate (and optional elevation for PeakFinder) to the selected site (Windy, Ventusky, Zoom Earth, PeakFinder, or ShadeMap), and update checks contact GitHub / GitCode solely for release metadata and verified packages.
