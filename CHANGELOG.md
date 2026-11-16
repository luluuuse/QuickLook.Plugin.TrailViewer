# Changelog

公开版本遵循 [Semantic Versioning](https://semver.org/)。每个版本分别列出中文和 English，使用
Added / Changed / Deprecated / Removed / Fixed / Security 分类；没有内容的分类可以省略。

`Unreleased` 只记录尚未进入正式版本的改动。发布前由 `scripts/release.cjs` 插入版本标题，GitHub Release
正文由 `scripts/release-notes.cjs` 从对应版本章节生成。1.16.x 的详细历史保存在
[docs/changelog/legacy-1.16.md](docs/changelog/legacy-1.16.md)。

## Unreleased

### 中文

- 无。

### English

- None.

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
