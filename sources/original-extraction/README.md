# David Whyte Experience 源码学习包

抓取目标：<https://davidwhyte.com/experience/>

抓取时间记录在 `manifest.json`。本目录用于个人学习公开网页的构造与前端逻辑，不包含服务器端 PHP 源码、数据库、会员数据或任何需要绕过权限才能取得的内容。

## 从哪里开始看

1. `raw/davidwhyte.com/experience/index.html`：WordPress 服务端渲染后的页面 HTML。
2. `study/style.beautified.css`：格式化后的主题样式，体验区从 `.xp-canvas` / `.xp-section` 开始。
3. `study/app.beautified.js`：格式化后的主构建包；这是核心逻辑，变量名仍是生产环境压缩后的短名。
4. `study/427.beautified.js`：Webpack 动态分块。
5. `raw/davidwhyte.com/wp-content/themes/davidwhyte/resources/assets/xp/`：WebGL 模型、纹理、LUT、字体图集、音效和桌面/移动视频纹理。
6. `ANALYSIS.md`：页面架构、状态流和建议阅读顺序。
7. `manifest.json`：每个请求的 URL、状态、类型、字节数、落盘位置和重定向信息。

## 抓取结果

- 清单中共 203 条请求记录。
- 172 条资源在原路径成功返回，约 80.4 MB。
- 28 条链接被 WordPress 重定向到注册页，主要是会员导航链接以及第一次扫描时误判的 `/xp/...` 逻辑路径；真正的体验素材已从主题资源目录正确下载。
- 3 条非核心请求失败：Cloudflare 邮箱保护占位 1 条、受限 oEmbed 2 条。
- 另补抓了 Webpack 的 `app/427.js` 动态分块。
- 站点没有公开主包的 source map，因此无法恢复原始源码文件名、注释和未压缩变量名；`study/` 中提供的是可读化的生产构建结果。

## 重新抓取

在本目录的上一级执行：

```powershell
node .\davidwhyte-experience\tools\mirror.mjs
```

脚本只请求 `davidwhyte.com` 同源的公开资源，带有有限并发和清晰的学习用途 User-Agent。它不会登录、提交表单或绕过站点保护。

## 关于本地运行

这是一份“源码与资源研究镜像”，不是可直接部署的完整站点。原 HTML 保留了线上 `<base>`、WordPress 路由、会员/商店接口以及第三方脚本地址；直接打开时仍可能访问线上服务。若要做可离线运行的复刻，建议基于分析结果重新实现交互，不要直接发布原站的文字、字体、音视频或视觉资产。
