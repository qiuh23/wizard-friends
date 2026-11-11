# React + TypeScript 界面迁移

2026-11-11。本次修改正式 `index.html → bootstrap.js → main.js` 入口，基于远端 main `5a09a918263b4bd3eda01f48b89fa891ca62ed8d` 和同日已审核的原牌桌精修结果。运动会参考 main 为 `7cc70a7f5c13517916edbd73e4c595a5c4065625`。不增加玩家需要另开的样板页面。

## 边界和文件

| 责任 | 实现 | 接口约束 |
| --- | --- | --- |
| 规则与随机流 | 原 `game.js` / `random.js` | 保留规则、发牌、变体、计分，不依赖 React |
| 房间权威与联机 | 原 RoomAuthority / Worker / Node / room-transport | 保留认证、requestId、权限投影、时钟、保留期、观战和重连协议 |
| 客户端协调 | `main.js` | 仅将 `viewFor` 或服务端已过滤的 `state` 和展示草稿交给 UI；不传 `game`、身份映射、凭据、牌堆或随机流 |
| 界面状态 | `ui/types.ts` / `ui/store.ts` / `ui/root.tsx` | React 19、严格 TypeScript、`useSyncExternalStore`；选中、查看、排序、展开和浮窗更新为草稿，不推进规则 |
| 首页、候场 | `ui/entry.tsx` | 保留主菜单、恢复入口、房间目录、玩家/玩法双标签和房主权限 |
| 牌桌与结果 | `ui/table.tsx` / `scores.tsx` / `settlement.tsx` | 保留卡面、赢/估、主牌、出牌归属、预测、计分与完整排名 |
| 设置和浮窗 | `ui/chrome.tsx` / `rules-modal.tsx` | 普通浮窗互斥、空白/Esc 关闭、焦点恢复；规则内容为 JSX |
| 场景和动效 | 原 TableScene / HandMotion / TableMotion / TrumpReveal | Three.js 不改成 R3F，复用美术与共享表现时钟；动画不裁决游戏 |

`main.js` 保留成熟的命令校验和生命周期协调，规则、通信及场景仍为 JavaScript。主界面 DOM 由 React JSX 生成，不以整页 HTML 注入包裹旧界面。原音乐、房间目录、海外聊天/改名及主牌展示作为独立适配器保留；React 预留空挂载节点，不接管其内部 DOM。固定图标词库的 SVG 是唯一静态 HTML 图标桥接，不接受玩家文本。

完整权限快照使用 `renderEpoch` 更新界面挂载边界，协调器恢复手牌滚动、焦点、计分表滚动和 FLIP 几何；同一状态内的选择、排序和浮窗只更新 React 草稿。HandMotion 使用 `retainNodes:false`，保留几何、扇形、上抬和邻牌避让，禁止把旧按钮替换进 React 树。场景 canvas、音乐与聊天控制器独立存活。这样保留原客户端的恢复语义，同时明确 DOM 所有权；后续优化快照增量更新时必须一起迁出重绑定流程。

## 主题与沉浸布局

`ui/theme.css` 区分通用 `--ui-*` 语义变量和 `data-game-theme="wizard"` 的主题覆盖，参照 [Astryx 的主题覆盖思路](https://github.com/meta/astryx#overview)。本次复用已审核的系统字体、4px 间距基准、数字对齐、44px 控件、焦点、14px 核心标签及18/20px关键数字。巫师的绿毡、美术、暖金牌框与靛紫控件继续保留，没有将现有场景替换为统一面板。未引入 Astryx 组件或第二套样式运行时；后续可独立提取 tokens 和基础控件，无需统一三个游戏的规则状态。

全屏牌桌与紧凑悬浮操作保持原布局。计分和菜单的下边界按实际手牌、本人信息和预测/出牌区域测量，内容在可用桌面内滚动，旋转和展开后重新计算。非法选牌原因留在本人信息区，预览隐藏时仍可读。

国内固定天文昵称、进房固定、无聊天/改名继续遵守前后端原策略；海外保留自定义昵称、组合 emoji、消息历史、输入草稿和实时聊天。邀请、返回大厅、浏览器存储和 API/WebSocket 继续按本站隔离。

## 验证和发布

执行结果、截图、原始报告及设备限制见 [正式迁移验收](qa/react-migration/README.md)。`npm run check` 现包含严格 UI 类型检查，原 CI、国内打包器、Wrangler 和 main 自动部署配置保持原入口。`npm run test:migration` 为手动的正式入口浏览器回归；不将所有截图矩阵加入默认发布链。

本地构建和验收不代表 main 已合并或线上已发布；发布状态应另核对真实部署记录和线上 `build-info.json`。
