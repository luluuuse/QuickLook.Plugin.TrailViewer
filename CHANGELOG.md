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
