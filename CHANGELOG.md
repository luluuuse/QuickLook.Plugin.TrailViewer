# Changelog

公开版本遵循 [Semantic Versioning](https://semver.org/)。每个版本分别列出中文和 English，使用
Added / Changed / Deprecated / Removed / Fixed / Security 分类；没有内容的分类可以省略。

`Unreleased` 只记录尚未进入正式版本的改动。发布前由 `scripts/release.cjs` 插入版本标题，GitHub Release
正文由 `scripts/release-notes.cjs` 从对应版本章节生成。1.16.x 的详细历史保存在
[docs/changelog/legacy-1.16.md](docs/changelog/legacy-1.16.md)。

## Unreleased

### 中文

- 暂无。

### English

- None yet.

## 1.35.0 — 2026-11-28

### 中文

#### 新增

- **多段轨迹单选查看器**：当 GPX / KML / KMZ 文件包含 2 条及以上独立轨迹（如 50 / 70 / 100 km 赛事合集包或多日行程）时，左侧摘要与每公里下方自动显示可折叠的 **轨迹** 切换入口（采用全新无圆点双分叉图标）；选中单条轨迹后保留原色高亮并自动缩放居中，其余轨迹降至低透明度作为参考线，同时按同分组文件夹或 350 米沿线邻近自动筛选当前轨迹航点，摘要统计、海拔剖面、主坡段、每公里分段、附件导出、叠加图导出、天气查询与宿主标题栏实时同步。
- **文本输入态空格保护与中文输入法选词兼容**：在页面内任意文本输入框（轨迹信息、航点编辑、自定义图源等）打字时，插件底层键盘钩子自动拦截空格键防止 QuickLook 误关预览窗口，普通输入态转发空格字符，中文输入法拼写组合态自动触发首个候选词上屏，切出输入框后按空格仍正常退出预览。

#### 变更

- **液态玻璃主题圆角与剖面图留白优化**：将 `ios` 液态玻璃主题顶层面板圆角从 `22px` 收敛至 `16px` 并同步同心收窄内部控件圆角，同时适度放宽剖面图左右内边距，消除大倒角压迫角落文字与按钮的观感。
- **剖面图折叠按钮与叠加图预览底衬精修**：剖面图右上角折叠按钮去掉常驻细边框并微调为 `20×20` 轻悬停样式，消除高 DPI 缩放下的视觉偏心感；透明叠加图预览框外层改为跟随当前主题的凹陷底色，仅白框画布内保留中灰透明棋盘格，兼顾黑/白/瑞士墨色可读性与主题一致性。
- **多轨切换性能与代码结构优化**：抽离独立的多轨视图切换与缓存控制器为 `app.js` 减负；长轨迹航点邻近匹配加入单段包围盒快速剪枝；多轨列表重绘时保持当前滚动位置与键盘焦点。

#### 修复

- **多轨反复切换越切越卡修复**：修复销毁旧路线时未从地图移除 Leaflet Canvas 渲染器导致全屏画布与地图监听持续堆积的问题，并按段缓存重算结果与及时清理脱离 DOM 的本地化节点引用。
- **普通照片航点批量误标为「观景」修复**：将通用 `camera` 图标移出「观景」识别规则，仅在名称、备注或专用观景图标明确匹配时归类为观景，避免两步路/六只脚/KMZ 导出的所有带照片航点刷屏误标。
- **宿主标题栏、菜单守卫与窗口关闭泄漏修复**：统一首屏、切子轨、覆盖保存与切语言四处同步 QuickLook 标题栏里程/爬升（无数据时清空旧后缀）；编辑态点击 `···` 菜单改为弹轻提示而非误触后台隐藏面板，预览态复制摘要改为直接调用；预览窗口销毁时统一停止延迟显示计时并解绑 `SizeChanged` 事件。
- **最简模式左侧控件重叠修复**：修正最简模式下二次布局校准未计入轨迹切换胶囊高度导致缩放按钮被遮挡的问题。

### English

#### Added

- **Multi-Track Single-Route Switcher**: Files containing 2 or more independent tracks (such as 50 / 70 / 100 km race packs or multi-day trips) now show a collapsible **Tracks** switcher below the summary/splits stack with a clean dot-free forked icon. Selecting a track highlights it in its original palette color, fits the viewport to it, dims unselected tracks as subtle reference lines, filters waypoints to the active track (matching KML folders and within 350 m along the route), and synchronizes summary stats, elevation profile, climbs, splits, attachments, overlay export, weather targets, and the QuickLook titlebar.
- **Text-Input Space Guard & Chinese IME Candidate Selection**: While typing in any in-page text input (track metadata, waypoint editor, custom map sources), the low-level keyboard hook intercepts `Space` so QuickLook does not close the preview; plain text input forwards spaces directly while active IME composition commits the first candidate cleanly, and `Space` still closes the preview normally outside text fields.

#### Changed

- **Liquid Glass Corner Radius & Profile Breathing Room**: Tightened the `ios` Liquid Glass panel radius from `22px` to `16px` with concentric inner control radii and slightly widened the elevation profile padding so corner arcs no longer crowd top labels or buttons.
- **Profile Collapse Button & Export Preview Backdrop Polish**: Switched the profile collapse button to a borderless `20×20` hover-tinted control to eliminate subpixel alignment asymmetry at fractional Windows DPI; moved the neutral mid-gray transparency checkerboard strictly inside the export preview canvas while the outer frame follows the active theme surface.
- **Multi-Track Performance & Modularization**: Extracted multi-track view caching and switching into a dedicated `track-view-controller.js` module, added per-segment bounding-box pruning to waypoint proximity matching, and preserved scroll position and focus across track list re-renders.

#### Fixed

- **Progressive Lag on Repeated Track Switching**: Properly removed Leaflet Canvas renderers from the map when tearing down track layers so orphaned full-viewport canvases and map listeners no longer accumulate, cached per-track computed view data, and pruned disconnected localized DOM references.
- **Photo Waypoints Misclassified as Viewpoints**: Removed generic `camera` icons from the `viewpoint` classification rule so ordinary photo waypoints exported by outdoor apps stay neutral unless their text or icon explicitly indicates a viewpoint.
- **Host Titlebar Sync, More-Menu Edit Guard & Reveal Leak**: Unified live `title-meta` updates across initial load, track switching, editor overwrite, and language switching (clearing stale suffixes when empty); guarded QuickLook's `···` More menu during editing with a toast and replaced DOM button clicking with direct summary copying; and unbound `WebView2.SizeChanged` via `CancelHostReveal()` on `Dispose()`.
- **Compact-Mode Zoom Overlap**: Fixed secondary layout refinement in compact mode overlooking the multi-track pill height and placing zoom buttons behind it.

## 1.32.4 — 2026-11-28

### 中文

#### 新增

- **七套完整手工主题与「外观主题」实时预览面板**：在原有三套主题基础上新增 **液态玻璃（`ios`，随底图明暗自适应）**、**极昼冰白（`nordic`）**、**林海松绿（`forest`）**与 **荒漠琥珀（`desert`）** 四套主题，并在工具箱底栏收口为「外观主题」子页入口，支持连续点击实时对比全套面板、轨迹与标题栏配色。
- **QuickLook 宿主深度集成**：支持顶部标题栏随主题与底图明暗自动切换深/浅，标题栏实时追加路线里程与累计爬升（`▲` 标记，编辑未保存时显示 `* `），标题栏 `···` 菜单新增「复制轨迹摘要」「导出透明叠加图」「导出轨迹附件」快捷项，窗口尺寸改用当前所在屏幕自适应比例。
- **全主题五态按钮与自动化视觉守门**：建立 `docs/THEME_STANDARD.md` 主题开发标准与 `npm run theme:check` 自动检查脚本；统一七套主题的按钮常态/悬停/选中/选中悬停/禁用五态反馈，补齐强调色按钮 WCAG AA（`>= 4.5:1`）对比度，并修复「每公里」顶栏悬停右侧缺口与「仅导出本地照片」悬停失效问题。

#### 变更

- **全新极简手绘风格插件图标**：重构插件图标为极简少线条的日系山野风格（保留左圆润右棱角轮廓、四象限地形配色与居中红点测绘三角），大幅提升 `16–32px` 小尺寸识别度。
- **地图设置双标签页与顶栏「添加图层」快捷入口**：将地图设置拆分为「常规」与「图源节点」双标签页以减少垂直滚动，并在地图设置顶栏的「网格」与「关闭」之间新增「添加图层（`+`）」快捷按钮。
- **默认主题与默认底图调整**：新安装默认主题调整为「经典深灰」，默认底图调整为卫星图源 **Esri World Imagery**（已手动切换过主题或底图的用户偏好保持不变）。
- **全链路性能优化（冷启动、长轨迹、编辑内存与宿主缓存）**：编辑器撤销栈消除冗余双倍深拷贝并对航点/元数据编辑启用轨迹结构共享（超 2 万点轨迹历史收紧至 20 步）；照片全览灯箱、叠加图导出及无图文件的附件导出模块改为按需懒加载；航点沿轨重排改用空间索引加速；8,000 点以上长轨迹自动切换 Canvas 渲染并缓存路网源点计数与飞点检测结果；C# 瓦片缓存复用目录枚举元数据与线程局部 SHA256；导出序列化坐标/海拔格式化去正则化提速。
- **多段连续轨迹起终点智能合并**：对顺序排列的多段轨迹（如中途暂停续录导出的多段 `<gx:Track>`），相邻两段首尾间距在 500 米以内时自动隐藏交界处的红绿起终点（保留既有断档提示），仅展示整条路线的总起点与总终点；相距较远的独立支线仍保留各自起终点。
- **全场景聚焦轨迹与安全区对齐统一**：排除左上角摘要/分段/缩放面板对整行顶部安全区的压占，释放更多画布高度让轨迹更舒展；为「回到整条轨迹（C）」、分段/爬坡/编辑聚焦与航点切换统一加入平缓移动过渡（跟随系统减少动态设置）；修复首次打开文件或窗口缩放时全览聚焦被异步重排取消的问题，同步统一编辑模式多段轨迹聚焦、退出编辑自动重聚焦及全览态折叠/展开剖面图（`P`）重算。
- **海拔剖面图悬停防误触门控**：放大查看轨迹时，快速纵向划过剖面图移向桌面任务栏不再触发视野跳动；仅在剖面图内停留约 200 ms 或横向扫动后启动地图跟随平移，单击剖面图仍立即定位。
- **点位坐标支持吸附轨迹点与轻提示统一**：复制点位坐标拾取模式同时支持吸附航点与轨迹点（同距离下航点优先），悬停显示对应菱形/十字准星与标签并带出源点海拔；底部操作提示同步统一为与轨迹编辑一致的紧凑键帽胶囊样式。

#### 修复

- **定制图源列表悬停割裂修复**：修复图层菜单通用按钮悬停样式覆盖定制图源行的问题，改为整行统一响应悬停，已选中的图源在悬停时保持强调色底色与清晰边框，不再出现左灰右蓝的割裂块。
- **测距模式吸附起终点与航点无法打点修复**：测距开启时改为在地图捕获阶段优先处理左键打点、自动关闭已开弹窗并在交互元素上保持十字光标，修复吸附起点、终点或航点时左键被标记弹窗拦截导致无法打点的问题。
- **工具箱与图源面板滚轮穿透修复**：拦截图源切换菜单与工具箱浮层内的滚轮事件冒泡，修复「检查更新」更新日志区域无法用鼠标滚轮滑动并误触发底图缩放的问题，同时为更新日志区隔离滚动边界避免连带滚动外层面板。

### English

#### Added

- **Seven Manual Themes & Live Appearance Preview Panel**: Expanded the theme library with **Liquid Glass (`ios`, adaptive to basemap tone)**, **Nordic Ice (`nordic`)**, **Alpine Forest (`forest`)**, and **Desert Amber (`desert`)**, and consolidated theme switching into a dedicated Toolbox **Appearance** panel for instant side-by-side preview of panels, tracks, and titlebar tones.
- **Deeper QuickLook Host Integration**: Synced QuickLook's native titlebar Light/Dark theme with the active theme and basemap tone, enriched the titlebar with live distance/ascent (`▲`) metadata (plus `* ` dirty indicator during editing), added **Copy track summary**, **Export overlay PNG**, and **Export attachments** to QuickLook's `···` More menu, and adopted per-monitor adaptive window sizing.
- **Unified 5-State Button Polish & Automated Theme Guardrail**: Added `docs/THEME_STANDARD.md` and `npm run theme:check` to enforce 5-way theme sync, token parity, and WCAG AA (`>= 4.5:1`) contrast across all seven themes; upgraded accent fill/hover contrast, unified selected-hover and measure button states, and fixed the expanded Splits header hover gap and local-photo export hover feedback.

#### Changed

- **Minimal Alpine Plugin Icon**: Redesigned the plugin icon with minimal strokes and clean flat alpine colors while preserving the asymmetric silhouette, four-quadrant palette, and central red-dot triangulation mark for crisp `16–32px` legibility.
- **Tabbed Map Settings & Header Add-Layer Shortcut**: Split Map Settings into **General** and **Map nodes** tabs to reduce scrolling, and added a quick **Add layer (`+`)** button between the no-map grid toggle and close button in the Map Settings header.
- **Default Theme & Basemap**: Changed the fresh-install default theme to **Classic Dark** (`classic`) and the default basemap to **Esri World Imagery** (`satellite.esri`), while preserving existing user-saved preferences.
- **End-to-End Performance Optimizations (Startup, Long Tracks, Editor Memory & Tile Cache)**: Removed redundant double deep-cloning in the editor undo stack with structural sharing for waypoint/metadata edits (capping history to 20 steps above 20k points); lazy-loaded the photo lightbox, overlay exporter, and photo-less attachment exporter on demand; accelerated along-track waypoint sorting with spatial indexing; enabled Canvas rendering for tracks with `>= 8,000` points and cached network source-point counts and anomaly detection results; reduced Win32 metadata syscalls and per-tile `SHA256` allocations in `TileCache.cs`; and replaced regex-heavy coordinate/elevation formatting in track serializers.
- **Smart Start/End Deduplication for Stitched Multi-Track Routes**: When consecutive tracks (such as pause/resume `<gx:Track>` segments) connect within 500 m, intermediate junction start/end dots are suppressed so only the route's overall start and end markers remain visible, while distant independent tracks keep their own endpoints.
- **Unified Route Focusing, Expanded Safe Area & Smooth Motion**: Excluded top-left corner panels (summary card, splits toggle, zoom/locate) from pushing down the full-width top safe boundary so routes fit larger and higher on screen; added gentle ease-out pan/zoom transitions (~350 ms, respecting `prefers-reduced-motion`) to **Fit the whole track (`C`)**, segment/climb/editor focusing, and waypoint selection; fixed initial open and window resize losing home refit, and aligned editor multi-track focusing, post-edit refit, and profile collapse/expand (`P`) refit.
- **Elevation Profile Hover Anti-Accidental-Pan Gate**: Sweeping vertically across the elevation profile toward the taskbar while zoomed in no longer jumps the map view; map following activates after ~200 ms of dwell or intentional horizontal scrubbing, while clicking the profile still pans immediately.
- **Coordinate Picking Track Snapping & Unified Hint Capsule**: Map coordinate picking now snaps to both waypoints and track points (waypoints win ties), showing the matching diamond/cross reticle and source elevation; its bottom hint now matches the compact key-cap capsule style used by track editing.

#### Fixed

- **Custom Source Row Hover Split**: Fixed the generic layer-menu button hover rule overriding `.layer-custom-select:hover` with an opaque gray fill inside active rows; custom source rows now highlight cohesively across the full card while preserving the selected accent background on hover.
- **Distance Measurement Click on Start/End & Waypoint Markers**: Handled primary measurement clicks in the map container capture phase (closing any open popup on start and keeping the crosshair cursor over interactive layers), fixing clicks snapped to start/end or waypoint markers being swallowed by marker popups instead of placing points.
- **Toolbox & Layer Panel Wheel Scroll Propagation**: Disabled Leaflet scroll propagation on the Toolbox and Layer Switcher control panels so mouse-wheel scrolling works inside the Check Updates release notes (and scrollable menus) without zooming the underlying map, and added `overscroll-behavior: contain` to keep release-notes scrolling isolated from the outer panel.

## 1.32.1 — 2026-11-27

### 中文

#### 新增

- **「气象与山景」双分类五平台外链卡**：重构工具箱天气卡，右上角支持在 **天气**（Windy / Ventusky / Zoom Earth）与 **山景**（PeakFinder / ShadeMap）之间一键切换并独立记忆偏好，零网络请求、零 API Key；各平台按徒步最擅长场景直达对应视图（Windy 14 级云层逐小时预报、Ventusky 点位实时与 14 天卡片、Zoom Earth 9 级实时卫星定点卡片、PeakFinder 360° 认山与日出日落并自动带入点位海拔、ShadeMap 13 级真实地形阴影）。
- **站点图标、悬停简介与氛围微动效**：为 5 个气象/山景站点补齐专属线条图标、双语悬停简介、右侧 `↗` 外链引导及三套主题独立调校的静息氛围背景与悬停微动效（跟随系统减少动态设置）。
- **工具箱与图层面板制图底纹**：为上方 4 格快捷工具（测距刻度 / 坐标网格 / 透明棋盘 / 相册角标）、「编辑轨迹」及图层面板四大分类与三大户外叠加层统一加入克制制图底纹（地形面板采用自然不规则矢量等高线）。
- **无底图模式 `X` 快捷键**：按 `X` 一键开关无底图测绘网格模式并自动记忆/恢复上次图源，同步接入 QuickLook 宿主按键转发与工具箱快捷键速查表。
- **编辑模式底部操作提示胶囊**：手绘补线、框选擦除、顶点精修、点击拆分与环线改起点下，底部居中渲染半透明操作提示胶囊（抽屉折叠后依然可见，窄窗自动精简，并与轻提示自动垂直避让）。
- **照片灯箱多图缩略图导览条**：同一航点含多张照片时，全览灯箱底部居中展示可点击缩略图导览条（支持直跳、高亮当前项与多图横向滚动），同时加深背板并叠加柔和模糊隔离底图。
- **轻提示语义色条与上浮微动效**：轻提示从屏幕正中移至底部轻挂（自动避开海拔剖面与编辑提示胶囊），新增上浮入场动效与左侧语义状态色条（成功/警告/错误/信息）。

#### 变更

- **工具箱排序与点位坐标联动优化**：将「编辑轨迹」移至四格快捷工具下方、「气象与山景」正上方；气象卡与点位坐标页的点位按钮统一调整为 **起点 / 顶点 / 终点** 顺序；点位坐标页「中心」改为聚焦并复制**轨迹几何中心**，底部快捷按钮动态显示当前所选气象/山景平台名。
- **设计系统与视觉层次全量精修**：三套主题统一收口直角体系、6 级整数语义字号（可读文字全面 ≥ 10px）、中英文与等宽数字字体栈、4px 基准间距网格、5px 极细主题滚动条、全控件键盘焦点环、原生表单主题化及 3 级海拔阴影。
- **对比度与色彩语义升级**：补齐瑞士纸镜、冷岩墨与基础深色三套主题核心令牌的 WCAG AA 对比度；修复浅色纸镜下航点标签、受限/错误提示与心率读数发白问题；纸镜编辑器激活态切为测绘钴蓝以解耦红色危险态，移除硬编码亮绿按钮，并升级 12 色沉稳多段轨迹测绘色板。
- **统一响应式断点与双向微动效**：全站对齐 `420px / 720px / 1080px` 三档断点；为浮层与照片灯箱补齐双向开合微动效、按钮按压回弹与 160ms 主题平滑漫变；编辑浮层纳入拖图毛玻璃降级，KMZ 打包与更新下载进度条改走 GPU 合成层缩放。

#### 修复

- **WebView2 快速开关卡顿与 `0x80080005` 启动报错修复**：关闭预览后将已清空画布的 WebView2 空白空壳短暂保活 15 秒（空闲或退出 QuickLook 时自动释放），消除连续“关闭再马上打开”时的 4–6 秒浏览器进程退出等待；同时监听浏览器进程退出事件自动失效旧环境，并在启动冲突时自动退避重试。
- **窄窗关闭工具箱防误拉回旧焦点**：在工具箱布局刷新回调中关闭自动焦点回滚，修复 360 px 窄窗下关闭工具箱时地图意外拉回旧聚焦点的问题。
- **顶部工具栏锐利边缘与跨按钮防重叠**：将顶部工具栏外轮廓改为 1px 实体边框并收口到按钮本体，消除小数倍 DPI 缩放下的边缘发虚与图层按钮右侧毛刺；收紧航点拼接按钮裁剪范围，修复悬停列表时图层按钮右侧出现阴影误采样加深的问题。
- **冷岩墨主题顶部按钮激活态叠色修复**：为工具箱与图层切换按钮的激活态补齐深色底板叠层，使其与右侧航点/列表激活态色彩完全一致。
- **连续轻提示淡出竞态修复**：连续触发新轻提示时同步清理上一次的隐藏计时器，避免新提示被提前关闭。
- **端到端浏览器测试套件全量对齐**：同步更新工具箱、点位坐标、灯箱与主题相关的浏览器自动化测试断言，确保 GitHub Actions 构建与发布流水线全绿通过。

### English

#### Added

- **"Weather & Sun" Dual-Category 5-Platform Card**: Refactored the Toolbox weather card with a **Weather** (Windy / Ventusky / Zoom Earth) and **Sun** (PeakFinder / ShadeMap) toggle with per-category local persistence, zero network requests, and zero API keys; each platform opens its best hiking view (Windy zoom-14 clouds + hourly forecast, Ventusky point route with live & 14-day card, Zoom Earth zoom-9 live satellite with pinned hourly card, PeakFinder 360° horizon & sun path with automatic point elevation, and ShadeMap zoom-13 real DEM terrain shadows).
- **Provider Icons, Hover Tooltips & Ambient Micro-Motion**: Added dedicated line icons, bilingual hover descriptions, `↗` external-link cue, and theme-calibrated ambient tints with subtle hover-only micro-animations (respecting `prefers-reduced-motion`).
- **Cartographic Textures for Toolbox & Layer Panels**: Added restrained, hover-revealed cartographic textures to the 4 quick-tool cards, Edit Track card, and Layer panel categories/overlays (including an organic irregular topographic contour vector backdrop for Terrain).
- **`X` Shortcut for No-Map Mode**: Press `X` to toggle the local no-map survey grid and restore the previous basemap, wired through both the viewer and QuickLook host key forwarding and added to the Toolbox shortcut reference.
- **Interactive Editor Key-Hint Capsule**: Displays a translucent bottom-center gesture/key hint capsule during hand-draw, box-erase, vertex-edit, click-split, and loop-start modes (stays visible when the drawer is collapsed, compacts on narrow windows, and stacks cleanly below toasts).
- **Photo Lightbox Backdrop & Thumbnail Strip**: Deepened the full-screen lightbox backdrop with subtle blur for crisp separation over light maps, and added a clickable bottom thumbnail strip with active highlighting and horizontal scrolling for multi-photo waypoints.
- **Bottom-Docked Semantic Toasts**: Moved toasts from screen center to a bottom-center anchor above the elevation profile and editor hint capsule, adding a slide-up entrance and left semantic status accent bar (info/success/warn/error).

#### Changed

- **Toolbox Order & Point Coordinates Sync**: Moved Edit Track below the 4 quick tools right above Weather & Sun; unified point button ordering to **Start / Peak / End** across Weather & Sun and Point Coordinates; changed Coordinate **Centre** to focus and copy the **track bounding-box centre**, and updated the coordinate shortcut button to dynamically display the active Weather & Sun service.
- **Design System & Visual Hierarchy Polish**: Unified corner radii across themes, converged typography to a 6-step integer scale (readable text ≥ 10px) with explicit sans/mono font stacks, adopted a 4px spacing grid, unified 5px themed scrollbars, expanded `:focus-visible` coverage, themed native form controls, and replaced hardcoded shadows with 3 elevation tokens.
- **Contrast & Color Semantics**: Raised core theme tokens to WCAG AA contrast across Swiss Paper, Slate Dark, and Classic Dark; fixed washed-out waypoint tags, status warnings, and HR readouts on light parchment; switched Swiss editor active accents to cartographic cobalt to decouple from danger red, unified editor primary buttons, and upgraded the 12-color multi-segment track palette.
- **Unified Breakpoints, Motion & GPU Performance**: Aligned responsive breakpoints to `420px / 720px / 1080px`; added bidirectional enter/exit transitions for overlays and the photo lightbox, tactile button press feedback, and scoped 160ms theme crossfades; extended map-drag backdrop degradation to editor overlays and switched KMZ/update progress bars to GPU-composited `scaleX`.

#### Fixed

- **WebView2 Rapid Close/Reopen Stalls & `0x80080005` Recovery**: Added a 15-second blank-shell keep-alive after closing a preview (released automatically when idle or when QuickLook exits) to eliminate 4–6 s browser shutdown waits on rapid close/reopen, paired with `BrowserProcessExited` environment invalidation and automatic backoff retry on startup conflicts.
- **Prevent Narrow-Window Toolbox Close Map Recall**: Passed `revealFocus: false` in the toolbox layout-change callback so closing the toolbox in 360 px narrow viewports never recalls an older focused point.
- **Crisp Toolbar Borders & Backdrop Isolation**: Replaced spread-shadow toolbar outlines with crisp 1px borders directly on toggle buttons to eliminate fractional-DPI edge blur and right-edge burrs, and tightened joined waypoint clip bounds so hovering the list button never causes backdrop shadow bleed onto the layer toggle.
- **Slate Dark Active Toggle Compositing**: Stacked the translucent active tint over the dark toolbar surface on the layer and toolbox toggles so their active appearance matches the waypoint and list toggles.
- **Consecutive Toast Timer Race**: Cleared any pending fade-out hide timer when a new toast fires so rapid consecutive toasts are never hidden prematurely.
- **Browser E2E Suite Alignment**: Updated Playwright assertions across toolbox, coordinates, lightbox, and theme suites to match the v1.32 UI polish and pass GitHub Actions cleanly.

## 1.31.2 — 2026-11-26

### 中文

#### 新增

- **航点列表带图片筛选**：航点速览筛选菜单新增「带图片」类型，按需展示含照片航点数量并支持中英文切换。
- **轨迹基础信息编辑**：编辑模式顶栏标题支持点击展开「轨迹信息」浮层，可修改轨迹标题、活动类型与轨迹简介并接入撤销/导出；信息卡展开详情后支持长简介 4 行折叠与限高滚动。

#### 变更

- **海拔平滑算法升级**：去尖刺纳入首尾点以修正开表瞬间气压漂移，滑动平均改为按空间距离加权避免原地停顿点簇权重失衡。
- **TCX 运动类型映射与导出提醒**：TCX 导出按活动类型映射标准 `Sport` 属性；无时间戳轨迹选择 TCX 导出时在保存浮层给出明确提醒。
- **瑞士纸镜裁剪遮罩适配**：海拔剖面裁剪遮罩接入主题变量，浅色纸镜主题下采用柔和冷灰半透明遮罩。

#### 修复

- **更新器异常兜底与安全校验**：捕获代理或认证页返回非 JSON 导致的解析异常并支持双源平稳回退；复验下载重定向落地域名并收紧 SHA256 提取正则。
- **KML 航点图标与简介换行兼容**：内部航点符号键改为写入 `ExtendedData` 并支持回读，避免第三方地图软件显示破图；保留 KML 轨迹简介原有段落换行。

### English

#### Added

- **Photo Filter in Waypoint Overview**: Added a "With photos" filter option in the waypoint overview menu with dynamic counts and full localization.
- **Track Metadata Editing**: Clicking the track title in the editor topbar opens a Track Info popover to edit title, activity type, and description with undo/redo and multi-format export support; long descriptions collapse to 4 lines in the info card and scroll within a bounded height when expanded.

#### Changed

- **Distance-Weighted Elevation Smoothing**: Extended median despiking to track endpoints to catch startup barometer spikes, and switched the moving average from index weights to spatial distance weights.
- **TCX Sport Mapping & Timestamp Notice**: Mapped track `activityType` to standard TCX `Sport` values and added an explicit notice in the save popover when exporting timestamp-free tracks to TCX.
- **Theme-Aware Crop Mask**: Extracted the elevation profile crop dim overlay to a theme token with a softer cool-gray wash under the Swiss Paper light theme.

#### Fixed

- **Updater Resilience & Security Hardening**: Caught non-JSON parse exceptions from captive portals or proxies for graceful dual-source fallback, re-validated final redirect hosts on package downloads, and tightened SHA256 extraction.
- **KML Waypoint Icon & Description Formatting**: Stored internal waypoint icon keys in `ExtendedData` with round-trip parsing instead of writing invalid `<Icon><href>` URLs, and preserved paragraph line breaks in KML document descriptions.

## 1.31.1 — 2026-11-25

### 中文

#### 修复

- **对齐底栏品牌图标尺寸测试**：同步工具箱底栏新山岳品牌图标的尺寸断言，确保发布流水线自动化测试通过。

### English

#### Fixed

- **Aligned Footer Brand Icon Size Test**: Updated the toolbox footer brand icon dimension assertion to match the sculpted alpine specimen icon so release verification passes cleanly.

## 1.31.0 — 2026-11-25

### 中文

#### 新增

- **三套手动主题体系**：新增 **瑞士纸镜**（默认）、**冷岩墨** 与 **基础深色** 三套手工调校主题，可在工具箱底栏通过微缩主题色卡一键切换，并由宿主持久保存偏好，不再随底图自动跳变。
- **瑞士测绘视觉精装与实时比例尺**：纸镜与岩墨主题采用建筑直角浮层、朱红顶线、四角定位刻度、四段交替比例尺及实时 `1 : N` 比例尺分母；同步升级白边朱红轨迹、海拔极值测绘三角标与无底图双尺度测绘网格。
- **全新瑞士山岳品牌图标**：内置无边框「精雕山岳标本 + 炭墨盘山小径 + 白底墨框红心」矢量图标，融入工具箱底栏与检查更新卡片，并配以克制的地形晕染与等高线暗纹。
- **叠加图瑞士风格墨色**：叠加图导出新增 **瑞士** 墨色预设（炭墨文字、暖白渐变衬底与白边朱红轨迹）。

#### 变更

- **工具箱底栏与检查更新卡片重排**：将主题色卡收进工具箱底栏，品牌区采用「TrailViewer + 版本号」双行排版；检查更新卡片同步升级图标与右对齐状态提示；三套主题的工具箱功能图标各自配备独立配色（纸镜松林绿、岩墨高山暖金、基础电光蓝）。
- **海拔剖面交互浮条适配**：刷选统计浮条、裁切与关闭按钮及主坡段/心率胶囊全面适配三套主题色彩与对比度。

#### 修复

- **修复初始加载竞态**：修正首次打开轨迹时航点、公里标及缩放适配偶发漏显或延迟的问题。
- **修复图层列表与单色图标显示异常**：修正未选图源文字色调不一致的问题，以及浅色主题下单色轨迹切换图标对比度过低难以辨认的问题。

### English

#### Added

- **Three Manual Interface Themes**: Introduced **Swiss Paper** (default), **Slate Dark**, and **Classic Dark** themes with miniature card swatches in the Toolbox footer and persistent host-side preference storage, never auto-switching when basemaps change.
- **Swisstopo Cartographic Styling & Live Scale Ratio**: Added architectural panel geometry, Swiss vermilion top accent rules, four-corner micro registration ticks, a four-segment alternating scale bar with live `1 : N` cartographic scale ratio, white-cased vermilion tracks, elevation extremum survey triangles, and a dual-scale no-map survey grid for Swiss Paper and Slate Dark.
- **New Alpine Specimen Brand Icon**: Added a borderless sculpted four-biome alpine peak icon with a winding charcoal switchback trail and Swiss survey summit mark across the Toolbox footer and Update card, paired with subtle terrain-tinted contour backgrounds.
- **Swiss Ink Preset for Overlay Export**: Added a **Swiss** ink option for PNG route overlays featuring charcoal typography, warm ivory backing wash, and white-cased vermilion route lines.

#### Changed

- **Redesigned Toolbox Footer & Update Card**: Moved the miniature theme swatches into the Toolbox footer with two-line `TrailViewer` + version lockups and right-aligned status text in the Update card; gave each theme distinct Toolbox action-icon palettes (alpine green for Swiss Paper, warm gold for Slate Dark, electric blue for Classic Dark).
- **Theme-Aware Elevation Profile Controls**: Updated the range brush readout bar, crop/close controls, and ClimbPro / heart-rate chips to adapt cleanly across all three themes.

#### Fixed

- **Fixed Initial Load Race Conditions**: Resolved sporadic missing waypoints, kilometre labels, or delayed initial zoom fits on first track load.
- **Fixed Layer Menu & Single-Color Icon Contrast**: Fixed inconsistent dimmed text styling on unselected layer providers and low-contrast single-color track mode icons on light themes.

## 1.30.2 — 2026-11-25

### 中文

#### 新增

- **国内 GitCode 镜像双源更新**：检查更新新增 GitCode 国内镜像源并与 GitHub 并行竞速，单边超时或不可达时自动无缝回退；下载安装包失败时同步回退到备用镜像，显著提升国内网络下的检查与下载稳定性。
- **安装包 SHA256 强校验**：下载 `.qlplugin` 安装包后自动核对官方发布说明中的 SHA256 哈希与插件清单完整性，防篡改、防下载截断。

### English

#### Added

- **GitHub + GitCode Dual-Source Update Fallback**: Update checks now race GitHub Releases and the GitCode mirror with automatic failover for both metadata lookup and `.qlplugin` package downloads, improving reliability on mainland China networks.
- **SHA256 Package Verification**: Downloaded `.qlplugin` packages are now verified against the published SHA256 checksum in addition to manifest archive validation before handing off to QuickLook.

## 1.30.1 — 2026-11-25

### 中文

#### 变更

- **优化检查更新角标与按钮视觉**：将顶部工具箱入口的更新圆点改为 5px 柔和青蓝微光点，底部发现新版按钮改为清新翠绿描边胶囊（`↑ vX.Y.Z`），更贴合暗色玻璃态界面；同步更新「编辑轨迹」卡片副标题以反映多格式导出能力。

#### 修复

- **修复更新圆点误覆盖底部按钮文字**：收紧工具箱角标样式选择器，避免圆点错误挂载到底部版本胶囊上遮挡版本号末尾数字。

### English

#### Changed

- **Refined Update Indicator & Badge Styling**: Replaced the red dot with a subtle 5px cyan glow dot on the top Toolbox button and restyled the footer update pill as a soft emerald badge (`↑ vX.Y.Z`) matching the dark glass theme; updated the Edit Track card subtitle to reflect multi-format export.

#### Fixed

- **Prevented Update Dot from Overlapping Footer Pill Text**: Scoped the corner indicator selector strictly to the top-level Toolbox toggle button so it no longer renders over the version number inside the footer update pill.

## 1.30.0 — 2026-11-25

### 中文

#### 新增

- **内置检查更新与一键下载安装**：工具箱底部新增当前版本栏与「检查更新」入口，默认每 24 小时在后台静默检查 GitHub Releases；发现新正式版时仅在顶部工具箱图标右上角亮起小红点提醒，绝不弹窗打断预览。
- **双语更新详情与忽略版本**：点击进入更新详情页可查看当前版本 → 最新版本对比、发布日期与按当前界面语言自动提取的更新摘要，并支持「忽略此版本」消除角标。
- **安全下载并调起 QuickLook 原生安装**：点击「下载并安装」后由宿主带进度条下载 `.qlplugin` 安装包，严格校验 GitHub 官方域名与插件包清单完整性，随后直接交由 QuickLook 原生插件窗口完成安装；断网或被限流时提供「打开发布页」兜底。

### English

#### Added

- **Built-in Update Checker & One-Click Package Download**: Added a compact version bar and "Check updates" entry at the bottom of the Toolbox with quiet 24-hour background checks against GitHub Releases. When a newer stable release is found, a subtle red dot appears on the Toolbox button without interrupting preview.
- **Bilingual Release Notes & Version Muting**: The update subview compares the installed and latest versions, renders release notes in the active interface language, and lets you mute a specific release.
- **Verified Download & Native QuickLook Installer Handoff**: Clicking "Download & install" streams the `.qlplugin` package with progress reporting, verifies the GitHub HTTPS allowlist and plugin manifest archive integrity, and launches QuickLook's native plugin installer (with a browser fallback to the Releases page).

## 1.29.0 — 2026-11-25

### 中文

#### 新增

- **多格式轨迹导出与离线 KMZ 打包**：编辑器支持导出 GPX、KML、KMZ、GeoJSON、TCX 和 CSV 六种格式；导出 KMZ 时可选下载并打包外链 HTTPS 照片，实时展示下载与打包进度，失败项自动保留原链。
- **KML / KMZ 完整保留时间与心率**：带时间戳或心率的轨迹自动导出为标准 `<gx:Track>`（含 `<when>` 与 `gx:SimpleArrayData` 心率数组）及航点图标样式，KML 解析器同步支持读取心率数组，FIT 等活动记录转存 KML/KMZ 不再丢数据。
- **同格式原地覆盖（GPX / KML / KMZ）**：编辑 GPX、KML、KMZ 时默认跟随原文件格式导出并允许同格式覆盖（首次覆盖前自动保留 `.bak` 备份），跨格式导出自动禁覆盖以防写坏原文件。
- **手绘补线工具**：支持地图左键打点、撤回一笔与吸附轨迹/航点，自动识别区段替换、闭合起终点缺口、端点续画或追加新分段。
- **外部轨迹拼接**：支持在编辑器内导入本地 GPX / KML 文件，提供同目录快捷拼接与可选的就近自动翻转合并为单段。
- **海拔平滑与坡度估算虚拟时间轴**：提供轻度、标准、强力三档海拔平滑并实时预览累计爬升变化；虚拟时间轴支持按坡度（Naismith 规则）估算各段用时。
- **航点批量工具**：支持沿轨迹里程自动重排、20 米内重复航点去重，以及按里程间隔批量生成里程/最高点航点。
- **每公里分段抗极值柱形图**：运动速度、垂直速度与单公里时间三列自动按四分位距识别坐车/长休等离群极值，正常徒步段恢复线性满宽对比，超限异常段以满格斜纹与侧边竖条标识。
- **照片灯箱外部打开**：新增「在浏览器中打开」入口，方便查看原图或外链图片。

#### 变更

- **编辑器工具栏重组与交互打磨**：归类为「剪辑拼接、清洗优化、路线方向、绘制修点、航点」五大模块；多段轨迹自动分配高区分度配色；框选擦除实时显示待删轨迹点与航点数量；KMZ 预览与打包图片上限统一放宽至 1000 张 / 1 GB（单包上限 1088 MB）。

#### 修复

- **修复另存为弹窗吞字与多图 KMZ 卡界面**：弹出保存对话框期间自动屏蔽全局快捷键；KMZ 打包读图与压缩移至后台线程执行。
- **修复 KMZ 打包链接前缀破坏、同名图碰撞与根目录路径解析**：改为单遍边界精确替换并优先保留直接本地图路径，防止跨目录同名图静默覆盖原图；修复盘符根目录下的本地图解析及大相册外链增量内存控制。
- **修复编辑器与解析边界问题**：修复 GPX 普通网页 `<link>` 误判为照片、KML 多边形 `<LinearRing>` 未闭合、正向轨迹拼接未清理倒流时间戳、保存中退出/重开竞态、点绘制图标折叠抽屉清空草稿，以及手绘吸附轨中航点丢失轨迹锚点的问题。

### English

#### Added

- **Multi-Format Track Export & Offline KMZ Packing**: Export edited tracks as GPX, KML, KMZ, GeoJSON, TCX, or CSV. KMZ export optionally downloads and packs remote HTTPS photos with live progress reporting while keeping failed links intact.
- **Full KML / KMZ Time & Heart-Rate Round-Trip**: Tracks with timestamps or heart rate export as standard `<gx:Track>` with `<when>` and `gx:SimpleArrayData` heart-rate arrays plus waypoint icon styles, and the KML parser now reads heart-rate arrays back so FIT-to-KML/KMZ exports keep telemetry intact.
- **Same-Format Overwrite for GPX / KML / KMZ**: The save popover defaults to the source track's format and allows overwriting GPX, KML, and KMZ files in place (creating a `.bak` backup on first overwrite) while blocking cross-format overwrites.
- **Hand-Drawn Path Tool**: Click-to-draw path editing with step undo and track/waypoint snapping, automatically splicing span replacements, closing loop gaps, extending endpoints, or appending branches.
- **External Track Append**: Import local GPX / KML files or pick sibling tracks in the same folder, with optional nearest-endpoint auto-flip and single-segment merging.
- **Elevation Smoothing & Grade-Adjusted Timeline**: Light, standard, and strong elevation smoothing with live ascent preview, plus Naismith grade-adjusted virtual timeline generation.
- **Waypoint Batch Tools**: Sort waypoints along the track, merge duplicates within 20 m, and batch-generate distance milestone and summit waypoints.
- **Outlier-Resistant Split Bars**: Moving speed, vertical speed, and split time columns now use an IQR-based scale so isolated car-ride or long-rest spikes no longer crush normal hiking bars; capped outliers display a diagonal hatch and edge marker.
- **Open Photo in Browser**: Added an external browser button to the photo lightbox.

#### Changed

- **Reorganized Editor Rail & Polish**: Grouped tools into Clip & Merge, Clean & Optimize, Route Direction, Draw & Refine, and Waypoints; added distinct multi-segment colors and live box-erase deletion counts; aligned KMZ photo limits to 1000 images / 1 GB (1088 MB archive cap).

#### Fixed

- **Save Dialog Shortcut Leakage & UI Blocking**: Suppressed global shortcuts while `SaveFileDialog` is open and moved KMZ archive assembly off the WPF UI thread.
- **KMZ Reference Replacement, Name Collisions & Drive-Root Paths**: Replaced global substring substitution with single-pass boundary-safe replacement, reserved direct local entry paths before remapped images, fixed drive-root path resolution, and enforced incremental byte budgeting during remote photo downloads.
- **Parser & Editor Edge Cases**: Stopped non-image GPX `<link>` URLs from being treated as photos, auto-closed KML `<LinearRing>` polygons, cleared non-monotonic timestamps on forward track merges, guarded against async save/close races, preserved draw drafts when collapsing the Draw drawer, and kept track anchors when snapping to mid-track waypoints.

## 1.28.2 — 2026-11-24

### 中文

#### 修复

- **图源节点检测改为宿主直连真网络探测**：桌面端由宿主直接发起真实网络请求测速，彻底绕过浏览器 HTTP 缓存与本地磁盘瓦片缓存，修复重测命中缓存出现假 10 ms、断网仍显示可达以及 Esri 双节点串缓存的问题。
- **修复 `.NET Framework 4.6.2` 宿主默认 TLS 握手失败**：在宿主网络请求初始化前显式启用 TLS 1.2 / 1.3 并将默认每域名并发连接上限提升至 16，同步覆盖节点探测、过期瓦片刷新与外链照片导出。
- **节点检测限流并发与区分超时**：将检测并发收紧为 4 路排队、单节点超时放宽至 10 秒，避免慢网下与地图加载抢带宽导致集体误判，并明确区分「超时」与「不可达」。
- **航点照片预览提速**：本地瓦片缓存拦截范围收窄至已注册的内置与定制地图图源域名，不再跨进程拦截本地 KMZ 照片与外部航点图片；航点缩略图和全屏大图设为最高加载优先级并去掉来源头，全屏看图后自动后台预载下一张。

### English

#### Fixed

- **Direct Host Network Probing for Map Nodes**: Desktop node checks now probe tile endpoints directly from the host, bypassing both WebView2 HTTP cache and the local disk tile cache to eliminate false ~10 ms cached readings, offline false positives, and cross-cached Esri nodes.
- **Explicit TLS 1.2 / 1.3 Enablement on .NET Framework 4.6.2**: Enabled TLS 1.2 / 1.3 and raised the default per-host connection limit to 16 before host HTTP calls, fixing TLS handshake failures for node probing, stale tile refresh, and external photo downloads.
- **Bounded Probe Concurrency & Distinct Timeout Status**: Capped node probing to 4 concurrent requests with a 10-second timeout to prevent bandwidth contention on slow networks, and separated `Timeout` from `Offline` status labels.
- **Faster Waypoint Photo Preview**: Narrowed WebView2 tile-cache request interception to registered built-in and custom map hosts so KMZ and external waypoint photos bypass cache IPC; set waypoint thumbnails and full-screen photos to high fetch priority with `no-referrer`, and added lightweight next-photo preloading in the photo viewer.

## 1.28.1 — 2026-11-23

### 中文

#### 新增

- **地图节点切换与按需测速**：在「地图设置」中为 OpenStreetMap（官方 CDN / HOT / 德国节点）、OpenTopoMap（官方 / OpenMaps 镜像）和 Esri 影像（Server / Services 节点）提供多节点切换与单节点实时连通性检测。
- **内置底图扩展与透明户外叠加层**：新增 **Esri 浅灰 / 深灰底图**（路网）和 **Esri 世界地形图**（地形），并新增 3 套可自由叠放的透明户外叠加层（**Waymarked 徒步路线**、**Waymarked 骑行路线**、**OpenSnowMap 雪道**），全部接入本地瓦片缓存。
- **11 套定制图源一键预设**：定制图源表单新增 7 套免费区域/全球预设（日本 GSI 地形、台湾鲁地图、美国 USGS 新版与经典镜像、瑞士 swisstopo 地形与航拍、Google 卫星）及 4 套专业户外 API Key 预设（Tracestrack、Thunderforest、Stadia Stamen 512px、MapTiler）。
- **拆分与裁剪联动体验升级**：点击拆模式新增地图实时里程悬浮气泡、剖面图点击直接拆分、剖面虚线分割标记与分段色带；裁剪双柄靠近分割线自动磁吸对齐；多段着色跨全部编辑工具实时同步到地图。

#### 变更

- **OpenStreetMap 默认切换至官方 CDN 节点**：解决部分网络下 OSM France HOT 节点超时问题，同时仍可在地图设置中一键切回 HOT 或德国节点。
- **拆分分段顺序重编号**：拆分并删段后自动按 `1, 2, 3…` 重新连续编号，避免出现跳号。
- **测距返回与非 GPX 覆盖提示优化**：点击测距页返回按钮自动结束测距；非 GPX 文件进入编辑后，“覆盖原文件”明确置灰并标注「仅 GPX 格式支持」；航点图标下拉列表移除原始内部代码项，同时无损保留原文件中的自定义图标。

#### 修复

- **覆盖保存与编辑器稳定性**：修复覆盖保存退出编辑后顶部重复出现「航点 | 列表」控件的问题；修复跨模式切回与多段擦除时的着色同步与状态残留。
- **顶部工具栏按钮态统一**：统一工具箱、图层、轨迹着彩、航点、列表及缩放/定位按钮的悬停底色与过渡效果，修复工具箱与图层按钮悬停发白的问题，并屏蔽禁用态按钮的悬停高亮。
- **全量代码审计修复**：完成前端解析器、剖面计算、测距、地图视图、叠加图导出及 C# 宿主（KMZ 解压、附件导出、瓦片缓存、全局热键、安全边界与资源释放）共 40 余项边界缺陷与内存/句柄清理修复。
- **图标系统测试对齐**：同步更新路网底图列表的端到端测试断言，覆盖新增的 Esri 浅灰与深灰底图。

### English

#### Added

- **Map Source Node Switcher & On-Demand Probe**: Added multi-node switching and per-node live connectivity checks in Map Settings for OpenStreetMap (Official CDN / HOT / DE), OpenTopoMap (Official / OpenMaps mirror), and Esri Imagery (Server / Services).
- **Expanded Built-in Basemaps & Transparent Outdoor Overlays**: Added **Esri Light Gray / Dark Gray** (Road) and **Esri World Topo** (Terrain), plus 3 toggleable transparent outdoor overlays (**Waymarked Hiking**, **Waymarked Cycling**, **OpenSnowMap Pistes**), all backed by the local tile cache.
- **11 One-Click Custom Source Presets**: Added 7 free regional/global presets (Japan GSI, Taiwan RudyMap, US USGS New & Classic Esri mirror, Swiss swisstopo Topo & Imagery, Google Satellite) and 4 pro outdoor API-key presets (Tracestrack, Thunderforest, Stadia Stamen 512px, MapTiler).
- **Split & Crop Editor Enhancements**: Added a live distance pill on the map in Click Split mode, click-to-split directly on the elevation profile, dashed split dividers and segment color bands on the profile, magnetic snap for crop handles near split dividers, and synchronized multi-segment coloring across all editor modes.

#### Changed

- **OpenStreetMap Defaults to Official CDN**: Switched the default OSM node to `tile.openstreetmap.org` to avoid regional timeouts on OSM France HOT, while keeping HOT and DE nodes one click away in Map Settings.
- **Sequential Split Segment Renumbering**: Automatically renumbers split segments sequentially (`(1)`, `(2)`, `(3)…`) after splits and deletions.
- **Measure Back-Button & Non-GPX Overwrite Clarity**: Navigating back from Measure now stops measuring cleanly; non-GPX tracks show a clearly disabled overwrite-original option (`GPX only`); removed raw `#MarkerStylePicture` codes from the waypoint symbol dropdown while preserving existing custom icons untouched.

#### Fixed

- **Overwrite Save & Editor Lifecycle**: Fixed duplicate Waypoints/Overview toolbar controls appearing after overwrite-saving and exiting the editor, plus cross-mode segment color synchronization.
- **Unified Toolbar Button States**: Unified hover surfaces and transitions across Toolbox, Layer, Track Color, Waypoints, Overview, Zoom, and Locate buttons; fixed washed-out light hover on Toolbox/Layer toggles and suppressed hover highlights on disabled controls.
- **Comprehensive Codebase Audit Fixes**: Resolved 40+ edge-case bugs and resource-cleanup issues across GPX/KML/FIT parsers, climb/profile analysis, measurement, map viewport, overlay export, and C# host services (KMZ extraction, attachment export, tile cache, global hotkeys, and validation guards).
- **Icon Suite Assertion Sync**: Updated the road-provider assertion in the icon system E2E suite to include Esri Light Gray and Esri Dark Gray.

## 1.28.0 — 2026-11-23

### 中文

#### 新增

- **地图节点切换与按需测速**：在「地图设置」中为 OpenStreetMap（官方 CDN / HOT / 德国节点）、OpenTopoMap（官方 / OpenMaps 镜像）和 Esri 影像（Server / Services 节点）提供多节点切换与单节点实时连通性检测。
- **内置底图扩展与透明户外叠加层**：新增 **Esri 浅灰 / 深灰底图**（路网）和 **Esri 世界地形图**（地形），并新增 3 套可自由叠放的透明户外叠加层（**Waymarked 徒步路线**、**Waymarked 骑行路线**、**OpenSnowMap 雪道**），全部接入本地瓦片缓存。
- **11 套定制图源一键预设**：定制图源表单新增 7 套免费区域/全球预设（日本 GSI 地形、台湾鲁地图、美国 USGS 新版与经典镜像、瑞士 swisstopo 地形与航拍、Google 卫星）及 4 套专业户外 API Key 预设（Tracestrack、Thunderforest、Stadia Stamen 512px、MapTiler）。
- **拆分与裁剪联动体验升级**：点击拆模式新增地图实时里程悬浮气泡、剖面图点击直接拆分、剖面虚线分割标记与分段色带；裁剪双柄靠近分割线自动磁吸对齐；多段着色跨全部编辑工具实时同步到地图。

#### 变更

- **OpenStreetMap 默认切换至官方 CDN 节点**：解决部分网络下 OSM France HOT 节点超时问题，同时仍可在地图设置中一键切回 HOT 或德国节点。
- **拆分分段顺序重编号**：拆分并删段后自动按 `1, 2, 3…` 重新连续编号，避免出现跳号。
- **测距返回与非 GPX 覆盖提示优化**：点击测距页返回按钮自动结束测距；非 GPX 文件进入编辑后，“覆盖原文件”明确置灰并标注「仅 GPX 格式支持」；航点图标下拉列表移除原始内部代码项，同时无损保留原文件中的自定义图标。

#### 修复

- **覆盖保存与编辑器稳定性**：修复覆盖保存退出编辑后顶部重复出现「航点 | 列表」控件的问题；修复跨模式切回与多段擦除时的着色同步与状态残留。
- **顶部工具栏按钮态统一**：统一工具箱、图层、轨迹着彩、航点、列表及缩放/定位按钮的悬停底色与过渡效果，修复工具箱与图层按钮悬停发白的问题，并屏蔽禁用态按钮的悬停高亮。
- **全量代码审计修复**：完成前端解析器、剖面计算、测距、地图视图、叠加图导出及 C# 宿主（KMZ 解压、附件导出、瓦片缓存、全局热键、安全边界与资源释放）共 40 余项边界缺陷与内存/句柄清理修复。

### English

#### Added

- **Map Source Node Switcher & On-Demand Probe**: Added multi-node switching and per-node live connectivity checks in Map Settings for OpenStreetMap (Official CDN / HOT / DE), OpenTopoMap (Official / OpenMaps mirror), and Esri Imagery (Server / Services).
- **Expanded Built-in Basemaps & Transparent Outdoor Overlays**: Added **Esri Light Gray / Dark Gray** (Road) and **Esri World Topo** (Terrain), plus 3 toggleable transparent outdoor overlays (**Waymarked Hiking**, **Waymarked Cycling**, **OpenSnowMap Pistes**), all backed by the local tile cache.
- **11 One-Click Custom Source Presets**: Added 7 free regional/global presets (Japan GSI, Taiwan RudyMap, US USGS New & Classic Esri mirror, Swiss swisstopo Topo & Imagery, Google Satellite) and 4 pro outdoor API-key presets (Tracestrack, Thunderforest, Stadia Stamen 512px, MapTiler).
- **Split & Crop Editor Enhancements**: Added a live distance pill on the map in Click Split mode, click-to-split directly on the elevation profile, dashed split dividers and segment color bands on the profile, magnetic snap for crop handles near split dividers, and synchronized multi-segment coloring across all editor modes.

#### Changed

- **OpenStreetMap Defaults to Official CDN**: Switched the default OSM node to `tile.openstreetmap.org` to avoid regional timeouts on OSM France HOT, while keeping HOT and DE nodes one click away in Map Settings.
- **Sequential Split Segment Renumbering**: Automatically renumbers split segments sequentially (`(1)`, `(2)`, `(3)…`) after splits and deletions.
- **Measure Back-Button & Non-GPX Overwrite Clarity**: Navigating back from Measure now stops measuring cleanly; non-GPX tracks show a clearly disabled overwrite-original option (`GPX only`); removed raw `#MarkerStylePicture` codes from the waypoint symbol dropdown while preserving existing custom icons untouched.

#### Fixed

- **Overwrite Save & Editor Lifecycle**: Fixed duplicate Waypoints/Overview toolbar controls appearing after overwrite-saving and exiting the editor, plus cross-mode segment color synchronization.
- **Unified Toolbar Button States**: Unified hover surfaces and transitions across Toolbox, Layer, Track Color, Waypoints, Overview, Zoom, and Locate buttons; fixed washed-out light hover on Toolbox/Layer toggles and suppressed hover highlights on disabled controls.
- **Comprehensive Codebase Audit Fixes**: Resolved 40+ edge-case bugs and resource-cleanup issues across GPX/KML/FIT parsers, climb/profile analysis, measurement, map viewport, overlay export, and C# host services (KMZ extraction, attachment export, tile cache, global hotkeys, and validation guards).

## 1.27.5 — 2026-11-22

### 中文

#### 新增

- **轨迹编辑器高级工具补全**：新增分段一键合并（支持乱序时间重排、重叠时间段清理与大断距警示）、异常漂移点逐条勾选与地图定位、环线点击重设起点（支持 `50m` GPS 容差与时间戳清除提示）、轨迹容差抽稀、放大至 `15` 级及以上顶点精修（拖拽、中点 `+` 插点含海拔/时间/心率插值、右键菜单确认删除）、框选擦除（同步删除框内航点，支持右键/中键拖图）以及时间平移与自定义出发时间的虚拟配速时间轴。

#### 变更

- **剖面选区裁剪按钮精简**：移除“裁剪此段”文字，改为紧凑纯图标按钮并保留悬停提示。
- **编辑器抽屉拆分与解耦**：将 6 个工具抽屉拆分为独立模块，消除航点渲染副作用，并通过回调注入替换顶栏对预览层 DOM 的硬编码依赖。

#### 修复

- **编辑器缩放重绘与交互边界**：修复进入编辑器后误清地图全局缩放/平移监听导致的线条不重绘与切换错位问题；修复含退化短段时顶点段索引错位、工具切换子模式残留、重进编辑器异常点勾选状态未重置，以及进入航点编辑时自动开启航点显示。

### English

#### Added

- **Advanced Track Editor Tools**: Added segment merging (with time-order sorting, overlapping-timestamp clearing, and large-gap warnings), checkable GPS spike list with map focus, loop start rotation (with `50m` GPS tolerance and timestamp-cleared notice), Douglas-Peucker simplification, zoom-aware (`>= 15`) vertex refinement (drag, midpoint `+` insert with elevation/time/HR interpolation, context-menu delete), box erase (erasing track points and waypoints inside bounds with right/middle-drag map panning), and timestamp shifting / virtual timeline generation with custom start time.

#### Changed

- **Compact Profile Brush Crop Button**: Removed text from the elevation-profile brush crop button, keeping a clean icon-only button with hover tooltip.
- **Drawer Modularization & Decoupling**: Extracted the 6 editor tool drawers into a dedicated module, removed state-mutation side effects from waypoint rendering, and replaced hardcoded preview DOM queries with injected callbacks.

#### Fixed

- **Zoom Redraw & Editor Edge Cases**: Fixed missing map redraws and tool-switch misalignment caused by clearing global `zoomend`/`moveend` listeners on overlay unmount; fixed vertex segment-index offset with degenerate segments, sub-mode leaks across tool switches, stale anomaly exclusions on editor re-entry, and auto-enabling waypoint visibility when switching to waypoint editing.

## 1.27.4 — 2026-11-21

### 中文

#### 变更

- **统一中文术语与图标命名**：全界面、活跃文档及测试中的「标记点」「上升」「线路网」统一规范为「航点」「爬升」「路网」；`editor-wpt-add` 图标键名改为全拼 `editor-waypoint-add`，并在 [CONTRIBUTING.md](CONTRIBUTING.md) 固化后续命名约定。

#### 修复

- **工具栏接缝阴影与工具箱展开高亮**：裁除「航点 | 列表」相邻按钮接缝处重叠的暗色外阴影并合并为单条 `1px` 细分隔线；为工具箱按钮补齐面板展开态（`aria-expanded="true"`）的蓝底高亮与底部指示线。

### English

#### Changed

- **Unified Chinese Terminology & Icon Naming**: Standardized Chinese UI, active docs, and test assertions to「航点」「爬升」「路网」; renamed the `editor-wpt-add` icon key to `editor-waypoint-add` and documented the naming conventions in [CONTRIBUTING.md](CONTRIBUTING.md).

#### Fixed

- **Joined Control Seam Shadow & Toolbox Active Highlight**: Clipped overlapping outer shadows on the seam between the joined Waypoints and Overview buttons to a single `1px` hairline divider, and styled the Toolbox button's expanded (`aria-expanded="true"`) active state to match the rest of the toolbar.

## 1.27.3 — 2026-11-21

### 中文

#### 新增

- **四区无损轨迹编辑器**：新增非破坏性轨迹编辑工作区，支持 **剖面剪**（剖面双柄区间裁剪）、**点击拆**（轨迹点击拆分与删段）、**漂移点清洗**、**拓扑操作**（反转方向、往返倍增、闭合环线）及 **航点增删改**，全操作支持多步撤销/重做（`Ctrl+Z` / `Ctrl+Shift+Z`）与一键复原。
- **独立安全保存与快捷键**：新增本地文件保存服务，支持 `Ctrl+S` 快捷保存、另存为新 GPX（可选手表友好去重与佳明航点 15 字符重名检查）及覆盖原文件自动备份并在退出后实时刷新预览。

#### 变更

- **工具箱布局与天气图标重设计**：将 **编辑轨迹** 设为工具箱顶部通栏主入口，下方四项工具重组为工整 `2×2` 横排小卡并去除黑底方框；轨迹天气起点/终点/顶点切换为低饱和柔色线框图标。
- **编辑顶栏集成与航点面板精简**：将图层与标记点图标并入编辑顶栏（极窄屏自动隐藏文字与文件名并补齐复原图标）；航点编辑抽屉将引导语移至标题右侧 `?` 外侧浮层、名称与图标并排、备注默认折叠，航点列表新增序号列、整行点击选中与行间细分割线。
- **窄窗/矮窗全列同步精简**：窗口宽度 `<= 720 px` 或高度 `<= 520 px` 时，轨迹信息、每公里微胶囊与 `26×26` 缩放/回到轨迹控件同步进入紧凑左列栈；编辑模式下缩放/回到轨迹同步采用紧凑尺寸并在与顶栏冲突时自动下移。

#### 修复

- **布局定位与交互细节**：修复精简模式下展开“每公里”表格时错位跳至缩放控件下方的问题；统一全界面工具按钮激活态着色；限制编辑模式下仅右键点击航点图标本身才显示“删除该航点”菜单，右键空白地图不再弹窗；退出编辑后完整恢复原轨迹着色模式。

### English

#### Added

- **Four-Zone Non-Destructive Track Editor**: Added an offline track editing workspace with **Profile Crop** (dual-handle elevation range crop), **Click Split** (click-to-split and segment deletion), **Drift Cleaning**, **Topology** (reverse direction, out-and-back, close loop), and **Waypoint Editing**, backed by multi-step undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`) and reset.
- **Safe Save Service & Shortcuts**: Added native GPX save support with `Ctrl+S`, Save As with optional watch-friendly deduplication and Garmin 15-char waypoint collision checks, plus overwrite-with-backup and live preview refresh on exit.

#### Changed

- **Toolbox Layout & Weather Icon Redesign**: Promoted **Edit Track** to a full-width top hero card above a clean `2×2` horizontal tool grid without heavy dark icon boxes, and softened the Route Weather start/end/peak icons into low-saturation outlined marks.
- **Integrated Editor Topbar & Compact Waypoint Drawer**: Merged icon-only Layers and Pins toggles into the editor topbar (hiding labels/filename on narrow windows and adding a Reset icon); moved waypoint guidance into an unclipped `?` hover tooltip beside the drawer, placed Name & Icon side-by-side, collapsed Notes by default, and added an index column, full-row click selection, and hairline dividers to the waypoint list.
- **Synchronized Compact Stack on Narrow/Short Windows**: Automatically switches Info, per-km splits, and `26×26` zoom/locate controls into a unified compact left-column stack at `<= 720 px` width or `<= 520 px` height; applies compact zoom controls in edit mode and shifts them below the editor topbar on collision.

#### Fixed

- **Layout & Interaction Fixes**: Fixed expanded per-km splits jumping below zoom controls in compact mode; unified active button highlight styling across toolbars; restricted the "Delete waypoint" context menu item to right-clicks on waypoint pins rather than empty map areas; and restored the original track color mode on exiting the editor.

## 1.26.0 — 2026-11-20

### 中文

#### 新增

- **海拔剖面图区间刷选分析**：支持在海拔剖面图上水平拖拽框选任意里程区间（≥ 6 px 触发，短点击仍保留钉住游标），并在选区上方实时展示该区间的里程、累计爬升/下降、平均坡度、用时、均速与平均心率，同步高亮对应地图轨迹；点击关闭按钮、画布外区域或按 `Esc` 即可清除选区。
- **ClimbPro 主坡段自动识别**：内置纯本地爬坡识别算法，自动识别路线中的主要爬坡段并在剖面图标题栏显示“主坡段 (N)”单行横向滚动列表（支持滚轮与左键拖拽滑动），点击任意坡段卡片即可同步聚焦地图范围与海拔剖面图区间并展示统计栏。
- **分段表排序、内嵌比例条与 HUD 双层描边**：每公里分段表支持点击任意表头按降序/升序/默认顺序循环排序，数值单元格背景绘制极淡比例条；全界面悬浮 HUD 面板统一采用外暗内亮双层描边阴影，兼顾亮色路网与深色卫星底图对比度。
- **地图轨迹线多维热力着彩**：工具箱左侧新增纯图标轨迹着彩按钮，单击或按 `L` 键即可依次循环切换 **单色 / 海拔（翠绿→金黄→鲜红）/ 配速（紫→蓝→荧光青）/ 心率（粉→鲜红→暗红+光晕）**，按钮内轨迹线条同步变换对应色彩，基于共享画布分段绘制并支持宿主持久化偏好记忆，缺失对应字段时自动跳过不可用选项。
- **海拔剖面图四等份里程刻度与一键折叠**：在剖面图底部紧贴绘图区增加 25% / 50% / 75% 三处细刻度与里程数值（辅以极淡竖向虚线参考线），并在标题栏右侧新增折叠按钮（快捷键 `P`），可一键收起/展开剖面图并同步释放地图视野。
- **窄窗摘要胶囊**：窗口宽度 `≤ 720 px` 时左上角摘要自动收起为单行紧凑胶囊（`距离 · 爬升 · 用时 ▾`），点击即可展开完整数据。
- **透明叠层导出升级**：工具箱“导出叠层”新增“仅轨迹”（隐藏标题、日期、遮罩与统计，输出文件名带 `-bare` 后缀）与“海拔轮廓”（在底部绘制极简海拔剪影曲线，输出文件名带 `-ele` 后缀，无高程数据时自动禁用）选项，实时刷新低分辨率预览并支持宿主持久化偏好保存。

### English

#### Added

- **Elevation Profile Range Brush Analysis**: Drag horizontally across the elevation profile (≥ 6 px threshold, while keeping short-click pin behavior) to inspect distance, elevation gain/loss, average grade, duration, average speed, and average heart rate for any arbitrary segment with synchronized map trajectory highlighting; dismiss via the close button, outside click, or `Esc`.
- **ClimbPro Major Climb Detection**: Automatically detects major climbs offline and exposes a collapsible single-row `Climbs (N)` horizontal strip (supporting wheel and left-drag scrolling) in the elevation profile header; clicking any climb chip highlights both the profile range and map bounds while displaying the range stats bar.
- **Split Table Sorting, Inline Data Bars & HUD Double-Layer Border**: Clicking any split table header cycles descending, ascending, and default order, with subtle inline proportion bars behind numeric cells; floating HUD panels share a dark-outer/light-inner double-layer border shadow for crisp contrast over both bright road and dark satellite basemaps.
- **Multi-Dimensional Track Coloring**: Added a compact trail-icon button to the left of the Toolbox that cycles on click or `L` key between **Single**, **Elevation** (emerald-to-red ramp), **Speed** (cool purple-to-cyan ramp), and **Heart rate** (rose-to-crimson ramp with soft outer halo), dynamically tinting the button's trail icon and persisting the preference while skipping unavailable modes.
- **Elevation Profile Quartile Distance Ticks & Collapse (`P`)**: Added three quartile distance ticks (25%, 50%, 75%) along a subtle bottom axis below the elevation plot with faint vertical dashed reference lines, plus a header collapse toggle (`P` shortcut) to fold/restore the profile and reclaim map space.
- **Narrow-Window Summary Pill**: At viewport widths `≤ 720 px`, `#info` collapses into a compact single-line summary pill (`distance · ascent · duration ▾`) that expands on click.
- **Transparent Overlay Export Upgrade**: Added `Track only` (hides heading, date, scrim, and stats with `-bare` filename suffix) and `Elevation silhouette` (renders a minimalist elevation silhouette along the bottom with `-ele` filename suffix, disabled when elevation data is unavailable) options to the Toolbox Export panel, with live low-res preview updates and host preference persistence.

## 1.25.9 — 2026-11-20

### 中文

#### 新增

- 新增宿主端本地瓦片磁盘缓存机制：自动将看过的内置与自定义图源瓦片按归一化键（剥离天地图个人密钥并合并多子域）跨版本持久化保存在本地独立缓存目录；在“地图设置”中支持一键开关本地缓存、选择容量上限（256 MB / 512 MB / 2 GB / ∞）与过期保留时长（7 天 / 30 天 / 90 天 / 永久）、查看实时占用与瓦片张数以及二次确认清空缓存，并在断网或刷新超时时优先回退展示已过期旧瓦片。
- 每公里分段与海拔剖面图联动聚焦：在每公里列表中选中某一段时，除在地图轨迹上聚焦高亮外，底部海拔剖面图同步在标题行展示分段徽标，并在绘图区以青色高光带、边界标线及轮廓高亮描边突出该公里区间并轻度压暗两侧非选区，避免遮挡峰顶标注与航点刻度，同时保留鼠标悬停/钉住游标读数及窗口缩放、语言切换和面板收起时的自动同步。

#### 修复

- 修复鼠标连续拖动地图时轨迹在半屏截断、开启标记点后刷新偏慢及密集路段发黑的问题：扩展矢量渲染区缓冲区并在连续拖动过程中按帧渐进刷新轨迹矢量视口、公里标和航点标注；同时移除普通轨迹逐采样点带黑边小圆点的绘制，避免高密度轨迹缩小时黑边叠压盖住彩色轨迹并显著降低拖动与悬停开销。
- 修复切换底图图源时偏好同步滞后一步的问题（此前回调在内部当前图源状态更新之前读取，导致每次向宿主保存的是切换前的旧图源，且异步并发写入可能乱序），同时放行自定义图源 ID（`custom.*`）的宿主持久化读写，确保每次打开轨迹稳定恢复上次关闭前正在显示的图源。
- 清洗 KML 与 GPX 航点描述中由导出工具自动写入的经纬度、海拔、时间等遥测模板文本（仅在同时存在有效经纬度字段时触发，完整保留用户手写备注、自然语言描述及普通占位文本），避免普通标记卡片、标记点列表和全览大图顶栏出现多余或重复的坐标信息，并修正同坐标标记点的去重优先级判断。
- 当 KML `<TimeStamp>` / `<TimeSpan>` 或 GPX `<time>` 缺失时，自动从 KML `ExtendedData` 的时间戳或被清洗掉的遥测时间字段中回填标记点时间，恢复卡片顶栏的“时间 · 海拔”展示（路网文件继续保持跳过时间）。

### English

#### Added

- Added host-owned local disk tile caching across versioned WebView2 origins: valid built-in and custom map tiles are stored under normalized cache keys (with Tianditu tokens stripped and subdomains merged), with new Map settings to enable/disable caching, pick storage limits (256 MB / 512 MB / 2 GB / ∞) and retention periods (7 d / 30 d / 90 d / Forever), view live size/tile counts, two-step clear the cache, and serve expired tiles automatically when offline or when refresh times out.
- Synced per-kilometre split focus onto the elevation profile: selecting a split row now places a localized range badge in the profile header and spotlights the corresponding distance range on the chart with a cyan highlight band, boundary lines, matching cyan contour stroke and mild dimming of outside segments without obscuring summit labels or waypoint ticks, while keeping profile hover/pinned scrub intact and syncing across resize, language switches and panel collapse.

#### Fixed

- Fixed mid-drag track clipping, slow refresh after enabling Markers and solid-black dense track segments by expanding the vector SVG viewport buffer and incrementally refreshing vectors, distance marks and waypoint pins during continuous drags, while removing per-trackpoint black-outlined circle markers that overlapped into solid black when zoomed out.
- Fixed map-layer preference syncing lagging one selection behind (the persistence callback previously read the active layer before it was updated, causing the previous layer to be saved to the host, and unordered background writes could race), while also allowing custom source IDs (`custom.*`) in host preference persistence so every preview reopens on the exact layer shown before closing.
- Stripped exporter-generated coordinate, elevation and timestamp telemetry boilerplate from KML and GPX waypoint descriptions (triggered only when valid coordinate fields are present, leaving genuine user notes, prose and placeholders intact), keeping plain waypoint cards, the waypoint overview and the full-size photo header clean while fixing same-coordinate waypoint deduplication weights.
- Backfilled missing KML and GPX waypoint timestamps from KML `ExtendedData` `Time` / `timestamp` values or stripped description timestamps so card headers show time alongside elevation (still skipped for route networks).

## 1.25.8 — 2026-11-20

### 中文

#### 变更

- 宿主启用全局 C# 可空引用类型检查（`<Nullable>enable</Nullable>`），零编译告警并通过全部宿主与协议自测。
- 将天地图密钥热更新（`setTiandituKey`）与全局快捷键分发（`pressKey`）从 `ExecuteScriptAsync`
  脚本字符串拼接彻底迁移至 `ViewerBridge.PostMessage`（`PostWebMessageAsString`），并在页面
  `host-bridge.js` 统一解码分发。
- 清理 9 个前端模块中的 19 处未使用导出及 `DEFAULT_SCRIM`/`elevationAt`/`storageKey` 等冗余代码，消除
  `toolbox-coordinates.js` 的业务层 `innerHTML` 拼接。
- 收敛 `layers.css` 与 `panels.css` 的重复灰度/边框/强调色至 `tokens.css` 变量，移除 4 处冗余
  `!important`；为 `index.html` 核心入口脚本增加 `modulepreload` 预加载链路。
- 补齐 `geo.test.mjs`、`gpx.test.mjs`、`kml.test.mjs` 与 `host-bridge.test.mjs` 单元测试。

#### 修复

- 修复 `profile-controller.js` 首次悬停或 `clear()` 后先测量尺寸再显示浮标导致 `0×0` 偏移/裁切的问题。
- 修复 `TrailViewerPanel.cs` 在快速取消或异常退出时的任务异常捕捉与 KMZ 临时解包目录清理。

### English

#### Changed

- Enabled global C# nullable reference checking (`<Nullable>enable</Nullable>`) across the host assembly with
  zero compiler warnings.
- Migrated `setTiandituKey` and `pressKey` host-to-page callbacks from `ExecuteScriptAsync` string interpolation to
  `ViewerBridge.PostMessage` (`PostWebMessageAsString`) handled directly in `viewer/host-bridge.js`.
- Removed or internalized 19 unused front-end module exports alongside dead helpers (`DEFAULT_SCRIM`, `elevationAt`,
  `storageKey`) and replaced template `innerHTML` assembly in `viewer/toolbox-coordinates.js` with cached icon
  elements.
- Consolidated repeated grayscale, border and accent values in `layers.css` and `panels.css` into `tokens.css`,
  removed four redundant `!important` declarations on the splits table, and added `<link rel="modulepreload">`
  hints for core ESM entry scripts in `viewer/index.html`.
- Added millisecond-level Node unit suites for `geo.js`, `gpx.js`, `kml.js` and `host-bridge.js`.

#### Fixed

- Fixed profile readout offset/clipping on first hover or after `clear()` caused by measuring hidden `0×0`
  dimensions before unhiding `#profile`'s readout.
- Added top-level exception handling to `LoadAsync` and explicit temp-folder cleanup when KMZ extraction is
  cancelled on preview close.

## 1.25.7 — 2026-11-20

### 中文

#### 新增

- 工具箱标题栏新增 **?** 快捷键速查页，以两列表格列出 `W / S / A D / Q E / C / M / T`，可从主菜单或任意
  工具子页进入并原路返回。
- 新增 <kbd>T</kbd> 快捷键打开或关闭工具箱；页面内文本输入框获得焦点时，所有全局快捷键与工具箱键自动放行。
- 测距页顶部新增 **返回** 按钮：回到工具箱主菜单或浏览其它工具时保留测距状态与已打点位，仅在真正开始或
  结束测距时切换工具页。
- 测距工具支持自动吸附手动创建的测距点（排除当前活动段末点以防自吸死锁），方便闭合环线或跨段续接；
  同像素平手时遵循 `标记点 > 测距点 > 轨迹点` 优先级，撤回或清空后即时更新。
- 浮动面板与标记点卡片新增轻量进入动效，并在系统开启“减少动态效果”时自动降级。

#### 变更

- **标记点卡片统一与整卡照片预览**：
  - 带照片的标记点卡片改为“整卡即照片”（竖幅 `4:3` 铺满），名称与“时间 · 海拔”压在底部渐隐层上，点击
    照片任意位置进入全览；“下一张”按路线顺序跳到下一处带照片的标记点并显示 `2/9` 进度。
  - 无照片标记点卡片改为与照片卡片同一套外壳（固定 `224 px` 宽度、圆角、右上角关闭按钮、一致的名称
    与元信息字级），长描述在卡内滚动，不再拉长遮住地图；短窗口下高于安全区的卡片自动对齐安全区顶部。
- **标准化地图吸附与点位选中视觉系统**：
  - 全项目统一使用双描边 `18×18` 准星与 `--snap-*` 设计令牌，按目标类型区分形状——标记点菱形、测距点
    方块、轨迹点十字——在浅色地形图和深色卫星图上都清晰可辨，搭配轻量化半透明吸附标签与 `120 ms`
    入场动效。
  - 测距悬停、点位坐标拾取悬停以及点击/导航选中标记点全部复用这套标准化准星；选中图钉同时配以暖金色
    轮廓微光，不再使用模糊蓝光晕或随缩放失调的描边圈。
- **界面语言切换收口到工具箱顶栏**：地图右上角不再单独放置语言开关，工具箱标题栏改为单个 **地球图标 +
  当前语言（`中` / `EN`）** 按钮，悬停提示直接显示目标语言本名（`English` / `中文`）；点击就地重绘整页，
  地图视野、已展开面板与测距进度保持不变。
- **轨迹摘要卡与路线标签优化**：摘要卡改为两行六项（首行里程、上升、下降；次行总用时、运动均速、点数），
  里程与总用时左侧保留蓝色重点竖线；移除主界面内重复的快捷键徽标；视口内公里胶囊自动避让路线起终点、
  上一胶囊和附近航点，同时保留方向箭头。
- **海拔剖面渲染优化**：改用低饱和户外色阶与密集航点像素抽稀，剖面填充合并为单条 SVG 路径和单个横向
  渐变；悬停光标使用缓存边界与独立合成层位移，减少长轨迹悬停合成开销。
- **图标与布局响应性能**：收敛设计令牌与字体对比度，航点图钉采用对称 `24×32` 网格、居中按钮使用四角
  取景框、设置采用六齿齿轮并缓存 SVG 模板；地图布局改为“读取快照 → 写入样式 → 下一帧复核”，消除同帧
  强制重排，拖动地图时临时关闭高开销面板模糊并隔离浮层重绘。
- **工程结构与模块边界**：宿主拆分消息路由、WebView 生命周期与消息处理模块（`TrailViewerPanel.cs` 精简
  并完成可空引用检查清理）；前端拆出图层、定制图源、测距、吸附指示器与工具箱主菜单模块，样式表从
  `index.html` 并行加载。

#### 移除

- 标记点卡片不再显示经纬度坐标；需要复制坐标时可使用工具箱 **点位坐标**。

#### 修复

- 修复标记点图钉锚点偏置（`iconAnchor` 由 `[10, 26]` 校正为 `[12, 28]`、`popupAnchor` 对齐 `[0, -26]`），
  使图钉针尖、吸附/选中准星中心、轨迹坐标与弹窗箭头精确同轴对齐。
- 修复无照片标记点卡片背景过暗：原弹窗外壳与卡片各绘制一遍 `--panel` 叠成近乎不透明，现只由外壳绘制
  一次，透明度与标记点列表保持一致。
- 修复切换界面语言或窗口布局刷新把工具箱退回主菜单，以及快捷键速查返回丢失来源页面的问题。
- 修复点击标记点时地图跳动两次（统一由 `popupopen` 作为唯一聚焦平移入口），以及照片卡片“下一张”误用排序前
  下标导致跳到无关点位的问题。
- 修复竖幅照片卡片被通用弹窗 `max-height` 裁切底部信息与翻页箭头的问题。
- 修复图层面板“添加图源”按钮因把状态取值函数当成布尔值而点击无效，以及定制管理入口在列表中异常常驻的问题。
- 修复坐标拾取模式下因 `panels.css` 顶部残留无效声明块而丢弃十字准星光标规则的问题。
- 修复宿主附件回退写入前未重置流位置、导航焦点定时器未在关闭时停止的问题，并明确拦截 IPv6 未指定地址 `::`。

### English

#### Added

- Added a **?** keyboard reference page in the toolbox header (`W / S / A D / Q E / C / M / T`) as a compact
  two-column table; it opens from the main menu or any subpage and returns to the page it was opened from.
- Added <kbd>T</kbd> to toggle the toolbox; all global and toolbox shortcuts yield automatically while a text
  input has focus.
- Added a **Back** button at the top of the distance-measurement page so returning to the toolbox menu or checking
  another tool preserves the measuring state and all placed points.
- Distance measurement now snaps automatically to manually placed measurement points (excluding the active section's
  last vertex to prevent self-snapping), making loop closures and cross-section branches exact. Exact-pixel ties
  follow `marker > measured point > track point`, and undo/clear update snap targets immediately.
- Added a subtle entrance transition for floating panels and waypoint cards with automatic `prefers-reduced-motion`
  fallback.

#### Changed

- **Unified waypoint cards and full-bleed photo preview**:
  - Waypoints with photos now open as portrait `4:3` cards filled by the photo, with name and "time · elevation"
    over a bottom scrim; clicking anywhere on the photo opens the full-size viewer, and "Next" advances along the
    route to the next photo stop with a `2/9` counter.
  - Plain waypoint cards without photos now share the same shell (`224 px` width, corner radius, top-right close
    button, matching title/meta typography) and scroll long descriptions internally instead of stretching down the
    map; cards taller than the safe band align cleanly to the safe top on short windows.
- **Standardized map-snapping and waypoint-selection visual system**:
  - Consolidated snapping reticles into double-stroked `18×18` symbols and `--snap-*` design tokens differentiated
    by target kind — diamond for waypoints, square for measured points, cross for track samples — paired with a
    lighter translucent snap label and a `120 ms` lock-in transition.
  - Distance-measurement hover, coordinate-picker hover, and clicked/navigated waypoint selection now share the
    same reticle with a subtle warm accent glow on the selected pin, replacing the old blurred blue ground halo.
- **Single language toggle in the toolbox header**: removed the standalone map-corner language control in favour
  of one **globe icon + current language (`中` / `EN`)** button whose tooltip names the target language in its own
  script (`English` / `中文`); toggling repaints in place while preserving map view, open panels, and active
  measurements.
- **Track summary hierarchy and kilometre labels**: arranged the summary into two rows of three (`distance / ascent /
  descent`, `total time / moving average speed / points`) with blue accent rules marking distance and total time,
  removed duplicate inline shortcut badges, and had kilometre capsules avoid route ends, previous capsules, and
  nearby waypoints while keeping direction arrows.
- **Elevation profile rendering**: switched to a muted outdoor palette with dense-pin pixel thinning and a single
  SVG path plus single horizontal gradient fill; the scrubber reuses cached bounds and transform-only compositing.
- **Icons and layout responsiveness**: consolidated surface/radius/contrast tokens with a `11 px` minimum for core
  labels, adopted a symmetric `24×32` waypoint template, four-corner fit-bounds icon, six-tooth settings gear, and
  SVG `<template>` caching; moved map layout to a read-snapshot, write-styles, next-frame verification flow,
  paused backdrop blur during map drags, and isolated floating panels with `contain`.
- **Architecture and module boundaries**: split host message routing, WebView lifecycle, and message handlers into
  focused files (`TrailViewerPanel.cs` reduced with nullable cleanup across core host units), separated frontend
  layers, custom-source manager, measurement, snap indicator, and toolbox subviews, and loaded stylesheets in
  parallel from `index.html`.

#### Removed

- Waypoint cards no longer print coordinates; **Point coordinates** in the toolbox remains the dedicated tool for
  copying them.

#### Fixed

- Corrected the waypoint pin anchor from `[10, 26]` to `[12, 28]` (and `popupAnchor` to `[0, -26]`) so the pin tip,
  diamond snap/selection reticle, recorded coordinate, and popup arrow align on the exact same centreline.
- Fixed plain-pin cards appearing too dark: `--panel` was painted twice (once on the popup shell and once on the
  card); it is now painted once so translucency matches the waypoint overview.
- Fixed switching interface language or refreshing layout knocking the toolbox back to its main menu, and fixed the
  shortcut reference losing its return subpage.
- Fixed the map jumping twice when clicking a pin (consolidated panning into `popupopen` alone) and fixed the photo
  card "Next" button using pre-sort `sourceIndex` instead of route-ordered `navigationIndex`.
- Fixed portrait photo cards having their bottom metadata and next arrow clipped by generic popup `max-height` caps.
- Fixed the custom-source "Add source" button failing because an injected state getter was evaluated as a boolean,
  and stopped management actions from staying visible inappropriately.
- Fixed coordinate-picking mode keeping a grab cursor because an orphaned declaration block at the top of
  `panels.css` caused browsers to discard the crosshair rule.
- Fixed the host attachment fallback failing to rewind its stream before retrying, made the post-navigation focus
  timer stop cleanly on close, and explicitly blocked the IPv6 unspecified address `::`.

## 1.25.6 — 2026-11-19

### 中文

#### 变更

- 没有照片的标记点卡片改为与带照片卡片同一套样式：同样 224 px 宽度、8 px 圆角和右上角关闭按钮，
  名称与“时间 · 海拔”沿用卡片的两行字级；描述较长时在卡片内滚动，不再把卡片拉长压住地图。

#### 移除

- 标记点卡片不再显示经纬度。图钉已经标出位置，六位小数的坐标是这张窄卡片里最宽也最少被读的一行；
  需要坐标时可用工具箱的 **点位坐标**。

### English

#### Changed

- A pin without photos now opens the same card as one with photos: the same 224 px width, 8 px radius and
  top-right close button, with the name and "time · elevation" kept at the card's two type sizes. A longer
  description scrolls inside the card instead of stretching it down the map.

#### Removed

- Waypoint cards no longer print coordinates. The pin already marks the spot, and the six-decimal pair was the
  widest and least-read line a card this narrow could hold; **Point coordinates** in the toolbox still copies it.

## 1.25.5 — 2026-11-19

### 中文

#### 变更

- 界面语言改成工具箱标题栏里的**一个按钮**：按钮显示当前语言（`中` 或 `EN`）并带一个双向箭头，点击即在
  中文与英文之间切换；提示与无障碍名称写明「界面语言：中文，点击切换到 英文」。不再用并排两个选项的
  胶囊，避免读成“二选一”而不是“翻一下”。
- 工具箱标题栏去掉“快速启动”说明文字，标题独占剩余宽度；新增 `swap` 双向箭头图标。

### English

#### Changed

- The interface language is now **one button** in the toolbox header: it prints the language in use (`中` or
  `EN`) beside a two-way arrow, and a click flips between Chinese and English. Tooltip and accessible name read
  "Interface language: Chinese. Click for English." The side-by-side two-option pill is gone — it read as a
  choice rather than a flip.
- The toolbox header no longer prints the "Quick launch" note, so the heading takes the remaining width, and
  the icon set gains a `swap` two-way arrow.

## 1.25.4 — 2026-11-19

### 中文

#### 新增

- 测距页顶部增加 **返回** 按钮：回到工具箱主菜单时测距状态与已打的点全部保留，去看别的工具再回来
  可以接着量同一段，不会因为翻页被打断。
- 界面语言切换移入工具箱标题栏，做成 **中 / EN** 胶囊按钮：两种语言同时可见，当前语言填充高亮，点击
  另一侧立即切换；地图右上角不再有单独的语言按钮。切换后整页就地重绘，地图视野与已展开的面板保持原样。
- 新增 `T` 键打开或关闭工具箱。快捷键速查表增至七项（`W / S / A D / Q E / C / M / T`），仍为两列。

#### 修复

- 修复切换界面语言或布局刷新把工具箱从当前工具页挤回主菜单：现在只有测距模式真正开始或结束才切换
  页面，测距页、坐标页和导出页在重绘后保持原位。
- 修复快捷键速查页从坐标、导出等子页打开后只能回到主菜单：现在会退回进入前的那一页。

### English

#### Added

- The measure page now opens with **Back** at the top: returning to the toolbox menu keeps the measuring state
  and every point already placed, so looking at another tool no longer interrupts a measurement.
- The interface-language switch moved into the toolbox header as a **中 / EN** pill: both languages stay
  visible, the active one is filled, and clicking the other side switches immediately. The map corner no longer
  carries a separate language button. The page repaints in place, keeping the map view and any open panel.
- `T` now opens or closes the toolbox. The keyboard reference grows to seven entries
  (`W / S / A D / Q E / C / M / T`) and stays a two-column table.

#### Fixed

- Fixed the toolbox falling back to the menu whenever the interface language changed or the layout refreshed:
  only the measuring mode's own start and end switch pages now, so the measure, coordinate and export pages
  stay where they were after a repaint.
- Fixed the keyboard reference always returning to the menu when opened from a subpage such as coordinates or
  export; it now returns to the page it was opened from.

## 1.25.3 — 2026-11-19

### 中文

#### 变更

- 工具箱快捷键速查改为两列表格，顺序为 `W / S / A D / Q E / C / M`，六项排成三行，短窗口内不再需要滚动。
- 轨迹信息卡改为两行六项：第一行里程、上升、下降，第二行总用时、运动均速、点数；里程和总用时左侧加
  蓝色竖线作为重点标识，其余四项保持次级层级。
- 选中标记点改为柔和地面光晕：取消图钉自身的描边圈，光晕改为无描边的贴地圆斑并加 `blur(5px)`，
  图钉本体改用蓝色 `drop-shadow` 发光。
- 标记点照片卡片改为“整卡即照片”：照片铺满整个**竖幅 4:3**（高:宽）卡片，名称与“时间 · 海拔”压在
  底部渐隐层上，看图面积达到卡片高度的 100%。取消“查看原图”按钮（点照片任意处即打开全览），移除坐标值；
  “下一张”简化为右下角圆形箭头，上方显示 `2/9` 位置进度。卡片加入与其它浮层一致的微动效
  （淡入 + 轻微上浮），并跟随系统“减少动态效果”设置。

#### 修复

- 修复地图图层的“添加图源”按钮点击后没有任何反应：图源管理器把传入的取值函数当成布尔值使用，导致新增
  表单在隐藏的页面里打开，界面毫无变化；同时“管理图源”和数量标记在图层列表中被错误地强制显示。
- 修复点击标记点时地图乱跳：Leaflet 在触发 click 之前就已打开 popup，两条路径各自触发一次聚焦平移，
  第二次量到的还是正在展开的 popup，于是又纠正了第一次刚稳定下来的位置。现改为 popupopen 是唯一的平移
  入口，点击、方向键、列表三个入口都只平移一次。
- 修复“下一张”按钮乱跳：它用 `sourceIndex` 定位，而该值在 `sortStops()` 排序之前就已固定，
  排序后数组顺序变了、下标却没变，于是跳到无关的点位。改用 `navigationIndex`，它按路线里程稳定排序。
- 修复坐标点位工具启动后地图仍是手状光标：`panels.css` 开头残留一段无选择器的声明块，
  浏览器连带丢弃了紧随其后的 `is-coordinate-picking` 光标规则。修复后拾取态正确显示十字准星。
- 修复竖幅照片卡片底部信息和箭头被裁掉：`map-view.js` 的 `popupRect()` 会给弹窗内容写内联
  `max-height`，对高 299 px 的竖幅卡片会截断；现跳过 `.photo-popup`，CSS 也不再限制该弹窗高度。
- 修复短窗口下竖幅卡片压住摘要卡：`focusOffset` 增加“内容高于安全区时顶部对齐”的分支，布局刷新改用
  `focusSelection` 而非只做最小移动的 `revealPoint`。

### English

#### Changed

- The toolbox keyboard reference is now a two-column table ordered `W / S / A D / Q E / C / M`; six entries
  in three rows fit a short panel without scrolling.
- The track summary card is now two rows of three: distance, ascent and descent, then total time, moving average
  speed and points. Distance and total time carry a blue rule on their left edge as the primary markers.
- The waypoint photo card is now the photo: it fills the whole portrait 4:3 frame (height : width) and the name plus time/elevation sit on
  a bottom scrim, taking the visible image to 100% of the card. The "Open photo" button is gone (the
  photo itself opens the viewer), coordinates are no longer printed, and "Next" is a round arrow in the corner
  with a `2/9` position counter above it. The card also enters with the same short fade and rise as the
  other floating panels, and honours the system reduce-motion setting.
- Selecting a waypoint now reads as a soft patch of light on the ground: the outline around the pin is gone, the
  halo is a strokeless ground disc softened with `blur(5px)`, and the pin itself glows with a blue
  `drop-shadow`.

#### Fixed

- Fixed the map keeping its grab hand after the coordinate picking tool started: a selector-less declaration block
  left at the top of `panels.css` made the browser discard the `is-coordinate-picking` cursor rule that
  followed it. The picking mode now shows the crosshair it always meant to.
- Fixed the map jumping when a waypoint pin is clicked: Leaflet opens the popup before it fires click, so both
  paths panned once each, and the second pan measured a popup that was still expanding and corrected the position
  the first pan had just settled. popupopen is now the only place that pans, so a click, an arrow key and the
  overview list each move the map exactly once.
- Fixed the photo card "Next" button jumping to an unrelated pin: it located its neighbour with `sourceIndex`,
  which is fixed before `sortStops()` reorders the array. It now uses `navigationIndex`, which follows the
  route distance.
- Fixed the map layer "Add source" button appearing to do nothing: the custom-source manager read the injected
  state getter as a boolean, so the form opened inside a hidden page and the UI never changed. The same bug forced
  the "Manage sources" link and the entry counter to stay visible in the layer list.
- Fixed the portrait photo card losing its facts and next arrow: `popupRect()` in `map-view.js` wrote an
  inline `max-height` onto every popup, which clipped a 299 px tall card. It now skips `.photo-popup`, and
  the stylesheet no longer caps that popup either.
- Fixed a tall card covering the summary in short windows: `focusOffset` now aligns content taller than the safe
  band to the safe top, and layout refreshes re-apply `focusSelection` instead of the minimal-movement
  `revealPoint`.

## 1.25.2 — 2026-11-19

### 中文

#### 新增

- 工具箱标题栏新增 `?` 快捷键速查入口，集中列出 `M / W / C / S / Q / E / ← →`。

#### 变更

- 移除测距卡片、标记点按钮和主工具箱内的重复快捷键徽标；按钮悬停提示继续保留快捷键。
- 摘要卡移除蓝色竖线，里程与上升改用字重、字号和颜色形成主次层级。
- 剖面填充改为单条路径与单个横向渐变，悬停光标使用缓存尺寸和独立合成层位移。
- 公里胶囊避让起终点及上一已绘胶囊，方向箭头不受影响。

### English

#### Added

- The toolbox header now includes a `?` shortcut reference for `M / W / C / S / Q / E / ← →`.

#### Changed

- Duplicate shortcut badges were removed from the measurement card, marker control and main toolbox;
  native tooltips still expose the keys.
- The summary card replaces the blue rule with typography-led distance and ascent hierarchy.
- The profile fill now uses one path and one horizontal gradient; the scrubber uses cached bounds and
  transform-only cursor layers.
- Kilometre capsules avoid route ends and the previous capsule without removing direction arrows.

## 1.25.1 — 2026-11-19

### 中文

#### 变更

- 移除剖面填充的底端渐隐遮罩，避免长轨迹悬停时重复合成大量遮罩层。

### English

#### Changed

- Removed the profile fill's bottom fade to avoid compositing many mask layers while scrubbing long tracks.

## 1.25.0 — 2026-11-19

### 中文

#### 新增

- 图层菜单显示 `Q / E` 提示，工具箱主菜单显示 `M / W / C / S` 快捷键提示，标记点控制显示 `W` 徽标。
- 浮动面板增加轻量进入动效，并提供系统“减少动态效果”降级。
- PR 工作流把浏览器测试拆为 core、map、tools、media、network 五组并行。

#### 变更

- 地图布局改为“读取快照 → 写入样式 → 下一帧复核”，消除同帧强制重排。
- 航点图钉改用对称 `24×32` 模板，取景按钮改为四角取景框，设置图标改为六齿版本。
- SVG 图标模板按名称、尺寸和样式缓存，重复图标只克隆缓存节点。
- 视觉 Token 收敛圆角、表面、边框和层级；核心标签最小字号提高到 11 px，并增强弱文字对比度。
- 摘要卡突出里程与累计爬升，其余指标保持次级层级。
- 剖面改为低饱和松绿、暖琥珀、焦糖橙、暗绯红阶，并增加底部渐隐和密集航点像素抽稀。
- 里程标签避让 24 px 内可见航点，昂贵的 SVG `drop-shadow` 改为描边或轻量阴影。
- 地图拖动期间临时关闭浮动面板模糊，浮层增加 `contain: layout style paint`。
- 宿主消息路由、WebView 生命周期、图层视图、定制图源管理、测距页、工具箱主菜单和测试 API 拆为独立模块。
- `TrailViewerPanel.cs` 从约 1000 行降至约 400 行；新增宿主文件启用可空引用检查。
- 样式表直接由 `index.html` 并行加载，移除串行 `@import` 入口。

#### 修复

- 附件主目录写入失败回退前复位流位置，避免回退文件截断。
- 明确拦截 IPv6 未指定地址 `::`。
- 导航完成后的焦点重试定时器提升为实例字段，并在关闭时停止。

#### 安全

- 完成 `TrailViewerPanel`、`AttachmentExport`、`KmzArchive` 的渐进可空引用检查清理。

### English

#### Added

- Layer menus now show `Q / E`, the toolbox shows `M / W / C / S` shortcut hints, and the marker control
  carries a `W` badge.
- Floating panels have a lightweight entrance transition with reduced-motion fallback.
- Pull-request browser tests now run in five parallel groups: core, map, tools, media and network.

#### Changed

- Map layout now uses a read-snapshot, write-styles, next-frame verification flow, removing same-frame forced
  reflow.
- Waypoint pins use a symmetric `24×32` template, fit-to-route uses a four-corner frame, and settings uses a
  clearer six-tooth gear.
- SVG templates are cached by name, size and style; repeated icons clone cached nodes.
- Radius, surface, border and layer tokens are consolidated; core labels start at 11 px and muted text has
  stronger contrast.
- The summary card promotes distance and ascent ahead of secondary metrics.
- The profile uses a muted pine, amber, caramel and oxblood scale with a bottom fade and dense-pin thinning.
- Kilometre capsules avoid visible waypoints within 24 px, and expensive SVG `drop-shadow` filters are replaced
  by outlines or lightweight shadows.
- Panel blur is disabled while the map is dragging, and floating panels isolate layout, style and paint.
- Host message routing, WebView lifecycle, layer views, custom-source management, measurement, toolbox main menu
  and the test API are split into focused modules.
- `TrailViewerPanel.cs` drops from roughly 1000 lines to about 400; new host files enable nullable analysis.
- Stylesheets load in parallel from `index.html`, removing the serial `@import` entry point.

#### Fixed

- Attachment fallback rewinds its stream before retrying another folder.
- The IPv6 unspecified address is explicitly blocked.
- The post-navigation focus retry is now an instance timer and stops on close.

#### Security

- Nullable-reference cleanup is complete for `TrailViewerPanel`, `AttachmentExport` and `KmzArchive`.

## 1.24.0 — 2026-11-19

### 中文

#### 变更

- 在插件初始化时预热共享 WebView2 环境，并保留创建失败时回退到默认环境的路径，缩短首次预览等待。
- KMZ 解包、本地附件复制、续传扫描、Data URI 落盘和叠加图落盘移出 WPF UI 线程；KMZ 关闭时可取消。
- KMZ 图片引用扫描改用 `XmlReader` 流式读取，不再把完整 KML 解码成单个 UTF-16 大对象字符串。
- 统一偏好、定制图源、天地图密钥和文件导出的原子写入实现；快捷键诊断进程名增加有界缓存。
- 拆分天地图密钥窗口、WebView 消息桥和主面板；新增可空引用检查边界。
- 前端拆分图源注册表、图层构造、定制图源表单、工具箱坐标页、附件导出页和宿主桥接模块。
- 4,132 行样式表按 tokens、面板、工具箱、图层、地图数据和照片查看器拆分，统一主要 `z-index` 层级变量。
- 工具箱坐标页、图层菜单、标记点速览和地图控制增加显式销毁路径及事件清理。
- `parseGxCoord` 直接解析数字，避免每个轨迹点创建临时字符串和单元素数组。

#### 移除

- 退役 `window.gpxViewer` 测试兼容别名；正式接口仅为 `window.trailViewer`。用户数据迁移分支继续保留，
  避免旧版本设置和 WebView profile 丢失。

#### 工程

- PR 的浏览器测试拆为 core、map、tools、media、network 五个并行分片；Release 仍执行完整串行门禁。
- 宿主自测增加共享文本、字节原子写入和异步附件路径覆盖。

### English

#### Changed

- The plugin now prewarms a shared WebView2 environment during initialization, with a default-environment
  fallback when creation fails.
- KMZ extraction, local attachment copying, resume scans, Data URI writes and overlay writes no longer block the
  WPF UI thread; KMZ extraction can be cancelled when the preview closes.
- KMZ image references are scanned with streaming `XmlReader` input instead of decoding the entire KML into one
  large UTF-16 string.
- Preferences, custom sources, the Tianditu key and file exports share the atomic writer; keyboard diagnostics now
  cache foreground process names with a bound.
- Tianditu-key UI, the WebView message bridge and the main panel are split into separate host units with a nullable
  boundary for the new bridge code.
- The front end now separates the layer registry, provider construction, custom-source form, toolbox coordinate
  page, attachment-export page and host bridge.
- The 4,132-line stylesheet is split into tokens, panels, toolbox, layers, map-data and photo-viewer files, with
  shared variables for the main `z-index` layers.
- Toolbox coordinates, layer menus, waypoint overview and map controls expose explicit cleanup paths.
- `parseGxCoord` parses numbers directly, avoiding temporary strings and single-element arrays for every point.

#### Removed

- Retired the `window.gpxViewer` test compatibility alias; the supported API is `window.trailViewer`. User-data
  migration branches remain so old preferences and WebView profiles are not lost.

#### Engineering

- Pull-request browser tests now run in five parallel shards: core, map, tools, media and network. Releases still
  run the complete serial gate.
- Host self-tests now cover shared text/byte atomic writes and asynchronous attachment paths.

## 1.23.10 — 2026-11-19

### 中文

#### 修复

- 修复快速连续复制坐标时宿主剪贴板重试使用同步等待，导致 WPF 界面线程卡死并在数秒后超时的问题。
  重试现在异步等待，并可在不冻结界面约 1 秒内等待系统剪贴板释放；页面同一时刻只允许一个剪贴板
  写入在途，连续操作合并为最新坐标。

### English

#### Fixed

- Fixed rapid coordinate copies freezing the WPF UI because clipboard retries waited synchronously.
  Retries now yield asynchronously for up to about one second without freezing the UI, and the page
  keeps only one clipboard write in flight while coalescing a burst to its latest coordinate.

## 1.23.9 — 2026-11-19

### 中文

#### 修复

- 修复坐标工具中快速连续点击多个点位时，每个点都立即写入系统剪贴板而造成宿主卡顿和
  “剪贴板无响应”的问题。现在同一段快速操作只复制最后一个坐标，地图高亮和聚焦反馈保持即时。

### English

#### Fixed

- Fixed rapid coordinate-tool clicks stalling the host and showing "the clipboard did not respond"
  because every intermediate point was written immediately. A rapid burst now copies only its final
  coordinate while keeping immediate map highlight and focus feedback.

## 1.23.8 — 2026-11-19

### 中文

#### 修复

- 修复 Mihomo/Clash TUN 将公开图片域名解析到 `198.18.0.0/15` 代理假地址时，全部外链图片被 SSRF
  防护误判失败的问题。直接以 `198.18.x.x` 作为 URL 主机仍会被拒绝。
- Windows 剪贴板被其他程序短暂占用时，坐标和摘要复制最多重试 6 次，避免 `CLIPBRD_E_CANT_OPEN`
  直接打断复制。

### English

#### Fixed

- Fixed all external images failing when a Mihomo/Clash TUN resolves a public image host into the
  `198.18.0.0/15` proxy fake-IP range. Literal `198.18.x.x` URL hosts remain blocked.
- Clipboard copies now retry up to six times when Windows is briefly owned by another process, avoiding
  immediate `CLIPBRD_E_CANT_OPEN` failures.

## 1.23.7 — 2026-11-19

### 中文

#### 修复

- 修复宿主把 `0/1` 作为字符串传给页面时被误判为真值的问题；剪贴板、附件下载、附件续传和叠加图结果
  现在统一通过 `PostWebMessageAsString` 返回，失败不再显示为成功。
- 修复关闭预览时附件下载队列仍释放已销毁信号量、排队下载取消后产生未观察任务异常的问题。
- 修复瞬时 DNS 失败被长期缓存，导致同一域名后续图片在本次导出中全部失败的问题。
- 修复 WebView2 异步初始化恢复后未复查 View 生命周期的问题。
- 修复 Node 20 环境下语言检测直接访问未定义 `navigator` 的问题。

#### 安全

- 扩展外链 SSRF 拦截范围，补充多播、保留、基准测试、文档示例、IPv6 未指定和文档地址。
- HTTPS 外链图片除 `Content-Type` 外校验 JPEG、PNG、GIF、WebP、BMP 或 AVIF 文件头，拒绝伪装成图片的内容。

### English

#### Fixed

- Fixed host `0/1` values being treated as truthy strings in the page. Clipboard, attachment download, resume and
  overlay-result callbacks now use `PostWebMessageAsString`, so failures no longer appear successful.
- Fixed attachment shutdown racing with in-flight downloads and queued cancellations producing unobserved task
  exceptions.
- Fixed transient DNS failures being cached for the rest of the export batch.
- Fixed the WebView2 initialization path not rechecking the view lifetime after an await.
- Fixed language detection on Node 20 when the global `navigator` object is absent.

#### Security

- Expanded external-link SSRF blocking for multicast, reserved, benchmark, documentation, unspecified and
  documentation IPv6 ranges.
- External HTTPS images now require a recognised JPEG, PNG, GIF, WebP, BMP or AVIF file signature instead of
  trusting `Content-Type` alone.

## 1.23.6 — 2026-11-19

### 中文

#### 修复

- 修复选中点位后手动平移地图，再打开或关闭工具箱时，地图被未执行的旧焦点回显拉回原位置的问题。
  工具箱开合不再触发历史焦点重新定位；摘要展开、窗口缩放等仍需保持当前点位的布局变化保持原行为。

### English

#### Fixed

- Fixed the map jumping back to an older selected point after the user manually panned and then opened or closed
  the toolbox. Toolbox layout changes no longer replay pending focus reveals, while summary expansion, viewport
  resizing and other layout changes that should keep the current point visible retain their existing behavior.

## 1.23.5 — 2026-11-18

### 中文

#### 新增

- 轨迹摘要新增复制按钮，可复制名称、里程、时间、运动时间、速度、累计升降、顶点海拔和点数；缺失字段与
  路网文件不会生成虚假统计。
- 新增 **点位坐标**：打开后立即进入连续地图拾取，支持起点、终点、顶点和中心；任意点靠近标记点时自动
  吸附，并在地图提示与结果卡中显示点位海拔。自由点和中心没有源海拔时明确显示“海拔：无数据”。
- 最近复制的坐标可直接打开 **该点天气**；剪贴板只写入 `纬度, 经度`，不把海拔或坐标类型混入文本。
- 新增 **附件图片导出**，支持内置图片、Data URI 和 HTTPS 外链；提供“导出全部图片”和“导出内置图片”
  两个入口，并通过隐藏清单续传，只补导缺失或失败图片。
- 叠加图自动写入路线名称和日期；路网文件显示文档名称、路线总长和轨迹段数，不再伪造起终点、用时或海拔。
- 叠加图设置新增实时预览、清晰画布边界，以及版式、墨色和底衬的说明性悬停提示；导出后可继续切换样式
  连续导出，不同墨色和底衬使用不同文件名。

#### 变更

- 工具箱主菜单改为紧凑的 2×2 快捷图标格：距离测量、点位坐标、叠加图导出和附件图片导出保持一键进入，
  轨迹天气作为下方完整功能条保留；说明保留在悬停提示与无障碍名称中。
- 叠加图导出设置并入统一工具箱，与测距、坐标和附件导出共用标题栏、半透明背景、返回与关闭逻辑。
- 徒步分享图指标顺序调整为距离、总用时、累计上升、最高海拔和运动均速。
- 重绘叠加图为“地图折页”、附件导出为“照片堆叠”，消除两个工具图标的高度相似感。
- 定制图源管理页移除“来源与授权说明”折叠块。

#### 删除

- 删除叠加图导出的 `X` 和 `Shift+X` 快捷键，导出只从工具箱进入。

#### 安全

- 外链图片只接受公开 HTTPS 地址，拒绝 HTTP、带凭据、回环、私网和链路本地地址；请求只在用户开始导出后
  发出，并按图片类型、单图大小、总大小和数量限制校验。

#### 修复

- 修复宿主剪贴板与附件回调名未挂到页面 API，导致操作实际成功却提示失败并逐张等待超时的问题。
- 修复任意拾取点标签暴露内部 `coordinates.any` 键名的问题。

### English

#### Added

- Added a copy button to the track summary for name, distance, elapsed and moving time, speed, ascent,
  descent, peak elevation and point count. Missing values and route networks never produce invented totals.
- Added **Point coordinates** with immediate continuous map picking, start/end/peak/centre controls, nearby
  marker snapping and elevation notes in both the map highlight and latest-coordinate card. Free points and
  the map centre explicitly report unavailable elevation when no source value exists.
- The latest coordinate can open **Weather here** directly. Clipboard output remains six-decimal
  `latitude, longitude`; elevation and coordinate-type context stay in the interface.
- Added **Export attachment photos** for embedded files, Data URIs and HTTPS links, with separate all-photo and
  embedded-only actions plus a hidden resume manifest that retries only missing or failed images.
- Overlay exports now include the route name and date. Route networks show the document name, route length and
  segment count without inventing trip endpoints, elapsed time or elevation.
- Overlay settings now offer a live preview, a visible canvas boundary, explanatory layout/ink/backing tooltips,
  continuous exports without closing the toolbox, and distinct file names for every visual style.

#### Changed

- The toolbox now uses a compact 2×2 quick-launch grid for measurement, coordinates, overlay export and
  attachment export, with route weather in a full-width strip below. Explanations remain in tooltips and
  accessible names.
- Overlay settings are now a page inside the shared toolbox instead of a separate window.
- Hiking share images order metrics as distance, elapsed time, ascent, maximum elevation and moving speed.
- Overlay and attachment exports now use distinct folded-map and stacked-photo icons.
- Removed the source/licence disclosure block from the custom-source manager.

#### Removed

- Removed the `X` and `Shift+X` overlay-export shortcuts. Export is available only from the toolbox.

#### Security

- External photo export accepts only public HTTPS image URLs and starts network work only after the user begins
  export. HTTP, credentials, loopback, private-network and link-local destinations are blocked, with image-type,
  per-file, total-size and count validation.

#### Fixed

- Fixed missing host clipboard and attachment acknowledgement names that made successful operations report
  failure and wait for per-image timeouts.
- Fixed picked-point labels exposing the internal `coordinates.any` key.

## 1.23.4 — 2026-11-18

### 中文

#### 新增

- 复制点位坐标时，地图强提示和“最近复制的坐标”卡片同时显示该点海拔；吸附到标记点或轨迹点时
  使用源数据海拔，自由地图点和中心点没有可靠海拔时明确显示“海拔：无数据”。

#### 变更

- 剪贴板内容仍保持纯 `纬度, 经度`，海拔只作为界面备注，不会写入复制文本。

### English

#### Added

- Coordinate copying now shows the point elevation in both the map highlight and the latest-coordinate card.
  Snapped markers and track points use their source elevation; free map points and the map centre explicitly
  show that elevation is unavailable.

#### Changed

- Clipboard output remains plain `latitude, longitude`; elevation is display-only and is not added to the copied
  text.

## 1.23.3 — 2026-11-18

### 中文

#### 变更

- 重新设计工具箱中的两个导出图标：叠加图导出改为“地图折页”，附件图片导出改为“照片堆叠”，
  消除两者相似的照片轮廓与箭头组合。

### English

#### Changed

- Redesigned the two toolbox export icons: overlay export now uses a folded map, while attachment export
  uses stacked photos, removing the similar photo-outline-and-arrow treatment.

## 1.23.2 — 2026-11-18

### 中文

#### 变更

- 点击叠加图导出后工具箱保持打开，可连续切换版式、墨色或底衬并再次导出。
- 导出预览增加清晰的明暗双层图片边界，直接显示方版、竖版和横版的实际画布比例。

### English

#### Changed

- Exporting an overlay keeps the toolbox open so users can switch shape, ink or backing and export again.
- The preview now has a clear two-tone image boundary that shows the exact square, portrait or wide canvas.

## 1.23.1 — 2026-11-18

### 中文

#### 新增

- 叠加图导出设置新增低分辨率实时预览，版式、墨色或底衬改变后立即更新。
- 墨色和底衬选项增加解释性悬停提示，说明适用背景、透明度与文字可读性。

#### 修复

- 叠加图文件名现在同时包含版式、墨色和底衬，避免同一轨迹的不同样式互相覆盖。

### English

#### Added

- Overlay export settings now include a low-resolution live preview that updates when the shape, ink or backing
  changes.
- Ink and backing choices now explain their intended photo contrast, transparency and text readability on hover.

#### Fixed

- Overlay file names now include shape, ink and backing so different styles of the same track no longer overwrite
  each other.

## 1.23.0 — 2026-11-18

### 中文

#### 新增

- 叠加图自动写入路线名称和日期；路网文件显示文档名称、路线总长和轨迹段数，不再伪造起终点、用时或海拔统计。

#### 变更

- 叠加图导出设置改为工具箱内部页面，与测距、坐标和附件导出共用标题栏、半透明背景、返回和关闭逻辑。
- 徒步指标顺序调整为距离、总用时、累计上升、最高海拔和运动均速。
- 方版、竖版和横版增加输出尺寸与适用场景悬停提示。

#### 删除

- 删除叠加图导出的 `X` 和 `Shift+X` 快捷键；导出只从工具箱进入。

### English

#### Added

- Overlay exports now include the route name and date. Route networks show the document name, total route
  length and segment count without inventing endpoints, elapsed time or elevation totals.

#### Changed

- Overlay export settings are now a page inside the shared toolbox, using the same header, translucent surface,
  back navigation and close behavior as the other tools.
- Hiking statistics are ordered as distance, elapsed time, ascent, maximum elevation and moving speed.
- Square, portrait and wide choices now explain their output dimensions and intended use on hover.

#### Removed

- Removed the `X` and `Shift+X` overlay-export shortcuts. Export is available only from the toolbox.

## 1.22.0 — 2026-11-18

### 中文

#### 新增

- 轨迹摘要信息框新增复制按钮，可复制名称、里程、时间、运动时间、速度、累计升降、顶点海拔和点数；
  缺失字段和路网文件不生成虚假统计。
- 工具箱新增 **点位坐标**，打开后立即进入地图任意点拾取；面板内起点、终点、顶点、中心固定一行。
  任意点保留自由拾取，靠近标记点时会自动吸附；左键拖动和滚轮缩放保持原有地图行为。
  起点、终点和顶点会聚焦地图，并以脉冲标记和坐标标签强提示。
- 最近复制的坐标可直接通过 **该点天气** 在 Windy 中打开，复用轨迹天气的链接与浏览器打开流程。
- 工具箱新增 **附件图片导出**，汇总内置图片、Data URI 和外链图片，保存到源轨迹同级的
  `<文件名>-photos` 目录；显示进度、成功数量、失败数量和最终保存目录。
- 附件导出拆为 **导出全部图片**（云图标）和 **导出内置图片**（文件夹图标）；后者不等待任何网络请求。
- 附件导出增加任务级续传：隐藏清单记录已完成图片，关闭窗口后重新打开同一轨迹只补导缺失或失败项。

#### 变更

- 工具箱改为“地图分析 / 分享与导出 / 环境信息”三个轻量分组，减少新增工具带来的视觉堆积。
- 轨迹摘要和点位坐标通过宿主写入 Windows 剪贴板，普通浏览器开发环境继续使用 Clipboard API。
- 附件图片按标记点名称和序号命名；重名文件自动追加序号，不覆盖已有图片。
- 内置图片改由宿主直接读取并原子复制，不再经过页面 `fetch → Base64 → 分块 WebMessage`。
- HTTPS 外链最多 3 张并发，宿主同步使用 3 个下载槽，并缓存同一域名的公共地址检查；单张超时缩短到
  10 秒，失败不会阻塞后续队列。
- 清单绑定原轨迹路径、大小和修改时间；每成功一张就原子更新。已删除或大小异常的文件会重新调度，结果
  显示新增、跳过已完成和失败数量。
- 坐标复制文本只包含六位小数的纬度、经度，不再附带 `WGS-84 ·` 前缀或成功 Toast；地图上的脉冲点与坐标标签
  负责反馈结果，避免遮挡。坐标标签背景更透明，并按文本内容自适应宽度。
- 地图中心模块简称为 **中心**，并补充“复制当前地图中心坐标”的悬停提示。
- 坐标面板增加固定的 **坐标类型：WGS-84** 提示，拾取说明仅保留鼠标操作。
- 地图拾取可连续取点；拾取提示和临时点标记显示约 1.8 秒后自动消失，十字准星与拾取状态继续保留到
  返回或关闭工具。
- 定制图源管理页移除“来源与授权说明”折叠块。

#### 安全

- 外链导出只接受公开 HTTPS 图片地址，并在用户点击导出后才开始网络请求；HTTP、带凭据地址、回环地址、
  私网地址和链路本地地址会被拒绝。
- 外链图片按内容类型、单图大小、总大小和数量限制进行校验；单张失败不会中止其余图片。

#### 修复

- 修复宿主剪贴板和附件回调名未挂到页面 API，导致操作实际成功却等待超时并提示失败的问题；这也消除了
  图片导出逐张等待 45 秒超时的卡慢。
- 修复任意拾取点标签显示内部键名 `coordinates.any` 的问题，现显示本地化的“拾取点 / Picked point”。

### English

#### Added

- Added a copy button to the track summary with name, distance, elapsed and moving time, speed, ascent,
  descent, peak elevation and point count. Missing fields and route networks never produce invented totals.
- Added **Point coordinates** to the toolbox. Opening it starts arbitrary map picking immediately, with start,
  end, peak and map centre fixed in one row. Arbitrary points remain free while nearby markers snap; left-drag
  and wheel zoom keep their normal map behaviour. Start, end and peak focus the map and show a pulsing point
  with its coordinate label.
- The latest copied coordinate can open **Weather here** in Windy through the same link and browser path used
  by route weather.
- Added **Export attachment photos**, combining embedded files, Data URIs and HTTPS links into a
  `<file name>-photos` folder beside the source track, with progress, success/failure counts and the final
  destination.
- Split attachment export into **Export all photos** (cloud icon) and **Export embedded photos** (folder
  icon); the embedded-only action performs no network work.
- Added task-level resume. A hidden manifest records completed photos, so reopening the same unchanged track
  retries only missing or failed images.

#### Changed

- Grouped the toolbox into lightweight **Map analysis**, **Share and export** and **Environment** sections.
- Track summaries and point coordinates use the Windows clipboard through the host; browser development keeps
  using the Clipboard API.
- Attachment names combine the marker name and sequence. Duplicate names receive a suffix instead of
  overwriting an existing photo.
- Embedded photos are now copied directly by the host instead of using page-side `fetch → Base64 → chunked
  WebMessage`.
- HTTPS links run with at most three page workers and three host download slots. Public-host validation is
  cached per domain, request timeout is 10 seconds, and one failure does not block the queue.
- The manifest binds the source path, size and modification time and is updated atomically after each image.
  Deleted or size-mismatched files are scheduled again, and results report added, completed and failed counts.
- Coordinate text now contains only six-decimal latitude and longitude. The `WGS-84 ·` prefix and success toast
  are gone; the pulsing map point and coordinate label provide unobstructed feedback. The label is more
  transparent and sizes itself to its text.
- Renamed the map-centre module to **Centre** and added its own hover explanation.
- Added the fixed **Coordinate type: WGS-84** badge; pick guidance now describes only mouse actions.
- Map picking supports consecutive points. Its instruction and transient point marker fade after about 1.8
  seconds while the crosshair and pick mode stay active until Back or closing the toolbox.
- Removed the source/licence disclosure block from the custom-source manager.

#### Security

- External photo export accepts only public HTTPS image URLs and starts network requests only after the user
  presses Export. HTTP, credential-bearing, loopback, private-network and link-local destinations are blocked.
- External responses are checked by image type and bounded by per-image, total and count limits; one failed
  image does not abort the rest of the batch.

#### Fixed

- Fixed host clipboard and attachment acknowledgement names missing from the page API, which made successful
  operations time out and report failure and added a 45-second delay to every attachment image.
- Fixed arbitrary picked-point labels exposing the internal `coordinates.any` key instead of a localized label.

## 1.21.30 — 2026-11-18

### 中文

#### 新增

- **定制图源**：新增最多 20 个用户 HTTPS 瓦片图源，支持名称、瓦片地址、256/512 px、缩放范围、子域、
  署名和 TMS。可直接粘贴两步路 `{$x}`、`{$y}`、`{$z}` 地址，`@2x` / `%402x` 自动使用 512 px。
- 定制图源提供独立管理页、添加/编辑子页、空状态、加载状态、二次删除确认和错误提示；至少有一个图源后，
  分类入口用于常规选择，管理入口单独提供。
- 定制图源由宿主保存到应用数据目录的 `custom-sources.json`，正常覆盖升级后仍会保留；首次升级会迁移旧
  `localStorage` 数据。
- 工具面板、图层面板与标记点列表统一顶部位置和标题栏高度，并加入互斥与键盘焦点回归。

#### 变更

- 地图类型保留为路网、地形、卫星、定制四类并保持单行；分类使用路线节点、等高线、地球和配置滑杆图标，
  增加悬停说明。顶部图层入口显示当前类别文字和类别图标，具体图源名称放在悬停提示中。
- 图层入口使用清晰八齿齿轮；图层面板宽度调整为 320 px、右对齐窗口，窄窗保持可用。
- 无底图模式移入图层标题栏，位于设置齿轮左侧，使用空白网格图标；激活时顶部显示“网格”，颜色与其他激活
  控件一致。地图设置页只保留天地图密钥卡。
- 轨迹天气三点使用彩色地图图钉方案，分别以绿色播放箭头、红色方框和黄色山峰表示起点、终点、顶点。
  “最高点”标签改为“顶点 / Peak”。
- 定制图源表单明确区分次要“取消”和主操作“保存并应用”；高级字段默认折叠。

#### 修复

- 修复编辑活动定制图源后仍使用旧地址、删除后列表残留、取消表单后校验状态残留及空类别缺少添加入口的问题。
- 修复定制图源输入框打字被全局快捷键吞掉，以及从输入框拖选文字到面板外时编辑页误关闭的问题。
- 修复定制图源切换或删除后确认按钮消失、重新打开后状态不显示及激活样式被通用按钮样式覆盖的问题。

### English

#### Added

- **Custom sources** now support up to 20 user HTTPS tile sources with name, URL, 256/512 px tiles, zoom range,
  subdomains, attribution and TMS. Two-step `{$x}`, `{$y}` and `{$z}` addresses can be pasted directly, and
  `@2x` / `%402x` automatically selects 512 px.
- Added a dedicated source manager, add/edit pages, empty state, loading states, two-step delete confirmation and
  error reporting. Once at least one source exists, the category opens the normal picker and management remains a
  separate action.
- The host stores custom sources in `custom-sources.json` under local application data, preserving them across
  normal overwrite upgrades and migrating the old `localStorage` list on first use.
- The toolbox, layer panel and waypoint list now share one top anchor and header height, with mutual exclusion and
  keyboard-focus coverage.

#### Changed

- Kept Road, Terrain, Satellite and Custom in one row, with route-node, contour, globe and slider icons plus
  hover descriptions. The top layer entry keeps the category text and matching icon; the active source name
  appears in the tooltip.
- Replaced the map-settings glyph with a clear eight-tooth gear and narrowed/right-aligned the layer panel to
  320 px while keeping narrow windows usable.
- Moved No-map mode into the layer title bar before Settings, using the blank-grid icon. The top entry reads Grid
  while active and uses the shared active colour. Map settings now contains only the Tianditu key card.
- Route weather uses coloured map-pin marks for start, end and peak: green play arrow, red square and amber
  mountain. The visible Summit label is now Peak.
- The custom-source form now clearly separates secondary Cancel from primary Save and apply, with advanced fields
  collapsed by default.

#### Fixed

- Fixed edited custom sources retaining the old URL, deleted entries lingering, stale validation after Cancel and
  the empty category lacking an add action.
- Fixed custom-source typing being swallowed by global shortcuts and text selection dragging outside the panel
  closing the editor.
- Fixed custom-source selection/deletion confirmation disappearing, source state missing after reopening and the
  active-state colour being overridden by generic button styles.

## 1.21.29 — 2026-11-18

### 中文

#### 变更

- 无底图模式激活时，顶部图层入口文字由“无底图”改为“网格”，窄窗简称由“无”改为“网”；功能与切换逻辑
  保持不变。

### English

#### Changed

- When no-map mode is active, the top layer entry now reads Grid (short label G) instead of No map (N). The mode
  and switching behaviour are unchanged.

## 1.21.28 — 2026-11-18

### 中文

#### 变更

- 地图图源的“自定义”中文名称统一改为“定制”，包括分类名称、窄窗简称、图源管理页标题、空状态和提示文案。
  内部 `custom` 标识和已保存数据保持不变。

### English

#### Changed

- Updated the Chinese Custom map-source terminology from 自定义 to 定制 throughout category labels, the compact
  label, manager headings, empty states and notices. Internal `custom` identifiers and saved data are unchanged.

## 1.21.27 — 2026-11-18

### 中文

#### 修复

- 明确顶部图层入口的显示规则：文字固定显示当前“路网 / 地形 / 卫星 / 自定义”类别，图标同步显示该类别的
  地图结构图标；具体图源名称保留在悬停提示和无障碍标签中。

### English

#### Fixed

- Clarified the top layer entry: its text remains Road, Terrain, Satellite or Custom while the matching map
  structure icon changes with the category. The active source name stays in the tooltip and accessible label.

## 1.21.26 — 2026-11-18

### 中文

#### 变更

- 顶部图层入口的图标和文字改为跟随当前具体图源，而不是只显示“路网 / 地形 / 卫星 / 自定义”分类。
  例如 OpenStreetMap 显示路线节点图标，CyclOSM 显示等高线图标，自定义图源显示其名称。
- 窄窗使用各图源简称；自定义图源显示名称前四个字符，完整名称继续保留在悬停提示和无障碍标签中。

### English

#### Changed

- The top layer entry now follows the active source rather than only its category: OpenStreetMap shows the route
  icon, CyclOSM the contour icon, and custom sources show their own names.
- Narrow windows use a per-source short label. Custom names use their first four characters while the full name
  remains available in the tooltip and accessible label.

## 1.21.25 — 2026-11-18

### 中文

#### 变更

- 无底图模式从地图设置移到图层面板标题栏，使用 A 方案空白网格图标，位于设置齿轮左侧，并提供悬停提示与
  激活态。地图设置页现在只保留天地图密钥卡。
- 轨迹天气分段标签由“最高点”改为“顶点”，英文标签由 Summit 改为 Peak；内部 `highest` 模式标识保持
  兼容。

### English

#### Changed

- Moved No-map mode from Map settings to the layer-panel title bar. It now uses the selected A blank-grid icon
  immediately before Settings, with a tooltip and active state. Map settings now contains only the Tianditu key
  card.
- Renamed the route-weather “Summit” segment to “Peak” (“顶点” in Chinese) while retaining the compatible internal
  `highest` mode identifier.

## 1.21.24 — 2026-11-17

### 中文

#### 变更

- 地图设置改用清晰的八齿齿轮图标。
- 路网、地形、卫星和自定义四类图源加入 B 方案地图结构图标，并为每个分类提供悬停提示。
- 轨迹天气的起点、终点和最高点改用彩色地图图钉 B 方案：统一图钉轮廓，分别嵌入播放箭头、停止方框和
  山峰线条，同时保留绿色、红色和黄色语义。

### English

#### Changed

- Replaced the map-settings glyph with a clear eight-tooth gear.
- Added the selected B map-structure icons and hover descriptions to Road, Terrain, Satellite and Custom.
- Route weather now uses the selected coloured map-pin B set: one pin silhouette with a play arrow, stop square
  or summit line, retaining green, red and amber semantics.

## 1.21.23 — 2026-11-17

### 中文

#### 变更

- 地图设置中的无底图模式移除可见说明文字，只保留图标、标题和开关；解释仍保留在悬停与无障碍标签中。
- 天地图密钥压缩为单行状态卡：配置、更换和移除改为图标按钮，移除 Windows 凭据及密钥共用说明，状态只显示
  “尚未配置”或“已配置”。

### English

#### Changed

- Removed the visible note under No-map mode in Map settings, leaving the icon, title and switch; the explanation
  remains in its tooltip and accessible label.
- Compacted the Tianditu key control into one row. Configure, change and remove are icon buttons, the Windows
  credential and shared-key notes are gone, and the status reads only Not configured or Configured.

## 1.21.22 — 2026-11-17

### 中文

#### 新增

- 自定义图源改由宿主保存到本地应用数据目录的 `custom-sources.json`，不再依赖随构建哈希变化的 WebView
  域名；正常覆盖安装新版本后仍会保留。首次升级会把旧 `localStorage` 列表迁移到宿主文件。
- 新增工具箱、图层和标记点列表的互斥与共同顶部定位回归。

#### 变更

- 工具箱、图层和标记点列表统一使用工具栏下方的共享顶部锚点及 `40px` 标题栏高度；普通窗口与 360 px
  窄窗的顶部位置一致。
- 三个浮动窗口任意时刻只保留一个：打开其中一个会关闭另外两个，关闭过程不会抢走新窗口的键盘焦点。

### English

#### Added

- Custom sources are now stored by the host in `custom-sources.json` under local application data instead of
  relying only on the content-hashed WebView origin. A normal overwrite upgrade retains them, and the first
  upgrade migrates the old `localStorage` list into the host file.
- Added regression coverage for shared top positioning and mutual exclusion across the toolbox, layer panel and
  waypoint list.

#### Changed

- The toolbox, layer panel and waypoint list now share one top anchor below the toolbar and a `40px` header
  height in both regular and 360 px narrow windows.
- Only one of the three floating panels can remain open: opening one closes the other two without stealing
  keyboard focus from the newly opened panel.

## 1.21.21 — 2026-11-17

### 中文

#### 变更

- 地图图源面板由 360 px 缩窄为 320 px，并由跟随图层按钮改为相对窗口右侧 `10px` 对齐；360 px 窄窗仍保持
  320 px 宽度和右侧对齐。窗口尺寸变化时，已打开的面板会重新对齐到图层按钮下方。

### English

#### Changed

- Narrowed the map source panel from 360 px to 320 px and aligned it 10 px from the window's right edge instead
  of the layer button. The 320 px width and right alignment are retained in a 360 px window.

## 1.21.20 — 2026-11-17

### 中文

#### 修复

- 修复在自定义图源文字输入框中开始拖选、并在窗口或面板外松开鼠标时，编辑页被地图点击误关闭的问题。
  现在只有在地图上首次按下鼠标时才会关闭图层面板，文本选择过程中的结束点击不会关闭编辑器。

### English

#### Fixed

- Fixed the custom-source editor closing when a text selection started inside a field and the mouse was released
  outside the window or panel. The layer panel now closes on the initial map press, not on the completion click
  from a text-selection drag.

## 1.21.19 — 2026-11-17

### 中文

#### 修复

- 自定义图源表单的 **取消** 改为低调幽灵按钮，**保存并应用** 改为蓝色实心主按钮；两者使用不同宽度、边框、
  背景和字重，避免整条操作栏上的两个按钮难以区分。

### English

#### Fixed

- In the custom-source form, **Cancel** is now a subdued ghost button and **Save and apply** is a blue filled
  primary button, with distinct widths, borders, backgrounds and font weights.

## 1.21.18 — 2026-11-17

### 中文

#### 变更

- 图层分类恢复为单行四等宽布局，路网、地形、卫星和自定义在常规窗口及 360 px 窄窗中保持同一行。

### English

#### Changed

- Restored the four map categories to one equal-width row: Road, Terrain, Satellite and Custom remain on the
  same row in regular and 360 px narrow windows.

## 1.21.17 — 2026-11-17

### 中文

#### 变更

- 自定义图源分类按数量区分入口：没有图源时直接显示管理页空状态；至少保存一个图源后，单击分类或重新打开
  图层面板都显示常规图源选择界面。
- 常规图源选择界面的“地图图源”标题旁新增 **管理图源** 入口，用于进入现有的添加、编辑、删除和状态页面。

### English

#### Changed

- The Custom category now chooses its destination by source count: with no sources it opens the empty manager,
  while one or more saved sources make category clicks and later openings show the regular source picker.
- Added a **Manage sources** action beside the source heading for entering the existing add, edit, delete and
  status page.

## 1.21.16 — 2026-11-17

### 中文

#### 新增

- 自定义图源改为独立的列表与管理页：标题栏直接添加，整行切换图源，编辑和删除使用图标按钮；删除需要再次
  点击确认。
- 图源状态统一显示为“加载中 / 已加载 / 部分可用 / 不可用”，来源与授权说明默认折叠，空列表提供明确入口。

#### 变更

- 添加和编辑使用独立表单子页，基础项先展示，子域、署名与 TMS 收进高级选项；保存后回到列表并应用图源。
- 支持直接粘贴两步路格式的 `{$x}`、`{$y}`、`{$z}` 占位符，自动转换为 Leaflet 的 `{x}`、`{y}`、`{z}`；
  地址含 `@2x` 或 `%402x` 时自动选择 512 px。

#### 修复

- 修复删除图源第一次点击后确认按钮随面板关闭、无法完成二次确认的问题。

### English

#### Added

- Custom sources now have a dedicated list and management page: add from the title bar, select from the full row,
  and use icon buttons to edit or delete. Deletion requires a second confirmation click.
- Source state is shown consistently as Loading, Ready, Partially available or Unavailable. The source/licence
  note is collapsed by default, and an empty list provides a clear action.

#### Changed

- Adding and editing use a separate form page with basic fields first and subdomains, attribution and TMS under
  advanced options. Saving returns to the list and applies the source.
- Two-step `{$x}`, `{$y}` and `{$z}` placeholders are converted automatically to Leaflet's `{x}`, `{y}` and `{z}`;
  an address containing `@2x` or `%402x` selects 512 px automatically.

#### Fixed

- Fixed the delete confirmation disappearing after the first click because the panel closed while it re-rendered.

## 1.21.15 — 2026-11-17

### 中文

#### 新增

- **自定义**地图类型新增独立图源管理页：支持添加、选择、编辑和删除自己的瓦片图源，最多保存 20 个。
- 图源表单包含名称、HTTPS 瓦片地址、256/512 瓦片大小、缩放范围、子域、署名和 TMS；512 px 图源同时使用
  正确的 512 CSS 像素尺寸和负缩放偏移。
- 自定义图源加载失败会在图源列表和提示中显示状态，但不会自动切换到其他底图。

#### 变更

- **无底图**不再占用主图源栏，改为 **地图设置 → 显示模式 → 无底图模式**；主栏保留路网、地形、卫星、
  自定义四类。
- <kbd>Q</kbd> / <kbd>E</kbd> 循环四个地图类别；无底图模式下按任一背景切换键会恢复上次使用的地图图源。
- 图层面板在 360 px 窄窗下固定到当前图层按钮下方并保持在窗口内，自定义列表与编辑页使用单一滚动区，
  保存与取消始终可见。
- 自定义地址只接受 HTTPS，与页面 CSP 保持一致；表单操作改为明确的“取消 / 保存并应用”。

#### 修复

- 修复在自定义图源输入框中输入 `W`、`Q`、`E`、`S`、`C`、`M`、`X` 时被全局快捷键吞掉、
  无法输入的问题：页面在文本字段获得焦点时通知宿主，全局钩子随即放行。
- 修复编辑当前自定义图源后仍使用旧地址的问题；保存后立即替换活动图层。
- 修复删除图源后列表残留、取消表单后校验状态残留，以及空自定义类别没有添加入口的问题。
- 修正天气入口的完成提示，明确打开的是所选点位，而不是轨迹中心。

#### 说明

- 插件不内置任何第三方端点；自定义图源的可用性与授权由用户自行确认。

### English

#### Added

- The **Custom** map type now has its own source manager for adding, selecting, editing and deleting up to 20
  user tile sources.
- The source form includes a name, HTTPS tile URL, 256/512 tile size, zoom range, subdomains, attribution and
  TMS. A 512 px source now uses the correct 512 CSS-pixel size together with its negative zoom offset.
- Failed custom tiles show their state in the source list and in a warning, without falling back to another
  basemap.

#### Changed

- **No map** no longer occupies the main source bar. It is now
  **Map settings → Display mode → No-map mode**, leaving Road, Terrain, Satellite and Custom.
- <kbd>Q</kbd> / <kbd>E</kbd> cycles the four map categories. Pressing either key while no-map is active restores
  the last map source.
- In a 360 px window the layer panel is fixed below the layer button and kept inside the viewport. The custom
  list and editor use one scroll region while Cancel and Save remain visible.
- Custom addresses require HTTPS to match the viewer CSP, and the form uses explicit Cancel and Save and apply
  actions.

#### Fixed

- Fixed `W`, `Q`, `E`, `S`, `C`, `M` and `X` being swallowed by the global shortcut hook while typing in a
  custom-source field: the page now reports text-field focus and the hook stands down.
- Fixed the active layer retaining the old URL after editing a custom source; saving now replaces it immediately.
- Fixed removed sources remaining in the list, stale validation after cancelling the form, and the empty custom
  category lacking an add action.
- Corrected the weather completion message to name the selected point instead of the route centre.

#### Notes

- The plugin ships no third-party endpoint; the availability and licence of a custom source are the user's own
  responsibility.

## 1.21.14 — 2026-11-17

### 中文

#### 新增

- 工具箱新增 **轨迹天气**：在系统默认浏览器中打开 Windy，并直接展开该点的逐小时天气面板（温度、体感、
  雨、风、阵风、风向），不需要再自己在地图上找位置。
- 天气提供“起点 / 终点 / 最高点”三种点位，均为具体位置并统一使用 14 级街道视角；最高点取全程海拔最大的
  记录点，文件没有海拔或全程高差不足 1 米时该分段禁用。
- 三种点位使用与地图一致的语义图标（绿色起点、红色终点、琥珀色峰顶），分段条并入天气按钮卡片，
  读作一个控件而不是两个。
- 天气默认打开云层图层，便于判断日照与雾况；需要风或降水时在 Windy 内切换。
- 预览页不内嵌第三方地图，不需要 Windy API 密钥，页面 CSP 保持不变。

#### 说明

- 天气查询在浏览器侧完成，轨迹坐标会随链接发送给 Windy；不使用该入口时不会发起任何外部请求。
- 没有坐标的文件（例如无 GPS 的训练文件）会禁用天气入口，并在悬停提示中说明原因。

### English

#### Added

- Added **Route weather** to the toolbox: it opens Windy in the default browser with that point's hourly
  forecast panel already expanded (temperature, feels-like, rain, wind, gusts, direction), so the place no
  longer has to be found on the map by hand.
- Weather offers three points — Start, End and Summit — each a single place opened at level 14. The summit is
  the recorded point with the greatest elevation, and that segment is disabled when a file has no elevation or
  less than a metre of relief.
- The three points carry the map's own semantics (green start, red end, amber summit), and the segmented picker
  is merged into the weather action card instead of reading as a second, unrelated control.
- Windy opens on the cloud layer, which is the quickest read on sun versus fog; wind and rain are one click
  away inside Windy.
- The preview embeds no third-party map, needs no Windy API key and keeps its Content-Security-Policy unchanged.

#### Notes

- The weather lookup happens in the browser, so the route coordinates travel with the link to Windy. Nothing is
  requested externally unless the entry is used.
- Files without coordinates (a GPS-free workout, for example) disable the weather entry and explain why in its
  tooltip.
## 1.21.13 — 2026-11-17

### 中文

#### 变更

- 自动识别由大量独立路线合并而成的路网 KML，不再把全网误算为一次连续行程；路网模式不显示无意义的
  全局均速、休息时间、每公里表和合并剖面。
- 路网轨迹使用 Canvas、视口过滤和按缩放级别简化的几何；最大 27 MB 路网实测首屏约从 3.21 秒降至
  2.70 秒，JS 堆峰值约从 114 MB 降至 85 MB。
- 路线拖动时按帧补入当前视口，标注点图层只更新可见集合的差异，减少快速跨区拖动时的集中重绘。
- 新增共享只读轨迹模型，分段长度和累计里程只计算一次，供地图、摘要、剖面、导航、导出和每公里分析复用。
- 每公里统计改为首次展开时计算，并使用单次区间游标和二分时间定位；3,300 公里轨迹回归约 45 ms。
- 测距吸附索引改为首次使用，航点索引与标记点控制器共享；5,000 个航点只为视口采样创建图钉 DOM。
- 摘要与每公里分析共用运动阈值和心率口径，并在记录段边界重置运动状态；段间时间统一计入休息时间。
- 地图平移和缩放不再重复测量整套 DOM，距离标记按缩放级别缓存采样。

#### 修复

- 修复照片全览关闭后地图可能重新计算可用区域并突然跳动的问题。
- 修复 KMZ 叠加图被写入临时解包目录并在关闭预览后丢失的问题。
- GPX、KML、KMZ 和 FIT 统一增加 64 MB 上限，超限文件在启动 WebView 前明确报错。
- 修复 20 万点心率统计、连续平移语言节点增长、WebView2 关闭及 COM 回调异常。

### English

#### Changed

- Route-network KML files made from many independent tracks are detected automatically instead of being treated
  as one continuous trip; network mode omits meaningless global moving speed, rest time, split table and merged
  profile.
- Network tracks use Canvas with viewport filtering and zoom-dependent geometry. The largest 27 MB network now
  reaches first paint in about 2.70 seconds instead of 3.21 seconds, with peak JS heap reduced from roughly
  114 MB to 85 MB.
- Routes enter the viewport as the map moves, while the waypoint layer updates only visibility differences,
  reducing concentrated redraws during fast cross-area dragging.
- Added a shared read-only route model so segment lengths and cumulative distance are calculated once for the
  map, summary, profile, navigation, export and split analysis.
- Per-kilometre analysis is calculated on first expansion and uses a monotonic interval cursor with binary time
  lookup; the 3,300-kilometre regression runs in about 45 ms.
- Measurement indexes are created on first use and share the marker controller's waypoint index; 5,000
  waypoints create marker DOM only for the current viewport sample.
- The summary and split analysis share movement thresholds and heart-rate semantics and reset movement at every
  recorded segment; time between segments is counted as rest.
- Map panning and zooming no longer remeasure the full DOM, and distance markers cache samples per zoom level.

#### Fixed

- Fixed the map sometimes recalculating its available area and jumping after closing a full-size photo.
- Fixed overlays exported from KMZ files being written into the temporary extraction folder and lost when the
  preview closes.
- GPX, KML, KMZ and FIT inputs now share a 64 MB limit and fail clearly before WebView starts.
- Fixed heart-rate statistics on 200,000 readings, language-node growth during repeated panning, and WebView2
  shutdown or COM callback errors.

## 1.21.12 — 2026-11-17

### 中文

#### 变更

- 路网不再把全部轨迹点复制为 Leaflet LatLng；只为当前视口内的路线创建 Canvas 折线。
- 路网折线按当前缩放级别简化点集，总览使用更轻的几何，高倍缩放仍保留可见细节。
- 最大 27 MB 路网的首屏约从 2.79 秒降至 2.70 秒，JS 堆峰值约从 105 MB 降至 85 MB。
- 总览实际绘制点从 99,009 个降至 1,277 个，路线名称提示和 Canvas 命中行为保持可用。

### English

#### Changed

- Networks no longer copy every track point into Leaflet LatLng objects; Canvas polylines are created only
  for routes intersecting the current viewport.
- Network geometry is simplified for the current zoom, keeping overview rendering light while retaining
  visible detail when zoomed in.
- The largest 27 MB network now reaches first paint in about 2.70 seconds instead of 2.79 seconds, with peak
  JS heap reduced from roughly 105 MB to 85 MB.
- The overview draws about 1,277 points instead of 99,009 while route-name tooltips and Canvas hit testing
  remain available.

## 1.21.11 — 2026-11-17

### 中文

#### 变更

- 测距吸附索引改为首次吸附或开始测距时创建，普通预览不再为全部轨迹点建立 k-d tree。
- 测距直接复用标记点控制器的航点空间索引，避免同一批航点被索引两次。
- 最大 27 MB 路网实测 JS 堆约从 114 MB 降至 105 MB，首屏约从 3.21 秒降至 2.79 秒。

### English

#### Changed

- Measurement snapping indexes are created on first use instead of during every normal preview.
- Measurement reuses the waypoint controller's spatial index instead of indexing the same waypoints twice.
- The largest 27 MB network now measures about 105 MB of JS heap and a 2.79-second first paint, down from
  roughly 114 MB and 3.21 seconds.

## 1.21.10 — 2026-11-17

### 中文

#### 变更

- 每公里统计改用单调区间游标和二分时间定位，避免为每一公里重新扫描全部轨迹区间。
- 路网模式跳过导航用轨迹空间索引副本，保留文件顺序的完整标注点导航。
- 路网轨迹坐标不再保存不参与剖面和导出的海拔字段，进一步降低解析内存。
- 新增 3,300 公里长轨迹分段性能回归；本机计算约 45 ms。

### English

#### Changed

- Per-kilometre analysis now uses a monotonic interval cursor and binary time lookup instead of rescanning all
  intervals for every kilometre.
- Network mode skips the duplicate route-space index used only for along-route ordering and keeps complete
  marker navigation in file order.
- Network track coordinates no longer retain elevation fields that are unused by profile and export.
- Added a 3,300-kilometre split-performance regression, measured at roughly 45 ms locally.

## 1.21.9 — 2026-11-17

### 中文

#### 变更

- 自动识别由大量独立路线合并而成的路网 KML，不再把全网误算为一次完整行程。
- 路网模式不显示全局运动均速、休息时间、每公里表和合并海拔剖面，保留路线、标注点、照片、测距与导出。
- 路网轨迹改用 Canvas 绘制，关闭逐点圆点、全路网公里数字和异常标记，避免大量无效 Leaflet 元素。
- 路网轨迹点不再创建 `Date` 对象；5,000 航点的视口标记虚拟化继续生效。
- 新增生成式路网浏览器回归，覆盖 24 条独立路线、2,400 个轨迹点、300 个标注点和连续缩放。

### English

#### Changed

- Route-network KML files made from many independent tracks are detected automatically instead of being
  treated as one continuous trip.
- Network mode omits global moving speed, rest time, the all-network split table and the combined elevation
  profile while retaining routes, waypoints, photos, measurement and export.
- Network tracks use the Canvas renderer; per-point circles, all-network kilometre labels and anomaly badges
  are skipped to avoid thousands of ineffective Leaflet elements.
- Network points no longer allocate `Date` objects, while viewport virtualisation continues for large waypoint
  sets.
- Added a generated browser regression with 24 independent tracks, 2,400 points, 300 markers and repeated
  zooming.

## 1.21.8 — 2026-11-17

### 中文

#### 变更

- 新增共享只读轨迹模型，分段长度和累计里程只计算一次，供摘要、地图、剖面、导航、导出和每公里分析复用。
- 航点按当前视口做空间查询，只为屏幕采样需要的标记创建 Leaflet DOM；5,000 个航点仍保留全部导航项。
- 增加解析、准备、首屏、首次展开每公里和连续缩放的性能基线，并在浏览器测试中设置宽松回归阈值。

### English

#### Changed

- Added a shared read-only route model so segment lengths and cumulative distance are measured once for the
  summary, map, profile, navigation, export and split analysis.
- Waypoints are queried by viewport and only markers needed by the current screen sample create Leaflet DOM;
  5,000 waypoints still retain every navigation stop.
- Added performance baselines for parsing, preparation, first paint, first split expansion and repeated zooming,
  with broad regression budgets in the browser tests.

## 1.21.7 — 2026-11-17

### 中文

#### 变更

- 轨迹摘要将距离、高程范围和时间范围合并为一次逐点扫描，不再为时间统计重复遍历全部轨迹点。
- 缺口与异常诊断在同一预览中复用，地图图层不再重复执行同一套全轨迹检测。
- 公里标记直接复用已计算的分段长度；缩放时不再次扫描全部点计算总里程。
- 剖面、叠加图导出和测距初始化不再创建中间分段数组。

### English

#### Changed

- Route summaries now collect distance, elevation range and time range in one point pass instead of walking the
  full track again for timestamps.
- Gap and anomaly diagnostics are reused within one preview, so the map layer no longer repeats the same
  full-route scan.
- Distance markers reuse precomputed segment lengths and no longer rescan every point to calculate total
  distance when the zoom changes.
- Profile, overlay export and measurement setup no longer allocate intermediate segment arrays.

## 1.21.6 — 2026-11-17

### 中文

#### 变更

- 每公里统计改为首次展开面板时计算；收起状态只读取摘要中的里程和可用时间，不再增加打开轨迹的预处理。
- 摘要与每公里表共用同一组运动阈值，并在每条记录段开始时重置运动状态；段间时间统一计入休息时间。
- 全程与每公里的平均心率统一为所有有效点读数的算术平均值，缺失读数不会被当作零或距离权重。

### English

#### Changed

- Per-kilometre statistics are calculated only when the panel is first expanded. The collapsed entry reads
  distance and time availability from the summary instead of preprocessing every route point.
- The summary and split table now share one movement threshold configuration and reset movement at every
  recorded segment. Time between segments is consistently counted as rest.
- Whole-route and per-kilometre average heart rate now use the arithmetic mean of valid point readings; missing
  readings are neither treated as zero nor distance weights.

## 1.21.5 — 2026-11-17

### 中文

#### 变更

- 测试运行器支持按套件名称选择专项测试；未匹配任何名称的直接报错，避免零项测试误报成功。
- 新增 `test:quick` 和 `test:suite` 命令，并在测试文档中明确迭代、测试包和正式发布三档验证流程。

### English

#### Changed

- The test runner can select a focused subset by suite name and rejects unmatched names instead of reporting a
  false success from zero tests.
- Added `test:quick` and `test:suite` commands and documented separate verification levels for iteration, test
  packages and formal releases.

## 1.21.4 — 2026-11-16

### 中文

#### 修复

- 修复带照片的标记点放大查看后，点击图片外区域返回时地图可能重新计算可用区域并突然移动的问题。
- 照片全览期间继续隐藏信息卡、剖面和地图控件，但保留它们原有的布局尺寸；关闭照片后保持当前地图视野不变。

### English

#### Fixed

- Fixed the map sometimes recalculating its available area and jumping after closing a full-size photo opened from
  a photo waypoint.
- The photo viewer still hides the summary, profile and map controls, but now preserves their layout geometry and
  leaves the map view unchanged when the photo closes.

## 1.21.3 — 2026-11-16

### 中文

#### 变更

- 地图平移和缩放不再重新测量整套 DOM 布局；布局只在窗口、面板或控件尺寸变化时刷新。
- 距离标记按缩放级别缓存路线采样，普通平移不再重复扫描全部轨迹点。
- GPX 点解析改为一次遍历直接子元素，减少大文件加载时的重复扫描和临时数组。

#### 修复

- 缺口和异常 tooltip 不再登记到全局语言节点列表；连续平移不会让该列表持续增长。
- 心率统计改为单次循环，20 万点心率轨迹不会因参数展开触发调用栈溢出。
- WebView2 快捷键、天地图状态和导出回调统一处理浏览器关闭及 COM 进程异常。
- KMZ 导出的叠加图现在保存在原始 KMZ 同级目录，不再写入临时解包目录。
- GPX、KML、KMZ 和 FIT 统一限制为 64 MB，超限文件在启动 WebView 前显示明确错误。

### English

#### Changed

- Map panning and zooming no longer remeasure the full DOM layout; layout refreshes only when the window,
  panels or controls change size.
- Distance markers cache route samples per zoom level, so ordinary panning no longer scans every track point.
- GPX point parsing now walks direct children once, reducing repeated scans and temporary arrays on large files.

#### Fixed

- Gap and anomaly tooltips no longer register in the global language-node list, so repeated panning cannot grow
  that list indefinitely.
- Heart-rate statistics use one pass, preventing call-stack overflow on 200,000-reading tracks.
- WebView2 shortcut, Tianditu-state and export callbacks consistently handle browser shutdown and COM errors.
- Overlays exported from KMZ files now go beside the original KMZ instead of the temporary extraction folder.
- GPX, KML, KMZ and FIT inputs share a 64 MB limit and fail clearly before WebView starts.

## 1.21.2 — 2026-11-16

### 中文

#### 修复

- 心率统计改为单次循环，不再通过参数展开求最小值和最大值；20 万点心率轨迹不会触发调用栈溢出。
- WebView2 快捷键、天地图状态和导出回调统一识别浏览器关闭及 COM 进程异常，关闭预览时不再产生未处理异常。
- 修复从 KMZ 导出的叠加图被写入临时解包目录并在关闭预览后丢失的问题；现在保存在原始 KMZ 同级目录。
- GPX、KML、KMZ 和 FIT 统一限制为 64 MB，超限文件在启动 WebView 前显示明确错误。

### English

#### Fixed

- Heart-rate statistics now use one pass instead of argument spreading for minimum and maximum values, so
  200,000-reading tracks no longer trigger call-stack overflow.
- WebView2 shortcut, Tianditu-state and export callbacks now consistently recognise browser shutdown and COM
  process errors, preventing unhandled exceptions when a preview closes.
- Fixed overlays exported from KMZ files being written into the temporary extraction folder and deleted when the
  preview closed; exports now go beside the original KMZ.
- GPX, KML, KMZ and FIT inputs now share a 64 MB limit. Oversized files fail clearly before WebView starts.

## 1.21.1 — 2026-11-16

### 中文

#### 修复

- 修复从 KMZ 导出的叠加图被写入临时解包目录、关闭预览后丢失的问题；现在始终保存在原始 KMZ 同级目录。
- GPX、KML、KMZ 和 FIT 统一限制为 64 MB，超限文件在启动 WebView 前显示明确错误，避免内存耗尽。

### English

#### Fixed

- Fixed overlays exported from KMZ files being written into the temporary extraction folder and deleted when the
  preview closed; exports now go beside the original KMZ.
- GPX, KML, KMZ and FIT inputs now share a 64 MB limit. Oversized files fail with a clear message before WebView
  starts, preventing memory exhaustion.

## 1.21.0 — 2026-11-16

### 中文

#### 新增

- 有心率数据的 FIT 和 GPX 轨迹可在海拔剖面上叠加心率曲线；使用独立 bpm 纵轴、默认关闭，悬停读数
  同步显示当前心率；横虚线标出全程平均心率。

#### 变更

- 附件图片小弹窗复用标记点列表的无磨砂半透明背景；照片全览保持深色半透明外围，并在查看期间隐藏重复
  的摘要、剖面、工具箱和地图操作控件。
- 心率开关固定在剖面标题旁，图标恢复为 12 px，文字始终位于胶囊内，不再随窗口宽度改变位置。

### English

#### Added

- FIT and GPX tracks with heart-rate data can overlay heart rate on the elevation profile, using an independent
  bpm axis. The overlay is off by default, adds the current reading to the hover/touch readout and marks the
  whole-route average with a dashed horizontal line.

#### Changed

- Attachment preview cards reuse the waypoint list's unblurred translucent background. The full-size viewer
  keeps its dark semi-transparent surround and hides duplicate summary, profile, toolbox and map controls.
- The heart-rate switch stays beside the profile title, uses a 12 px icon and keeps its label inside the pill
  instead of moving between layouts.

## 1.20.11 — 2026-11-16

### 中文

#### 变更

- 点击带附件图片时的小弹窗复用标记点列表的半透明背景，不使用磨砂。
- 照片全览继续使用已确认的深色半透明背景，并在查看期间隐藏底层重复的摘要、分段、剖面、工具箱和
  地图操作控件，只保留地图内容与必要署名。

### English

#### Changed

- Attachment preview cards now reuse the waypoint list's translucent background without a frosted filter.
- The full-size viewer keeps its confirmed dark semi-transparent background and hides duplicate summary,
  split, profile, toolbox and map-operation controls, leaving the map content and required attribution visible.

## 1.20.10 — 2026-11-16

### 中文

#### 新增

- 右上角新增统一 **工具箱**，集中提供多段手动测距和叠加图导出。
- 测距支持右键打点、左键拖图、滚轮缩放、14 px 屏幕吸附、分段小计和总距离；提供结束本段、撤销、
  重做、清空、结束测距和地图中心打点。
- 新增测距快捷键：<kbd>M</kbd> 开始/结束，测距中 <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤回，
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做；宿主只在测距激活时接管历史快捷键。
- 新增集中式图标注册表和 [图标规范](docs/ICON_SYSTEM.md)：UI 图标使用统一 24×24 网格、16/12 px
  尺寸档、1.75 px 圆角描边、无填充和统一蓝色激活态；地图数据符号保留语义填充色。
- 叠加图导出面板新增关闭按钮，关闭后焦点返回打开前的控件。

#### 变更

- 工具箱、测距、导出和地图图层面板统一使用半透明背景与背景模糊；任务面板贴近窗口右侧，
  测距与导出面板互斥显示。
- 重绘缩放、定位、图层、设置、标记点、列表、工具箱、速览、照片和数据符号图标；
  Leaflet 加减与弹窗关闭符号由应用图标适配层替换，不改第三方文件。
- 每公里详细表格改用紧凑固定列网格，增加累计时间、上升/下降、平均心率、运动速度和垂直速度；
  底部汇总总时间、运动时间和休息时间。
- 照片全览显示真实原图像素比例，支持最高 800% 滚轮缩放、拖拽平移和点击百分比恢复适应窗口。

#### 修复

- 修复 KMZ 内相对路径照片无法显示的问题；保留 KML 父目录并受限解包 JPG、PNG、WebP、GIF、BMP、AVIF。
- 修复高分辨率照片放大后的纹理接缝，以及大照片缩放和窗口变化后的比例失真。
- 修复地图图源面板混合显示所有地图类型的问题；现在只显示当前类型对应图源。
- 修复每公里标题栏右侧激活色缺失、缩放加减符号未居中，以及分段数据列头的多余装饰图标。
- 修复测距公里标签过度遮挡线路的问题，降低底色透明度与阴影强度。
- 同步更新中英文 README、使用说明、架构、测试、图标规范、handoff 和当前界面截图。
- 修复照片查看器浏览器测试在切换照片时过早读取缩放状态的竞态，避免云端发布验证偶发失败。

### English

#### Added

- Added a unified **Toolbox** for multi-section manual distance measurement and overlay export.
- Measurement supports right-click points, left-drag panning, wheel zoom, 14 px screen snapping, section
  subtotals and an overall distance, with end-section, undo, redo, clear, finish and centre-point actions.
- Added measurement shortcuts: <kbd>M</kbd> toggles measuring, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes and
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redoes. The host captures history keys only while measuring.
- Added the centralized icon registry and [icon specification](docs/ICON_SYSTEM.md): UI icons share a 24×24
  grid, 16/12 px tiers, 1.75 px rounded no-fill strokes and one blue active state; semantic map symbols keep
  their fills.
- Added a close button to the overlay-export panel, restoring focus to the control that opened it.

#### Changed

- Toolbox, measurement, export and map-layer panels now use a translucent blurred surface; task panels sit on
  the right and measurement/export are mutually exclusive.
- Redrew zoom, locate, layers, settings, marker, list, toolbox, overview, photo and data-symbol icons.
  Application code adapts Leaflet zoom and popup-close glyphs without modifying the vendored library.
- Reworked per-kilometre details into compact fixed columns with cumulative time, ascent/descent, average heart
  rate, moving speed and vertical speed; totals include total, moving and rest time.
- Photo viewing now reports true source-pixel percentage with wheel zoom up to 800%, drag-to-pan and a
  click-to-fit percentage control.

#### Fixed

- Fixed KMZ photos using relative paths by preserving the KML parent directory and safely extracting referenced
  JPG, PNG, WebP, GIF, BMP and AVIF assets.
- Fixed texture seams in zoomed high-resolution photos and inaccurate scale after large-photo or window changes.
- Fixed the map-source panel mixing providers from every map type; only providers for the active type appear.
- Fixed the missing right edge of the expanded split header, off-centre zoom glyphs and decorative split-header
  icons.
- Reduced measurement-label background opacity and shadow so the measured line and map routes remain visible.
- Synchronized the bilingual README, usage, architecture, testing, icon specification, handoff and current
  interface screenshot.
- Fixed a timing race in the photo-viewer browser test that read the zoom state before a photo switch had
  finished, preventing intermittent cloud release-validation failures.

## 1.20.9 — 2026-11-16

### 中文

#### 新增

- 右上角新增统一 **工具箱**，集中提供多段手动测距和叠加图导出。
- 测距支持右键打点、左键拖图、滚轮缩放、14 px 屏幕吸附、分段小计和总距离；提供结束本段、撤销、
  重做、清空、结束测距和地图中心打点。
- 新增测距快捷键：<kbd>M</kbd> 开始/结束，测距中 <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤回，
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做；宿主只在测距激活时接管历史快捷键。
- 新增集中式图标注册表和 [图标规范](docs/ICON_SYSTEM.md)：UI 图标使用统一 24×24 网格、16/12 px
  尺寸档、1.75 px 圆角描边、无填充和统一蓝色激活态；地图数据符号保留语义填充色。
- 叠加图导出面板新增关闭按钮，关闭后焦点返回打开前的控件。

#### 变更

- 工具箱、测距、导出和地图图层面板统一使用半透明背景与背景模糊；任务面板贴近窗口右侧，
  测距与导出面板互斥显示。
- 重绘缩放、定位、图层、设置、标记点、列表、工具箱、速览、照片和数据符号图标；
  Leaflet 加减与弹窗关闭符号由应用图标适配层替换，不改第三方文件。
- 每公里详细表格改用紧凑固定列网格，增加累计时间、上升/下降、平均心率、运动速度和垂直速度；
  底部汇总总时间、运动时间和休息时间。
- 照片全览显示真实原图像素比例，支持最高 800% 滚轮缩放、拖拽平移和点击百分比恢复适应窗口。

#### 修复

- 修复 KMZ 内相对路径照片无法显示的问题；保留 KML 父目录并受限解包 JPG、PNG、WebP、GIF、BMP、AVIF。
- 修复高分辨率照片放大后的纹理接缝，以及大照片缩放和窗口变化后的比例失真。
- 修复地图图源面板混合显示所有地图类型的问题；现在只显示当前类型对应图源。
- 修复每公里标题栏右侧激活色缺失、缩放加减符号未居中，以及分段数据列头的多余装饰图标。
- 修复测距公里标签过度遮挡线路的问题，降低底色透明度与阴影强度。
- 同步更新中英文 README、使用说明、架构、测试、图标规范、handoff 和当前界面截图。

### English

#### Added

- Added a unified **Toolbox** for multi-section manual distance measurement and overlay export.
- Measurement supports right-click points, left-drag panning, wheel zoom, 14 px screen snapping, section
  subtotals and an overall distance, with end-section, undo, redo, clear, finish and centre-point actions.
- Added measurement shortcuts: <kbd>M</kbd> toggles measuring, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes and
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redoes. The host captures history keys only while measuring.
- Added the centralized icon registry and [icon specification](docs/ICON_SYSTEM.md): UI icons share a 24×24
  grid, 16/12 px tiers, 1.75 px rounded no-fill strokes and one blue active state; semantic map symbols keep
  their fills.
- Added a close button to the overlay-export panel, restoring focus to the control that opened it.

#### Changed

- Toolbox, measurement, export and map-layer panels now use a translucent blurred surface; task panels sit on
  the right and measurement/export are mutually exclusive.
- Redrew zoom, locate, layers, settings, marker, list, toolbox, overview, photo and data-symbol icons.
  Application code adapts Leaflet zoom and popup-close glyphs without modifying the vendored library.
- Reworked per-kilometre details into compact fixed columns with cumulative time, ascent/descent, average heart
  rate, moving speed and vertical speed; totals include total, moving and rest time.
- Photo viewing now reports true source-pixel percentage with wheel zoom up to 800%, drag-to-pan and a
  click-to-fit percentage control.

#### Fixed

- Fixed KMZ photos using relative paths by preserving the KML parent directory and safely extracting referenced
  JPG, PNG, WebP, GIF, BMP and AVIF assets.
- Fixed texture seams in zoomed high-resolution photos and inaccurate scale after large-photo or window changes.
- Fixed the map-source panel mixing providers from every map type; only providers for the active type appear.
- Fixed the missing right edge of the expanded split header, off-centre zoom glyphs and decorative split-header
  icons.
- Reduced measurement-label background opacity and shadow so the measured line and map routes remain visible.
- Synchronized the bilingual README, usage, architecture, testing, icon specification, handoff and current
  interface screenshot.

## 1.20.8 — 2026-11-16

### 中文

#### 变更

- 同步更新中英文 README、使用说明、架构、测试、图标规范和当前界面截图。
- 文档补充图源分类过滤、透明工具表面、测距快捷键、测距/导出互斥、导出关闭按钮、分段表纯文字列头、
  测距标签透明度和当前图标规范。
- 重写项目 handoff，使当前功能、验证命令、安装包要求与已知风险保持一致。

### English

#### Changed

- Updated the bilingual README, usage guide, architecture, testing, icon specification and current interface
  screenshot.
- Documented map-source filtering, translucent tool surfaces, measurement shortcuts, tool/export mutual
  exclusion, the export close button, text-only split headers, translucent measurement labels and the current
  icon system.
- Rewrote the project handoff with the current feature set, verification commands, packaging requirement and
  known risks.

## 1.20.7 — 2026-11-16

### 中文

#### 变更

- 测距中跟随线路的公里标签改为更透明的底色和更轻的阴影，减少对测距线和底图线路的遮挡。

### English

#### Changed

- Measurement distance labels now use a more transparent background and lighter shadow, reducing obstruction
  of the measured route and underlying map lines.

## 1.20.6 — 2026-11-16

### 中文

#### 新增

- 叠加图导出面板标题栏新增统一关闭按钮，可直接关闭设置面板并将焦点返回打开前的控件。

### English

#### Added

- Added a shared close button to the overlay-export panel header. It dismisses the panel and restores focus to
  the control that opened it.

## 1.20.5 — 2026-11-16

### 中文

#### 变更

- 地图图层面板改用与工具箱、测距和叠加图导出面板相同的半透明背景与背景模糊效果。

### English

#### Changed

- The map-layer panel now uses the same translucent, blurred surface as the toolbox, measurement and
  overlay-export panels.

## 1.20.4 — 2026-11-16

### 中文

#### 修复

- 修复地图图源面板同时显示所有地图类型图源的问题；现在只列出当前“路网 / 地形 / 卫星 / 无底图”类型对应的图源。
- 每公里面板展开时，蓝色激活背景现在覆盖完整标题栏，右侧不再出现缺失色块。
- 恢复每公里表格列头为纯文字，移除顶部横向标题中的装饰图标。
- 修复地图放大、缩小符号未在 30 px 按钮内水平垂直居中的问题。
- 测距面板在宽窗中固定贴近窗口右侧，不再依赖工具箱按钮所在位置。
- 工具箱/测距面板与叠加图导出面板现在互斥显示，打开一个会自动关闭另一个。

### English

#### Fixed

- Fixed the map-source menu showing providers from every map type; it now lists only sources belonging to
  the active Road, Terrain, Satellite or No-map category.
- The expanded per-kilometre header now paints its complete blue active surface without a missing right edge.
- Restored text-only per-kilometre column headers and removed the decorative header icons.
- Centred the map zoom plus/minus glyphs horizontally and vertically inside their 30 px buttons.
- Anchored the measurement panel to the right edge of wide previews instead of the toolbox button position.
- The toolbox/measurement and overlay-export panels are now mutually exclusive and automatically close each
  other when one opens.

## 1.20.3 — 2026-11-16

### 中文

#### 新增

- 新增集中式图标注册表和 [图标规范](docs/ICON_SYSTEM.md)，统一 UI 图标的 24×24 网格、16/12 px 尺寸档、
  1.75 px 圆角描边、无填充策略及蓝色激活态。
- 地图数据符号采用独立双轨规范：保留语义填充色，同时统一深色 1.5 px 描边与几何比例。

#### 变更

- 重绘缩放、定位、图层、设置、返回、关闭、选中、标记点、列表、工具箱、测距及其操作按钮图标。
- 分段表全部列头改用紧凑图标；速览、照片查看器和弹窗关闭/翻页操作改用统一图标。
- 航点、照片角标、方向箭头、数据缺口、GPS 异常、起终点、剖面航点和剖面游标按数据符号规范重绘。
- Leaflet 的加减缩放和弹窗关闭按钮由应用图标适配层替换，第三方 vendor 文件保持不变。

### English

#### Added

- Added a centralized icon registry and [icon specification](docs/ICON_SYSTEM.md) for the 24×24 grid,
  16/12 px size tiers, 1.75 px rounded no-fill strokes and blue active state.
- Map data symbols now follow a separate dual-track policy that keeps semantic fills while standardizing dark
  1.5 px outlines and proportions.

#### Changed

- Redrew zoom, locate, layers, settings, back, close, selected, marker, list, toolbox, measurement and
  measurement-action icons.
- Split-table headers now use compact registered icons; the waypoint overview and photo viewer use the same
  close, edit and navigation system.
- Redrew waypoint pins, photo badges, direction arrows, data gaps, GPS anomalies, start/end points, profile
  pins and the profile scrubber as consistent semantic data symbols.
- Leaflet zoom and popup-close controls are adapted by application code; vendored Leaflet files remain untouched.

## 1.20.2 — 2026-11-16

### 中文

#### 新增

- 测距新增 <kbd>M</kbd> 开始/结束切换；测距中按 <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤回，
  按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做。
- 工具箱主面板增加独立的“重做”按钮，并实时反映撤回/重做是否可用。
- QuickLook 宿主仅在测距激活时接管测距历史快捷键，未测距时保留资源管理器的普通 <kbd>Ctrl</kbd>+<kbd>Z</kbd>。

#### 变更

- 工具箱、测距和叠加图导出等任务面板统一使用半透明背景与背景模糊，作为后续工具页面的视觉规范。

### English

#### Added

- Added <kbd>M</kbd> to start or finish measuring, <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo and
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> to redo while measuring.
- Added a dedicated redo action to the toolbox measurement panel with live enabled states.
- The QuickLook host captures measuring history shortcuts only while measuring, leaving ordinary
  <kbd>Ctrl</kbd>+<kbd>Z</kbd> with the file manager when the tool is inactive.

#### Changed

- Toolbox, measurement and overlay-export task panels now share a translucent blurred surface as the standard
  for future tool pages.

## 1.20.1 — 2026-11-16

### 中文

#### 变更

- 工具箱操作图标统一为简洁的单色描边模板：测距使用斜向标尺，叠加图导出使用“图像 + 下载”符号。
- 操作图标统一为 16 px、1.75 px 描边、圆角端点和无填充样式；测距激活态继续使用蓝色强调底。

### English

#### Changed

- Unified toolbox action icons around a simple monochrome stroke template: a diagonal ruler for measuring and
  an image-with-download mark for overlay export.
- Action icons now share a 16 px size, 1.75 px stroke, rounded caps and no fill; the active measurement state
  keeps its blue emphasis.

## 1.20.0 — 2026-11-16

### 中文

#### 新增

- 右上角新增统一 **工具箱**，集中提供 **距离测量** 与 **叠加图导出**。
- 距离测量支持多段右键打点、左键拖动地图和滚轮精确缩放；总距离与每段距离实时更新。
- 打点时在 14 px 屏幕范围内自动吸附标记点或轨迹采样点，并显示吸附目标；隐藏的标记点仍可作为吸附目标。
- 提供结束本段、撤销打点、清空、结束测距和地图中心打点操作，满足多段距离核算和键盘操作。

### English

#### Added

- Added a unified **Toolbox** in the upper-right map corner for **Measure distance** and **Export overlay**.
- Distance measurement supports multi-section right-click point collection while left-drag panning and wheel
  zoom remain available; section subtotals and the overall distance update live.
- Points snap to waypoint markers or recorded track samples within a 14 px screen radius and identify the
  target while hovering. Hidden waypoint pins remain valid snap targets.
- Added end-section, undo, clear, finish-measuring and add-at-map-centre actions for multi-section and
  keyboard-operable measurement workflows.

## 1.19.2 — 2026-11-15

### 中文

#### 新增

- 照片全览的百分比改为真实原图像素比例：显示宽度除以图片原始宽度，100% 表示图片按 1:1 像素显示，
  不再把“适应窗口”误报为 100%。
- 初始仍自动适应窗口并显示实际比例；窗口变大或缩小时百分比同步更新。滚轮改为绝对比例档位，最高 800%，
  最低不低于当前适应尺寸；手动缩放后调整窗口会保持真实比例。
- 放大后的照片支持鼠标拖拽平移；点击右上角百分比可恢复适应窗口。切换照片或重新打开时也会重新适应窗口。

#### 变更

- 每公里表格改用固定列网格，列宽由数据模型统一定义，面板按实际列宽总和控制，不再把剩余空间不均匀
  分摊到各列。
- 所有数据列统一左右 6 px 内边距、1 px 低对比度列分隔线并右对齐，圈号居中；简要模式约 240 px、
  无心率详细模式约 452 px、有心率详细模式约 504 px。
- 首列表头由两字“圈数”改为单字“圈”，避免固定列宽下换行造成表头与滚动行错位。
- 表头字号从 9 px 提升到 10.5 px，同步增加行高和文字对比度，与 11.5 px 的数据字号更协调。
- 中文“平均心率”表头缩为单行“心率”，完整说明保留在悬停提示和无障碍标签中。
- 详细模式底部改为总时间、运动时间、休息时间三栏等宽排列；休息时间优先使用文件暂停总量，
  缺失时按总时间减运动时间计算。简要模式仍保留两栏。
- 英文长表头允许在各自列内换行，纵向滚动条预留固定槽位，避免切换模式和滚动时列宽跳动。

#### 修复

- 修复 KMZ 内使用相对路径的照片无法显示的问题。解包时保留 KML 的原始父目录，并只提取 KML
  实际引用的本地 JPG、PNG、WebP、GIF、BMP 和 AVIF 图片，使照片 URL 能继续从虚拟文件主机加载。
- 图片引用支持空格、URL 编码、查询参数、父级相对路径和 KML `Icon/href`；缺失图片不会阻止轨迹打开。
- 每个 KMZ 最多提取 200 张本地图片、单张不超过 30 MB、累计不超过 300 MB；越出解包根目录的引用会被忽略，
  重复引用只处理一次，仅大小写不同的歧义资源不会解包。
- 修复高分辨率照片放大后出现的等距浅色分隔线。图片不再通过 CSS `scale()` 作为超大 GPU 合成层缩放，
  改为直接按目标像素尺寸排版；拖拽平移只使用二维位移，避免 WebView2 纹理分块接缝。

### English

#### Added

- Full-size photo percentages now describe the true source-pixel ratio: displayed width divided by natural width,
  so 100% means a 1:1 image rather than an arbitrary fit-to-window baseline.
- The viewer still fits a photo on open but reports that fitted percentage. Resizing the window updates the
  percentage in fit mode. Mouse-wheel zoom uses absolute levels up to 800%, never below the current fitted size,
  and manual zoom preserves its true percentage across window resizes.
- Zoomed photos can be dragged to pan. Clicking the percentage restores fit-to-window; changing photos or
  reopening the viewer also starts from a fresh fit.

#### Changed

- Reworked the split table as a deterministic fixed-column grid. Column widths now come from one shared model
  and the panel sizes itself from their total instead of distributing unused space unevenly.
- All data columns now use a uniform 6 px gutter, a 1 px low-contrast separator and right-aligned values; the
  index is centred. Basic mode is about 240 px, detailed without heart rate about 452 px, and detailed with
  heart rate about 504 px.
- The first column label is now the single-character “圈” instead of “圈数”, so the 24 px column cannot wrap
  the header and make it look misaligned with the scrolled rows.
- Header type is increased from 9 px to 10.5 px with slightly more line height and contrast, making it visually
  consistent with the 11.5 px data rows.
- The Chinese “average heart rate” header is shortened to the single-line “心率”, with the full meaning kept in
  its tooltip and accessible label.
- Detailed mode now ends with three equal columns for total, moving and rest time. Rest time uses the recorded
  pause total when available, otherwise total time minus moving time; basic mode keeps its two-column footer.
- Long English headers wrap inside their columns, and the vertical scrollbar reserves a stable gutter so
  column widths do not jump while switching modes or scrolling.

#### Fixed

- Fixed relative-path photos inside KMZ archives. Extraction now preserves the KML document's original parent
  directory and copies the local JPG, PNG, WebP, GIF, BMP and AVIF images it references, so photo URLs remain
  available through the virtual file host.
- Image references support spaces, URL encoding, query strings, parent-relative paths and KML `Icon/href`.
  A missing image no longer prevents the route from opening.
- Each KMZ is bounded to 200 local images, 30 MB per image and 300 MB in total. References that escape the
  extraction root are ignored, duplicate references are extracted once, and case-ambiguous resources are skipped.
- Fixed evenly spaced pale seams that could appear over high-resolution photos after zoom. Images are now laid
  out at their target pixel dimensions instead of being scaled as an oversized CSS compositor layer, and drag
  panning uses 2D translation only, avoiding WebView2 texture-tile seams.

## 1.19.1 — 2026-11-15

### 中文

#### 删除

- 移除每公里分段以 `Enter` / `Space` 激活的快捷方式及相关文案。分段行通过 `Tab` 获得焦点时会立即选中
  并定位，不再需要额外按键；鼠标点击同样可以选圈。

### English

#### Removed

- Removed split-row Enter/Space activation and its documentation. Moving focus to a row with Tab now selects
  and locates it immediately; clicking a row also selects it.

## 1.19.0 — 2026-11-15

### 中文

#### 新增

- 新增 `.fit` 活动与路线文件预览。读取带 GPS 的 `record` 消息，并展示时间、经纬度、海拔和
  `course_point` 标记点。
- 使用 `session` 的总耗时和计时时间；总时间悬停提示中的运动时间优先采用 FIT 记录的计时时间，
  展示里程仍由 GPS 轨迹点计算。
- 支持 FIT 普通时间戳、压缩时间戳、大小端定义、开发者字段跳过、无效值过滤以及文件与头部 CRC 校验。
- 简介下方新增独立的每公里折叠项，打开文件时默认收起；主动点击后才显示分段距离、实际经过时间和
  按运动时间计算的平均速度。底部汇总总时间与运动时间，最快分段使用强调色标出。长路线在固定高度区域内
  滚动，不把地图横向撑宽；展开时只向下避让，不改动缩放/定位/导出控件列的位置。简介卡与分段面板同时
  展开时按两者实际高度顺序堆叠，不再相互覆盖。展开或收起只更新安全区域，不再重新适配整条轨迹，
  避免底图重新加载造成闪黑。
- 每公里行支持鼠标点击和键盘 `Enter` / `Space` 选中。选中后自动聚焦该里程对应的轨迹范围，并用高对比
  青色覆盖强调；再次选择同一行或收起面板会清除轨迹强调。
- 每公里面板默认显示简要四列，并可在标题栏一键切换详细模式；详细模式增加累计时间、累计上升/下降、
  平均心率、运动速度和垂直速度。文件没有有效心率数据时自动省略平均心率列，不保留空白项。
- 增加 FIT 活动、压缩时间、开发者字段、路线点、截断文件、损坏校验和和无 GPS 训练文件的自动测试。
- 增加分段边界、停留排除、文件记录暂停总量、无时间轨迹、窄窗布局和第二版字段契约测试。
- 收窄每公里分段面板：简要模式 288 px、详细模式 520 px（无心率 470 px），压缩列宽和单元格间距、数字右对齐，并移除表头图标；窄窗仍可在表格内部横向滚动。

#### 说明

- 简要模式聚焦轨迹绘制和速度所需的必要数据；步频、功率、温度和训练步骤等完整设备指标暂不展示。
- 工作区真实 COROS FIT 已验证为 17,721 个可绘制点、19.70 km、110–811 m，耗时 7 小时 19 分，
  与同名 KML 的轨迹和海拔范围一致。

### English

#### Added

- Added `.fit` activity and course previews. GPS `record` messages provide time, coordinates and elevation,
  while `course_point` messages appear as map markers.
- `session` totals supply elapsed time and timer time; moving time prefers the FIT timer duration in the
  total-time tooltip while displayed distance remains calculated from GPS points.
- Added normal and compressed FIT timestamps, both byte orders, developer-field skipping, invalid-value
  filtering, and header/file CRC validation.
- Added an independent, collapsed-by-default split entry below the route summary. Clicking it reveals
  segment distance, elapsed time and moving speed, plus total and moving-time totals. The fastest split is
  emphasized, and long routes scroll inside a fixed-height table without widening the map. Expansion moves
  downward only and never changes the zoom/locate/export control column. Expanded summary details and splits
  now stack by their measured heights instead of overlapping.
- Split rows are selectable with a click or keyboard Enter/Space. Selecting one focuses the matching trajectory
  range and emphasizes it in high-contrast cyan; selecting it again or collapsing the panel clears the overlay.
- Splits open in the four-column basic mode and can switch to detailed mode in one click. Detailed mode adds
  cumulative time, ascent, descent, average heart rate, moving speed and vertical speed. The heart-rate column
  is omitted entirely when the file has no valid heart-rate data.
- Added automated coverage for FIT activities, compressed timestamps, developer fields, course points,
  truncated files, damaged checksums and GPS-free workouts.
- Added coverage for split boundaries, pause exclusion, recorded timer totals, untimed routes, narrow-window
  layout and the detailed-phase column contract.
- Tightened the per-kilometre split panel: 288 px in basic mode and 520 px in detailed mode (470 px
  without heart rate), with narrower columns, tighter cell spacing, right-aligned numbers and no header
  icons; narrow windows still scroll the table horizontally.

#### Notes

- Basic mode focuses on the data needed to draw and pace a track. Cadence, power, temperature, workout steps and
  the full device metric set are not displayed yet.
- A real COROS FIT in the workspace resolves to 17,721 drawable points, 19.70 km, 110–811 m and 7 h 19 min,
  matching the route and elevation range of the companion KML.

## 1.18.6 — 2026-11-15

### 中文

#### 修复

- 修复 KML 点位使用标准 `<Style><IconStyle><Icon><href>` 内联图标时被误当成空节点并导致整条轨迹
  打不开的问题。
- 兼容 COROS 等导出的 KML 2.1 文件；已验证包含 17,722 个点位的登山轨迹可以正常打开和绘制。

### English

#### Fixed

- Fixed KML tracks failing to open when a point uses the standard inline
  `<Style><IconStyle><Icon><href>` icon structure.
- Added compatibility for KML 2.1 exports such as COROS files; a 17,722-point hiking track now parses and
  renders successfully.

## 1.18.5 — 2026-11-10

> 这是 `v1.17.2` 之后的首个公开版本。以下内容累积 `1.18.0` 至 `1.18.5` 的新增、变更、删除、修复和安全更新。
>
> This is the first public release after `v1.17.2`. The notes below cumulatively cover additions, changes,
> removals, fixes and security updates from `1.18.0` through `1.18.5`.

### 中文

#### 新增

- 地形图新增 OpenHikingMap 和 OpenTopoMap，CyclOSM 继续作为默认地形图源。
- 路网图和卫星图新增天地图，分别使用 `vec_w + cva_w` 与 `img_w + cia_w` 官方 WMTS 底图/注记组合。
- 增加天地图密钥配置：密钥使用当前 Windows 用户的 DPAPI 加密保存，并在页面创建前注入当前预览。

#### 修复

- 公共包改为在页面创建前由宿主注入 DPAPI 天地图密钥，页面直接请求官方 WMTS，不再依赖逐瓦片
  WebMessage RPC。
- 配置或更换密钥后，页面即时重建直连图层并完成之前待选的天地图图源。
- 地图设置页提供“更换密钥 / 移除密钥”入口，密钥只从当前用户的 DPAPI 存储读取。
- 单个天地图瓦片失败不再清空密钥或切换图源；连续失败会保留密钥并自动重试。
- 宿主旁路读取天地图 HTTP 状态，只有明确的 401/403 才提示密钥或域名被拒绝。
- 点击当前地图类型打开或关闭图层面板时不会重建活动瓦片图层，消除地图闪黑。

#### 删除

- 删除私有内置密钥配置与 `-private.qlplugin` 打包链路，只维护一种公开部署方式。
- 删除宿主的逐瓦片代理、专用瓦片虚拟主机和 `tile-request` / `tile-result` WebMessage 状态机。
- 删除进程环境变量读取密钥的旁路，避免出现未写入文档的第二种配置来源。

#### 变更

- 原“地图”类别并入“路网”，最终保留路网、地形、卫星和无底图四种类型。
- 图源偏好升级为具体图源 ID，同时兼容旧的 `map`、`terrain`、`satellite` 和 `none` 值；各类型继续记住
  上次选择的图源。
- 顶部地图工具统一为 32 px 高度；标记点与列表合并为一个连续工具组，语言保持独立。
- 路网、地形、卫星和无底图合并为一个“当前图层”入口；展开面板分“地图类型”和“地图图源”两级，
  `Q / E` 快捷键继续循环切换类型。
- 窄窗中的图层入口只显示图标、当前类型短标签和下拉箭头，图层面板改为剖面上方的底部浮层。
- 天地图密钥操作移入图层面板标题栏右上角的“地图设置”二级页，主图层列表只保留类型和图源。
- 未配置天地图密钥时，选择天地图图源会直接进入地图设置页，不再立即弹出系统密钥窗口。
- 标记点启用态改用强调色圆点，避免与当前地图分类的蓝色选中态争夺视觉焦点。
- 中文图源菜单将“OpenStreetMap 人道主义风格”简化为“OpenStreetMap”。

#### 安全

- 天地图密钥不写入源码、页面 URL、浏览器存储、日志或公开发布包。
- 宿主只识别天地图官方 HTTPS 响应，并新增仓库密钥扫描，阻止 `tk=` 和供应商明文密钥提交。

### English

#### Added

- Terrain now offers OpenHikingMap and OpenTopoMap alongside the default CyclOSM source.
- Road and Satellite now offer Tianditu using the official `vec_w + cva_w` and `img_w + cia_w` WMTS
  base/label layer pairs.
- Added Tianditu key configuration: the key is encrypted with Windows DPAPI for the current user and injected
  into the preview before page creation.

#### Fixed

- Public builds now receive the DPAPI Tianditu key from the host before page creation and request the official
  WMTS directly instead of relying on per-tile WebMessage RPC.
- Configuring or changing a key rebuilds direct layers immediately and completes any pending Tianditu selection.
- Map settings keeps the Change key and Remove key actions, and keys are read only from the current user's
  DPAPI store.
- A single Tianditu tile failure no longer clears the key or switches providers; repeated failures keep the key
  and retry automatically.
- The host observes Tianditu HTTP statuses out of band, and only an explicit 401/403 reports a rejected key or
  domain.
- Opening or closing the layer panel on the active map type no longer rebuilds its tile layer, removing the
  brief black flash.

#### Removed

- Removed private embedded-key packaging and the `-private.qlplugin` path so there is only one deployment model.
- Removed the host per-tile proxy, dedicated tile virtual host and `tile-request` / `tile-result` WebMessage
  state machine.
- Removed the process-environment key bypass so key configuration has one documented source.

#### Changed

- The former Map category is now part of Road, leaving Road, Terrain, Satellite and No map.
- Layer preferences now use provider IDs while remaining compatible with legacy `map`, `terrain`, `satellite`
  and `none` values; each type continues to remember its last selected source.
- Road, Terrain, Satellite and No map now share one current-layer entry. Its panel separates map type from
  source, while Q / E still cycle the type.
- The narrow layer entry keeps only the icon, current-type abbreviation and chevron; the layer panel becomes a
  bottom sheet above the profile.
- Tianditu key management now lives on a Map settings page opened by the gear in the layer-panel header, leaving
  the main layer list focused on type and source.
- Selecting an unconfigured Tianditu source opens Map settings instead of immediately opening the native key
  dialog.
- The active marker switch now uses an accent-coloured dot instead of competing with the selected map category
  as a second solid blue block.

#### Security

- Tianditu keys are not written to source, page URLs, browser storage, logs or public release packages.
- The host recognises only official Tianditu HTTPS responses, and a repository secret scan rejects plaintext
  `tk=` values and provider keys.

## 1.18.4 — 2026-11-09

### 中文

#### 新增

- 增加仅限本机使用的私有直连打包：从环境变量读取用户自己的天地图浏览器端密钥，直接使用官方 WMTS
  图层，绕过宿主瓦片传输。
- 增加公开/私有共享打包模块；公开包拒绝非空私有配置。

#### 安全

- 仓库中的 `viewer/private-config.js` 始终为空；真实密钥只写入临时打包副本，完成后立即删除。
- 私有安装包含可直接提取的密钥，因此明确命名为 `-private.qlplugin`，不得推送或公开发布。

### English

#### Added

- Added local-only direct packaging for Tianditu: a user-owned browser key is read from an environment variable
  and the official WMTS layers are requested directly, bypassing host tile transport.
- Added a shared packaging module for public and private builds; public packages reject a non-empty private
  configuration.

#### Security

- The tracked `viewer/private-config.js` remains empty. Real keys are written only into a temporary packaging
  copy and removed afterwards.
- Private packages contain an extractable key, use the explicit `-private.qlplugin` suffix, and must never be
  pushed or published.

## 1.18.3 — 2026-11-09

### 中文

#### 修复

- 天地图瓦片改用页面与宿主之间的 WebMessage 通道传输，不再依赖在部分 QuickLook 环境中不触发的
  `WebResourceRequested`。
- 浏览器测试继续使用本地 HTTP 代理回退；真实 QuickLook 使用 Host 获取并返回 Data URL。
- 修复自定义消息瓦片在取得图片地址前被误判为已完成的问题。

### English

#### Fixed

- Tianditu tiles now use a WebMessage channel between the page and host instead of relying on
  `WebResourceRequested`, which did not fire in some QuickLook environments.
- Browser tests keep a local HTTP-proxy fallback; the real QuickLook host fetches the tile and returns a data URL.
- Fixed custom message tiles being treated as complete before they received an image source.

## 1.18.2 — 2026-11-09

### 中文

#### 修复

- 修复天地图瓦片代理在 WebView2 关闭、请求失败或响应对象为空时赋值 `null` 响应导致的
  `System.NullReferenceException`。
- 瓦片代理现在捕获所有生命周期异常，仅在响应对象创建成功后写回，关闭预览时不会再弹错误窗口。

### English

#### Fixed

- Fixed the Tianditu tile proxy `System.NullReferenceException` caused by assigning a null response while
  WebView2 was closing or a tile request failed.
- The proxy now handles all lifecycle exceptions and only assigns a successfully created response, so closing a
  preview no longer raises an error dialog.

## 1.18.1 — 2026-11-09

### 中文

#### 修复

- 修复天地图浏览器端密钥在 C# 代理中被识别为非浏览器请求而返回 403 的问题。
- 天地图 403 时自动恢复默认路网/卫星图，并提示检查密钥与域名白名单。
- 图源菜单固定文字、选中底色和勾选标记的高对比度，消除首次展开时文字难识别的问题。
- 使用独立 `tiles.trailviewer.example` 代理主机，避免与 viewer 静态资源路由冲突。

#### 安全

- 新增仓库密钥扫描，禁止 `tk=` 和供应商 `apikey=` 明文提交。

### English

#### Fixed

- Fixed Tianditu browser keys being rejected with 403 because the C# proxy did not identify as a browser.
- A Tianditu 403 now restores the default road or satellite source and explains the key/domain failure.
- The source menu now has stable high-contrast text, selection colour and a check mark on first open.
- A dedicated `tiles.trailviewer.example` proxy host avoids collisions with viewer static resources.

#### Security

- Added a repository secret scan that rejects plaintext `tk=` and provider `apikey=` values.

## 1.18.0 — 2026-11-09

### 中文

#### 新增

- 地形图新增 OpenHikingMap 和 OpenTopoMap；CyclOSM 继续作为默认地形图源。
- 路网图和卫星图新增天地图，分别使用 `vec_w + cva_w` 与 `img_w + cia_w` 底图/注记组合。

#### 变更

- 原“地图”类别并入“路网”，底图控件改为“路网 / 地形 / 卫星 / 无底图”四类。
- 多图源类别使用紧凑的图源菜单；`Q / E` 切换类别，并记住每个类别上次选择的图源。
- 图层偏好升级为具体图源 ID，同时兼容旧的 `map`、`terrain`、`satellite` 和 `none` 值。
- 天地图密钥由用户配置并使用 Windows DPAPI 加密保存；页面仅请求宿主本地代理，不接收密钥。

#### 修复

- 点击当前地形类别打开或收起图源菜单时不再重建瓦片图层，消除地图闪黑。

#### 安全

- 天地图瓦片由宿主校验图层和坐标后代理请求；密钥不写入源码、页面 URL、LocalStorage、日志或安装包。
- 天地图返回 403 时自动退出该图源、恢复默认路网/卫星图并提示检查密钥与域名白名单。

### English

#### Added

- Terrain now offers OpenHikingMap and OpenTopoMap alongside the default CyclOSM source.
- Tianditu is available for Road and Satellite using the composite `vec_w + cva_w` and `img_w + cia_w` layers.

#### Changed

- The former Map category is now part of Road, leaving four categories: Road, Terrain, Satellite and No map.
- Multi-source categories use a compact source menu; `Q / E` switches categories and remembers the last source
  selected in each one.
- Layer preferences now use provider IDs while remaining compatible with the legacy `map`, `terrain`,
  `satellite` and `none` values.
- Tianditu keys are configured by the user and encrypted with Windows DPAPI; the page only calls a local host
  proxy and never receives the key.

#### Fixed

- Opening or closing the source menu on the active Terrain category no longer rebuilds its tile layer, removing
  the brief black flash.

#### Security

- The host validates the Tianditu layer and tile coordinates before proxying; tokens stay out of source code,
  page URLs, LocalStorage, logs and release packages.
- A Tianditu 403 now falls back to the default road or satellite source and prompts the user to check the key and
  domain restrictions.

## 1.17.2 — 2026-11-09

### 中文

#### 新增

- 增加 TrailViewer 品牌回归检查，防止旧 GpxViewer 标识重新进入生产代码、当前文档和活动配置。

#### 变更

- 宿主面板、线程名、WebView 虚拟主机、浏览器测试接口、LocalStorage 前缀、日志、KMZ 临时目录和用户数据
  目录全部统一为 TrailViewer。
- 首次运行会把旧 `GpxViewer` 偏好、WebView profile 和日志迁移到 `TrailViewer` 路径；LocalStorage
  键名统一为 `trailviewer.*`，同源旧键按需迁移。
- Release workflow 从 CHANGELOG 生成完整双语 Release 正文，并附加安装包名与 SHA256。
- 文档按用户、开发、测试、发布和架构职责重新组织；1.16.x 详细历史移入归档。

#### 修复

- CI 文件检测改为校验“是否可预览”，接受 Harness 的 `TRACK` 结果。

### English

#### Added

- Added a TrailViewer branding guard that keeps obsolete GpxViewer identifiers out of production code, current
  documentation and active configuration.

#### Changed

- The host panel, thread name, WebView virtual hosts, browser test API, LocalStorage prefix, log, KMZ temporary
  directory and user-data folders now use TrailViewer.
- First run migrates legacy GpxViewer preferences, the WebView profile and logs to TrailViewer paths;
  LocalStorage now uses the `trailviewer.*` namespace, with same-origin legacy keys migrated on demand.
- The release workflow now uses the complete bilingual CHANGELOG section as the Release body and appends the
  package name and SHA256.
- Documentation is organised by user, development, testing, releasing and architecture responsibilities; the
  detailed 1.16.x history moves to the archive.

#### Fixed

- CI fixture detection now checks the previewable contract and accepts the Harness `TRACK` result.

## 1.17.1 — 2026-11-09

### 中文

#### 修复

- 导出面板测试显式使用中文系统，不再依赖 CI runner 的默认语言。
- GPS 异常图标测试等待标签重绘和缩放变化，消除地图空闲与 marker 重建之间的竞态。
- 产品行为不变；本补丁修复 `v1.17.0` 发布流水线中的两处环境相关失败。

### English

#### Fixed

- The export-panel test selects a Chinese locale instead of relying on the CI runner's system language.
- The GPS-anomaly test waits for marker repaint and an explicit zoom change, removing a race between map idle
  and marker recreation.
- Product behaviour is unchanged; this patch fixes two environment-dependent failures in the `v1.17.0` release run.

## 1.17.0 — 2026-11-09

### 中文

#### 新增

- 新增统一沿线导航：方向键、`A/D`、速览、剖面航点和相册跨点切换按累计里程排序，起终点与重合图钉合并。
- 页面协议和偏好 schema 使用独立版本。

#### 变更

- 产品版本改用 Semantic Versioning，`Directory.Build.props` 成为唯一版本源。
- WebView2 主机改用 `viewer/` 内容哈希，发布版本不再承担缓存职责。
- 发布脚本支持 major/minor/patch 和 beta/rc。

#### 修复

- 修复起点向右先跳终点再回起点的循环；终点向右回绕起点。

### English

#### Added

- Route-ordered navigation now drives arrow keys, `A/D`, the overview, profile dots and cross-pin photos;
  coincident start/end anchors and waypoints become one node.
- Viewer protocol and preference-schema versions are independent.

#### Changed

- Product versions use Semantic Versioning with `Directory.Build.props` as the single source.
- The WebView host uses a content hash of `viewer/`; release versions no longer control caching.
- Release preparation supports major/minor/patch and beta/rc versions.

#### Fixed

- Fixed the start loop where Right jumped to the end, back to the start, then forward. Right from the end wraps.

## Older releases

- [1.16.x history](docs/changelog/legacy-1.16.md)
