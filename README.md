# QuickLook.Plugin.TrailViewer

简体中文 | [English](README.en.md)

在 Windows 上直接用 QuickLook 预览 GPX、KML、KMZ 和 FIT 轨迹。在资源管理器中选中轨迹文件并按
<kbd>Space</kbd>，无需打开地图软件即可查看路线、标记点、照片和海拔剖面。

![当前轨迹摘要、分段入口、地图工具和海拔剖面](docs/screenshot-map.png)

## 快速开始

1. 从 [GitHub Releases](https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases/latest) 下载最新
   `.qlplugin`。
2. 打开安装包完成安装，并从托盘完全退出后重新启动 QuickLook。
3. 在资源管理器中选中 `.gpx`、`.kml`、`.kmz` 或 `.fit` 文件，按 <kbd>Space</kbd>。

常用操作：

| 操作 | 控制 |
|---|---|
| 切换标记点 | <kbd>←</kbd> <kbd>→</kbd> 或 <kbd>A</kbd> <kbd>D</kbd> |
| 回到完整轨迹 | <kbd>C</kbd> |
| 显示/隐藏地图标记 | <kbd>W</kbd> |
| 切换底图 | <kbd>Q</kbd> / <kbd>E</kbd> |
| 隐藏界面 | <kbd>S</kbd> |
| 开始/结束测距 | <kbd>M</kbd> |
| 测距撤回 / 重做 | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> |
| 打开/关闭工具箱 | <kbd>T</kbd> |
| 切换轨迹热力着彩 | <kbd>L</kbd> |
| 收起/展开海拔剖面 | <kbd>P</kbd> |
| 无损轨迹编辑 | 工具箱 → 编辑轨迹 |
| 编辑模式保存 GPX | <kbd>Ctrl</kbd>+<kbd>S</kbd> |
| 查看轨迹天气 | 工具箱 → 轨迹天气 |
| 导出叠加图 | 工具箱 → 叠加图导出 |

## 功能概览

- **无损轨迹编辑**：工具箱顶部一键进入四区轨迹编辑器，支持 **剖面剪**（剖面双柄区间裁剪）、**点击拆**（点击拆分与删段）、**漂移点清洗**、**拓扑操作**（反转方向、往返倍增、闭合环线）及 **航点增删改**（支持序号列表与 `Alt+点击` 自由落点）；全程支持多步撤销/重做（`Ctrl+Z` / `Ctrl+Shift+Z`）、`Ctrl+S` 另存或覆盖备份，并在窄窗下自动合并图层与标记点图标及压缩缩放控件。
- **轨迹显示与着彩**：GPX 轨迹、KML LineString、`gx:Track` 和 FIT 活动/路线按段着色，方向箭头和公里标签随缩放自适应；按 <kbd>L</kbd> 或点击工具箱左侧图标可循环切换 **单色 / 海拔 / 配速 / 心率** 热力着彩。
- **路线分析**：运动时间、数据缺口、GPS 异常跳点和基于 Naismith、Langmuir 下坡及陡上坡修正的用时估算。
- **每公里分段与窄窗精简**：简介下方提供独立的折叠项，支持点击表头循环排序、单元格内嵌比例条及与海拔剖面图的联动聚焦；窗口宽度 `≤ 720 px` 或高度 `≤ 520 px` 时，信息摘要、每公里微胶囊与缩放控件自动同步进入精简左列栈。
- **路网轨迹**：自动识别由多条独立路线合并成的路网，不把全网误算为一次行程；跳过全局速度、每公里表
  和合并剖面以降低加载时间与内存占用。
- **标记点与照片**：按路线顺序切换图钉，支持竖幅整卡照片预览与全览相册（真实原图像素比例、最高
  800% 滚轮缩放与拖拽平移）、可滚动描述的普通标记点卡片、速览列表，以及危险/水源/营地/下撤等
  本地语义提示。
- **海拔剖面与 ClimbPro**：坡度着色、航点位置、四等份里程刻度、区间拖拽刷选统计（`Esc` 清除）、ClimbPro 主坡段自动识别与 <kbd>P</kbd> 键一键折叠；轨迹含逐点心率时可按需叠加到独立纵轴，并用横虚线标出全程平均心率。
- **手动测距**：支持多段手动打点测距，右键添加点、左键拖动地图、滚轮缩放，靠近标记点、已有手动测距点
  或轨迹点时自动吸附；地图实时显示每段距离和总距离。
- **复制与附件导出**：一键复制分享版轨迹摘要，复制起点、终点、顶点、地图中心或任意拾取点的 WGS-84
  坐标（靠近标记点自动吸附并备注海拔）；支持将内置图片、Data URI 和 HTTPS 外链图片导出到轨迹旁，
  可选仅导出内置图片或三路并发导出全部并支持断点续传。
- **多图源底图**：内置 OpenStreetMap HOT（路网）与 CyclOSM / OpenHikingMap / OpenTopoMap（地形），
  配置个人密钥后可使用天地图路网与卫星图，并支持本地网格（无底图）模式与持久化 HTTPS 定制图源（支持
  两步路占位符与 512 px 地址）。
- **叠加图导出**：支持导出方版、竖版和横版透明 PNG 轨迹叠加图，提供实时预览、墨色与底衬选择，自动
  写入路线名称、日期与统计指标（路网文件仅显示路线总长与段数）。
- **轨迹天气**：在浏览器中打开 Windy（默认云层）并直接展开所选起点、终点或顶点的逐小时天气预报，
  预览页不内嵌第三方地图。
- **双语界面**：支持中英文就地切换，自动保存底图、标记点与导出等常用偏好。

完整操作、快捷键和导出说明见 [docs/USAGE.md](docs/USAGE.md)。

## 兼容范围

支持：

- GPX 1.0 / 1.1
- KML 2.2（含 `gx:Track` 和 `MultiGeometry`）
- 压缩的 `.kmz`
- 带 GPS 记录、压缩时间戳、海拔和路线点的 FIT 活动/路线

FIT 简要模式聚焦路线基础数据；记录的心率可按需叠加到剖面。步频、功率、温度、训练步骤和完整设备指标
暂不展示。

长轨迹会完整绘制路线线条、起终点及按视口抽样的航点，不再为每个原始采样点单独生成圆点标记，以保持拖动与缩放流畅。非法 XML 会显示包含解析器原始错误信息的页面。单个输入文件最大为 64 MB。

## 隐私

插件不会把轨迹数据发送到服务器。打开文件时只在本地读取。选择在线或定制底图时会向对应瓦片服务
请求地图；**无底图模式** 由本地网格绘制。使用轨迹天气会把所选点坐标随链接发送给 Windy。偏好保存在
本机应用数据中，与带版本号的 WebView 缓存无绑定关系。

## 疑难处理

- 如果预览仍显示 XML 文本，请确认插件已安装并启用。
- 升级后界面没有变化时，请从托盘完全退出并重新启动 QuickLook。
- 在线瓦片空白时检查网络，或点击图层标题栏中的网格图标开启 **无底图模式**。
- <kbd>Esc</kbd> 归 QuickLook 管理；需要时使用预览关闭按钮。

更多诊断信息见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 和 [docs/TESTING.md](docs/TESTING.md)。

## 开发

先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。主要文档：

- [架构](docs/ARCHITECTURE.md)
- [图标规范](docs/ICON_SYSTEM.md)
- [开发环境](docs/DEVELOPMENT.md)
- [测试](docs/TESTING.md)
- [发布](docs/RELEASING.md)
- [更新日志](CHANGELOG.md)

常用本地检查：

```text
npm ci
npm run check
dotnet build src/QuickLook.Plugin.TrailViewer.csproj -c Release
npm test
```

产品版本遵循 Semantic Versioning；WebView 缓存身份由前端内容生成，与发布版本号解耦。

## 致谢与许可证

本项目基于 [McBenac/QuickLook.Plugin.GpxViewer](https://github.com/McBenac/QuickLook.Plugin.GpxViewer)
二次开发，采用 MIT 许可证。上游版权声明原样保留在 [LICENSE](LICENSE) 中，并与本分支修改部分的版权
声明并列。
