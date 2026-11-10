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

脚本默认提取当前版本章节；传入 `--since vX.Y.Z` 时会汇总该公开版本之后到当前版本之间的所有 CHANGELOG
章节。Release workflow 自动读取 GitHub 上一个公开 Release，并使用累积模式，因此在两个公开版本之间产生多个
内部版本时，不会只发布最后一版的说明。缺失、空正文或 TODO 会让发布失败。workflow 还会追加安装包名和
SHA256，并使用 `gh release create --notes-file` 发布。

## Tag 与发布

```powershell
git tag -a v1.18.0 -m "TrailViewer 1.18.0"
git push origin main
git push origin v1.18.0
```

`.github/workflows/release.yml` 会检查 annotated tag 与版本源一致，执行全量测试、打包、生成 SHA256 并创建
GitHub Release。预发布 tag 自动标记为 prerelease。

已推送的 tag 不移动、不覆盖。若发布失败，修复后按 SemVer 创建下一个 PATCH 版本。

## 缓存

WebView 主机名由 `viewer/` 内容哈希生成。发布版本变化不会单独决定缓存，前端内容和页面协议才决定缓存。
