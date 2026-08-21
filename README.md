# David Whyte Experience

本仓库保存 David Whyte Experience 的本地学习复刻工程。它仅供本地研究和视觉验证使用；不发布、不部署、不接入购买、预约、账户或其他远程商业服务。

## 项目结构

- `app/`：当前可运行的 Vite / Three.js 应用，源码位于 `app/src/`。
- `sources/original-extraction/`：完整原始提取镜像，只读，不作为运行时依赖修改。
- `archive/`：已淘汰 v1 的小型补丁证据。
- `evidence/`：迁移清单与已验收 QA 截图、报告。
- `工程记忆/`：协作日志、长期架构知识和维护规则。

依赖、构建输出和 QA 产物不需要提交到 GitHub：`app/node_modules/`、`app/dist/` 和
`app/.artifacts/` 已由根目录 `.gitignore` 排除。

## 环境要求

- Windows PowerShell
- Node.js 和 npm
- 建议使用 Node.js LTS。检查本机版本：

```powershell
node --version
npm --version
```

## 安装依赖

在仓库根目录执行：

```powershell
Set-Location .\app
npm ci
```

`npm ci` 会按照 `app/package-lock.json` 安装精确版本。首次运行、依赖版本发生变化，或删除
`node_modules` 后，都可以重新执行此命令。

如果当前不在仓库根目录，也可以使用绝对路径：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\DavidWhyte-Experience\app'
npm ci
```

## 本地开发

启动 Vite 开发服务器：

```powershell
Set-Location .\app
npm run dev
```

然后在浏览器打开终端显示的地址，通常是 <http://localhost:5173/>。停止服务器请在当前
PowerShell 窗口按 `Ctrl+C`。

## 构建和验证

只构建生产版本：

```powershell
Set-Location .\app
npm run build
```

构建结果写入 `app/dist/`，该目录是可再生产物，不提交到 GitHub。

执行完整验证（生产构建 + 73 项本地素材完整性检查）：

```powershell
Set-Location .\app
npm run verify
```

也可以分开执行：

```powershell
npm run verify:integrity
```

生产构建后的本地预览：

```powershell
npm run preview
```

## 自动化 QA（可选）

`npm run qa` 会运行五个验收视口及交互回归。它需要专用 Chrome CDP 配置文件，并连接到
端口 `9333`：

```powershell
Set-Location .\app
npm run qa
```

新的报告和截图写入被 Git 忽略的 `app/.artifacts/`。当前已接受的基线位于
[`evidence/qa/accepted-2026-08-20/report.json`](./evidence/qa/accepted-2026-08-20/report.json)。

## 常用清理与重新安装

如果依赖安装损坏，可以删除本地依赖后重新安装。此操作只删除可再生成的
`app/node_modules/`：

```powershell
Set-Location .\app
Remove-Item -Recurse -Force .\node_modules
npm ci
```

## 来源和协作规则

- `sources/original-extraction/` 是只读原始基线，不要修改、格式化或写入生成物。
- 可再生产物只写入 `app/node_modules/`、`app/dist/` 或 `app/.artifacts/`。
- 开始实质性工作前，请先阅读 [`AGENTS.md`](./AGENTS.md)、
  [`工程记忆/README.md`](./工程记忆/README.md) 和相关工程日志。
- 自动化验收基线与迁移记录请参阅 [`evidence/`](./evidence/)。

应用自身的渲染架构与调试说明见 [`app/README.md`](./app/README.md)。
