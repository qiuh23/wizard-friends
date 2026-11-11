# React + TypeScript 正式迁移验收

代表截图：[首页](screenshots/home.png) · [等待房](screenshots/waiting.png) · [桌面扇形](screenshots/desktop-selected.png) · [手机竖屏](screenshots/phone-selected.png) · [手机横屏](screenshots/phone-landscape.png) · [手机终局](screenshots/phone-finished.png) · [国内手机](screenshots/cn-phone.png)。这些图片来自正式入口及真实原始卡面，未合成页面。

验收脚本为 `scripts/react-migration-review.mjs`，始终访问正式根入口 `/`，不使用独立样板或生产测试接口。

截图和机器可读报告写入忽略提交的 `output/playwright/react-migration/`。默认覆盖 1440×900 桌面、390×844 手机竖屏、844×390 手机横屏；手机使用 Chromium 视口和触控模拟，不能代替真机 GPU、键盘、耗电或运营商网络验证。

## 运行

先按项目说明构建对应版本，并启动同版本的本地 Node 或 Worker 服务。例如海外版：

```sh
SITE_EDITION=global npm run build
SITE_EDITION=global PORT=3002 npm run start:node
GAME_URL=http://127.0.0.1:3002/ node scripts/react-migration-review.mjs
```

国内版使用 `SITE_EDITION=cn` 的构建及服务。脚本自动读取本站运行配置和存储键，不切换另一站，不向实际国内／海外生产 API 发起游戏请求。

可分别运行 `MIGRATION_CASE=fixtures`、`MIGRATION_CASE=network`，或使用 `MIGRATION_CASE=settlement` 只验三个视口的终局排名、总分首屏可见和再来一局。练习截图默认保留 Three.js 场景；`MIGRATION_WEBGL=0` 可另验二维降级，输出报告会记录该配置。真实多人流程采用二维，避免并发 WebGL 对计时与交互的干扰。使用本机 Chrome，CI 或其他环境可设置 `BROWSER_CHANNEL=chromium`。

练习截图仅在测试浏览器的初始化脚本中固定 `Date.now()`，通过原存档契约保留 45 秒出牌时间；不修改生产规则或添加测试入口。恢复提示消失后才截图。真实服务的多人对局使用原始时钟，完整保留三秒收墩／轮末展示和四十五秒出牌规则。

## 覆盖

- 使用公开规则引擎的合法动作生成练习存档，走既有练习恢复：三人 20 张、六人 10 张、秘密数字预测、先见之明及完整终局。
- 扇形卡面可点，桌面选中上抬与邻牌让位；排序、展开保留选择，空白取消选择，确认后只出一张。
- 菜单与计分浮窗点击空白关闭；确认出牌、预测及再来一局在屏幕内且点击中心未被遮挡。
- 仅允许视图中的卡牌进入 DOM；普通对手手牌、先见之明的本人手牌、秘密数字在规定阶段保持隐藏。
- 三个独立浏览器身份通过真实服务创建／加入、房主规则权限、预测、出牌、完整五轮快速局、同步计分、自动下一轮、终局与再来一局。
- 只读观战、暂停／恢复、刷新及真实断网重连恢复原身份和手牌得分、暂离再返回、返回本站大厅无凭据、解散和同源 API/WebSocket。
- 海外自定义昵称和聊天，国内天文昵称及无聊天／改名入口。

## 执行记录

2026-11-11，海外正式根入口 `http://127.0.0.1:5511/`（Vite 当前迁移源码，代理本地 Node + SQLite + WebSocket）：

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| 三人 20 张、六人秘密数字、先见之明、终局 × 三视口 | 12 / 12 通过，Three.js，未捕获浏览器错误 0 | `output/playwright/react-migration/global-fixtures-report.json` |
| 手机原生触摸滑动 | 竖屏 283 px、横屏 161 px；没有误选牌 | 同上 |
| 三个真实身份及一个观众的完整五轮快速局 | 创建／加入、预测、出牌、计分、自动推进、终局再来、暂停／恢复、刷新与断网重连、暂离返回、海外聊天、本站大厅与解散全部通过；未捕获浏览器错误 0 | 本轮终端通过记录；原 Node JSON 后被同名的 Worker 验收报告覆盖，未重建为原始证据 |

截图覆盖首页、等待房、桌面与手机横竖牌桌、选择、展开、六人秘密数字、先见之明和终局。练习图使用固定测试时钟显示 45 秒，真实联机流程使用原始时钟。网络场景观察到的房间 WebSocket 均来自本地同源站点；该次 UI 没有 HTTP `/api` 请求，不能把空 HTTP 请求列表解释为额外生产 API 验收。

国内正式构建产物在本地 `http://127.0.0.1:8788/` 的 Node + SQLite 服务上，同一脚本全量 13 项（12 组视口场景与 1 组完整多人流程）通过；未捕获浏览器错误 0。报告为 `output/playwright/react-migration/cn-all-report.json`。验证固定天文昵称、国内不构建聊天／改名入口，包含观战、暂停、断网重连、五轮终局与再来一局。国内手机原生滑动竖屏 161 px、横屏 199 px，没有误选牌。

终局窄屏样式修复后，另对海外当前源码与国内重新构建的正式产物分别运行 `MIGRATION_CASE=settlement`，共 6 / 6 项通过，未捕获浏览器错误 0。每个玩家的总分单元格都在表格首屏水平可见范围，再来一局可点。报告为 `global-settlement-report.json`、`cn-settlement-report.json`，三视口的 `global-finished-*.png` 和 `cn-finished-*.png` 已重拍。

海外生产构建还通过本地 Wrangler / Durable Objects 的正式 `npm run test:smoke`：`http://127.0.0.1:8790/` 三客户端及一观众完整五轮、刷新与断网重连、暂停、聊天、终局再来、本站大厅与解散全部通过，浏览器错误 0。报告为 `output/playwright/react-migration/global-worker-network-report.json`，日志为同目录 `worker-smoke.log`。旧 `test:smoke`、refresh/spectator/network 别名保留原入口，统一复用当前自动推进流程的回归。

最终静态和构建检查：`npm run check`（JS 语法及严格 UI TypeScript）、354 / 354 单测、31 / 31 发布契约、cn/global 构建与产物契约、global Worker dry-run 均通过。`test:music` 验证音乐按钮在首页/牌桌/刷新后切换、记忆和后台暂停，以及单个 AudioContext 和实际66秒PCM输出，错误0；其旧脚本补入海外必填昵称以符合现有入口策略。

依赖审计保留了原工具链的4项报告（3 moderate、1 high，涉及 Vite/Wrangler/Miniflare 与传递 undici），React/ReactDOM不在报告中；本次没有同时升级部署工具。Three.js 场景 chunk 仍约557 kB / gzip141 kB，按需加载，未作真机性能结论。

上述结果不代表远端发布、物理设备或公网长时稳定性验收。返回大厅目的地使用浏览器路由截获确认 URL，不对实际生产大厅发起联动操作。

迁移前原始单测基线为 354 项。系统 Python 3.9.6 会使唯一的 `aliyun-archive.test.js` 失败：解包使用 Python 3.11 的 `hashlib.file_digest` 及较新 `tarfile` 的 `filter='data'`。同机已有 Python 3.12，直接运行 `scripts/deploy/test_archive.py` 得到 5/5 通过；无需为该环境差异修改发布代码。
