# TripFlow 架构

完整接手流程、关键约束与候选改进见 [AI 项目架构与改进指南](docs/AI项目架构与改进指南.md)；日常操作见 [用户使用说明书](docs/用户使用说明书.md)。

## 模块与边界

```text
src/
  App.tsx                   页面、路由、登录状态和界面交互
  components/               旅行/活动表单、照片、备份、登录
    ui/                     可直接维护的 shadcn 风格 Button / Radix Dialog
    map/MapDialog.tsx       按需加载的 React Leaflet 搜索/选点/路线弹窗
  models/index.ts           Zod 模型、完整文档校验、纯 CRUD
  lib/time.ts               UTC 转换、DST、分段、排序、间隙/重叠
  lib/route.ts              同一份时间线数据生成地图点位
  lib/fixture.ts            主动载入的虚构三日验收数据
  hooks/useTrips.ts         账户隔离的读取、保存、缓存状态
  hooks/usePhoto.ts         私有 Blob → 临时 object URL，卸载时回收
  services/repository.ts    Supabase / IndexedDB 持久化与附件
  services/geoapify.ts      独立 PlaceProvider、搜索、路线缓存和粗估
  services/media.ts         图片压缩与元数据去除
  services/photoMetadata.ts 明确锚定照片的 EXIF / GPS 解析与时区预填
  services/backup.ts        JSON / ZIP 校验、导入重绑定、导出
  services/report.ts        转义后的独立 HTML 旅行报告
supabase/migrations/        初始 SQL、RLS、Storage、版本检查
tests/                      Vitest / RTL / 本地 PostgreSQL / Playwright
.github/workflows/          检查及 Pages 自动发布
```

没有自建后端、SSR、全局状态平台或按日复制数据。React Hooks 保存当前视图状态，服务层处理 I/O，纯函数处理业务计算。Vite 的动态 import 只在打开地图时加载 Leaflet 和其 CSS。

## 数据模型

每段旅行是一份 `TripDocument {trip, places[], entries[], photos[], revision}`。逻辑实体包括 Trip、Place、TimelineEntry、内嵌 TransportDetail 和 Photo，字段与任务书对应；额外保存 `endTimezone`、`coverPhotoId`、`mimeType`、`missing`、`endPlaceId?`、`Photo.anchorRole?`。

Supabase 使用 `trips(id uuid, owner_id uuid, data jsonb, revision int, created_at, updated_at)`，将这一份 aggregate 原子保存。这样地点、记录和照片引用不会在多张表写到一半时失配，也适合单用户小应用。数据库索引 `(owner_id, updated_at)`；所有用户内容留在私有数据库和 Storage，不写入 GitHub。

每次保存：Zod 完整校验 → `revision + 1` → 插入（新文档）或 `UPDATE ... WHERE id = ? AND revision = oldRevision`。匹配零行即冲突，界面提示刷新；DB 触发器限制 revision 逐一递增和 owner/id 不变。IndexedDB 本地模式也在事务中检查 revision。云端模式每次读取/保存都以服务器为准，缓存失败不会将已提交的云端操作误报为未保存。

每份文档最多 10MB；照片二进制独立于 JSONB 存储。本版适合个人旅行规模，超大账户可在未来拆分规范化表及分页，接口可保持同一服务层契约。

## UTC 与日期投影

1. 开始/结束是完整 ISO UTC 字符串（Z），保留各自的 IANA 时区。
2. 表单把当地 `datetime-local + timezone + 可选 DST offset` 转成实际 UTC。不存在的 DST 时间拒绝，重复时间必须明确选择偏移。
3. 每日边界是旅行默认时区 `[local midnight, next local midnight)`；用 Luxon `plus({days:1})`，不把一天硬编码为 24 小时。
4. 非零记录用区间相交筛选，再裁剪到当日边界。瞬间用半开区间归属；午夜结束不落到次日。跨天原记录只存一次。
5. 当日显示时长用裁剪后的真实毫秒差，全程统计按原记录 ID 计算一次。重叠活动分别计时；概览明确标为“记录时长合计”，不声称是去重后的占用总时长。
6. 按 UTC 排序，跨时区航班不以当地显示钟点排序。日页面统一显示旅行时区，同时显示异时区记录的当地时间。
7. 间隙计算维护最大已占用结束边界，避免在长期住宿中夹有短活动时产生错误留白。

## 地图和路线

`PlaceProvider` 提供 search / walk，Geoapify 是默认实现。地点结果只保存所需名称/地址/精确坐标/provider ID，复用已保存地点；修改已选坐标会清掉失配的 provider ID。搜索450ms防抖、取消旧请求、15秒超时。公共 Nominatim 没有被使用。

路线请求只由按钮触发，按起终点精确坐标缓存，最多100项。API 的 GeoJSON MultiLineString 存储为经度在前；Leaflet 渲染时交换为纬度在前。返回的米/秒与实际记录秒数分开。失败时显示直线距离除可配置步行速度的粗略结果，不伪造道路几何。

每日地图从 dailyEntries 的同一份持久化数据生成点位。连续路段共享同一端点时合并点位；真实重复访问仍可在时间线各自记录。道路路径为绿色实线，用户导入 GeoJSON GPS 为紫色实线，连接地点顺序为棕色虚线。没有轨道数据时只画示意虚线；不声称是真实地铁/铁路/航线。跨天路段的完整几何保留，弹窗注明显示全段。没有可用坐标时显示空状态。

打开单点会调整视野；多点自动 fitBounds。弹窗关闭不卸载日页面，地图弹窗支持返回某条时间线并滚动到对应元素。没有 Key 时不请求外部瓦片，显示网格供手动输入/点击坐标。

## 私有身份、缓存与照片

Supabase Auth 邮箱密码登录。个人用户在后台建立，关闭新用户注册。客户端仅用 Publishable Key，数据库所有 CRUD 都受 owner RLS 控制。SQL 额外检查 aggregate 内部 owner/trip/path 绑定。Storage Bucket private，按 `auth.uid()/tripId/photoId` 目录限制 SELECT/INSERT/UPDATE/DELETE，允许 JPG/PNG/WebP、最大8MB。

开始 / 结束锚点仅由显式文件入口触发本机解析，普通附件不解析；可选 endPlaceId 与 anchorRole 保存两端和照片角色，v1 备份重绑定两端引用。解析结果只预填有效部分，用户可手动修改；带偏移换算为节点 IANA 时区，无偏移保留钟点并提示。详细规则见 AI 指南第 7.0 节。

照片 Canvas 压缩后作为 Blob 暂存，保存记录时先上传/写附件，再保存文档；上传阶段失败或本地提交失败时补偿删除新文件。云端提交请求可能已经成功但响应丢失，因此提交结果不明确时保留已上传文件，避免误删已被引用的照片；同一编辑窗口重试会复用已上传文件。删除先保存引用变化再清理对象；断网清理失败提示。跨服务不具有分布式事务，异常退出可能留下孤立私有对象，README 说明人工清理方式。

读取用经过认证的 Storage download，再生成短生命周期 object URL。备份不保存 object URL 或签名访问链接。云端缓存按账户分区；主动退出清掉该账户缓存。离线云端缓存只读，本地模式可离线编辑。无凭据时始终标记本地模式，接入账户后不会自动上传本地数据。

## 备份与报告

版本化 JSON 包含稳定附件关系，导入 Zod 检查数值、完整日期、时区、ID、引用、owner、路径，不执行任何 HTML。导入总是生成新旅行和实体 ID、重绑定当前账户。JSON 无照片二进制，标 missing；ZIP 含 JSON 与真实照片字节，校验中央目录解压大小、白名单文件、图片签名/MIME及容量上限。多旅行逐段提交，失败报告已提交数量。

HTML 报告逐字段转义，使用禁止脚本和网络资源的 CSP；报告不嵌入地图，不泄露临时私有图片链接。浏览器打印当前概览可保存 PDF，打印 CSS 隐藏操作界面。

## 测试与扩展

核心时间/验证/CRUD是纯函数测试；真实 IndexedDB 仿真测试持久化；RTL 测表单提交与 API 错误；Provider 用官方返回形状模拟，并明确不冒充真实网络响应。PGlite 运行实际 PostgreSQL 迁移、用户角色、RLS、版本更新与私有对象策略，Auth / Storage 元表用最小 stub 模拟。Playwright 对生产构建验证完整桌面/手机操作及 Pages 子路径。

线上 Supabase Auth / Storage 与 Geoapify 仍需真实项目和 Key 做集成验收。生产部署前应按 TESTING.md 的凭据验收清单操作。
