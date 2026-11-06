# 巫师牌：牌桌优先的入口与候场

基线为 2026-11-06 拉取的 `origin/main`：`3ffa46fc904a951a39d07851198971f44d2aa8da`。先查看真实页面，再修改实际可见内容。原有烛光牌桌、卡牌插画、预测/手牌布局、沉浸式工具栏继续使用。

## 前后对照

| 页面 | 优化前 | 优化后 |
| --- | --- | --- |
| 海外首页，桌面 | [before](before-home-desktop.png) | [after](after-global-home-desktop.png) |
| 海外首页，手机竖屏 | [before](before-home-portrait.png) | [after](after-global-home-portrait.png) |
| 海外首页，手机横屏 | [before](before-home-landscape.png) | [after](after-global-home-landscape.png) |
| 满员列表，桌面 | [before](before-directory-full-desktop.png) | [after](after-global-directory-full-desktop.png) |
| 满员列表，手机竖屏 | [before](before-directory-full-portrait.png) | [after](after-global-directory-full-portrait.png) |
| 满员列表，手机横屏 | [before](before-directory-full-landscape.png) | [after](after-global-directory-full-landscape.png) |
| 候场玩法，手机横屏 | [before](before-setup-landscape.png) | [after](after-global-setup-landscape.png) |

国内效果：[首页竖屏](after-cn-home-portrait.png)、[首页横屏](after-cn-home-landscape.png)、[候场玩法](after-cn-setup-portrait.png)、[满员列表](after-cn-directory-full-portrait.png)。

牌桌回归：[桌面](after-game-desktop.png)、[竖屏手牌](after-game-portrait.png)、[短横屏手牌](after-game-landscape.png)、[六人终局 844×300](after-finished-short.png)、[先见之明竖屏](after-foresight-portrait.png)、[先见之明 844×280](after-foresight-short.png)。

首页 before 为基线页面实拍；满员列表 before 使用相同公开房间字段渲染基线目录组件，因为基线预览的独立本机 origin 未在联机服务的允许来源中。after 满员、邀请、加入、观战来自真实本机 Node 房间。牌桌和先见之明截图使用现有审查脚本通过合法引擎动作生成的练习存档，没有在产品中添加测试接口。

## 主要删减与替换

- 删除首页宣传句、“创建后如何操作”的常驻教程；站点标识缩成“国内站 / 海外站”，不增加跨站切换入口。
- 在线列表由房主、房间码、进度、人数各占行改成紧凑两行，复用同一套描边 SVG。玩家用人物图标与 `n / 6`，观战用眼睛与数字；“等待开局 / 游戏阶段”“满员”“加入 / 观战”保持明确。
- 刷新、规则、设置、邀请、返回、候场暂停和聊天复用已有 SVG 系统。每个入口保留无障碍名称、提示、键盘焦点与至少 44px 触摸区域。国内换随机昵称改成与昵称并排的图标按钮。
- 候场移除重复标题、每个玩法的常驻长解释和空位的重复注释。牌库、预估方式、加减预估、先见之明、局长五组直接展示，细则仍在规则窗口；单色 3–4 人限制和不适用选项状态保留。
- 规则支持关闭按钮、空白关闭、Escape 与键盘焦点循环；设置增加关闭按钮，原有空白/Escape 关闭继续工作；隐私说明的原生窗口补空白关闭，不修改说明内容。
- 修复实际 320px 流程中“邀请已复制”提示遮住开始按钮：状态文本不截获点击，复制成功提示 3 秒退出。错误仍清楚显示。
- 修复海外改名草稿被意外收起丢失：X、空白、Escape 均保留草稿，自己的新昵称被确认或更换房间后才清理。聊天和加入草稿继续保留。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| `npm test` | 349 / 349，通过 |
| `node scripts/check-syntax.mjs`、`git diff --check` | 通过 |
| `SITE_EDITION=cn npm run build`、`SITE_EDITION=global npm run build` | 通过；保留既有 Three.js chunk 大于 500kB 的构建警告 |
| `node scripts/site-edition-review.mjs` | 双站真实建房、聊天政策、邀请、观战、重连恢复、跨站邀请拒绝及旧练习昵称迁移通过；[结果](site-edition-results.json) |
| `node scripts/visual-first-review.mjs` | 两站 × 桌面 1440×1000、390×844、844×390、320×568；首页、加入错误/草稿、规则内外点击、设置 X/空白/Escape；实际邀请复制、朋友加入、6 人满员观战、断线恢复均通过；[结果](entry-results.json) |
| `GAME_URL=http://127.0.0.1:5212/ REVIEW_GAME_ONLY=true REVIEW_STAMP=visual-first node scripts/mobile-layout-review.mjs` | 13 个牌桌组合及旋转、对手先手、暂停自动发牌通过；手牌、预测、主牌/公开牌不重叠，无整页滚动；[结果](table-results.json) |
| 同脚本，`REVIEW_VIEWPORT=320x568 REVIEW_PHASE=play REVIEW_STAMP=visual-first-drafts` | 最终改名 X/空白草稿、聊天草稿/发送、菜单/记分/浮窗、解散取消、合法牌只提交一次通过；[结果](draft-results.json) |
| `GAME_URL=http://127.0.0.1:5212/ node scripts/foresight-review.mjs` | 103 项先见之明、3–6 人、隐藏/秘密预估、20 张牌、单色、长昵称、手机短横屏等通过；[结果](foresight-results.json) |
| `playwright test -c playwright.room-experience.config.mjs --project=chromium tests/room-experience/room-layout.spec.js` | 7 / 7，通过；连续旋转、320 设置、手牌选择、预测选色、568×250/667×280 结算及记分、模拟安全区/视觉键盘；[记录](rotation-results.txt) |

修正了旧本地审查脚本的测试前提：现有服务器默认 global，存档应使用对应的无后缀键；普通轮结算已经自动发牌，详细分数从记分入口查看。测试改为当前实际界面，不恢复已移除的结算大面板。

入口脚本默认使用本机两个 Vite：global `5212`、cn `5222`，各自代理对应 Node `3212`、`3222`；`/api`（含 WebSocket）及 `/runtime-config.json` 同源代理。端口可通过 `GLOBAL_URL`、`CN_URL` 改写；脚本拒绝公网 URL。`BASELINE_URL` 仅用于额外的基线目录截图。

## 边界与未覆盖

仅改客户端呈现、浮窗/草稿行为及本地审查。未改规则、服务器、房间权限、昵称分配机制、交流政策、邀请隔离、主分支部署工作流、凭据或安全配置。未合并、未主动发布；提交使用 `[skip ci]`，分支使用现有 `codex/review-only/` 防护。

本次浏览器为本机 Chrome/Edge 的 Chromium 模拟视口；没有实机 iPhone/Safari、物理旋转、真实系统键盘、移动网络及 WebKit 验证。模拟安全区/视觉键盘不等于实机验证。极矮视口的规则、候场玩法和记分表可在各自面板内滚动；对局主体保持整屏。
