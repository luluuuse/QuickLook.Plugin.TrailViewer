# 使用说明 / Usage

本文承接 README，说明地图、标记点、剖面和导出功能。

## 中文

### 打开文件

在资源管理器中选中 `.gpx`、`.kml` 或 `.kmz`，按 <kbd>Space</kbd>。在线底图需要网络；选择“无底图”时
轨迹直接绘制在本地网格上。

### 地图与标记点

- <kbd>←</kbd> <kbd>→</kbd> 或 <kbd>A</kbd> <kbd>D</kbd> 按累计里程顺序切换标记点。
- 绿色起点、红色终点与重合的黄色图钉共享同一导航节点。
- 图钉靠近窗口边缘、信息卡、工具栏或剖面时，地图会平滑回中。
- `列表` 打开标记点速览；支持语义筛选、合并近点和人工纠正。
- 点击或键盘 `Enter` 可放大 GPS 异常和数据缺口标签。

### 海拔剖面

剖面按坡度着色，最高点和最低点直接标在曲线上。鼠标沿曲线移动可查看海拔、里程和时间；点击可固定光标。
剖面会参与地图安全区域计算，被选中的地图点不会被剖面遮住。

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

Select a `.gpx`, `.kml` or `.kmz` file in Explorer and press <kbd>Space</kbd>. Online basemaps require network
access; **No map** renders the route on a local grid.

### Map and waypoints

- <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> navigate by cumulative route distance.
- Green starts and red ends share one navigation node with coincident yellow pins.
- The map recentres when the selected pin approaches an edge, the summary, toolbars or the profile.
- **List** opens the waypoint overview with filters, nearby-point merging and local manual corrections.
- Click or press Enter on a GPS anomaly or data-gap label to zoom to it.

### Elevation profile

The profile is coloured by gradient and labels its highest and lowest points. Move over the chart for elevation,
distance and time; click to pin the scrubber. Its height participates in the map's safe-area calculation.

### Overlay export

<kbd>X</kbd> exports with the previous settings; <kbd>Shift</kbd>+<kbd>X</kbd> opens the settings panel. Square,
portrait and landscape PNGs are written beside the source track with transparent backgrounds and optional ink
and backing.

### Large files and privacy

Files above 20,000 recorded points keep the route and endpoints but omit a clickable marker for every sample.
Track data is not sent to a server; selecting an online basemap triggers requests to that tile provider.
