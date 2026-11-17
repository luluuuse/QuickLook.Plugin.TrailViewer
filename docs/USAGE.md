# 使用说明 / Usage

本文承接 README，说明地图、标记点、剖面、测距和导出功能。

## 中文

### 打开文件

在资源管理器中选中 `.gpx`、`.kml`、`.kmz` 或 `.fit`，按 <kbd>Space</kbd>。在线底图需要网络；选择“无底图”时
轨迹直接绘制在本地网格上。

FIT 读取活动和路线中的 GPS 记录、时间、海拔、心率、会话用时及 `course_point` 路线点。简要模式聚焦
路线基础数据；步频、功率、温度、训练步骤和完整设备指标暂不展示。

单个轨迹文件最大为 64 MB；GPX、KML、KMZ 和 FIT 超限时会在启动 WebView 前直接显示错误，避免内存耗尽。

### 地图与标记点

- 顶部“图层”入口显示当前底图类型；面板中分为 **路网**、**地形**、**卫星** 和 **无底图** 四类，
  下方只列出当前类型对应的图源。<kbd>Q</kbd> / <kbd>E</kbd> 可直接循环切换类型。
- 图层面板使用与工具箱一致的半透明背景和背景模糊，不完全遮断下方地图。
- 路网使用 OpenStreetMap HOT。地形菜单提供 CyclOSM、OpenHikingMap 和 OpenTopoMap；再次进入某一类别时
  会恢复该类别上次选择的图源。
- 路网和卫星菜单提供天地图。首次选择时按提示配置天地图开发者密钥；密钥由当前 Windows 用户凭据加密，
  后续打开无需再次输入。
- 天地图密钥管理位于图层面板右上角齿轮打开的 **地图设置** 页；已配置时提供 **更换密钥** 和
  **移除密钥**，主图层列表只显示地图类型和图源。
- <kbd>←</kbd> <kbd>→</kbd> 或 <kbd>A</kbd> <kbd>D</kbd> 按累计里程顺序切换标记点。
- 绿色起点、红色终点与重合的黄色图钉共享同一导航节点。
- 图钉靠近窗口边缘、信息卡、工具栏或剖面时，地图会平滑回中。
- 顶部地图工具保持统一高度；标记点与列表组成一个工具组。极窄窗口中的图层入口显示图标、当前类型短标签
  和下拉箭头，完整名称仍可通过悬停提示和无障碍标签读取。
- `列表` 打开标记点速览；支持语义筛选、合并近点和人工纠正。
- 点击或键盘 `Enter` 可放大 GPS 异常和数据缺口标签。
- 点击照片缩略图进入全览后，右上角显示当前显示尺寸相对原图像素的真实百分比，例如原图为
  2560 px 宽、窗口中显示 640 px 时显示 `25%`。滚轮按绝对比例缩放，最高 800%；点击百分比恢复
  适应窗口，放大后可拖拽平移，切换照片时会重新适应窗口。

### 海拔剖面

剖面按坡度着色，最高点和最低点直接标在曲线上。鼠标沿曲线移动可查看海拔、里程和时间；点击可固定光标。
剖面会参与地图安全区域计算，被选中的地图点不会被剖面遮住。轨迹含逐点心率时，标题右侧会出现 **心率**
开关，默认关闭；打开后增加红色心率曲线、独立 bpm 范围，悬停读数同时显示当前心率。缺失心率的位置会断开
曲线，不进行插值。横贯剖面的红色虚线表示全部有效心率读数的算术平均值。

### 距离测量

打开右上角 **工具箱**，选择 **距离测量**：

- <kbd>M</kbd> 可直接开始测距；测距中再次按 <kbd>M</kbd> 结束测距。
- 测距面板固定贴近窗口右侧；打开叠加图导出时会自动关闭工具箱/测距面板，避免两个面板重叠。
- 右键在地图上添加测距点；左键仍用于拖动地图，滚轮按当前位置缩放。
- <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤回最后一个操作，
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做。
- 靠近已有标记点或轨迹采样点时自动吸附，并显示目标类型；吸附使用屏幕上的 14 px 范围。
- **结束本段** 后，下一次右键从新一段开始。工具箱分别显示每段距离、点数与全部路线总距离。
- **撤销打点** 删除最后一个点，**清空** 删除全部测距线；**结束测距** 退出打点状态但保留当前结果。
- **在地图中心打点** 提供不依赖右键的键盘操作路径。
- 地图上的段距离标签使用半透明底色，避免遮住测距线、轨迹和底图道路。

测距结果仅保存在当前预览的内存中，不会写回轨迹文件，也不会随叠加图导出。

### 轨迹天气

工具箱中的 **轨迹天气** 会在系统默认浏览器中打开 [Windy](https://www.windy.com/)，并**直接展开该点的逐小时
天气预报面板**（温度、体感、降雨、风、阵风、风向），不需要再自己在 Windy 里找位置。按钮下方的分段选择
决定定位到哪个点：

- **起点 / 终点**：第一个或最后一个记录点，固定 14 级街道视角。
- **最高点**：全程海拔最大的记录点，同样 14 级。文件没有海拔数据，或全程高差不足 1 米（例如全 0 的
  平坦导出），该分段会禁用，不会拿一个任意点冒充峰顶。
- 三个点位都用与地图一致的语义图标：绿色起点、红色终点、琥珀色峰顶。
- 打开后默认显示**云层**，便于判断日照与雾况；需要风、降水或温度时在 Windy 内切换图层。
- 预览页不内嵌第三方地图，也不需要 Windy API 密钥；点击该入口前不会发起任何外部请求。
- 没有坐标的文件（例如无 GPS 的训练文件）会禁用该入口和分段选择，悬停提示会说明原因。
- 选定点的坐标会随链接发送给 Windy；如果不想让坐标离开本机，请不要使用该入口。

### 每公里分段

带时间戳的轨迹会在简介下方显示独立的“每公里”折叠项。文件打开时默认收起，不显示具体行；点击后才
展开分段表，再次点击可收起：

- **距离**：完整分段为 1.00 km，最后一段为剩余里程。
- **时间**：从该公里起点到终点的实际经过时间。
- **运动速度**：按运动时间计算；文件提供暂停总量时优先使用文件计时，否则根据移动速度排除停顿。
- 每公里统计在第一次展开时才计算，收起时不会遍历全部轨迹点。
- 测距吸附索引在第一次吸附或开始测距时才创建，普通地图浏览不会承担测距索引的初始化开销。
- 大路网只绘制当前视野附近的路线，并按缩放级别简化显示细节；标注点、照片和测距仍使用完整数据。
- 表底汇总总时间与运动时间，最快分段的速度使用强调色显示。
- 长路线在固定高度表格内滚动，表头和底部汇总保持可见。
- 使用 `Tab` 将焦点移到某一圈时会立即选中并定位；也可以直接点击某一圈。地图会缩放到对应轨迹范围，
  并用青色覆盖强调；再次点击同一圈或收起面板可清除强调。`Enter` / `Space` 不是本功能的快捷键。
- 标题栏默认显示“详细”切换键。点击后增加累计时间、累计上升/下降、平均心率、运动速度和垂直速度；
  文件没有有效心率数据时，平均心率列完全隐藏。平均心率为该公里内有效点读数的算术平均值，与全程
  平均心率口径一致。
- 展开时蓝色激活背景覆盖完整标题栏；各数据列头保持纯文字，不增加装饰图标。

### 路网轨迹

由大量独立路线合并出的两步路路网 KML 会自动进入路网模式。路网会显示全部路线和标注点，但不显示
全路网运动均速、休息时间、每公里表或合并海拔剖面，因为这些数据不属于同一次连续行程。地图使用
Canvas 绘制路线，并跳过普通轨迹点圆点、公里数字和路网级异常标记，以降低大文件的内存和交互开销。
标注点、照片、测距和叠加图导出仍可使用。

### 导出叠加图

也可从 **工具箱 → 叠加图导出** 打开设置。<kbd>X</kbd> 按上次设置直接导出，
<kbd>Shift</kbd>+<kbd>X</kbd> 打开设置：

- 设置面板右上角的关闭按钮可关闭面板；地图点击、<kbd>X</kbd> 和导出完成仍可关闭设置。
- 方版：1536×1536
- 竖版：1080×1920
- 横版：2048×1536

导出文件写在源轨迹同一目录，PNG 透明；可选黑/白墨色和底衬。

### 大文件与隐私

超过 20,000 个记录点时仍绘制线条和起终点，但省略逐点可点击圆点。轨迹数据不发送到服务器；在线瓦片请求
由所选底图触发。

## English

### Open a file

Select a `.gpx`, `.kml`, `.kmz` or `.fit` file in Explorer and press <kbd>Space</kbd>. Online basemaps require network
access; **No map** renders the route on a local grid.

The first FIT version reads GPS records, time, elevation, heart rate, session totals and `course_point` markers
from activities and courses. Laps, cadence, power, temperature, workout steps and the full device metric set are
not displayed yet.

Each track file is limited to 64 MB. Oversized GPX, KML, KMZ and FIT files show an error before WebView starts,
so malformed or padded files cannot exhaust memory.

### Map and waypoints

- Basemaps are grouped into **Road**, **Terrain**, **Satellite** and **No map**; <kbd>Q</kbd> / <kbd>E</kbd>
  switches category.
- The source list contains only providers for the active category, and the panel uses the shared translucent,
  blurred tool surface.
- Road uses OpenStreetMap HOT. The Terrain menu offers CyclOSM, OpenHikingMap and OpenTopoMap, and remembers
  the source last selected in that category.
- The Road and Satellite menus offer Tianditu. Enter a user-owned developer key when first prompted; it is
  encrypted for the current Windows user and does not need to be entered for later previews.
- With a key configured, the bottom of the Road or Satellite source menu offers **Change key** and **Remove key**.
- <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> navigate by cumulative route distance.
- Green starts and red ends share one navigation node with coincident yellow pins.
- The map recentres when the selected pin approaches an edge, the summary, toolbars or the profile.
- **List** opens the waypoint overview with filters, nearby-point merging and local manual corrections.
- Click or press Enter on a GPS anomaly or data-gap label to zoom to it.
- In the full-size photo viewer, the top-right percentage is the displayed width divided by the source width:
  a 2560 px photo shown at 640 px reads 25%, and 100% means 1:1 pixels. Use the wheel to zoom up to 800%,
  drag a zoomed photo to pan, click the percentage to fit the window again, or change photos to start over.
- The first-click attachment card reuses the waypoint list's unblurred translucent background. The full-size
  viewer also keeps its dark semi-transparent surround, with duplicate panels and controls hidden.

### Elevation profile

The profile is coloured by gradient and labels its highest and lowest points. Move over the chart for elevation,
distance and time; click to pin the scrubber. Its height participates in the map's safe-area calculation.
When the track contains per-point heart rate, a **Heart rate** button appears above the chart. It starts off;
turning it on adds a red line, its own bpm range and the current reading to the hover/touch readout. Missing
readings split the line rather than inventing values. A dashed horizontal line marks the arithmetic average of
all valid heart-rate readings.

### Distance measurement

Open **Toolbox** in the upper-right corner and choose **Measure distance**:

- <kbd>M</kbd> starts measuring directly; press it again while measuring to finish.
- The measurement panel stays against the right edge. Opening overlay export closes it so the two panels never
  overlap.
- Right-click adds a point. Left-drag still pans the map, and the wheel zooms at the pointer.
- <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the last change;
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redoes it.
- Nearby waypoints and recorded track samples snap to their exact coordinates within a 14 px screen radius;
  the target type is shown while hovering.
- **End section** finishes the current line, and the next right-click starts a separate section. The toolbox
  shows every section subtotal, its point count and the overall distance.
- **Undo point** removes the last point, **Clear** removes all measurements, and **Finish measuring** leaves
  the current result visible while turning off point collection.
- **Add at map centre** provides a keyboard-operable alternative to right-click.
- Section-distance labels use a translucent backing so the measured line, recorded track and basemap remain
  visible underneath.

Measurements stay in memory for the current preview. They are not written into the track file or included in
the overlay export.

### Route weather

**Route weather** in the toolbox opens [Windy](https://www.windy.com/) in the default browser **with that
point's hourly forecast panel already expanded** (temperature, feels-like, rain, wind, gusts, direction), so the
place does not have to be found again inside Windy. The segmented picker under the action decides which point
it lands on:

- **Start** and **End** jump straight to the first or last recorded point at level 14.
- **Summit** is the recorded point with the greatest elevation, also at level 14. The segment is disabled when
  the file has no elevation or less than a metre of relief across the whole route (a flat all-zero export),
  so an arbitrary sample is never presented as the summit.
- All three points use the map's own semantics: green start, red end, amber summit.
- Windy opens on the **cloud** layer, which is the quickest read on sun versus fog; wind, rain and temperature
  are one click away inside Windy.
- The preview embeds no third-party map and needs no Windy API key; no external request happens before the
  entry is used.
- Files without coordinates (a GPS-free workout, for example) disable both the entry and the picker, and the
  tooltip explains why.
- The chosen point travels with the link to Windy. Do not use the entry if the coordinates must stay local.

### Per-kilometre splits

Timed routes show an independent **Splits** entry below the route summary. It starts collapsed and renders no
rows until clicked. The expanded table contains distance, elapsed time and moving speed; the last row holds the
remaining partial kilometre. Total and moving time are summarized at the bottom, the fastest split is
emphasized, and long tables scroll while their headers and totals remain visible.

Tab onto a split to select and focus it immediately, or click it directly. The selected range is emphasized in
cyan; clicking it again or collapsing the panel clears the emphasis. Enter/Space are not shortcuts for this
action.

The header's **Details** control adds cumulative time, cumulative ascent/descent, average heart rate, moving
speed and vertical speed. When the file has no valid heart-rate data, that column is omitted entirely.
The active header surface spans the full panel width, and metric column headers remain text-only.

### Overlay export

The same panel is also available from **Toolbox → Export overlay**. <kbd>X</kbd> exports with the previous
settings; <kbd>Shift</kbd>+<kbd>X</kbd> opens the settings panel. Square, portrait and landscape PNGs are
written beside the source track with transparent backgrounds and optional ink and backing.
The close button in the panel header dismisses it; clicking the map, pressing <kbd>X</kbd>, or completing an
export also closes it.

### Large files and privacy

Files above 20,000 recorded points keep the route and endpoints but omit a clickable marker for every sample.
Track data is not sent to a server; selecting an online basemap triggers requests to that tile provider.
