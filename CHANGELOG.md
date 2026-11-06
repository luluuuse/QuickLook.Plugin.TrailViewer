# 版本更新日志 / Changelog

**1.15.11 — 2026-11-06**，本仓库的首发版本。下面这一条写的是插件**现在具备的全部能力**，不是某一次改动的
流水账。版本号沿用上游编号：`1.0.0` 是上游基线（只支持 GPX），`1.1.0` 起的开发都发生在这里。

逐版记录不随仓库发布，这里只保留当前这一版。

版本号同时决定前端所在的虚拟主机名（`app-1-15-11.gpxviewer.example`），用于绕开 WebView2 的磁盘缓存，
所以**每次升级都需要从托盘退出 QuickLook 再启动**。

**1.15.11 — 2026-11-06** is the first release of this repository. What follows describes what the plugin does
today rather than what one commit changed. The numbering continues upstream (`1.0.0` is McBenac's baseline,
GPX only); everything from `1.1.0` on was written here. This note is rewritten with every release -- it says
what the plugin is now, and the per-version log is not published. The version number is also the WebView2
virtual host (`app-1-15-11.gpxviewer.example`) that defeats the browser cache, so restart QuickLook from the
tray after every upgrade.

---

## 1.15.11 — 2026-11-06 · 首发版本 / First release

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
- 竖版窗口（高 ≥ 宽，或宽 < 960 px）折叠布局：键位提示条让位，缩放按钮和角落开关下移到摘要框下方——只在
  确实放不下时才下移，摘要框的宽度只等于它最长的一行，角落通常是空的。

- English or Chinese, following the system language on first use and switched by one button. The choice is
  remembered, and switching repaints what is already on screen without reloading the page. Dates and times
  follow the interface language, not the system one.
- In a portrait window (as tall as it is wide or taller, or narrower than 960 px) the keyboard bar makes way
  and the corner controls step down beneath the summary -- but only once they no longer fit.

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

- `http://` images do not load: the page runs on an `https://` virtual host, so mixed content is blocked
  (`https` and `data:` are fine). Relative-path images inside a `.kmz` are not supported yet.
- <kbd>Esc</kbd> closes the preview (QuickLook's key), so a full-size photo is closed with × or the backdrop.
  <kbd>←</kbd> <kbd>→</kbd> only work while the preview window has focus; <kbd>A</kbd> <kbd>D</kbd> are the
  fallback for when Explorer keeps it.
- The terrain layer comes from a service outside China: the first screen can take a few seconds, and offline it
  is a grey background that leaves the track and the profile untouched.

### 测试 / Tests

14 组脚本，全部是普通 Node 脚本，每条检查打印一行 `PASS` 或 `FAIL`：

| 套件 | 覆盖 |
| --- | --- |
| `viewer-test.cjs` | 全部样本的解析与摘要，对数 `tests/fixtures/expected.json` |
| `profile-test.cjs` / `scrub-test.cjs` | 剖面配色、极值标签、图例，光标读数与地图联动 |
| `ve-test.cjs` / `portrait-test.cjs` | 剖面高度与垂直夸大，竖版折叠布局 |
| `photo-test.cjs` / `nav-test.cjs` | 缩略图与大图、相册切换，键盘浏览标记点 |
| `pins-test.cjs` / `keys-test.cjs` | 圆点开关与记忆，快捷键 |
| `lang-test.cjs` | 中英文默认、切换、记忆、日期格式、错误页 |
| `terrain-test.cjs` / `zoom-test.cjs` / `locate-test.cjs` | 底图切换与瓦片请求，缩放步长，定位按钮 |
| `version-test.cjs` | 版本号在 csproj、元数据与两份日志之间一致 |

测试样本全部由 `tools/make-fixtures.py` 生成，不含真实轨迹。

Fourteen plain Node scripts driving the viewer in Chromium, one `PASS`/`FAIL` line per check. The fixtures are
synthetic, generated by `tools/make-fixtures.py`; no recorded track is checked in.
