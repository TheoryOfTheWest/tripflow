# TripFlow

沿着时间，收藏旅行。默认中文、时间线优先、地图按需出现的个人旅行手记。

这是可运行的 React 静态项目，能够部署到 GitHub Pages。无需 Node 后端。**未配置服务时使用 IndexedDB 本地模式，绝不显示为云端已同步。** 默认没有旅行数据；首页可主动载入明确标记的虚构三日验收旅行。

## 文档入口

- [用户使用说明书](docs/用户使用说明书.md)：按实际界面介绍旅行、时间线、交通、照片、备份和常见问题。
- [AI 项目架构与改进指南](docs/AI项目架构与改进指南.md)：供 AI 或开发者接手，包含模型、数据流、关键约束、验证范围和候选改进。
- [架构概览](ARCHITECTURE.md)与[测试验收记录](TESTING.md)：简明技术说明与已执行结果。

## 运行

安装 Node.js 22.12+（推荐 24 LTS），在项目文件夹运行：

```sh
npm ci
cp .env.example .env
npm run dev
```

Windows PowerShell 复制模板：`Copy-Item .env.example .env`。浏览器打开终端打印的地址，默认 `http://127.0.0.1:5173/tripflow/`。没有任何 API Key 也能创建、编辑、保存、备份记录。不要双击 index.html 或 dist/index.html；ES 模块需要 HTTP 服务。

```sh
npm test                 # 时间、校验、CRUD、表单、备份、地图 Provider、PostgreSQL RLS
npm run build            # TypeScript 检查 + 生产构建到 dist/
npx playwright install chromium
npm run test:e2e         # 桌面 + 手机视口完整操作；自动构建、启动测试服务器
npm run preview          # 在 HTTP 服务中预览生产版本
```

有系统 Chromium / Edge 时也可通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定可执行文件。验收时用的是 Windows Edge；CI 使用 Playwright Chromium。Playwright 手机项目是移动视口与触摸模拟，不代表已在实体 iOS 设备测试。

## 功能

- 旅行卡片、名称与日期编辑、IANA 默认时区、备注、四种原创插画封面及已保存照片封面。
- 每日纵向时间线，日期标签、日期选择器、前后日期衔接；地点停留、交通、独立照片/备注时间点。
- 完整 UTC 起止时间，独立出发/到达时区；按 UTC 排序，按旅行时区分段，不复制跨天记录。
- 重叠提示、未记录时段、日内时长与全程实际时长。夏令时不存在的当地时间会拒绝；重复时间要求确认 UTC 偏移。
- 懒加载 React Leaflet 弹窗；Geoapify 中英日地点搜索（450ms 防抖），点击地图、手动坐标、地点与站点复用。
- 九种交通方式；运营商、线路、上下车站、换乘备注、线路历史；换乘可拆成多条记录。
- 主动计算步行路线、同参数缓存；服务不可用时使用可配置速度的直线粗估，并明确说明局限；估计耗时与实际耗时独立保存。
- 每日/全程地图、按时间编号、交通站点方形标记、地图返回对应记录。道路实线、用户 GeoJSON GPS 轨迹、顺序虚线明确区分。
- 多图压缩、说明编辑、删除、预览；Canvas 重编码去掉 EXIF/GPS。照片关联活动、交通或独立瞬间。
- Supabase 邮箱密码登录、每用户私有 RLS、私有 Storage；每段旅行版本冲突检查、本地缓存、离线只读云端内容。
- JSON 备份与校验导入；含实际照片的完整 ZIP；HTML 旅行报告与打印/PDF。HTML 输出转义用户文字，不执行导入 HTML。

## Supabase 配置（启用跨设备保存）

1. 创建 Supabase 项目，在 SQL Editor **执行一次** `supabase/migrations/202610110001_tripflow.sql`。它创建 trips 表、RLS、版本触发器及私有 `tripflow-photos` Bucket。不要在同一数据库重复执行初始迁移；后续修改应新建迁移。
2. 在 Supabase Auth 后台创建你自己的邮箱密码账户。此应用没有公开注册界面。**在 Auth 设置里禁用新用户注册**；不要公开管理员凭据。
3. 在项目 Connect / Settings → API Keys 取得项目 URL 与 **Publishable Key**，填入 `.env`：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_GEOAPIFY_API_KEY=
VITE_BASE_PATH=/tripflow/
```

4. Auth → URL Configuration 中设置实际网站 Site URL，例如 `https://USERNAME.github.io/tripflow/`；按需要允许本地开发 URL。当前使用密码登录，不依赖邮件回调和 HashRouter 片段兼容。
5. 重启开发服务器，点击“登录”，用刚创建的个人账户登录。在另一浏览器或手机登录同一账户，刷新应读取同一云端记录。
6. **本地记录不会悄悄上传到云端**。如需迁移，先在本地模式导出完整 ZIP，登录后导入 ZIP；导入会创建新旅行并绑定当前账户。JSON 不含实际照片。

严禁把 Service Role、`sb_secret_`、数据库密码放进任何 `VITE_` 变量。前端环境变量会公开进入构建产物，Publishable Key 必须配合 RLS。项目不会记录密码或凭据。

云端是主要数据源：重新登录后重新查询 trips。缓存按账户隔离，主动退出登录会清除该账户的本地缓存。离线或读取云端失败时仅显示缓存并停用云端编辑；保存请求失败保留编辑窗口，不将其标记为已同步。两个设备同时编辑同一旅行会提示冲突；关闭编辑、刷新并重新编辑即可。本版没有自动合并或实时多人同步；可通过页面重载读取另一设备的更新。

## Geoapify 配置

在 Geoapify 创建项目并启用地图瓦片、地址自动补全和 Routing API；把浏览器 Key 填入 `VITE_GEOAPIFY_API_KEY`，重启/重新构建。设置允许的 HTTP Referer / Origin，包含实际 GitHub Pages 来源和你需要的本地开发来源，并设置配额提醒。浏览器 Key 是公开的，不能以隐藏前端 Key 代替来源限制。

实现使用：

- `GET /v1/geocode/autocomplete?text=...&lang=zh|en|ja&limit=6&format=geojson`
- `GET /v1/routing?waypoints=lat,lon|lat,lon&mode=walk&units=metric&format=geojson`
- `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png`

距离为米，耗时为秒，几何坐标为 `[longitude, latitude]`。不调用公共 Nominatim 自动补全。地图仅打开时请求瓦片；步行仅点击“计算步行”时请求。保留 Leaflet 署名；本版报告不导出地图截图。未配置 Key 时显示坐标网格，并允许手动填写坐标。不要将该网格当成真实底图。

## GitHub Pages 部署

1. 新建独立仓库 `tripflow`，把**这个项目文件夹的内容**提交到仓库根目录，主分支使用 `main`。不要上传 node_modules、.env、私人备份、测试截图和个人照片，不要覆盖个人主页仓库。
2. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. Settings → Secrets and variables → Actions → **Variables** 添加 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_GEOAPIFY_API_KEY`。这些均是浏览器公开配置，不得填写特权 Key。留空会部署成本地模式。
4. 推送到 `main` 或手动运行 Deploy 工作流。流程安装锁定依赖、运行全部单元/数据库测试和桌面/手机 E2E、生产构建、上传 dist 并发布。
5. 成功后打开 `https://USERNAME.github.io/tripflow/`。工作流自动采用仓库名作基础路径；若仓库名确为 `USERNAME.github.io`，自动切为 `/`。路由使用 `#/trip/ID?date=...`，刷新子页面不会要求 GitHub Pages 服务器回退。

普通仓库的本地构建默认基础路径 `/tripflow/`。其他名字可以设置 `VITE_BASE_PATH=/YOUR_REPO/`。工作流 E2E 在默认 `/tripflow/` 路径验收，正式构建再按实际仓库名配置路径。

已生成并验证本地配置，**当前未上传 GitHub、未运行 GitHub 托管工作流、没有已上线 URL**。本环境没有提供仓库授权或第三方凭据。

## 备份、照片与隐私

- JSON 有格式/version、完整 UTC 与时区、地点、交通、路线和稳定附件引用，不保存会过期的签名 URL。JSON 重新导入会把无文件的照片标为“需 ZIP 恢复”；它无法恢复图片本身。
- 完整 ZIP 必须成功读取每张实际照片才导出；缺图就报错，避免产生假完整备份。ZIP 包含 `tripflow.json` 和 `photos/<photoId>`。
- 导入先做 Zod / 引用 / 账户 / 日期 / 图片类型校验，生成新 ID 并重绑定所有引用；不会覆盖现有旅行。导入含多旅行时逐旅行提交，途中失败会提示已经成功的数量，刷新即可查看。
- 单次导入压缩文件上限 100MB、解压上限 200MB、最多 5001 个文件；单张备份照片上限 8MB（与 Storage 一致）。大旅行可分批保管；当前不做流式超大 ZIP。
- 上传原图限 JPG/PNG/WebP、20MB，压缩至最长边 1800px；每记录最多 12 张照片。HEIC 请先转换。
- 删除先提交元数据，再清理图片；清理失败会提示。若中途断网或页面关闭，可能留下私有孤立对象，需要在 Supabase Storage 管理页面人工清理。
- 云端保存响应丢失时会保留已上传照片，避免删除可能已经提交的引用；请刷新核对后重试。同一编辑窗口重试不会重复上传这些照片。
- 浏览器缓存依赖当前来源；localhost、不同端口及 GitHub Pages 互不共享。本地模式不跨设备同步。浏览器清理站点数据会删除本地记录，务必备份。
- 没有主动退出的共享设备仍可能保留账户数据；私密数据并未做客户端磁盘加密。

## 验证范围与维护

具体实测结果见 [TESTING.md](TESTING.md)，模块和模型说明见 [ARCHITECTURE.md](ARCHITECTURE.md)。Supabase 线上登录/真实跨设备读取、Storage 线上策略集成和 Geoapify 真实 API 响应需要你的凭据验收；本地 PostgreSQL RLS 与模拟接口通过不等于这些线上功能已运行。

依赖精确版本由 `package-lock.json` 固定，安装请用 `npm ci`。选用兼容 React 19 的 React Leaflet 5、Vite 7、Tailwind 4、Luxon 3、Supabase JS 2、Zod 4；shadcn/ui 风格的 Button/Dialog 源码保留在项目内，基于 Radix，便于直接维护。

官方文档核对日期：2026-10-11。

- [Vite](https://vite.dev/guide/)、[Tailwind Vite](https://tailwindcss.com/docs/installation/using-vite)、[React Leaflet](https://react-leaflet.js.org/docs/start-installation/)
- [Geoapify 自动补全](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/)、[Routing](https://apidocs.geoapify.com/docs/routing/)、[地图瓦片与署名](https://apidocs.geoapify.com/docs/maps/map-tiles/)
- [Supabase Key](https://supabase.com/docs/guides/getting-started/api-keys)、[Storage 权限](https://supabase.com/docs/guides/storage/security/access-control)、[数据库安全](https://supabase.com/docs/guides/database/secure-data)
- [Luxon](https://moment.github.io/luxon/api-docs/index.html)、[GitHub Pages Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
