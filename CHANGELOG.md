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

## 1.18.5 — 2026-11-10

> 这是 `v1.17.2` 之后的首个公开版本。以下内容累积 `1.18.0` 至 `1.18.5` 的新增、变更、删除、修复和安全更新。
>
> This is the first public release after `v1.17.2`. The notes below cumulatively cover additions, changes,
> removals, fixes and security updates from `1.18.0` through `1.18.5`.

### 中文

#### 修复

- 公共包改为在页面创建前由宿主注入 DPAPI 天地图密钥，页面直接请求官方 WMTS，不再依赖逐瓦片
  WebMessage RPC。
- 配置或更换密钥后，页面即时重建直连图层并完成之前待选的天地图图源。
- 地图设置页提供“更换密钥 / 移除密钥”入口，密钥只从当前用户的 DPAPI 存储读取。
- 单个天地图瓦片失败不再清空密钥或切换图源；连续失败会保留密钥并自动重试。
- 宿主旁路读取天地图 HTTP 状态，只有明确的 401/403 才提示密钥或域名被拒绝。

#### 删除

- 删除私有内置密钥配置与 `-private.qlplugin` 打包链路，只维护一种公开部署方式。
- 删除宿主的逐瓦片代理、专用瓦片虚拟主机和 `tile-request` / `tile-result` WebMessage 状态机。
- 删除进程环境变量读取密钥的旁路，避免出现未写入文档的第二种配置来源。

#### 变更

- 顶部地图工具统一为 32 px 高度；标记点与列表合并为一个连续工具组，语言保持独立。
- 路网、地形、卫星和无底图合并为一个“当前图层”入口；展开面板分“地图类型”和“地图图源”两级，
  `Q / E` 快捷键继续循环切换类型。
- 窄窗中的图层入口只显示图标、当前类型短标签和下拉箭头，图层面板改为剖面上方的底部浮层。
- 天地图密钥操作移入图层面板标题栏右上角的“地图设置”二级页，主图层列表只保留类型和图源。
- 未配置天地图密钥时，选择天地图图源会直接进入地图设置页，不再立即弹出系统密钥窗口。
- 标记点启用态改用强调色圆点，避免与当前地图分类的蓝色选中态争夺视觉焦点。
- 中文图源菜单将“OpenStreetMap 人道主义风格”简化为“OpenStreetMap”。

### English

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

#### Removed

- Removed private embedded-key packaging and the `-private.qlplugin` path so there is only one deployment model.
- Removed the host per-tile proxy, dedicated tile virtual host and `tile-request` / `tile-result` WebMessage
  state machine.
- Removed the process-environment key bypass so key configuration has one documented source.

#### Changed

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
