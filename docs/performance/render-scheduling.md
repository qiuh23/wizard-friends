# 界面与绘制调度重构验证（2026-10-30）

基线为执行时拉取的 `origin/main`：`acae078`，工作分支为 `codex/scoped-render-scheduling`。参考运动会的按需绘制思路，未改参考仓库。沿用 JavaScript、Vite、Three.js、规则、TableMotion 时钟、协议、双后端和发布产物约定；没有依赖、CSS、美术或玩法修改。

## 核对与实现范围

- 菜单、计分表、首页加入表单本来已经局部更新；聊天输入本来就独立于 `#app`，排序原有焦点／滚动恢复也有效。没有把这些写成新修复。
- 选牌、空白取消、排序、展开／收起原来进入全局 `render()`，重建主要区域、绑定事件、挂载场景。现在选择只更新样式、预览和原确认按钮；排序移动原 `cardId` 节点，展开／收起只调整原容器。确认提交继续使用原去重保护，练习同步确认不再额外全局重绘一次。
- `ui-regions.js` 区分牌桌与社交输入。仅社交／重复快照更新独立区域，玩法、权限、玩家和绝对截止时间变化仍使牌桌视图失效。规则弹窗也独立开关。结构发生变化时保留原重建方式。
- `frame-scheduler.js` 合并布局、HTML 和 WebGL 请求，支持各客户端到期时间与未来唤醒。`TableMotion.snapshot()` 让 HTML／WebGL 共用同帧姿态；仍由原权威截止时间和暂停时钟计算进度。主牌沿用自己的原控制器时钟，正面静止停留阶段等待归位时刻。
- `layout-scheduler.js` 与 `table-layout-dom.js` 合并观察器／窗口／聊天请求，比较几何和节点输入；按依赖分批测量、计算、写入，复用 SVG 连接线。需要立即取揭示起点时先完成布局。相同 CSS／文字值不反复写入。
- 场景保留正常烛光、水晶球、首页主牌等动效及原画质频率；暂停／减动静止后休眠。纹理就绪、布局、可见性、首帧及 WebGL 恢复显式请求绘制。GPU 贴图仍按需创建，54 种牌面的分批预热、失败重试和分辨率不变。

## 前后实测

同机 Chrome headless、同视口、省电画质，六人第 8 轮练习记录。独立基线工作树避免 HMR 污染；三个视口分别运行 3D 普通、3D 减动、2D 减动，共 9 组。以下是 3D 普通模式的代表值；9 组局部交互和静止断言均通过。

| 操作／观测 | 基线 | 重构后 |
| --- | --- | --- |
| 选牌：全局 render／布局入口／attach／resize | 1／2／1／3 | 0／0／0／0 |
| 取消：全局 render／布局入口／attach／resize | 1／2／1／3 | 0／0／0／0 |
| 排序：全局 render／布局入口／attach／resize | 1／2／1／3 | 0／1／0／0 |
| 展开：全局 render／布局入口／attach／resize | 1／2／1／3 | 0／2／0／1 |
| 桌面选牌：直接新增／移除节点 | 68／58 | 2／0 |
| 390×844 选牌：直接新增／移除节点 | 62／55 | 2／0 |
| 844×300 选牌：直接新增／移除节点 | 60／54 | 2／0 |
| 暂停稳定采样约 1 秒：WebGL 提交 | 19–20 次 | 0 次 |
| 暂停稳定采样约 1 秒：HTML draw 调用 | 约 240 次 | 0 次 |
| 普通稳定采样约 1 秒：HTML draw 调用 | 约 240 次 | 0 次 |
| 普通稳定采样约 1 秒：环境 WebGL 提交 | 约 20 次 | 约 20 次，持续动效保留 |

选牌、取消、排序、展开和收起后，牌桌、席位、手牌区域／容器、本人状态、行动区、计分区和聊天输入 8 个关键节点均保持身份。布局入口计数包含命中缓存的检查；不能视作每次都重新求解牌位。节点数来自 MutationObserver 的直接 addedNodes／removedNodes，不是整棵子树总数。脚本 `elapsedMs` 包括自动化等待窗口，不能解释为交互延迟；本轮不发布 FPS、耗时加速比或真机功耗结论。

## 本地行为验证

- `npm run check`、单测 278/278、生产构建、Worker dry-run。生产构建保留既有 Three.js 分包大小提示。
- 新增的 10 项单测纳入原 `npm test`：请求合帧、未来收牌唤醒、后台恢复／清理、布局强制请求、共享姿态、社交输入失效边界及主牌停留唤醒；已有规则、隐私、恢复、持久化与后端测试继续执行。
- `render-scheduling-review.mjs`：9 组前后对比及 6 组扩展。覆盖选择、取消、排序、展开／收起、一次出牌、焦点／滚动／草稿、随机流不变；三人 20 张手牌三视口和真实转屏；六人未来收牌 2D／3D 期间开菜单、聊天和 resize；延迟图片加载后静止场景补绘；真实 WebGL 丢失／恢复；visibility 事件唤醒。
- 原 `hand-actions-review.mjs` 9 组通过：桌面、390／360 竖屏、844×390／844×300 横屏，保留手牌附近单一出牌按钮、合法性、实际几何、完整终局分数／解散入口及角色权限。
- 原 `card-presentation-review.mjs` 通过：慢图 Canvas／GPU 可读首帧、按插画去重、失败回退；三视口 1／20 张预测选项；桌面 20 张扇形手牌悬停与选中抬升。
- 原真实 Durable Objects 三客户端／观众 `authority-smoke.mjs` 通过：隐私、权限、暂停聊天、房主关页后新页续回、刷新、剩余时限、结算同步、自动推进及解散墓碑。`refresh`／`spectator` 命令是该脚本的别名，没有重复运行同一整场。
- 原 `room-animation-review.mjs` 普通与主牌专项通过：2D／3D 轮末收牌、聊天／resize 不重播、收牌中暂停、暂停刷新和恢复；实际 socket 重连、刷新／中途观战直接归位、第二轮揭示一次及离房清理。
- 原 `table-clarity-review.mjs` 主牌 12 组最终通过：五个视口／渲染模式的真实牌面、停留／归位、遮挡、预测操作与刷新；W／J／无翻牌、三阶段真实 resize、动态减少动效及关闭动画。浏览器 media emulation 返回早于 change 通知，按真实渲染帧交付通知后断言，未改变产品偏好或放宽断言。

原 `graphics-smoke.mjs` 的额外独立场景阈值在基线和重构后完全相同地失败：高低画质像素平均差均为 `0.0677490234375`，低于旧断言 `>0.1`；单独提取手机检查时，三牌投影宽均为 `48.56584692865255`，低于旧断言 `>=60`。高→低→高→低往返误差均为 0。没有改产品尺寸或放宽这些断言来使旧脚本通过；实际产品手牌、公开牌及触控几何由上述专项验证。

## 重现和证据

启动已有 Vite 与本地 DO 后，在 PowerShell 中运行：

```powershell
$env:GAME_URL='http://127.0.0.1:5173/'
$env:PERF_STAGE='after'
node scripts/render-scheduling-review.mjs
$env:REVIEW_EXTENDED='only'
node scripts/render-scheduling-review.mjs
```

基线需服务独立 `acae078` 工作树，使用相同脚本、浏览器、视口和画质，设置 `PERF_STAGE=baseline`；不要在当前代码上把 stage 改名冒充基线。原始本机证据位于未提交的 `output/playwright/`：

- `render-scheduling-baseline-20261030-render-scheduling.json`
- `render-scheduling-after-20261030-render-scheduling.json`
- `render-scheduling-after-extended-20261030-render-scheduling.json`
- `hand-actions-review-20261030-render-scheduling.json`、`room-animation-review.json`、`trump-network-review.json`、`card-presentation-review.json`。

已目视对比桌面和手机前后截图，牌面、手牌、按钮及布局一致。本轮留存：[桌面 20 张手牌](../screenshots/render-scheduling-desktop-20261030.png)、[手机六人选牌](../screenshots/render-scheduling-mobile-20261030.png)。手机均为浏览器模拟，未验证实体手机、Safari／Firefox、真实系统后台节流和生产端部署。visibility 测试是明确注入的可见性事件；WebGL 恢复使用浏览器实际扩展。

## CI 与发布边界

`.github/workflows/verify.yml` 无需适配，保持原样；没有新增工作流、job、矩阵、远端跑分或 GPU 检查。旧本地图形脚本的场景引用探针从已移除的 `animate(0)` 改为成功构造场景后的锚点，仍检查原用户行为；主牌新视口样本先等待真实 resize 事件／布局完成，再注入新发牌，动效偏好模拟也等待浏览器渲染帧。原联机冒烟关键断言不变。

`dist/`、`build-info.json`、Cloudflare 和阿里云打包／版本校验流程不变。远端检查状态以 PR 为准；本轮不合并、不部署。
