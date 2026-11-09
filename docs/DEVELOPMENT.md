# 开发环境

## 前置条件

- Windows
- .NET Framework 4.6.2 构建能力与可用的 .NET SDK
- Node.js 20 或更高版本
- Microsoft Edge / Chromium，用于 Playwright
- PowerShell

首次构建：

```powershell
npm ci
pwsh scripts/get-quicklook-common.ps1
dotnet build src/QuickLook.Plugin.TrailViewer.csproj -c Release
dotnet build tools/Harness/TrailViewer.Harness.csproj -c Release
```

如果本机 PATH 上的 `dotnet` 只有宿主而没有 SDK，请直接使用已安装 SDK 的 `dotnet.exe` 完整路径。

## 本地验证

```powershell
npm run check
npm test
npm run test:host
```

浏览器测试需要 Edge/Chromium：

```powershell
$env:CHROMIUM = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm test
```

## 打包

```powershell
dotnet build src/QuickLook.Plugin.TrailViewer.csproj -c Release
node scripts/pack.cjs
```

安装包写入仓库根目录，文件名包含产品版本。`bin/Release/viewer` 必须与 `viewer/` 文件清单一致；不一致时
打包脚本会拒绝出包。

## 常用路径

| 路径 | 作用 |
|---|---|
| `viewer/` | Web 前端 |
| `src/` | QuickLook/WebView2 宿主 |
| `tests/` | 浏览器、单元、夹具和测试支持 |
| `tools/Harness/` | 无 QuickLook UI 的宿主测试与渲染工具 |
| `scripts/` | 测试、版本、发布说明和打包脚本 |
| `Directory.Build.props` | 产品、页面协议和偏好 schema 版本 |

## 用户数据

| 数据 | 路径 |
|---|---|
| 偏好文件 | `%APPDATA%\pooi.moe\QuickLook\TrailViewer\viewer-settings.txt` |
| WebView2 profile | `%APPDATA%\pooi.moe\QuickLook\TrailViewer_WebView2` |
| 日志 | `%LOCALAPPDATA%\TrailViewer\log.txt` |
| KMZ 临时目录 | `%TEMP%\TrailViewer\<guid>` |

首次运行会尝试从旧 `GpxViewer` 目录迁移设置和 WebView profile。Harness 使用
`TRAILVIEWER_USER_DATA` 指定独立 profile；旧的 `GPXVIEWER_USER_DATA` 仍作为迁移期回退。

架构和测试细节分别见 [ARCHITECTURE.md](ARCHITECTURE.md) 与 [TESTING.md](TESTING.md)。
