# 发布

## 版本模型

产品采用 Semantic Versioning：

| 变化 | 升级 |
|---|---|
| 不兼容的数据、偏好或宿主协议 | MAJOR |
| 向后兼容的新功能 | MINOR |
| 修复、性能和样式 | PATCH |

产品版本唯一来源是根目录 `Directory.Build.props`。`package.json` 是测试工具配置，不携带产品版本。
页面协议和偏好 schema 有各自的独立版本。

## 准备版本

```powershell
node scripts/release.cjs patch --dry
node scripts/release.cjs minor
node scripts/release.cjs major --pre beta.1
node scripts/release.cjs 2.0.0-rc.1
```

脚本只更新版本源并插入 CHANGELOG 条目，不 build、commit、tag 或 push。

## CHANGELOG 规则

主 CHANGELOG 保留 `Unreleased` 和公开版本。每个版本使用：

```markdown
## 1.18.0 — YYYY-MM-DD

### 中文

#### 新增
#### 变更
#### 修复
#### 安全

### English

#### Added
#### Changed
#### Fixed
#### Security
```

发布前必须删除 TODO，并确保中文和英文内容描述同一组变化。

## Release notes

```powershell
node scripts/release-notes.cjs --output release-notes.md
```

脚本默认提取当前版本章节；传入 `--since vX.Y.Z` 时使用当前版本章节作为“自上一个公开版本以来的净变化”
发布摘要（`--since` 只用于校验章节顺序，不再生成范围标题）。Release workflow 自动读取 GitHub 上一个公开
Release，并使用该模式，因此在两个公开版本之间产生多个内部版本时，只发布最终仍有效的功能、变更、删除、
修复和安全内容，不会机械拼接已经撤销或替换的中间记录。
发布负责人必须把净变化整理进当前版本章节。缺失、空正文或 TODO 会让发布失败。workflow 还会追加安装包名和
SHA256，并使用 `gh release create --notes-file` 发布。

**正文书写规则：**

- Release 正文只写用户可见的变化本身，直接以 `### 中文` / `### English` 开始。
- **不要写版本区间说明、发布背景或“这是自某个版本以来首个公开版本”这类元信息前言**，也不要写
  `# 自 vX.Y.Z 以来` 这样的范围标题：正文直接从 `### 中文` 开始，脚本也不再添加任何横幅。
- 当前版本章节就是净变化的唯一来源：把上个公开版本以来仍有效的新增、变更、修复和安全内容整理进来，
  已撤销或已替换的中间记录不要写入。
- README、CHANGELOG、使用文档和 handoff 之间保持同一组事实；不要把“版本号”“tag”“workflow 编号”
  等发布流程信息写进面向用户的 Release 正文。

## Tag 与发布

```powershell
git tag -a v1.18.0 -m "TrailViewer 1.18.0"
git push origin main
git push origin v1.18.0
```

`.github/workflows/release.yml` 会检查 tag 与版本源一致，执行全量测试、打包、生成 SHA256 并创建
GitHub Release，随后通过 `scripts/sync-gitcode-release.cjs` 自动同步发布说明、`.qlplugin` 与 `.sha256` 到 GitCode 国内镜像（供内置更新器双源竞速与回退使用）。预发布 tag 自动标记为 prerelease。

已推送的 tag 不移动、不覆盖。若发布失败，修复后按 SemVer 创建下一个 PATCH 版本。

## 打包

```powershell
dotnet build src/QuickLook.Plugin.TrailViewer.csproj -c Release
npm run pack
```

`npm run pack`（与直接运行 `node scripts/pack.cjs` 等价）会在打包前自动调用 `scripts/build-viewer.cjs`：将 `viewer/` 分包压缩并合并首屏样式输出到 `bin/Release/viewer/`（保留编辑器与导出等懒加载边界），同时排除未使用的 `Microsoft.Web.WebView2.WinForms.dll`、开发期文件与 `runtimes/win-arm64/`（仅支持 x64/x86 Windows）。Debug 构建与本地测试继续直接使用源码 `viewer/`，无需预构建。

## 缓存

WebView 主机名由 `viewer/` 内容哈希生成。发布版本变化不会单独决定缓存，前端内容和页面协议才决定缓存。
