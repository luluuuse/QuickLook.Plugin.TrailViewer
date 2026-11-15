# 使用说明 / Usage

本文承接 README，说明地图、标记点、剖面和导出功能。

## 中文

### 打开文件

在资源管理器中选中 `.gpx`、`.kml`、`.kmz` 或 `.fit`，按 <kbd>Space</kbd>。在线底图需要网络；选择“无底图”时
轨迹直接绘制在本地网格上。

FIT 第一版读取活动和路线中的 GPS 记录、时间、海拔、会话用时及 `course_point` 路线点。圈数、心率、
步频、功率、温度、训练步骤和完整设备指标暂不展示。

### 地图与标记点

- 顶部“图层”入口显示当前底图类型；面板中分为 **路网**、**地形**、**卫星** 和 **无底图** 四类，
  下方再选择该类型的图源。<kbd>Q</kbd> / <kbd>E</kbd> 可直接循环切换类型。
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

### 海拔剖面

剖面按坡度着色，最高点和最低点直接标在曲线上。鼠标沿曲线移动可查看海拔、里程和时间；点击可固定光标。
剖面会参与地图安全区域计算，被选中的地图点不会被剖面遮住。

### 每公里分段

带时间戳的轨迹会在简介下方显示独立的“每公里”折叠项。文件打开时默认收起，不显示具体行；点击后才
展开分段表，再次点击可收起：

- **距离**：完整分段为 1.00 km，最后一段为剩余里程。
- **时间**：从该公里起点到终点的实际经过时间。
- **运动速度**：按运动时间计算；文件提供暂停总量时优先使用文件计时，否则根据移动速度排除停顿。
- 表底汇总总时间与运动时间，最快分段的速度使用强调色显示。
- 长路线在固定高度表格内滚动，表头和底部汇总保持可见。
- 使用 `Tab` 将焦点移到某一圈时会立即选中并定位；也可以直接点击某一圈。地图会缩放到对应轨迹范围，
  并用青色覆盖强调；再次点击同一圈或收起面板可清除强调。`Enter` / `Space` 不是本功能的快捷键。
- 标题栏默认显示“详细”切换键。点击后增加累计时间、累计上升/下降、平均心率、运动速度和垂直速度；
  文件没有有效心率数据时，平均心率列完全隐藏。

### 导出叠加图

<kbd>X</kbd> 按上次设置直接导出，<kbd>Shift</kbd>+<kbd>X</kbd> 打开设置：

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

The first FIT version reads GPS records, time, elevation, session totals and `course_point` markers from
activities and courses. Laps, heart rate, cadence, power, temperature, workout steps and the full device metric
set are not displayed yet.

### Map and waypoints

- Basemaps are grouped into **Road**, **Terrain**, **Satellite** and **No map**; <kbd>Q</kbd> / <kbd>E</kbd>
  switches category.
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

### Elevation profile

The profile is coloured by gradient and labels its highest and lowest points. Move over the chart for elevation,
distance and time; click to pin the scrubber. Its height participates in the map's safe-area calculation.

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

### Overlay export

<kbd>X</kbd> exports with the previous settings; <kbd>Shift</kbd>+<kbd>X</kbd> opens the settings panel. Square,
portrait and landscape PNGs are written beside the source track with transparent backgrounds and optional ink
and backing.

### Large files and privacy

Files above 20,000 recorded points keep the route and endpoints but omit a clickable marker for every sample.
Track data is not sent to a server; selecting an online basemap triggers requests to that tile provider.
