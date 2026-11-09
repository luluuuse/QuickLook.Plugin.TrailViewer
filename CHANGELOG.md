# 版本更新日志 / Changelog

**1.16.6 是本仓库的起点**：下面这一条写的是插件当时具备的全部能力，作为后面每一条的基线。从下一版起，
新版本另起一条加在最上面，只写这一版改了什么，已有的条目不再改动。

版本号沿用上游编号：`1.0.0` 是上游基线（只支持 GPX），`1.1.0` 起的开发都发生在这里。

产品版本使用 Semantic Versioning。WebView2 缓存由 `viewer/` 文件内容哈希单独决定，因此日常修复不再为了
刷新缓存制造新的发布版本。安装新的发布包后仍需从托盘退出 QuickLook 再启动。

**1.16.6 is where this repository starts**: the entry below says what the plugin could do at that point, and
is the baseline every later entry is read against. From the next version on, each release gets its own entry
at the top saying only what it changed; entries already written are left alone.

The numbering continues upstream (`1.0.0` is McBenac's baseline, GPX only); everything from `1.1.0` on was
written here.

The product version follows Semantic Versioning. WebView2 cache identity is derived independently from the
content of `viewer/`, so unrelated releases do not exist merely to defeat the cache. Restart QuickLook from the
tray after installing a new release.

---

## Unreleased

- Release workflow 改为从本文件的对应版本章节生成 GitHub Release 正文；缺失章节、空正文或 TODO 占位会直接
  拒绝发布，并自动追加安装包名与 SHA256。

- The release workflow now uses the matching section of this file as the GitHub Release body. Missing sections,
  empty notes and TODO placeholders fail the release, and the package name plus SHA256 are appended.

## 1.17.1 — 2026-11-09 · CI 可重复性修复 / Reproducible CI

- 导出面板测试显式使用中文系统，不再依赖 CI runner 的默认语言。
- GPS 异常图标测试等待标签重绘完成并显式等待缩放变化，消除地图空闲与 marker 重建之间的竞态。
- 测试意图和产品行为不变；本版修复 `v1.17.0` 发布流水线中的两处环境相关失败。

- The export-panel test now selects a Chinese locale instead of relying on the CI runner's system language.
- The GPS-anomaly test waits for marker repaint and an explicit zoom change, removing a race between map idle
  and marker recreation.
- Product behaviour is unchanged; this patch fixes two environment-dependent failures in the `v1.17.0` release run.

## 1.17.0 — 2026-11-09 · 版本规划与沿线导航 / Versioning and route-ordered navigation

### Added / 新增

- 新增统一沿线导航模型：方向键、`A/D`、速览、剖面航点和相册跨点切换统一按累计里程排序；绿色起点和红色
  终点与重合的黄色标记点合并为同一节点。
- 新增独立的页面协议版本和偏好结构版本，为后续兼容与迁移提供明确边界。

### Changed / 变更

- 产品版本改用 Semantic Versioning，根目录 `Directory.Build.props` 成为唯一版本源；npm 配置不再伪装成
  插件产品版本。
- WebView2 虚拟主机改为 `viewer/` 内容哈希，不再依赖程序集版本。只有前端内容或页面协议改变时才刷新缓存。
- 发布准备脚本支持 `major / minor / patch`、`beta.N / rc.N` 和显式语义版本，并按 SemVer 优先级检查。

### Fixed / 修复

- 修复从起点向右切换时先跳终点、再回起点的循环；到达路线终点后向右正常回到起点。

- A unified route-ordered navigation model now drives arrow keys, `A/D`, the overview, profile waypoint dots
  and cross-pin photo navigation. Green starts and red ends merge with coincident yellow waypoints.
- Viewer protocol and preference-schema versions are now independent from the product version.

- The product uses Semantic Versioning with `Directory.Build.props` as its only source; npm tooling no longer
  claims the plugin's release number.
- The WebView2 virtual host is derived from a hash of `viewer/` content and the page protocol instead of the
  assembly version. Release preparation supports patch/minor/major and beta/rc versions.

- Fixed the start loop where Right jumped to the end, back to the start, then forward; Right from the end wraps
  to the start.

## 1.16.23 — 2026-11-09 · 统一沿线标记点导航 / Along-route waypoint navigation

- 修复从起点向右切换时先跳到终点、再回到起点的循环。方向键和 `A/D` 现在按轨迹累计里程排序，不再沿用 KML/GPX
  文件里 placemark 的原始顺序。
- 绿色起点、红色终点与位置重合的黄色标记点合并为同一个导航节点；点击任一可见标记都选中同一位置，不再重复
  经过起点或终点。
- 速览列表、方向键、剖面航点和相册跨点切换共用这条沿线序列；到终点后向右正常回绕起点。

- Fixed the start-point loop where Right jumped to the end, back to the start, then to the following point.
  Arrow keys and `A/D` now use cumulative route distance instead of the source file's placemark order.
- Green start and red end anchors merge with coincident yellow waypoints into one navigation node, so the same
  location is not visited twice.
- The overview, arrow keys, profile waypoint dots and cross-pin photo navigation all share the same route-ordered
  sequence. Right from the route end wraps to its start.

## 1.16.22 — 2026-11-09 · 信息聚焦与窄窗三态布局 / Focused map framing and three-state layout

- 新增统一的地图安全区域：按信息卡、工具栏、速览面板、剖面、比例尺和版权行实际测量后取景。文件打开和按
  `C` 回到全览时，整条轨迹完整居中显示在真正可见、无遮挡的区域，不再钻到信息卡或工具栏下面。
- 黄色标记点切换改为“接近边缘才回中”：点与弹窗仍在舒适区时地图不动，靠边或被遮挡时平滑移回安全区域中心。
  弹窗按实际尺寸参与避让，过高时限制高度并在内部滚动；剖面悬停/拖拽只做最小避让，不再把点中心放到剖面板下。
- 信息卡展开/收起、中英文切换、速览开关和窗口缩放后都会重新测量安全区域；已有当前点会继续保持在可见区域。
- 速览列表打开时，外部切换会把当前行滚入视野但不抢键盘焦点；筛选隐藏当前点时顶部保留“当前选中”行；
  合并分组中任一成员是当前点时该组都会高亮。
- 窄窗布局改为按内容实测的 `inline / wrapped / docked` 三态：缩放和右上工具栏分别定位；`docked` 允许两行；
  极窄窗口把标记点与列表按钮收成图标；完整信息卡受可用高度约束并在卡片内部滚动。
- GPS 异常和缺口图标支持点击及键盘 `Enter`/`Space` 放大到对应异常范围，提示文案同步改为“点击放大”。

- A measured safe map area now accounts for the summary, toolbars, waypoint overview, elevation profile, scale and
  credit line. Opening a file and pressing `C` frame the complete route inside the genuinely unobstructed map.
- Yellow-pin navigation now recentres only when the selected pin or its card approaches an edge or becomes obscured.
  Cards use their real DOM size and gain an internal scroll limit on short maps. Profile scrubbing performs the
  minimum reveal needed and stays clear of the panel.
- Summary mode, language, overview visibility and window resizing all refresh the safe area while keeping the
  current pin and card visible.
- The open waypoint overview scrolls its current row into view without stealing keyboard focus. A hidden current
  row is pinned at the top, and merged groups highlight when any member is selected.
- Narrow windows use measured `inline`, `wrapped` and `docked` layouts with independent zoom/tool positions,
  two-line tool wrapping, icon-only compact switches and an internally scrolling full summary.
- GPS anomaly and gap icons zoom to their event range on click or `Enter`/`Space`; hints now say “click to zoom”.

## 1.16.21 — 2026-11-09 · 补全悬停说明 / Complete hover hints

- 信息卡标题的悬停提示现在同时包含轨迹名称与完整文件名；文件名单独显示行继续保持移除。
- GPS 异常图标与红色数据缺口图标改为可悬停，提示分别展示异常/缺口事件数、影响或缺失里程，并提示放大查看。
  这些图标仍与 `W` 同步显隐，异常线段和缺口虚线继续常显。

- The summary-title tooltip now includes both the route name and full file name, while the separate file-name line
  remains removed.
- GPS anomaly and red data-gap icons are hoverable. Their hints report anomaly/gap event counts, affected or
  missing distance, and the zoom-for-detail action. W still controls the icons while the anomaly and gap lines
  remain visible.

## 1.16.20 — 2026-11-09 · 精简信息卡与两态切换 / Compact summary with two detail levels

- 信息卡删除轨迹名称下方的冗余文件名，文件全名仍保留在标题悬停提示中。
- 新增两态显示，默认使用精简模式：只显示标题和运动均速、上升、下降、里程、总用时、点数六项基础数据。
  标题右侧“更多/收起”按钮切换完整信息；完整模式保留日期、轨迹异常、内容和照片。选择保存在本机，语言切换
  与刷新后仍保持。

- The summary card removes the redundant file-name line below the route title; the full file name remains in the
  title tooltip.
- A two-level summary now defaults to Compact: only the title and the six basics (moving speed, ascent, descent,
  distance, total time, points). A More/Less button beside the title reveals full details with date, track
  anomalies, contents and photos. The choice persists locally across language switches and reloads.

## 1.16.19 — 2026-11-09 · 同步注记开关与紧凑摘要 / Synchronized annotations and compact summary

- `W` 和“标记点”按钮现在同步控制黄色标记点、轨迹采样点、红色数据缺口图标和 GPS 异常标签；真实缺口虚线
  连接与青白异常线段仍属于轨迹层，始终显示。键盘恢复标记点时，两类异常标签也一起恢复。
- 信息卡最大宽度从 340 px 收紧到 310 px，数字列间距和内边距缩小；数据缺口与速度异常在同一“轨迹异常”栏内
  分两行显示，长日期和内容允许在值列内换行。

- W and the Markers button now hide and restore waypoint pins, track sample dots, red gap icons and GPS anomaly
  labels together. Genuine gap connectors and cyan anomaly line overlays stay in the track layer and remain
  visible. Keyboard navigation restores both anomaly label groups with the pins.
- The summary card narrows from a 340 px to a 310 px ceiling with tighter numeric columns and padding. Data gaps
  and speed anomalies occupy two lines inside one Track anomalies row, while long dates and contents wrap inside
  the value column.

## 1.16.18 — 2026-11-09 · 合并 GPS 异常带 / Consolidated GPS anomaly bands

- 低缩放把相近的速度异常合并成一条 GPS 异常带：异常虚线全部保留，但每带最多一个 `GPS` 标签；低缩放最多
  显示 3 个标签，且进行碰撞避让。放大到 13 级以上才显示 `GPS ×N` 局部计数。
- 数据缺口与速度异常在信息卡中合并为同一“轨迹异常”栏，阅读顺序仍区分两者；原始断点计数保留在悬停提示中。

- At low zoom, nearby speed anomalies consolidate into GPS anomaly bands: every cyan dashed overlay remains,
  but each band gets at most one `GPS` label, with no more than three labels on screen and collision avoidance.
  `GPS ×N` detail returns above zoom level 12.
- Data gaps and speed anomalies now share one Track anomalies row in the summary card while remaining separately
  named; raw event counts stay in the hover title.

## 1.16.17 — 2026-11-09 · 稀疏黄色图钉 / Sparse yellow pins

- 移除地图上的聚合数字圆点，恢复黄色图钉，并把图钉从 30×34 px 缩小到 24×27 px。
- 普通图钉按屏幕距离稀疏显示：当前缩放下彼此不足 34 px 时只保留路线顺序中靠前的一个；缩放、平移后重算，
  因此整览数量有限，放大后逐步展开。重要语义点和键盘当前点始终显示。原始标记、照片导航与速览列表不变。

- Remove aggregate number markers and restore yellow waypoint pins, reduced from 30×34 px to 24×27 px.
- Ordinary pins are thinned by screen distance: within the current view pins closer than 34 px are skipped in
  route order, then the sample is recalculated on zoom and pan. The route overview stays sparse and reveals more
  individual pins as it is enlarged. Important semantic points and the keyboard selection always remain visible.

## 1.16.16 — 2026-11-09 · 图钉改为轻量圆点 / Lightweight waypoint dots

- 地图上的 30×34 黄色图钉全部移除，普通点改为 8 px 小圆点，重要点和带照片点略大但仍不超过 11 px；
  照片状态使用极小相机角标。键盘选中时通过蓝色光环定位，不再放大图钉。
- 屏幕聚合点、重要点优先、点击聚合放大、悬停提示、照片卡片和速览列表均保留。

- All 30×34 yellow map pins are replaced by 8 px waypoint dots. Important and photo points remain slightly
  larger but no more than 11 px, with a tiny camera mark for photos. Keyboard selection uses a blue halo instead
  of enlarging a pin.
- Screen-space clusters, important-point priority, cluster zooming, tooltips, photo cards and the overview list
  are unchanged.

## 1.16.15 — 2026-11-09 · 细化标记点聚合视觉 / Refined waypoint-cluster styling

- 聚合点由 34 px 黄色实心圆缩小为约 20 px 的深色数字圆，使用黄色细边和黄色数字，降低与真实图钉争夺注意力；
  三位数会自动略微加宽。
- 聚合点不再显示照片数量徽标，只保留一个很小的相机符号；完整标记点与照片数量仍可在悬停提示中查看。

- Waypoint clusters shrink from 34 px yellow discs to roughly 20 px dark count badges with a thin yellow rim and
  yellow number, so they no longer compete visually with real waypoint pins. Three-digit counts widen slightly.
- The photo-count badge is reduced to a tiny camera mark; hovering still reports the exact waypoint and photo
  counts.

## 1.16.14 — 2026-11-09 · 标记点屏幕聚合 / Screen-space waypoint clusters

- 地图标记点改为按当前缩放下的屏幕距离聚合：相距不足 30 px 的普通点合并为带数量的黄色聚合点，并附带聚合内
  的照片数量；点击聚合点会放大到对应区域，缩放和平移后自动重新分组。
- 危险、水源、营地、救援、下撤、补给等重要点，以及当前键盘选中的点始终显示为独立图钉。大量普通标记在低
  缩放级别显示为小圆点；原始标记点、照片导航和速览列表都保持不变。
- 聚合点会自动避开重要图钉，避免重要标记遮住聚合入口；按 W 时原始图钉、普通圆点和聚合点一起隐藏。

- Map waypoints now cluster by screen distance at the current zoom. Ordinary pins within 30 px become a yellow
  counted cluster with a photo count; clicking it zooms into the area, and zooming or panning regroups the pins.
- Important danger/water/camp/rescue/bailout/supply points and the current keyboard selection always stay as
  individual pins. Dense ordinary points become small dots at low zoom. Raw stops, photo navigation and the
  overview list remain unchanged.
- Clusters move clear of important pins so the protected marker cannot cover the cluster control. W hides raw
  pins, ordinary dots and clusters together.

## 1.16.13 — 2026-11-09 · 区分数据缺口与速度异常 / Separate gaps from sampling anomalies

- 红色警告只表示轨迹段之间真正断开的数据缺口；同一轨迹段内部的速度或位置跳点不再显示成红色断点，改用
  青白色斜向虚线覆盖异常路段，并以 `GPS` / `GPS ×N` 标识。样式同时依靠纹理和文字，不只依赖颜色。
- 一个孤立飞点产生的进出两次跳点合并为一个异常区。摘要拆成“数据缺口”和“速度异常”两行，悬停仍可查看
  原始事件数量；真实的缺口里程和异常采样路程分别统计。

- Red warnings now mean only genuine data gaps between recorded track parts. Implausible speed or position
  jumps inside one part use a cyan-on-white dashed overlay and a `GPS` / `GPS ×N` badge instead of pretending
  the line is broken. Texture and text carry the meaning as well as colour.
- The two sides of one bad GPS sample collapse into one anomaly area. The summary separates Data gaps from
  Speed anomalies and reports missing-gap distance and affected sampled distance independently.

## 1.16.12 — 2026-11-09 · 缩放里程与断点聚合 / Zoom detail and clustered breaks

- 修复长路线放大后仍固定在 10 km 的问题。移除整条路线“最多 18 个标签”的全局上限，标签间隔现在只由当前
  缩放后的屏幕像素间距决定；公里标记只渲染当前视口附近，平移和缩放后重新计算。
- 真实漓江百公里路线验证：整览为 10 km，放大一级为 5 km，继续放大依次恢复 2 km 和 1 km。
- 轨迹断点先合并连续异常：一个孤立 GPS 飞点不再同时算成“跳出去”和“跳回来”两个警告；连续漂移合并为
  一个异常区。当前缩放下相距 26 px 内的异常区再聚合成单个 `! ×N` 标记，放大后自动拆分。
- 摘要现在显示异常区数量，并在悬停提示中保留原始 GPS 断点数量。真实漓江路线由 41 个原始断点合并为
  17 个连续异常区，在 12 级缩放下显示为 6 个警告标记。

- Fixed long routes remaining stuck at 10 km labels after zooming in. The global 18-label cap is removed;
  milestone intervals now follow projected pixel spacing at the current zoom, and only markers near the
  viewport are rendered. Panning and zooming recalculate the layer.
- The real 100 km Lijiang route now moves from 10 km at the whole-route view to 5 km one zoom level in, then
  2 km and 1 km as the map is enlarged further.
- Recording breaks now collapse continuous anomalies first: one bad GPS point no longer counts as both an exit
  and a return, while a run of drift becomes one anomaly episode. Episodes within 26 screen pixels merge into
  one `! ×N` marker and split again when zoomed in.
- The summary reports anomaly areas and keeps the raw GPS break-event count in its tooltip. The real Lijiang
  route's 41 raw events become 17 continuous episodes and six visible warnings at zoom level 12.

## 1.16.11 — 2026-11-09 · 自适应里程标记 / Adaptive distance markers

- 公里箭头和数字标签改为按当前缩放后轨迹的屏幕长度自动选择间隔；标签最多保留约 18 个，并同时受最小像素
  间距约束，方向箭头使用更宽的另一组限制。百公里路线整览由近百个标记降为规则的 `10 km` 至 `100 km`，
  放大后自动细分到 5 km、2 km 或 1 km。
- 多段轨迹改为按整条路线连续累计里程取样，不再每段重新起算，因此标签会落在统一的整十/整五里程；
  回头路或并行路段发生屏幕碰撞时优先保留箭头，并暂时隐藏重叠标签。

- Kilometre arrows and text labels now choose their interval from the track's projected screen length at the
  current zoom. Labels are limited to about 18 entries and a minimum pixel spacing, while arrows use a separate,
  tighter limit. A 100 km overview now shows regular `10 km` through `100 km` milestones instead of roughly one
  hundred markers, then subdivides to 5, 2 or 1 km as the user zooms in.
- Multi-part tracks sample one continuous cumulative distance instead of restarting at every recorded part, so
  labels land on consistent round milestones. If switchbacks make labels collide, the arrow wins and the
  overlapping text is temporarily omitted.

## 1.16.10 — 2026-11-09 · 紧凑标记点速览 / Compact waypoint overview

- 标记点速览移除“路线重点”横向卡片条和常驻分类筛选行，改由标题栏的单个“筛选”菜单完成全部/重点/分类筛选，
  不再出现两条原生横向滚动条，也不额外占用列表高度。
- 每行的“纠正分类”下拉框改为标题右侧的铅笔按钮；点击后才显示分类菜单，人工纠正过的行以蓝色铅笔标识。
  分类颜色、文字徽标、证据、地图定位和本机持久化均保留，窄窗口可显示更多标记点。

- The waypoint overview removes the horizontal route-highlight strip and always-visible category row. One compact
  Filter menu in the header now handles all, important and category filters, eliminating both horizontal
  scrollbars without taking extra list height.
- The per-row correction select is replaced by a pencil button in the title. Its category menu opens on demand
  and manually corrected rows keep the pencil highlighted. Colours, text badges, evidence, map selection and
  local persistence are unchanged, while narrow windows fit noticeably more waypoints.

## 1.16.9 — 2026-11-09 · 大文件路径与可访问状态 / Large-track paths and accessible state

### 性能 / Performance

- 剖面 waypoint 不再为每个标记线性扫描全部采样点。新增静态二维 k-d 树，最近点仍使用原来的经纬度平方距离和
  同值取最早点的规则，因此显示结果不变；30,000 点 / 1,000 次查询的本机基准由约 62.8 ms 降到 4.1 ms。
- 600 单位宽的 SVG 剖面现在按像素列抽稀，每列保留最低和最高采样点，再保留整条轨迹首尾。30,000 点测试文件的
  曲线路径从 30,000 个顶点降到约 1,200 个，单采样尖峰仍会保留。
- 短坡段合并从反复扫描、`splice` 的写法改成一次入栈扫描，避免坡型频繁切换时出现二次复杂度。
- 汇总改为遍历原轨迹，不再先 `flat()` 出两份点数组；30,000 点文件少一次与点数同规模的内存复制。
- 导出先按完整轨迹计算取景和海拔范围，再在投影后的像素空间用 Ramer–Douglas–Peucker 简化，容差 0.35 px。
  文档中的 30,000 点范围会完整进入简化，不再先按固定步长盲目跳点。

- Profile waypoints no longer scan every sample for every marker. A static 2D k-d tree keeps the old
  degree-squared metric and earliest-sample tie rule, so the chosen point is unchanged; a local
  30,000-point / 1,000-query benchmark fell from about 62.8 ms to 4.1 ms.
- The 600-unit SVG profile is sampled per pixel column, keeping each column's low and high point plus the route
  ends. A 30,000-point test route now produces about 1,200 path vertices instead of 30,000, while a
  one-sample summit still survives.
- Short-run merging is a single stack pass instead of repeated scans and `splice` calls.
- Summary now traverses the original route instead of flattening two temporary point arrays first.
- Export computes framing and elevation range from the complete route, then applies Ramer-Douglas-Peucker in
  projected pixels with a 0.35 px tolerance. The documented 30,000-point range reaches simplification intact
  instead of being stride-sampled first.

### 路线信息 / Route readiness

- 每公里在地图上插一个沿行进方向旋转的箭头和 `1 km`、`2 km` 标签；不足一公里但有实际长度的轨迹仍在中间给出
  一个方向箭头，不必先在地图上猜起点朝哪走。
- 信息卡把运动均速和总用时分开。KML 带 `TimeUsed` / `PauseTime` 时直接用文件记录的暂停总时长计算运动时间，
  例如真实天堂寨路线为 10h21m 总用时减 1h23m 暂停，得到 8h57m；没有元数据时才回退到移动速度估算，并使用
  适合雪地、碎石和找路慢行的宽松阈值。运动时间和坡度修正估算都收进“总用时”的悬停提示，不再各占一行。
- 爬升说明会给出过滤值与原始 GPS 读数，例如 567 m 显示值、600 m 原始累计，让噪声处理不再藏在代码里。
- 自动检测异常位置跳变和段与段之间的空间断点；地图用红色警告点和虚线连接标出，摘要给出断点数量与缺口里程。
  原地停留只属于暂停时间，不会被误报成轨迹断点。
- 预计用时改为坡度敏感模型：Naismith 提供 5 km/h + 600 m/h 的基础；5°–12° 缓下坡按 Langmuir 每 300 m
  减 10 分钟，大于 12° 的陡下坡每 300 m 加 10 分钟；大于 12° 的陡上坡同样每 300 m 加 10 分钟。
  真实天堂寨路线的估算由旧 Naismith 6h28m 更新为 7h22m，仍与雪地实际运动 8h57m 分开显示。
- Waypoint 速览按轨迹里程排序，逐行显示名称、累计里程、海拔、照片数量和描述摘要；点击一行即在地图上选中
  对应标记点并保持列表，方便连续扫读营地、岔路、照片点等重要位置。
- Waypoint 速览第一阶段加入本地语义识别：危险、水源、营地、岔路、山顶/垭口使用不同底色和文字标签；支持
  多标签、中英文同义词、否定语境和命中依据，提供“重要”及各分类筛选。颜色不是唯一信息，行内同时保留图标
  文字，列表顺序仍严格按轨迹里程。
- 第二阶段补齐完整描述文本、逐句分类和上下文证据；KML 共享/内联图标和 GPX 符号可作为中等置信度线索。
  新增救援、下撤、补给、过河、入口和观景类别，并把危险/水源/营地/救援/下撤/补给汇成顶部“路线重点”速览。
- 25 m 内的重复标记点在速览中合并，照片、名称、分类和描述合并展示；地图图钉和键盘导航仍保留全部原始点。
  每行加入“自动识别/危险/水源/营地/补给/下撤/清除标签”纠正菜单，选择保存在本机 localStorage 并可在刷新后恢复。
- KML 共享样式只有 `LineStyle`、没有直接 `Icon` 子节点时不再继续解引用空节点；带轨迹样式的真实天堂寨 KML
  可正常打开，图标语义仍从存在 `Icon/href` 的样式中读取。
- 导出的轨迹图同步使用运动均速与总用时标签，保证屏幕摘要和分享图片口径一致。

- Every kilometre now carries an arrow rotated to the walking direction and a `1 km`, `2 km` label. A shorter
  but non-trivial path still gets one midpoint arrow, so the starting direction is visible immediately.
- The summary separates moving average speed from total time. KML `TimeUsed` / `PauseTime` metadata is used
  directly when present: the real Tianzhuzhai route is 10h21m total minus 1h23m paused, or 8h57m moving.
  Files without that metadata fall back to a looser movement estimate. Both moving and estimated time now
  live in the total-time tooltip instead of separate fact rows.
- The ascent tooltip reports filtered and raw GPS values, such as 567 m shown against 600 m accumulated raw.
- Implausible position jumps and spatial breaks between segments are detected automatically. The map marks them
  with red warnings and dashed connectors, while the summary reports count and missing distance. A stationary
  pause is part of moving-time statistics, not a false break in the line.
- The estimate now uses a grade-sensitive model: Naismith supplies 5 km/h plus 600 m/h of ascent; Langmuir
  subtracts 10 minutes per 300 m on 5-12 degree descents and adds 10 minutes per 300 m above 12 degrees;
  steep ascents above 12 degrees receive the same 10 minutes / 300 m extension. The real route moves from a
  6h28m Naismith estimate to 7h22m, while its snow-affected recorded moving time remains 8h57m.
- The waypoint overview is sorted by track distance and lists name, cumulative distance, elevation, photo count
  and a description snippet. Clicking a row selects and locates the pin while keeping the list open for browsing.
- Phase one of waypoint insights adds local semantic labels for danger, water, camp, junctions and summits,
  with category-specific row tints, text badges, multi-label support, Chinese/English synonyms, negation
  handling and evidence. Important/category filters are available, while route order remains unchanged.
- Phase two reads full descriptions, evaluates evidence sentence by sentence, and uses shared/inline KML icons
  or GPX symbols as medium-confidence hints. Rescue, bailout, supply, crossing, access and viewpoint categories
  are added. Important semantic points also form a compact route-highlight strip.
- Waypoints within 25 m are merged in the overview only, combining names, descriptions, photos and categories;
  map pins and keyboard navigation retain every original point. A per-row correction menu can override the
  automatic category or clear labels, persisted locally across reloads.
- Shared KML styles that contain only a `LineStyle` no longer dereference a missing `Icon`; real tracks with
  styled route placemarks open normally while icon hints still come from styles that do define `Icon/href`.
- Exported track pictures now use the same moving-average and total-time wording as the on-screen summary.

- Added direct unit coverage for movement hysteresis, recording gaps, GPS jumps, interpolated kilometre bearings,
  raw-versus-filtered elevation, slope bins and grade-aware hiking arithmetic.
- Added a browser suite for direction labels, route breaks, recorded pause metadata, summary values, waypoint
  overview ordering and selection, insight filters, multilingual labels and narrow-window layout.
- Added phase-two coverage for full descriptions beyond the display limit, icon hints, extended categories,
  route highlights, nearby merging, manual overrides, reload persistence and multilingual labels.

### 可访问性 / Accessibility

- 底图、标记点开关和导出选项补上 `aria-pressed`；图层、标记点、语言、照片按钮的可见提示同步成为
  `aria-label`。导出面板和全屏照片成为带名称的 dialog，摘要与 toast 使用礼貌播报。
- 控件恢复正常的 Tab 焦点顺序。按钮上的 Space 被阻止默认激活，Enter 仍可正常操作，所以 QuickLook 的
  Space 关预览行为保持不变。全屏照片加入焦点陷阱，关闭后把焦点送回地图。
- 全屏照片和焦点逻辑拆到 `photo-viewer.js` / `focus.js`，主文件不再同时拥有整套照片 DOM 生命周期。

- Layers, marker visibility and export choices expose `aria-pressed`; their visible tooltips now double as
  `aria-label`s. The export panel and full-size photo viewer are named dialogs, and the summary/toast announce
  changes politely.
- Controls return to the normal Tab order. Space is prevented from activating a focused button, while Enter
  still works, so QuickLook keeps Space for closing the preview. The photo dialog traps Tab and returns focus to
  the map when closed.
- The photo dialog and focus lifecycle now live in `photo-viewer.js` / `focus.js` instead of the map application.

### 测试 / Tests

- 新增 k-d 树对线性搜索的逐查询一致性、稠密剖面像素上限、单点尖峰、线性短段合并、导出折线、ARIA 状态、
  Space/Enter、Tab 顺序和照片焦点陷阱断言。
- `npm test` 仍覆盖全部 17 个套件；新增 30,000 点剖面路径顶点上限检查。
- 地图图层、语言、定位、导出按钮拆到 `map-controls.js`，导出设置面板拆到 `export-panel.js`；两者通过注入
  Leaflet、DOM 工具、翻译和回调工作。`app.js` 从约 1937 行降到约 1579 行。
- SVG 剖面、渐变图例、坐标轴、极值标签和像素顶点构建拆到 `profile-chart.js`，主文件只保留剖面数据准备和
  拖拽交互。`app.js` 进一步降到约 1307 行。
- 完成一次性边界重构：格式化、waypoint 内容、摘要、剖面数据/拖拽、轨迹几何、waypoint 状态、导出流程、
  快捷键、地图视图和 chrome/toast 分别进入独立模块。`app.js` 从最初约 1937 行降到约 327 行，只保留参数、
  模块装配和 ready/error 上报。
- 增加 ESLint 9 与 TypeScript 5 `checkJs` 静态门禁，`npm run check` 同时检查 viewer、测试、脚本和工具；
  CI 在构建前执行该门禁。新增共享 JSDoc 类型，覆盖轨迹点、GPX/KML 模型、摘要、剖面单元和导出设置。
- 文件名回退改为安全 URI 解码，页面级意外错误改用当前界面语言显示，不再硬编码英文。
- 测试服务器、浏览器启动、断言和失败产物抽到 `tests/support/`，14 个浏览器套件共用同一套离线基础设施；
  失败时在 `test-results/<套件>/` 留下截图与 `result.json`。
- 新增 34 个 Node 纯单元测试，覆盖累计升降尾段、剖面像素采样、短坡合并、坡度色阶、k-d 树等价性、
  极地/日期变更线投影、折线简化、按键控制器、运动时间、断点、坡度估算，以及完整航点文本、图标和扩展分类。
  常规 `npm test` 不再访问真实地图服务。
- 真实地形端点改为独立的每周/手动 `live-smoke` workflow；它不阻塞要求确定性的主 CI。
- 删除 87 处固定 `waitForTimeout`，改为等待目标地图状态、Leaflet 动画结束、弹窗数量、图片加载、瓦片加载、
  焦点或布局帧，减少慢机器上的假失败，也避免空等拖慢本机测试。
- Harness 新增 `selftest` / `npm run test:host`，以 43 项断言覆盖 KMZ 文档探测、解包命名、ZIP 路径穿越、
  64 MB 上限、临时文件清理、视图偏好，以及导出分块状态机和原子替换。
- 浏览器失败产物现在包含 `trace.zip`；新增 `artifacts-test.cjs`，用一次故意失败验证截图、结果 JSON 和 trace
  确实同时生成；CI 失败时会把整个 `test-results/` 作为诊断 artifact 上传。常规 `npm test` 现覆盖 19 个套件。
- PNG 分块协议从 `GpxPanel` 抽到独立 `OverlayTransfer` 状态机：乱序、重复、缺块、非法 Base64、错误 id/count
  或超过 64 MB 时失败关闭并清空半成品；文件名统一去掉路径、Windows 非法字符和尾随点/空格。
- PNG 落盘抽到共享 `AtomicFile`，先写同目录临时文件再发布，并替换已有图片。Harness 真实按 X 导出了一张
  330084 B 的 `track-轨迹-4x3.png`，确认状态机、分块消息和最终文件写入连在一起工作。

- Added assertions for k-d tree equality against the linear scan, dense-profile pixel bounds, preserved
  one-sample peaks, linear short-run merging, export simplification, ARIA state, Space/Enter, Tab order and the
  photo focus trap. The 30,000-point viewer test now also checks the bounded profile path.
- Map layer, language, locate and export controls moved to `map-controls.js`; the settings dialog moved to
  `export-panel.js`. Both receive Leaflet, DOM, translation and callbacks as dependencies. The application file
  dropped from about 1,937 to 1,579 lines.
- SVG construction, the gradient legend, axes, extremum labels and sampled curve moved to `profile-chart.js`;
  the application keeps data preparation and scrub interaction. `app.js` fell further to about 1,307 lines.
- Completed the one-pass boundary refactor: formatting, waypoint content, summary, profile data/scrub, track
  geometry, waypoint state, export flow, keyboard routing, map view and chrome/toast now live in focused modules.
  `app.js` dropped from about 1,937 to 327 lines and now only handles parameters, composition and ready/error
  reporting.
- Added ESLint 9 and TypeScript 5 `checkJs` gates. `npm run check` covers the viewer, tests, scripts and tools,
  and CI runs it before building. Shared JSDoc types now describe track points, GPX/KML models, summaries,
  profile samples and export settings.
- File-name fallback now uses safe URI decoding, and the page-level unexpected-error boundary follows the active
  interface language instead of hard-coded English.
- The static server, browser launcher, assertions and failure artifacts now live under `tests/support/` and are
  shared by all 14 browser suites. Failures leave both a screenshot and `result.json` under
  `test-results/<suite>/`.
- Thirty-four Node-only unit tests cover final ascent/descent stretches, profile pixel sampling, short-run
  merging, slope colours, k-d tree equivalence, polar/date-line projection, path simplification, formatting,
  keyboard routing, movement time, route gaps, direction sampling, grade-aware hiking arithmetic and complete
  waypoint text/icon classification.
- The real terrain endpoint is checked by a separate weekly/manual `live-smoke` workflow, so the deterministic
  main CI does not depend on a third-party service.
- All 87 fixed `waitForTimeout` calls were removed. Tests now wait for a target map state, Leaflet animation,
  popup count, image/tile load, focus or a layout frame, reducing both false failures on slow machines and idle
  time on fast ones.
- The Harness now has `selftest` / `npm run test:host`, with 43 assertions for KMZ document detection, unpacked
  naming, ZIP path traversal, the 64 MB bound, temporary-file cleanup, preferences and the overlay protocol.
- Browser failure bundles now include `trace.zip`. `artifacts-test.cjs` deliberately fails once to prove the
  screenshot, result JSON and trace are all produced. The regular `npm test` now covers 19 suites.
- PNG chunk handling moved from `GpxPanel` into an `OverlayTransfer` state machine. Out-of-order, duplicate,
  missing, invalid-base64, wrong-id/count and oversized transfers fail closed and clear their partial picture;
  file names lose paths, Windows-invalid characters and trailing dots/spaces.
- PNG publication moved to the shared `AtomicFile` helper, which writes beside the target before replacing it.
  A real Harness X-key run produced a 330,084-byte `track-轨迹-4x3.png`, proving the transfer messages and final
  file write work together.

## 1.16.8 — 2026-11-09 · 正确性与跨版本偏好 / Correctness and durable preferences

### 轨迹数据 / Track data

- 累计爬升和下降现在会结算行程终点尚未反转的那一段。此前单向爬坡，或记录停在上坡过程中，会把最后一整段爬升
  丢掉；现有合成山路的爬升因此从 284 m 修正为 567 m。新增单调上升、单调下降和长距离单向上/下坡的纯函数断言。
- 用时和平均速度优先只读实测轨迹；没有轨迹时读路线，最后才读航点。航点上的计划时间不再把整段行程拉长。
- `gx:Track` 的无效坐标不再导致后续时间整体错位：时间仍按原始坐标下标配对，只有合法坐标进入轨迹。

- Ascent and descent now settle the final, uncommitted stretch at the end of a recording. A route that only
  climbed, or stopped halfway up, could lose its whole final climb; the synthetic mountain fixture therefore
  changes from 284 m to 567 m. Monotonic up, monotonic down and long one-way climbs now have direct assertions.
- Duration and average speed use the recorded track first, then a route, and only then waypoint times. A planned
  stop timestamp can no longer stretch the whole trip.
- An invalid `gx:Track` coordinate no longer shifts every later timestamp: times stay paired with their original
  coordinate indexes, while only valid points enter the track.

### 导出与地图 / Export and map

- 导出使用与 Web Mercator 相同的纬度边界，合法但接近两极的坐标不会再让整张图变成 `Infinity`/`NaN`；跨越
  180° 经线的轨迹走短边，而不是把世界地图整圈铺开。
- PNG 分块协议现在带导出 id、序号和总块数。宿主逐块校验顺序和总数，拒绝超限、缺块、重复块或乱序块；最终
  文件先写同目录临时文件，再原子替换目标，失败时不会留下半张 PNG。
- 连续按导出键会忽略重复请求；文件名使用绘制开始时快照的版式，避免编码期间改设置造成图片与文件名不一致。

- Export coordinates share Web Mercator's latitude limit, so valid polar points can no longer turn the whole
  picture into `Infinity`/`NaN`. Routes crossing 180° longitude take the short way around instead of spanning
  the world.
- PNG chunks now carry an export id, index and count. The host validates order and completeness, and writes to a
  temporary file before atomically replacing the target, so an interrupted save cannot leave half a PNG.
- A repeated export key press is ignored while encoding. The file name uses the settings snapshot taken when
  drawing began, so changing the panel in flight cannot make the name disagree with the image.

### 隐私与文件边界 / Privacy and file bounds

- 语言、底图、标记点和导出选项改由宿主保存到
  `%LOCALAPPDATA%\GpxViewer\viewer-settings.txt`，再随 URL 传给页面。WebView2 origin 仍可随版本变化，但选择不再
  跟着 origin 丢失；选择“无底图”后升级，也不会因为 localStorage 为空而自动发起瓦片请求。
- KMZ 内 KML 的上限降为 64 MB，并同时限制压缩大小和实际解压字节。ZIP 元数据声明较小、实际解压过大时会在写入
  临时文件的中途中止并清理，不再只信任中央目录里的长度。
- Harness 可通过 `GPXVIEWER_USER_DATA` 使用独立的 WebView2 配置目录，不和在运行的 QuickLook 争锁。
- 全局键盘钩子在自己的线程上卸载后再停止 Dispatcher，避免固定等待超时后丢失仍有效钩子的引用。

- Language, layer, marker and export choices are stored by the host in
  `%LOCALAPPDATA%\GpxViewer\viewer-settings.txt` and passed in the URL. The WebView2 origin may still change
  per release, but preferences no longer disappear with it; choosing **No map** survives an upgrade instead of
  falling back to an immediate tile request.
- The KML inside a KMZ is limited to 64 MB, with both compressed and actual decompressed bytes checked. A ZIP
  whose metadata understates its content is stopped while copying and the partial file is removed.
- The harness can use an isolated WebView2 profile through `GPXVIEWER_USER_DATA`, avoiding a lock held by a
  running QuickLook instance.
- The global keyboard hook is removed on its own dispatcher thread before that dispatcher stops, instead of
  clearing the handle after a fixed wait.

### 工程质量 / Engineering

- 新增 `package.json`、锁文件和 `npm test` 聚合入口；GitHub Actions 现在安装锁定的 Playwright、运行全部 Node/
  浏览器测试，并通过干净的 `bin/` 构建。
- 打包会比对 `bin/Release/viewer` 与源码 `viewer/` 的文件清单，拒绝多出或缺失的旧前端文件；ZIP 条目按名称
  排序，产物更可复现。

- Added `package.json`, a lockfile and an aggregate `npm test` entry point. GitHub Actions now installs the
  pinned Playwright package, runs every Node/browser suite and builds from a clean `bin/`.
- Packing compares `bin/Release/viewer` with the source `viewer/` tree, rejecting stale or missing front-end
  files, and sorts ZIP entries for a more reproducible package.

## 1.16.7 — 2026-11-07 · 面板用词 / Panel wording

### 文案 / Wording

- <kbd>⇧X</kbd> 面板首行的中文标签由**比例**改为**版式**：这一行挑的是方版 / 竖版 / 横版三种排法中的一种，
  写成「比例」容易被读成要找数字比例。导出按钮的悬停提示同步改用「版式」。英文一直是 Shape，未动。

- The first row of the <kbd>⇧X</kbd> panel reads 版式 (layout) rather than 比例 (proportion): the row picks one
  of three layouts, and "proportion" reads like something to be measured. The export button's tooltip
  follows. The English label already said Shape.

### 打包 / Packaging

- 安装包文件名带版本号（`QuickLook.Plugin.TrailViewer-1.16.7.qlplugin`），从 csproj 的 `<Version>` 推导。
  以前每版都叫同一个名字，几个版本下到同一个文件夹会互相覆盖。打包前还会比对 `bin/Release` 里的元数据，
  版本对不上就拒绝出包，避免出现「文件名是新的、里面是旧编译」的包。

- The installer is named after its version (`QuickLook.Plugin.TrailViewer-1.16.7.qlplugin`), derived from the
  csproj `<Version>`. Every release used to share one name, so two downloads landed on top of each other.
  Packing now also checks the metadata in `bin/Release` and refuses to build when it disagrees, so a new name
  can never wrap a stale binary.

## 1.16.6 — 2026-11-07 · 首发版本 / First release

### 文件格式 / Formats

- GPX 1.0 / 1.1、KML 2.2（含 `gx:Track` 与 `MultiGeometry`）、压缩包 `.kmz`。`.kmz` 只解出其中的 KML 文档到
  临时目录，临时目录的寿命等于预览窗口。
- 轨迹（`trk`）按段各自配色，起点绿、终点红，每个记录点一个可点的圆点（上限 2 万点）；路线（`rte`）画虚线；
  标记点（`wpt`）画钉子；KML 的 `Polygon` 画成淡淡的蓝色面，悬停显示名称。
- 不是合法 XML 的文件显示错误页和解析器原文，而不是白屏。

- GPX 1.0/1.1, KML 2.2 (including `gx:Track` and `MultiGeometry`) and zipped `.kmz`. Only the KML document
  inside a `.kmz` is unpacked, into a temporary folder that lives exactly as long as the preview.
- Tracks as lines, each segment in its own colour, start green and end red, a clickable dot per recorded point
  (up to 20,000); routes as dashed lines; waypoints as pins; KML `Polygon`s as a faint blue area named on hover.
- A file that is not valid XML shows an error page with the parser's message.

### 地图 / Map

- 四种底图，右上角切换：**地图**（OpenStreetMap 人道主义风格）、**地形**（CyclOSM：等高线、晕渲、高程点、
  小径）、**卫星**（Esri World Imagery）、**无底图**（纯网格）。选择会记住。
- 滚轮一格走一整级缩放；按住 <kbd>Alt</kbd> 同一次滚动只走半级，用来把某个盘山路弯按在指针下面。
  <kbd>+</kbd> <kbd>-</kbd> 按钮始终走整级。
- 缩放按钮下方一个定位按钮（或按 <kbd>C</kbd>）把整条轨迹恢复成打开时的取景——平移走了、跟着钉子跑远了，
  这是一键回家。

- Four backgrounds: **Map** (OpenStreetMap, Humanitarian style), **Terrain** (CyclOSM), **Satellite**
  (Esri World Imagery) and **No map** (a plain grid). The choice is remembered.
- One wheel notch moves a whole zoom level; hold <kbd>Alt</kbd> and the same notch moves half of one.
- A button under the zoom buttons -- and <kbd>C</kbd> -- puts the whole track back in view, framed exactly as
  the file opened.

### 标记点与照片 / Waypoints and photos

- 带 `<img>` 的标记点有相机角标，点开先给一排缩略图，大图再点一次——照片不会未经请求占满屏幕。相册内可
  左右切换。
- <kbd>←</kbd> <kbd>→</kbd> 或 <kbd>A</kbd> <kbd>D</kbd> 依次走过标记点：选中的钉子加蓝圈、地图跟随、
  卡片自动展开，一个接一个读下去不用碰鼠标。
- 一个开关同时隐藏地图上的圆点、标记点钉子和剖面图上的标记点（<kbd>W</kbd>）——四千多点的轨迹本来是一条
  点带，藏掉才看得出形状。线、面、起终点旗标、曲线和坐标轴都留下；选择会记住，本来就没有点的文件不出这个按钮。

- A placemark whose description carries an `<img>` gets a camera badge and opens a row of thumbnails first;
  the full-size picture is one click further.
- <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> step through the waypoints, keeping the selected pin
  in view with its card open.
- One switch (<kbd>W</kbd>) hides the dots, the waypoint pins and the markers on the profile at once. Lines,
  areas, the start/end flags, the curve and the axis stay; the choice is remembered, and a file that draws no
  dots gets no button.

### 海拔剖面 / Elevation profile

- 文件带 `<ele>` 就在底部画出剖面：半透明面板浮在地图上，一直延伸到底边。
- 曲线下的填充按**坡度本身**连续取色：绿（平缓）→ 黄（10% 附近）→ 橙红（20% 以上），25% 封顶。爬升在看
  坐标轴之前就能看出来，色阶固定不随文件伸缩，两条轨迹的颜色可以直接对比。
- 曲线上方两个数：**陡坡里程**和**最陡坡度**，旁边是读这两个数用的色带；最高点与最低点直接标在曲线上，
  贴顶自动翻到下方，靠边改一端对齐。
- 鼠标沿曲线移动显示该处海拔、里程和时间，小卡片半透明，压在下面的是曲线和色带本身。
- 剖面高度按轨迹自适应，使一米爬升占的像素约为一米地面的三倍（垂直夸大锁定 3×）。超出合理范围的轨迹被钳在
  上下限——40 km 起伏几米，或 2 km 爬 500 米——标题旁注明实际夸大倍数。
- 标记点按轨迹经过的位置画在剖面上，点一下打开地图上同一个钉子。

- A translucent panel across the bottom, running to the window edge behind it.
- The fill is coloured by the gradient itself -- green at level ground, yellow around 10 %, orange-red past
  20 %, capped at 25 % -- with a fixed scale, so two tracks can be compared by colour.
- Above the curve: how much of the route is steep, the worst gradient on it, and the colour bar those numbers
  came from. The highest and lowest points are labelled on the curve where the route reached them.
- Running the mouse along the profile shows the altitude at the cursor with its distance and time.
- The drawing is as tall as the route needs: a metre of climb takes about three times the pixels of a metre
  of ground. Routes outside the band are held at a floor and a ceiling, and the caption states the
  exaggeration it settled on.
- Waypoints sit on the profile where the track passes them; clicking one opens the same pin the map would.

### 语言与布局 / Language and layout

- 中英双语，首次按系统语言，右上角一个按钮切换。选择会记住，切换时重绘已有内容（摘要、打开的卡片、剖面、
  照片条）而不重载页面。日期和时间也跟着界面语言走，不跟系统走。
- 顶部不再有键位提示条：每个键写在它对应按钮的悬停提示里——底图 Q / E、标记点 W、全览 C、导出 X。
  没有按钮的键（方向键、A / D、S）不单独说明。摘要框标题最多两行、文件名一行，超出的部分进悬停提示，
  长文件名不会再把卡片撑宽。
- 竖版窗口（高 ≥ 宽，或宽 < 960 px）折叠布局：缩放按钮和角落开关下移到摘要框下方——只在
  确实放不下时才下移，摘要框的宽度只等于它最长的一行，角落通常是空的。

- English or Chinese, following the system language on first use and switched by one button. The choice is
  remembered, and switching repaints what is already on screen without reloading the page. Dates and times
  follow the interface language, not the system one.
- The key bar across the top is gone: each key now lives in the tooltip of the button it stands for --
  backgrounds Q / E, markers W, fit C, export X. Keys without a button (the arrows, A / D, S) are not spelled
  out anywhere. The summary clamps its title to two lines and its file name to one, with the full text on the
  tooltip, so a long name no longer widens the card.
- In a portrait window (as tall as it is wide or taller, or narrower than 960 px) the corner controls step
  down beneath the summary -- but only once they no longer fit.

### 叠加图导出 / Overlay export

- <kbd>X</kbd> 把当前轨迹画成一张透明 PNG，写到源文件同目录：左侧轨迹按海拔从绿到红渐变、
  两端各一个圆标，右侧竖排里程、用时、最高海拔、均速、上升。整张图从解析出的点现算，不是截屏，所以导出
  结果与当前缩放、平移、底图和窗口大小都无关，背景是真透明，可以直接叠到照片上。
- 同一个动作也有按钮：地图左上角、全览按钮下面那个方框图标，悬停提示里带着键位。
- <kbd>⇧X</kbd> 打开一个小面板：比例（**方版** / **竖版** / **横版**）、**墨色**（黑 / 白）、底衬（无 / 淡）。
  三个版式按用途命名，不按比例数字——「1:1」「9:16」看不出哪一张该叠在照片上；默认是竖版。
  选择会记住，之后按 <kbd>X</kbd> 就按上次的设置直接出图，默认是黑字、无底衬。
- 墨色是整张图唯一的一支笔：数值、标签、分隔线都由它派生，底衬方向自动跟它反相——黑字配浅底衬、白字配深底衬，
  不用自己判断该开哪一种。起终点圆标里的「起 / 终」恒为黑字，压在绿、红两个实心圆上。底衬也认版式：竖版铺在
  右半边，横版铺在上方数据区。
- 方版与竖版是「右侧竖排」：一列数字右对齐，左边一条竖线做边。**横版换了一种排法**，从上往下读：数据收在
  左上「半宽 × 三分之一高」的一格里，**轨迹占下方整条横带**（约 2 : 1）。里程是标题，字号最大、左对齐、不带
  中文名；其余四项在它下面排成 2 × 2，每格数字在上、标签在下，数字与标签都在格内居中，标签用更浅的墨色，视线
  先落在数字上。横版不画分隔线，靠间距分块。
- 横版的轨迹框是「按比例装进去」：东西向长轨迹铺满 0.05–0.95 的全宽，把横版的宽度用足；环形与南北向轨迹只能
  按高度撑满，左右留白并居中——这是等比装入的必然，不是排错。
- 出图尺寸按「叠在照片局部」定，不按照片本身：竖版 1080 × 1920，方版 1536 × 1536，横版 2048 × 1536（后两者
  的短边是 12 MP 照片短边的一半）。线宽与字号按画布等比缩放，三种版式的观感一致。文件名带版式比例
  （`-9x16`、`-1x1`、`-4x3`），同一轨迹导不同版式互不覆盖，同版式重导则直接更新。没有海拔的文件退化为单色线，
  并省掉「最高海拔」「上升」两行。
- 横版的字号是自适应的：里程按整栏宽度缩放，2 × 2 里的四个数字取同一个字号，由其中最宽的那个（通常是
  `02:00:00`）决定——四个数一样大，才不会读成四种数。里程与四项的字号比是 2 : 1（112 : 54）：里程一眼是这张
  图的主角，四项在照片局部尺寸下也仍然读得清。
- 绘制代码在按需加载的模块里，首次导出约 0.1–0.3 s（大头是 PNG 编码），打开文件与预览响应不受影响。

- <kbd>X</kbd> draws the track as a transparent PNG beside the source file: the route coloured by height from
  green to red with a badge at each end, and distance, time, highest point, average speed and ascent stacked on
  the right. The picture is computed from the parsed points rather than captured from the screen, so it ignores
  the current zoom, pan, background and window size -- and the background is actually transparent, ready to be
  laid over a photo.
- The same action has a button: the framed-route icon under the fit button in the top-left column, with the key
  named in its tooltip.
- <kbd>⇧X</kbd> opens a small panel: shape (**Square** / **Portrait** / **Wide**), **ink** (black / white) and
  backing (none / soft). The three shapes are named for the job, not for their proportion -- "1:1" and "9:16" say
  nothing about which one belongs on a photo -- and Portrait is the default. The choices are remembered, and
  <kbd>X</kbd> then exports with them: black ink and no backing unless you say otherwise.
- The ink is the one pen the picture is drawn with: values, labels and rules all derive from it, and the backing
  flips to oppose it (light wash behind black type, dark wash behind white), so the two can never be set against
  each other. The characters inside the start and end badges stay black in both inks, sitting as they do on a
  solid green or red disc. The backing knows the page too: the right half of a portrait one, the figures' band
  across the top of a landscape one.
- Square and Portrait stack the figures in a right-hand column, right-aligned against a rule. The
  **Wide page reads top down**: the figures are gathered into a top-left cell half the width and a third of
  the height, and **the track takes the whole band below** (about 2 : 1). Distance is the heading -- largest
  type, flush left, with no name under it -- and the other four sit beneath in a 2 x 2 block, number over
  label, both centred in their cell, the label in a lighter ink so the eye lands on the numbers first. No rules
  on this page; the spacing does the separating.
- The landscape band is fitted, not filled: an east-west track uses the full 0.05--0.95 width, which is what the
  page is for, while a loop or a north-south track can only fill the height and centres with photograph either
  side. That is what containing a shape in a 2 : 1 box does, not a layout gone wrong.
- Sizes are chosen for being laid into *part* of a photo, not over all of it: Portrait is 1080 × 1920, Square
  1536 × 1536 and Wide 2048 × 1536 -- the last two with a short edge of half a 12 MP frame. The line and type
  scale with the canvas, so all three read the same. The proportion is part of the file name (`-9x16`, `-1x1`,
  `-4x3`), so two shapes of one track never overwrite each other while a re-export of the same shape updates in
  place. A file without heights falls back to one colour and drops the two height rows.
- Landscape sizes itself: the heading is fitted to the column width, and the 2 x 2 block takes one size for all
  four numbers, set by the widest of them (usually a `02:00:00` clock) -- four numbers at four sizes would read
  as four different kinds of number. The heading is set at twice the block (112 : 54): unmistakably the subject
  of the page, and the four still legible once the picture is laid into a photo.
- The drawing code is loaded on demand: about 0.1--0.3 s for the first export, most of it PNG encoding, with
  opening a file and the rest of the preview untouched.

### 隐私 / Privacy

- 文件在本地读取，从不上传。只有底图瓦片会发出请求（OSM France 的 `*.tile.openstreetmap.fr` 与 CyclOSM、
  Esri 的 `server.arcgisonline.com`）：请求了哪些瓦片，等于大致暴露了轨迹在哪。**无底图**不下载任何东西。

- The file is read locally and never uploaded. Only map tiles leave the machine (OSM France, CyclOSM, Esri);
  which tiles are requested reveals roughly where the track is. **No map** downloads nothing.

### 性能 / Performance

- 1.5 万点轨迹从打开到可交互约 0.9 s。超过 2 万点的轨迹只画线不画可点击的点（内存与帧率考虑），剖面交互
  不受影响。

- A 15,000-point track opens in about 0.9 s. Past 20,000 points the line is drawn without clickable dots, for
  memory and frame rate; the profile is unaffected.

### 已知边界 / Known limits

- `http://` 图片不加载：页面运行在 `https://` 虚拟主机下，混合内容会被拦（`https` 与 `data:` 正常）。
- `.kmz` 包内的相对路径图片尚不支持。
- <kbd>Esc</kbd> 留给 QuickLook 关预览，所以全屏看图走 × 或点背板；<kbd>←</kbd> <kbd>→</kbd> 只在焦点落在
  预览窗口内时生效（焦点在资源管理器时按键被 QuickLook 的全局钩子拿去切文件），<kbd>A</kbd> <kbd>D</kbd>
  是兜底。
- 地形图层依赖境外服务，首屏可能要几秒才铺满，断网时只是灰底，不影响轨迹与剖面。
- 白墨靠身后一圈暗影撑住笔画，压在浅色照片上仍不如黑墨结实；照片一半亮一半暗时，单一墨色总有一边吃亏——
  这时开 <kbd>⇧X</kbd> 里的「淡」底衬。

- `http://` images do not load: the page runs on an `https://` virtual host, so mixed content is blocked
  (`https` and `data:` are fine). Relative-path images inside a `.kmz` are not supported yet.
- <kbd>Esc</kbd> closes the preview (QuickLook's key), so a full-size photo is closed with × or the backdrop.
  <kbd>←</kbd> <kbd>→</kbd> only work while the preview window has focus; <kbd>A</kbd> <kbd>D</kbd> are the
  fallback for when Explorer keeps it.
- The terrain layer comes from a service outside China: the first screen can take a few seconds, and offline it
  is a grey background that leaves the track and the profile untouched.
- White type is held up by a dark shadow behind it, and still reads less solidly than black on a light photo;
  on a photo that is bright on one side and dark on the other, one ink always loses somewhere -- turn on the
  "soft" backing under <kbd>⇧X</kbd>.

### 测试 / Tests

15 组脚本，全部是普通 Node 脚本，每条检查打印一行 `PASS` 或 `FAIL`：

| 套件 | 覆盖 |
| --- | --- |
| `viewer-test.cjs` | 全部样本的解析与摘要，对数 `tests/fixtures/expected.json` |
| `profile-test.cjs` / `scrub-test.cjs` | 剖面配色、极值标签、图例，光标读数与地图联动 |
| `ve-test.cjs` / `portrait-test.cjs` | 剖面高度与垂直夸大，竖版折叠布局 |
| `photo-test.cjs` / `nav-test.cjs` | 缩略图与大图、相册切换，键盘浏览标记点 |
| `pins-test.cjs` / `keys-test.cjs` | 圆点开关与记忆，快捷键 |
| `lang-test.cjs` | 中英文默认、切换、记忆、日期格式、错误页 |
| `terrain-test.cjs` / `zoom-test.cjs` / `locate-test.cjs` | 底图切换与瓦片请求，缩放步长，定位按钮 |
| `export-test.cjs` | 叠加图：三种版式与尺寸、透明、黑白墨、横版「上数据下轨迹」与 2 × 2 排布、底衬方向、面板与设置记忆 |
| `version-test.cjs` | 版本号在 csproj、元数据与两份日志之间一致 |

测试样本全部由 `tools/make-fixtures.py` 生成，不含真实轨迹。

Fifteen plain Node scripts driving the viewer in Chromium, one `PASS`/`FAIL` line per check. The fixtures are
synthetic, generated by `tools/make-fixtures.py`; no recorded track is checked in.
