# 放映室

我的电影片单，数据来自 Notion「🎞️ 电影档案」数据库。

- `site/`：网页本体（胶片视图 / 印样视图 / 详情与影评 / 片头动画），GitHub Pages 发布的就是这个目录
- `scripts/sync.mjs`：从 Notion 拉片单和影评，生成 `site/data.js`；新片自动补 IMDb 资料和海报
- `.github/workflows/pages.yml`：每天北京时间 04:00 自动同步并发布；也可以在 Actions 页面手动 Run workflow
- `build/`：本地工具（PowerShell）：初始数据、海报下载、本地预览服务器

需要在仓库 Settings → Secrets and variables → Actions 里配置 `NOTION_TOKEN`（Notion 内部集成的密钥，并把数据库连接给这个集成）。
