# 巫师牌房间页面与入口 UI 验收

本次截图基线来自 `origin/main` 的 `008a117`。保留绿色桌面、金色边框和原有控件，不修改游戏规则、房间权威服务、身份存储或发布流程。

## 游戏入口

首页显眼的服务器按钮改为当前线路标签，保留「返回游戏大厅」。设置与对局菜单提供低视觉权重的「切换服务器」组，直接打开受信配置中的目标游戏首页；当前线路与未开放线路禁用。返回游戏大厅是独立操作，按当前线路选择国内或 Cloudflare 大厅。两类导航均不带当前 URL 的房间、令牌、查询或片段。

房间内先确认并保存恢复记录，再整页导航；不发送离开、解散或迁服操作。当前浏览器可在原游戏网址恢复原房间与身份。创建连接尚未完成时阻止导航。邀请解析与“先恢复已有房间”的既有处理保持不变，服务器身份继续隔离。

首页 [修改前](before-home-iphone.png)、[修改后](after-home-iphone.png)、[设置内直接切线](after-home-settings-iphone.png)；另有桌面及横屏同名截图。首页基线从 `origin/main` 的 `main.js` 与 `home-menu.css` 加载，其余基础资源相同；静态 Vite 截图不提供在线人数服务，人数与房间列表不可用提示是该预览环境的状态。

## 房间页面

房间分为始终可见的「玩家入座」「整局玩法」两个页签。房主进入房间默认看到整局玩法，玩家与观众默认看到座位；选择的页签按当前服务器、房间和身份保留，各页的滚动位置在配置或座位更新后保留。规则表单保持挂载，开始按钮在两个页签都继续使用原有规则及人数判断，没有新增必须确认规则的服务端门槛。

页面使用 `100dvh` 的页头、内容、页脚网格。页签在内容滚动区域上方，设置、开始游戏和聊天在独立页脚中，内容不会滚到按钮下面。横屏页头压缩为一行房间信息与操作，再加一行页签，进入规则页即可看到牌库选项。观众提示占用独立一行，不再通过抬高底部工具栏让出空间。

机器人选择与添加按钮整合为操作组，高度均为 **46px**；Safari 原生选择框使用深绿色外观和金色箭头。连续添加时保留所选难度，六人满员后隐藏添加组，移除后恢复。六个座位使用同样尺寸，桌面三列、850px 及以下两列；长昵称省略显示，房主、真人、机器人与空位使用文本区分，移除按钮保留 44px 触控面积。

聊天面板仍留在原来的持久社交容器中，仅聊天按钮进入页脚，继续沿用原有的虚拟键盘与 visualViewport 处理。

## 实际截图

| 视口 | 优化前 | 房主进入后的规则页 | 座位与机器人操作组 | 底部规则与开始操作 |
| --- | --- | --- | --- | --- |
| 桌面 1440×1000 | [之前](before-desktop.png) | [现在](after-desktop.png) | [机器人操作](after-desktop-bots.png) | [底部](after-desktop-bottom.png) |
| iPhone 尺寸 390×844 | [之前](before-iphone.png) | [现在](after-iphone.png) | [机器人操作](after-iphone-bots.png) | [底部](after-iphone-bottom.png) |
| 手机横屏 844×390 | [之前](before-landscape.png) | [现在](after-landscape.png) | [机器人操作](after-landscape-bots.png) | [底部](after-landscape-bottom.png) |
| 窄屏 320×780 | — | [现在](after-narrow.png) | [机器人操作](after-narrow-bots.png) | [底部](after-narrow-bottom.png) |

另外保存了同名 `-webkit.png` 截图。例如 [WebKit 竖屏规则页](after-iphone-webkit.png)、[WebKit 横屏规则页](after-landscape-webkit.png)、[WebKit 竖屏机器人操作](after-iphone-bots-webkit.png)。

## 本地实测

`scripts/room-ui-review.mjs` 使用真实页面和本地离线练习，分别在 Chromium / Edge 和 Playwright WebKit 的上述四种尺寸运行：

- 房主默认规则页，页签切换、键盘左右箭头及页签选中状态正确。
- 两种难度可选择；简单机器人实际显示「机器人 · 简单」，连续添加保留选择。
- 六席尺寸一致，移动端保持两列，添加至满员后隐藏操作组，移除后恢复。
- 每组规则标签均可滚动到可点击区域；修改底部规则和切换页签均保留滚动位置。
- 设置、聊天可打开与关闭；页面高度减少 90px 后仍可操作且无横向溢出。
- 16 字长昵称保留省略样式且不会越过座位卡片边界。
- 开始按钮始终处于内容滚动区域之外，中心点击命中按钮，无底部工具遮挡。
- 两个浏览器引擎均未记录页面错误。结果见 [Chromium 检查记录](after-chromium-checks.json) 和 [WebKit 检查记录](after-webkit-checks.json)。

复现方式：先在本地启动 Vite，再运行：

```powershell
$env:GAME_URL='http://127.0.0.1:5184/'
node scripts/room-ui-review.mjs
$env:BROWSER_ENGINE='webkit'
node scripts/room-ui-review.mjs
```

双服务器、真实房主/玩家/观众、邀请直达和刷新恢复由 `scripts/entry-smoke.mjs` 的临时 Node/SQLite 双服务专项覆盖。对应最新结果以 PR 中本次运行记录为准。

最终本地检查：`npm test` **321/321**、`npm run check`、`npm run build`、`git diff --check` 通过。构建仅保留既有 Three.js 分包体积提示。`node scripts/entry-smoke.mjs` 通过，359 个请求、21 条本地 WebSocket，页面错误为空；覆盖次级菜单双向直接切服、当前/未开放线路禁用、同线路返回大厅、取消/确认跳转、进行中原身份恢复、邀请显式服务器与观战直达、非房主机器人编辑隐藏及规则只读、观众键盘滚动规则、冲突邀请与原房间恢复。大厅目标使用本地响应替身接管，没有访问生产大厅或创建生产房间。[真实本地在线房间](after-online-iphone.png) 与 [观众等待页](after-spectator-iphone.png) 已截屏。

原有 `browser-smoke.mjs`、`variant-browser-smoke.mjs` 和 `mobile-layout-review.mjs` 仅更新分页后的选择器与空座文案。本次未重跑其中的长局或全部图形专项；本次新增的房间 UI 专项和双服专项已实际运行。没有新增依赖、修改远端 CI 或手动触发远端工作流。

Playwright WebKit 是 Safari 引擎级检查；没有把 Windows 上的移动视口模拟写成实体 iPhone、真实地址栏或运营商网络验收。安全区 CSS 与动态视口处理已实现，实体 iPhone Safari 仍需要真机确认。
