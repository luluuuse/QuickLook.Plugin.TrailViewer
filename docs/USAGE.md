# 使用说明 / Usage

本文承接 README，说明地图、航点、剖面、测距和导出功能。

## 中文

### 打开文件

在资源管理器中选中 `.gpx`、`.kml`、`.kmz` 或 `.fit`，按 <kbd>Space</kbd>。在线底图需要网络；选择
“网格”（无底图模式）时轨迹直接绘制在本地网格上。

FIT 读取活动和路线中的 GPS 记录、时间、海拔、心率、会话用时及 `course_point` 路线点。简要模式聚焦
路线基础数据；步频、功率、温度、训练步骤和完整设备指标暂不展示。

单个轨迹文件最大为 64 MB；GPX、KML、KMZ 和 FIT 超限时会在启动 WebView 前直接显示错误，避免内存耗尽。

### 地图与航点

- 顶部“图层”入口的文字显示当前 **路网 / 地形 / 卫星 / 定制** 类别，图标同步使用该类别的地图结构图标；
  具体图源名称保留在悬停提示中。面板中分为这四类，
  每类带路线节点、等高线、地球或配置滑杆图标及悬停说明；下方只列出当前类型对应的图源。
  <kbd>Q</kbd> / <kbd>E</kbd> 可直接循环切换类型。
- **无底图模式**使用图层面板标题栏中的空白网格图标，位于设置齿轮左侧。开启后只显示轨迹、测距和坐标网格，
  不下载在线瓦片；顶部入口显示“网格”。关闭或按背景切换键会恢复上次使用的地图图源。图标提供悬停说明和
  蓝色激活态。
- 图层面板使用与工具箱一致的半透明背景和背景模糊，不完全遮断下方地图。
- 工具箱、图层面板和航点列表使用相同的顶部位置与标题栏高度；三者互斥，打开一个会自动关闭另外两个。
- 路网使用 OpenStreetMap HOT。地形菜单提供 CyclOSM、OpenHikingMap 和 OpenTopoMap；再次进入某一类别时
  会恢复该类别上次选择的图源。
- 路网和卫星菜单提供天地图。首次选择时按提示配置天地图开发者密钥；密钥由当前 Windows 用户凭据加密，
  后续打开无需再次输入。
- 天地图密钥管理位于图层面板右上角齿轮打开的 **地图设置** 页；已配置时提供 **更换密钥** 和
  **移除密钥** 图标操作，主图层列表只显示地图类型和图源。密钥状态压缩为“尚未配置 / 已配置”，不再展示
  技术加密说明。

### 定制图源

图层面板最多保存 20 个定制图源。没有图源时，单击 **定制** 类别会直接打开管理页空状态；至少保存
一个图源后，单击该类别或重新打开图层面板会显示常规图源选择列表，用于直接切换底图。需要添加、编辑或
删除时，点击“地图图源”标题旁的 **管理图源** 进入管理页。

管理页标题栏右侧的 **+** 用于添加；点击列表行切换图源，右侧铅笔和删除按钮分别编辑、删除。删除需要再次
点击确认，避免误操作。编辑与添加使用独立子页，保存后回到管理列表并立即应用当前图源。

- **名称**：显示在图源列表和顶部入口的悬停提示中。
- **瓦片地址**：必须包含 `{z}`、`{x}`、`{y}` 占位符，可选 `{s}`；只接受 HTTPS 地址。
  例如 `https://example.com/tiles/{z}/{x}/{y}.png`。也可直接粘贴两步路格式的 `{$x}`、`{$y}`、`{$z}`，
  保存前会自动转换为 Leaflet 占位符。
- **瓦片大小**：256 或 512。地址含 `@2x` 或 `%402x` 时会自动选择 512；512 图源同时使用 512 CSS 像素
  尺寸和负的缩放偏移，避免瓦片被压缩或放大。
- **缩放级别**：最小与最大级别，默认 1–19。
- **高级选项**：默认折叠。子域在地址里用了 `{s}` 时必须填写，例如 `abc`；署名作为纯文本显示在地图
  右下角的版权行；仅当服务使用 TMS 的 Y 轴方向时勾选翻转 Y。

保存后图源会出现在 **定制** 列表，选中即渲染。列表状态依次为 **加载中**、**已加载**、**部分可用**
或 **不可用**；失败时只提示，**不会**自动切换回其他底图，避免把配置问题误判为服务故障。

定制图源由宿主保存在本机应用数据目录，不再依赖会随版本变化的 WebView 存储域名；正常覆盖安装新版本后
仍会保留。首次使用这一存储方式时，旧页面存储中的图源会自动迁移。

#### 航点

- <kbd>←</kbd> <kbd>→</kbd> 或 <kbd>A</kbd> <kbd>D</kbd> 按累计里程顺序切换航点。
- 绿色起点、红色终点与重合的黄色图钉共享同一导航节点。
- 图钉靠近窗口边缘、信息卡、工具栏或剖面时，地图会平滑回中。
- 顶部地图工具保持统一高度；航点与列表组成一个工具组。极窄窗口中的图层入口显示图标、当前类型短标签
  和下拉箭头，完整名称仍可通过悬停提示和无障碍标签读取。
- `列表` 打开航点速览；支持语义筛选、合并近点和人工纠正。
- 点击或键盘 `Enter` 可放大 GPS 异常和数据缺口标签。
- 带照片的航点点击后显示一张卡片，**整张卡片就是照片**（竖幅 4:3，即高:宽 = 4:3，与手机竖拍一致）：名称和“时间 · 海拔”压在底部的
  渐隐层上，右上角是关闭，右下角是圆形箭头和 `2/9` 位置进度。**点照片任意处**即进入全览；圆形箭头
  跳到下一处带照片的航点并就地打开它的卡片，只有一处带照片时不显示箭头。
- 没有照片的航点卡片与它同属一套：同样的 224 px 宽度、圆角和右上角关闭，名称与“时间 · 海拔”两行
  字级一致；描述较长时在卡片内滚动，卡片本身不会长长地压住地图。卡片不再显示经纬度，图钉已经标出位置；
  若部分轨迹 App 把经纬度、海拔或时间自动写入航点备注，打开时会自动过滤这些重复遥测文字并保留用户手写
  备注，同时把缺失的时间回填回卡片顶栏。
- 进入全览后，右上角显示当前显示尺寸相对原图像素的真实百分比，例如原图为 2560 px 宽、窗口中显示
  640 px 时显示 `25%`。滚轮按绝对比例缩放，最高 800%；点击百分比恢复适应窗口，放大后可拖拽平移，
  切换照片时会重新适应窗口。
- 被选中的航点与起终点共用标准化双描边准星（航点为菱形、起终点为十字），精确锚定在图钉尖端坐标上，
  并与图钉本体的暖金色轮廓微光配合。

### 海拔剖面

剖面按坡度着色，最高点和最低点直接标在曲线上。鼠标沿曲线移动可查看海拔、里程和时间；点击可固定光标。
剖面会参与地图安全区域计算，被选中的地图点不会被剖面遮住。轨迹含逐点心率时，标题右侧会出现 **心率**
开关，默认关闭；打开后增加红色心率曲线、独立 bpm 范围，悬停读数同时显示当前心率。缺失心率的位置会断开
曲线，不进行插值。横贯剖面的红色虚线表示全部有效心率读数的算术平均值。

### 轨迹摘要复制

轨迹摘要标题栏中的复制图标会把当前文件整理成可直接粘贴到聊天或攻略中的纯文本。内容根据文件实际数据
生成，可包含名称、里程、日期、总用时、运动时间、运动均速、累计爬升/下降、顶点海拔和点数；缺失字段会
省略。路网文件只复制里程、路线/分段数量和航点数量，不伪造全网用时、均速或海拔。

摘要卡分两行六项：第一行里程、上升、下降，第二行总用时、运动均速、点数。里程和总用时左侧带蓝色竖线，
作为最常被先读的两个数值；其余四项用字号、字重和颜色保持次级层级。工具箱标题栏右侧的
`?` 打开快捷键速查页，以两列表格列出 `W` 航点、`S` 隐藏界面、`A` / `D` 切换点位或照片、`Q` / `E` 切换
地图图源、`C` 全轨迹、`M` 测距、`T` 开关工具箱；常用按钮的悬停提示仍保留对应键位。

### 界面语言

工具箱标题栏里只有一个语言按钮：左边是地球图标，右边是当前语言（`中` 或 `EN`），点击即在中文与英文之间
切换；悬停提示直接给出可切换到的语言——中文界面显示 `English`，英文界面显示 `中文`。整页就地重绘，
地图视野、已展开的面板和测距结果都保持原样，不会重新加载预览。选择会被记住，下次打开同一种语言；
没有手动选择时跟随系统语言。

### 距离测量

打开右上角 **工具箱**，选择 **距离测量**：

- <kbd>M</kbd> 可直接开始测距；测距中再次按 <kbd>M</kbd> 结束测距。
- 测距页面固定贴近窗口右侧；叠加图导出等其他工具页复用同一工具箱窗口。
- 页面顶部的 **返回** 回到工具箱主菜单，测距状态和已打的点都保留：去看别的工具再回来，
  可以接着量同一段，不会因为翻页被打断。
- 右键在地图上添加测距点；左键仍用于拖动地图，滚轮按当前位置缩放。
- <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤回最后一个操作，
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做。
- 在 14 px 屏幕半径内，靠近航点、先前手动打下的测距点（自动排除当前活动段末点以防自吸死锁）或轨迹
  采样点时会自动吸附到精确坐标。同像素平手时遵循 `航点 > 测距点 > 轨迹点` 优先级；悬停时以标准化
  双描边准星区分目标类型（航点菱形、测距点方块、轨迹点十字），并搭配轻量化悬浮标签。
- **结束本段** 后，下一次右键从新一段开始。工具箱分别显示每段距离、点数与全部路线总距离。
- **撤销打点** 删除最后一个点，**清空** 删除全部测距线；**结束测距** 退出打点状态但保留当前结果。
- **在地图中心打点** 提供不依赖右键的键盘操作路径。
- 地图上的段距离标签使用半透明底色，避免遮住测距线、轨迹和底图道路。

测距结果仅保存在当前预览的内存中，不会写回轨迹文件，也不会随叠加图导出。

### 点位坐标

工具箱 **点位坐标** 打开后立即进入连续地图拾取；面板内固定一行提供起点、终点、顶点和中心：

- 起点、终点使用轨迹或路线的首末记录点；顶点沿用可靠海拔判断。
- 点击起点、终点或顶点会复制坐标、自动聚焦该点，并在地图上显示脉冲标记和坐标标签。
- 打开工具即关闭当前图钉弹窗并进入十字准星状态。任意位置都可单击取点；靠近航点 14 px 内会显示
  标准化菱形吸附准星与轻量标签，单击后精确吸附到航点，离开吸附范围后保持用户实际点击的位置。拾取可
  连续进行，左键拖动和滚轮缩放不变；关闭坐标窗口即可结束。
- **中心** 复制当前地图中心坐标，并提供悬停说明。

所有结果按 `纬度, 经度` 六位小数复制，面板说明当前使用 WGS-84，不静默转换为 GCJ-02。
面板同时显示 **坐标类型：WGS-84**。
地图强提示和 **最近复制的坐标** 卡片会备注点位海拔；吸附到航点或轨迹点时读取源数据海拔，
自由地图点和地图中心没有可靠海拔时显示 **海拔：无数据**。海拔只用于界面说明，不会写入复制文本。
最近一次复制结果下方提供 **该点天气**，使用与轨迹天气相同的 Windy 链接直接打开该坐标。

### 附件图片导出

工具箱 **附件图片导出** 会统计当前文件的图片：内置相对路径、Data URI 和 HTTPS 外链。
面板提供两个入口：

- **导出全部图片**：云图标，包含内置图片、Data URI 和 HTTPS 外链。
- **导出内置图片**：文件夹图标，只导出本地内置图片，不等待任何外网请求。

图片写入源轨迹同级的 `<文件名>-photos` 目录；KMZ 使用压缩包所在目录。

- 文件名包含航点名称和序号，重名时追加 `-2`、`-3`，不覆盖已有图片。
- 内置图片由宿主直接复制，不再经过页面 Base64 和分块消息。
- 外链只在选择全部导出后请求，最多 3 张并发；同一域名只做一次安全检查，单张超时或失败不会阻塞其他图片。
- 导出目录内的隐藏清单记录已完成图片；关闭窗口后重新打开同一轨迹会跳过已完成项，只补导缺失或失败图片。
  原轨迹文件被修改后旧清单自动失效。结果会显示新增、跳过已完成和失败数量。
- 只接受公开 HTTPS 图片，HTTP、带凭据、回环、私网、多播、保留网段和链路本地地址会被拒绝；返回内容
  还必须匹配支持的图片文件头。
- 单张图片限制 30 MB，整批最多 200 张、300 MB；界面显示进度、成功/失败数量和最终目录。

### 轨迹天气

工具箱中的 **轨迹天气** 会在系统默认浏览器中打开 [Windy](https://www.windy.com/)，并**直接展开该点的逐小时
天气预报面板**（温度、体感、降雨、风、阵风、风向），不需要再自己在 Windy 里找位置。按钮下方的分段选择
决定定位到哪个点：

- **起点 / 终点**：第一个或最后一个记录点，固定 14 级街道视角。
- **顶点**：全程海拔最大的记录点，同样 14 级。文件没有可靠海拔，或全程高差不足 1 米（例如全 0 的
  平坦导出），该分段会禁用，不会拿一个任意点冒充峰顶。
- 三个点位使用统一地图图钉轮廓：绿色播放箭头表示起点、红色方框表示终点、琥珀色山峰表示顶点。
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
- 标题栏默认显示“详细”切换键。点击后增加累计时间、累计爬升/下降、平均心率、运动速度和垂直速度；
  文件没有有效心率数据时，平均心率列完全隐藏。平均心率为该公里内有效点读数的算术平均值，与全程
  平均心率口径一致。
- 展开时蓝色激活背景覆盖完整标题栏；各数据列头保持纯文字，不增加装饰图标。

### 路网轨迹

由大量独立路线合并出的两步路路网 KML 会自动进入路网模式。路网会显示全部路线和标注点，但不显示
全路网运动均速、休息时间、每公里表或合并海拔剖面，因为这些数据不属于同一次连续行程。地图使用
Canvas 绘制路线，并跳过普通轨迹点圆点、公里数字和路网级异常标记，以降低大文件的内存和交互开销。
标注点、照片、测距和叠加图导出仍可使用。路网叠加图显示文件名称、路线总长和轨迹段数，不绘制起终点，
也不显示用时、均速或海拔，避免把多条独立路线误示为一次连续行程。

### 导出叠加图

从 **工具箱 → 叠加图导出** 打开设置。该页面与测距、坐标和附件导出共用标题栏、半透明背景、返回键和
关闭键；不再使用单独的导出窗口或快捷键。

- 方版：1536×1536
- 竖版：1080×1920
- 横版：2048×1536
- 三个版式按钮的悬停提示会说明尺寸和适用场景。
- 设置页内提供低分辨率实时预览；改变版式、墨色或底衬后立即刷新。
- 预览画布带明暗双层边界，可直接辨认方版、竖版和横版的实际比例。
- 墨色按钮说明适合明亮或深色背景，底衬按钮说明完全透明或增加文字可读性的区别。

导出文件写在源轨迹同一目录，PNG 透明；可选黑/白墨色和底衬。图片会写入路线名称和日期，普通轨迹按
距离、总用时、累计爬升、最高海拔、运动均速排序。文件名包含版式、墨色和底衬，例如
`路线-轨迹-1x1-white-soft.png`，同版式的不同样式不会互相覆盖。
点击导出后设置页保持打开，可以继续切换版式、墨色或底衬并再次导出。

### 轨迹着彩、剖面分析与无损编辑

- **多维热力着彩**：点击工具箱左侧的轨迹图标或按 <kbd>L</kbd>，循环切换 **单色 / 海拔 / 配速 / 心率**（缺失对应字段时自动跳过）。
- **海拔剖面交互**：水平拖拽剖面绘图区可框选任意区间查看里程、爬升/下降、坡度、用时与均速（按 `Esc` 清除）；支持自动识别 ClimbPro 主坡段、点击或按 <kbd>P</kbd> 一键折叠剖面，以及四等份里程刻度参考线。
- **窄窗与矮窗联动精简**：窗口宽度 `≤ 720 px` 或高度 `≤ 520 px` 时，轨迹摘要、每公里分段微胶囊与 `26×26` 缩放/回到轨迹控件同步进入紧凑左列栈。
- **四区无损轨迹编辑**：点击工具箱顶部的 **编辑轨迹** 进入离线编辑工作区：
  - **顶部主控条**：显示文件名、修改状态圆点、里程增减徽标、撤销/重做（<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>）、复原、集成的图层/航点图标，以及 **保存**（<kbd>Ctrl</kbd>+<kbd>S</kbd>，右侧设置可勾选手表友好去重、佳明 15 字符重名检查或覆盖原文件自动备份）。
  - **裁剪与拆分**：支持 **剖面剪**（剖面双柄区间裁剪）与 **点击拆**（点击轨迹拆分并管理/删除分段）。
  - **清洗与拓扑**：支持检测并一键清洗 GPS 异常漂移点，以及反转方向、往返倍增和闭合环线。
  - **航点编辑**：支持点击轨迹吸附落点、`Alt+点击` 自由落点、序号化航点列表整行选中、右键航点图标删除，以及悬停 `?` 查看操作提示与折叠备注栏。

### 大文件与隐私

长轨迹仅绘制路线线条、起终点以及按视口抽样的航点，不再为每个原始采样点单独创建圆点标记，避免缩放或拖动时点位重叠与刷新卡顿。轨迹数据不发送到服务器；在线瓦片请求由所选底图触发。

## English

### Open a file

Select a `.gpx`, `.kml`, `.kmz` or `.fit` file in Explorer and press <kbd>Space</kbd>. Online basemaps require
network access; **Grid** (No-map mode) renders the route on a local grid.

The first FIT version reads GPS records, time, elevation, heart rate, session totals and `course_point` markers
from activities and courses. Laps, cadence, power, temperature, workout steps and the full device metric set are
not displayed yet.

Each track file is limited to 64 MB. Oversized GPX, KML, KMZ and FIT files show an error before WebView starts,
so malformed or padded files cannot exhaust memory.

### Map and waypoints

- Basemaps are grouped into **Road**, **Terrain**, **Satellite** and **Custom**;
  <kbd>Q</kbd> / <kbd>E</kbd> switches category.
- The top layer entry keeps the current Road, Terrain, Satellite or Custom label and matching category icon;
  the active source name is shown in the tooltip.
- **No-map mode** uses the blank-grid icon in the layer-panel title bar, immediately before Map settings. It
  shows only the route, measurement and coordinate grid without downloading tiles; turning it off or pressing
  a background key restores the last map source. The top entry reads Grid. The icon has a tooltip and a blue
  active state.
- The source list contains only providers for the active category, and the panel uses the shared translucent,
  blurred tool surface.
- The toolbox, layer panel and waypoint list share one top position and header height. They are mutually
  exclusive: opening one closes the other two.
- Road uses OpenStreetMap HOT. The Terrain menu offers CyclOSM, OpenHikingMap and OpenTopoMap, and remembers
  the source last selected in that category.
- The Road and Satellite menus offer Tianditu. Enter a user-owned developer key when first prompted; it is
  encrypted for the current Windows user and does not need to be entered for later previews.
- With a key configured, **Map settings** offers **Change key** and **Remove key** icon actions. The status reads
  only Not configured or Configured, without technical encryption copy.

### Custom sources

The layer panel stores up to 20 custom raster sources. With no sources, clicking **Custom** opens the empty
manager. Once at least one source is saved, clicking the category or reopening the layer panel shows the regular
source picker for switching basemaps. Use **Manage sources** beside the source heading to add, edit or delete
entries.

In the manager, use **+** in the title bar to add a source; click a row to select it, and use the pencil or delete
buttons to edit or remove it. Deletion needs a second confirmation click. Adding and editing use a separate page,
and saving returns to the manager list and applies the source immediately.

- **Name** — shown in the source list and the top-entry tooltip.
- **Tile URL** — must contain `{z}`, `{x}` and `{y}`; `{s}` is optional. Only HTTPS addresses are
  accepted, for example `https://example.com/tiles/{z}/{x}/{y}.png`. Two-step `{$x}`, `{$y}` and `{$z}`
  placeholders can also be pasted and are converted to Leaflet placeholders before saving.
- **Tile size** — 256 or 512. An address containing `@2x` or `%402x` selects 512 automatically. A 512 px
  source uses the correct 512 CSS-pixel size together with a negative zoom offset so tiles are neither
  compressed nor enlarged.
- **Zoom range** — minimum and maximum level, 1–19 by default.
- **Advanced options** — collapsed by default. Fill in subdomains when the URL uses `{s}`, for example `abc`;
  attribution is printed as plain text in the map credit line; enable Flip Y only for a TMS source.

A saved source appears in the **Custom** list and renders as soon as it is selected. Its state reads **Loading**,
**Ready**, **Partially available** or **Unavailable**. If tiles fail, the viewer only warns you to check the
address and the service's restrictions; it does **not** silently fall back to another basemap.

The host stores custom sources in local application data rather than the versioned WebView origin, so normal
overwrite upgrades retain them. Sources in the old page storage are migrated the first time the durable store
is used.

#### Waypoints

- <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> navigate by cumulative route distance.
- Green starts and red ends share one navigation node with coincident yellow pins.
- The map recentres when the selected pin approaches an edge, the summary, toolbars or the profile.
- **List** opens the waypoint overview with filters, nearby-point merging and local manual corrections.
- Click or press Enter on a GPS anomaly or data-gap label to zoom to it.
- A pin with photos opens a card that **is** the photo (portrait 4:3, height : width): the name and "time · elevation" sit on a bottom
  scrim, with close at the top right and a round next arrow plus a `2/9` position counter at the bottom right.
  Click anywhere on the photo for the full-size viewer; the arrow jumps to the next pin that has photos and opens
  its card in place, and is not shown when this is the only one.
- A pin without photos opens the same card family: the same 224 px width, corner radius and top-right close, the
  name and "time · elevation" at the same two type sizes. A longer description scrolls inside the card instead of
  stretching it down the map. Coordinates are no longer shown -- the pin already marks the spot, and
  exporter-injected coordinate, elevation or timestamp boilerplate in waypoint descriptions is automatically stripped
  while preserving user notes and recovering missing timestamps for the card header.
- In the full-size viewer, the top-right percentage is the displayed width divided by the source width: a
  2560 px photo shown at 640 px reads 25%, and 100% means 1:1 pixels. Use the wheel to zoom up to 800%, drag a
  zoomed photo to pan, click the percentage to fit the window again, or change photos to start over.
- The selected pin is marked by the standardized double-stroked selection reticle (diamond for waypoints, cross for
  start/end track anchors) centred on the pin tip together with a subtle warm accent glow on the pin itself.
- The first-click attachment card reuses the waypoint list's unblurred translucent background. The full-size
  viewer also keeps its dark semi-transparent surround, with duplicate panels and controls hidden.

### Elevation profile

The profile is coloured by gradient and labels its highest and lowest points. Move over the chart for elevation,
distance and time; click to pin the scrubber. Its height participates in the map's safe-area calculation.
When the track contains per-point heart rate, a **Heart rate** button appears above the chart. It starts off;
turning it on adds a red line, its own bpm range and the current reading to the hover/touch readout. Missing
readings split the line rather than inventing values. A dashed horizontal line marks the arithmetic average of
all valid heart-rate readings.

### Track summary copy

The copy icon in the track-summary heading copies a plain-text summary suitable for chat notes or route
descriptions. It includes only values the file actually provides: name, distance, date, elapsed and moving
time, moving average, ascent/descent, peak elevation and point count. Route networks copy distance, route/
segment counts and waypoint count without inventing whole-network duration, speed or elevation.

The summary card is two rows of three: distance, ascent and descent, then total time, moving average speed
and points. Distance and total time carry a blue rule on their left edge as the two values read first; the
other four stay on the secondary tier by size, weight and colour.

The `?` control in the toolbox header opens one two-column keyboard reference: `W` markers, `S` hide
interface, `A` / `D` previous or next point or photo, `Q` / `E` switch map source, `C` whole route, `M` measure,
`T` open or close the toolbox. Native control tooltips keep the relevant key without repeating shortcut
badges throughout the toolbox.

### Interface language

The toolbox header carries a single language button: a globe icon beside the language in use (`中` or `EN`),
and one click flips between Chinese and English. The tooltip names the language the click gives you, in that
language's own words — `English` on a Chinese page, `中文` on an English one. The page repaints in place, so
the map view, open panels and any measurement survive the switch and the preview is never reloaded. The choice
is remembered for the next file; without a manual choice the interface follows the system language.

### Distance measurement

Open **Toolbox** in the upper-right corner and choose **Measure distance**:

- <kbd>M</kbd> starts measuring directly; press it again while measuring to finish.
- The measurement page stays against the right edge. Overlay export and the other tool pages reuse the same
  toolbox window.
- **Back** at the top of the page returns to the toolbox menu and keeps both the measuring state and the points
  already placed, so looking at another tool does not interrupt a measurement.
- Right-click adds a point. Left-drag still pans the map, and the wheel zooms at the pointer.
- <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the last change;
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redoes it.
- Nearby waypoints, previously placed manual measurement points (excluding the active section's last vertex so
  it cannot self-snap), and recorded track samples snap to their exact coordinates within a 14 px screen radius.
  Exact ties favour `marker > measured point > track point`. While hovering, a standardized double-stroked
  reticle distinguishes the target type (diamond for waypoints, square for measured points, cross for track
  samples) alongside a lightweight snap label.
- **End section** finishes the current line, and the next right-click starts a separate section. The toolbox
  shows every section subtotal, its point count and the overall distance.
- **Undo point** removes the last point, **Clear** removes all measurements, and **Finish measuring** leaves
  the current result visible while turning off point collection.
- **Add at map centre** provides a keyboard-operable alternative to right-click.
- Section-distance labels use a translucent backing so the measured line, recorded track and basemap remain
  visible underneath.

Measurements stay in memory for the current preview. They are not written into the track file or included in
the overlay export.

### Point coordinates

Opening **Toolbox → Point coordinates** starts continuous map picking immediately. Its fixed
single-row controls offer start, end, peak and map centre:

- Start and end are the first and last recorded route points; Peak uses the same reliable-elevation test as
  route weather.
- Start, end and peak copy the coordinate, focus the map and show a pulsing point with a coordinate label.
- Opening the tool closes the current pin popup and changes the cursor to a crosshair. Any position can be
  picked repeatedly; hovering within 14 px of a marker shows the standardized diamond snap reticle and label,
  and clicking snaps to its exact coordinate while points outside the snap radius stay where clicked. Left-drag
  and wheel zoom remain unchanged; closing the coordinate window ends picking.
- **Centre** copies the current map-centre coordinate and has its own hover explanation.

Coordinates copy as six-decimal `latitude, longitude`; the panel identifies WGS-84 and never silently converts
to GCJ-02 and shows **Coordinate type: WGS-84**. **Weather here** below the latest result uses the same Windy
link builder as route weather. The map highlight and latest-coordinate card also note point elevation from the
snapped marker or track sample. Free points and the map centre explicitly say when elevation is unavailable.
Elevation is display-only and is not included in the clipboard text.

### Attachment photo export

**Toolbox → Export attachment photos** counts embedded relative files, Data URIs and HTTPS
links and offers two entries:

- **Export all photos** uses the cloud icon and includes embedded files, Data URIs and HTTPS links.
- **Export embedded photos** uses the folder icon, skips all network work and copies only embedded images.

Files are written to a `<file name>-photos` folder beside the source track; KMZ files use the archive's own
directory.

- Names contain the marker name and sequence. Duplicate names receive `-2`, `-3` and never overwrite an
  existing photo.
- Embedded files are copied directly by the host without page-side Base64 or chunk messages.
- External links run with at most three workers. Host validation is cached per domain, and one timeout or
  failure does not block the remaining batch.
- A hidden manifest records completed images. Reopening the same unchanged track skips those files and retries
  only missing or failed images; editing the source track invalidates the old manifest. The result reports
  added, already-completed and failed counts.
- Only public HTTPS images are accepted. HTTP, credentials, loopback, private, multicast, reserved and
  link-local destinations are rejected, and the response must carry a supported image signature.
- Each image is limited to 30 MB; a batch is limited to 200 images and 300 MB. The panel reports progress,
  success/failure counts and the destination folder.

### Route weather

**Route weather** in the toolbox opens [Windy](https://www.windy.com/) in the default browser **with that
point's hourly forecast panel already expanded** (temperature, feels-like, rain, wind, gusts, direction), so the
place does not have to be found again inside Windy. The segmented picker under the action decides which point
it lands on:

- **Start** and **End** jump straight to the first or last recorded point at level 14.
- **Peak** is the recorded point with the greatest elevation, also at level 14. The segment is disabled when
  the file has no elevation or less than a metre of relief across the whole route (a flat all-zero export),
  so an arbitrary sample is never presented as the peak.
- All three points use one map-pin silhouette: green play arrow for start, red square for end and amber mountain
  for peak.
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

Open **Toolbox → Export overlay**. It is a page in the shared toolbox and uses the same header, translucent
surface, Back control and close button as the other tools; there is no separate export window or shortcut.
Square, portrait and landscape PNGs are written beside the source track with transparent backgrounds and
optional ink and backing. The image includes the route name and date. Standard tracks order statistics as
distance, elapsed time, ascent, maximum elevation and moving speed.

Route networks show the document name, total route length and segment count without drawing invented start/end
points or displaying elapsed time, speed and elevation. Hover each shape choice for its dimensions and intended
use. A live low-resolution preview updates with the shape, ink and backing. Ink choices explain which photo
contrast they suit, and backing choices explain the transparency/readability tradeoff. File names include shape,
ink and backing, for example `east-west-traverse-track-1x1-white-soft.png`, so different styles do not
overwrite one another. The preview frame shows the exact canvas boundary, and the settings remain open after an
export so another style can be produced immediately.

### Track coloring, profile analysis & non-destructive editing

- **Multi-dimensional track coloring:** click the trail icon to the left of the Toolbox or press <kbd>L</kbd> to cycle **Single / Elevation / Speed / Heart rate** (automatically skipping unavailable fields).
- **Elevation profile analysis:** drag horizontally across the plot to inspect range distance, ascent/descent, grade, duration and average speed (`Esc` to clear); includes automatic ClimbPro major climb chips, quartile distance ticks and <kbd>P</kbd> shortcut collapse.
- **Responsive compact left stack:** at `≤ 720 px` width or `≤ 520 px` height, the summary pill, per-km micro-badge and `26×26` zoom/locate controls collapse together into a compact left column.
- **Four-zone non-destructive track editor:** open **Toolbox → Edit track** to trim, clean, reverse/close or edit waypoints:
  - **Top bar:** shows track name, dirty indicator, distance delta pill, Undo/Redo (<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>), Reset, integrated Layers & Pins icon toggles, and **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) with Save As or overwrite-with-backup options.
  - **Crop & Split:** switch between **Profile Crop** (dual-handle elevation range) and **Click Split** (click-to-split and segment deletion).
  - **Clean & Topology:** detect/clean GPS drift spikes, reverse direction, create out-and-back routes or close loops.
  - **Waypoints:** snap onto the track or `Alt+Click` to place freely, select from the indexed compact list, right-click a waypoint pin to delete, hover `?` for tips and expand Notes on demand.

### Large files and privacy

Long tracks keep the full route line, endpoints and viewport-sampled waypoints without creating per-sample markers, keeping pan and zoom responsive.
Track data is not sent to a server; selecting an online basemap triggers requests to that tile provider.
