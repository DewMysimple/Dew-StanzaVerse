# David Whyte Experience

本目录保存 David Whyte Experience 的本地学习复刻工程。它仅供本地研究和视觉验证使用；不发布、不部署、不接入购买、预约、账户或其他远程商业服务。

## 目录

- `app/`：当前可运行的 Vite / Three.js 应用。
- `sources/original-extraction/`：完整原始提取镜像，只读，不作为运行时依赖修改。
- `archive/`：已淘汰 v1 的小型补丁证据。
- `evidence/`：迁移清单与已验收 QA 截图、报告。
- `工程记忆/`：协作日志、长期架构知识和维护规则。

## 运行与验证

```powershell
Set-Location .\app
npm ci
npm run dev
npm run verify
```

自动化验收使用 `npm run qa`；当前已接受的基线位于
[`evidence/qa/accepted-2026-08-20/report.json`](./evidence/qa/accepted-2026-08-20/report.json)。

开始任何实质性工作前，请先阅读 [`AGENTS.md`](./AGENTS.md) 与
[`工程记忆/README.md`](./工程记忆/README.md)。
