# 放映室

我的电影片单，数据来自 Notion「🎞️ 电影档案」数据库。

- `site/`：网页本体（胶片视图 / 印样视图 / 详情与影评 / 片头动画），GitHub Pages 发布的就是这个目录
- `scripts/sync.mjs`：和 Notion 双向同步。读片单和影评生成 `site/data.js`；在 Notion 里只填片名或 IMDb 链接的行，会自动查齐资料并写回 Notion 的空栏目，同时下载海报和剧照
- `scripts/lookup.mjs`：查资料用的接口（IMDb、Wikidata、中文维基百科，都不需要密钥）
- `.github/workflows/pages.yml`：约每 15 分钟自动同步一次，内容有变化才重新发布；也可以在 Actions 页面手动 Run workflow
- `build/`：本地工具（PowerShell）：初始数据、海报下载、本地预览服务器

需要在仓库 Settings → Secrets and variables → Actions 里配置 `NOTION_TOKEN`（Notion 内部集成的密钥，并把数据库连接给这个集成）。集成需要勾选「读取内容」和「更新内容」两项权限，后者用于把查到的资料写回 Notion。

自己的剧照：把图片拖进 Notion 那一行的「剧照」栏，下次同步会收进 `site/gallery/u/`。
