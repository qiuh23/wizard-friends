# 静态素材浏览器缓存

2026-11-12，基于已合并 PR #43 的 main `df547b9`。用户要求未变素材不重复下载、有变化再更新，并授权完成检查后提交 PR。不合并、不部署。

## 策略

- 16 个 GLB 在构建时根据实际文件字节计算 SHA-256，不使用发布号、时间戳或整个素材包的版本。改变一个模型仅改变该模型的地址；未使用的道具不会因为本改动被预下载。
- 模型、54 张独立牌图、3 个 JS 分块、1 个 CSS 文件统一生成在 `assets/immutable/`，文件名含内容指纹。牌图/代码/样式沿用 Vite 的内容散列。模型 URL 相对所属 JS 分块解析，兼容根目录与子路径。
- 国内 Node 仅对构建清单中的实际指纹文件返回 `public, max-age=31536000, immutable`。海外 Workers 构建生成 `_headers`，逐项列出当前存在的指纹文件，不给整个 `assets` 目录强缓存，避免旧路径、404 或 SPA 回退被长期缓存。本轮 74 个文件加 5 条入口规则，共 79 条；超过 Cloudflare 的 100 条上限会明确阻止构建。
- HTML 与固定名称的旧静态文件需要重新校验。Node 新增内容 ETag 和 GET/HEAD 条件请求，未变返回 304，已变返回新正文。海外其他固定资源沿用 Workers 的 `max-age=0, must-revalidate` 和内容 ETag 默认策略。
- `runtime-config.json`、`build-info.json`、缓存清单和 API 响应不缓存。客户端仍以 `cache: no-store` 获取运行配置。WebSocket、身份、房间状态和现有会话恢复流程未改。
- 原固定 GLB 文件继续保留兼容旧版本/开发模式，不设长期缓存。没有 Service Worker、离线页面、全量预加载、跨站缓存、主动清缓存或自动刷新进行中的牌局。
- 浏览器可以按其空间策略淘汰缓存；无痕模式、主动清理或禁用缓存后仍需重新下载。这是可复用的 HTTP 浏览器缓存，不是保证永久保存或完整离线运行。

## 检查

- `npm test`：404 项通过；含 8 项缓存专项。
- `npm run test:release`：包含缓存专项，验证真实 Vite 连续构建、修改单个模型、构建清单/头规则及损坏资源阻断。
- `npm run check`、global/cn 两站构建、global Worker dry-run、`git diff --check` 通过。
- 两站构建中未变的 GLB、SVG、CSS 地址一致；浏览器缓存仍各自按站点 origin 隔离。
- 国内真实 HTTP 集成覆盖资源 200/304/HEAD、弱 ETag、多值匹配、HTML 变更、SPA 回退、固定 JS、动态配置、API 错误、缺失指纹文件和非 GET 方法。
- 每次正式构建新增 `check-asset-cache.mjs`，核对所有指纹文件、16 个 GLB 的字节与 URL、运行时代码引用、国内清单和海外 `_headers` 一致，拒绝 HTML/JSON 被标为 immutable。

## 实测边界与复跑

- `npm run test:cache` 是独立浏览器回归：复制已构建的代表性 GLB/SVG/JS/CSS，用真实 Node 服务和同一持久浏览器配置验证重复访问、关闭重启后都只下载一次，不拦截请求、不强制缓存。当前环境 Chromium 在建页前因 `socket() failed: Operation not permitted (1)` 退出，因此**磁盘缓存持久性尚未由浏览器实测通过**。
- 本地 Wrangler dev 因 `uv_interface_addresses ... Unknown system error 1` 退出，未完成本地 Workers 静态头端到端实测。Worker JSON 策略单测、生成头检查和部署 dry-run 不等于线上 CDN 验收。
- 在可运行浏览器的环境执行 `SITE_EDITION=cn npm run build && npm run test:cache`，必要时设置 `BROWSER_EXECUTABLE`。合并并通过既有发布流程后，应核对国内/海外 HTML、配置、指纹资源和缺失文件的实际响应头，再在浏览器常规模式验证重复访问。

Cloudflare 官方头规则及默认缓存说明：https://developers.cloudflare.com/workers/static-assets/headers/
