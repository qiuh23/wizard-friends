---
name: 巫师牌 · 烛光牌桌
description: 烛光、深绿毡面与金色操作构成牌桌，卡面和当前行动始终清楚。
colors:
  primary: '#e6c486'
  text: '#f7f4ec'
  muted: '#b9c4bb'
  paper: rgba(18, 30, 28, .92)
  line: rgba(255, 255, 255, .16)
  accent: '#c9b7ed'
  focus: '#fff4b8'
typography:
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei",
      "Noto Sans SC", system-ui, sans-serif
  title:
    fontFamily: '"Noto Serif SC", "Songti SC", serif'
  card:
    fontFamily: Georgia, "Noto Serif SC", serif
rounded:
  control: 12px
  panel: 14px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
components:
  button-primary:
    backgroundColor: '#e6c486'
    textColor: '#221b10'
    rounded: 12px
---

# 巫师牌 · 烛光牌桌

## Overview
深绿毡面、烛光、纸牌与黄铜色共同构成游戏身份。文字与控件用稳定的语义色，卡面、材质、渐变和灯光保留各自的美术表达。桌面场景承载氛围，手牌、已出牌和当前行动承载操作。

## Colors
| 用途 | Token | 当前值 |
| --- | --- | --- |
| 正文 | `--ui-text` | `#f7f4ec` |
| 次级文字 | `--ui-text-muted` | `#b9c4bb` |
| 面板 | `--ui-surface` | `rgba(18, 30, 28, .92)` |
| 普通控件 | `--ui-control` | `rgba(24, 43, 38, .88)` |
| 悬停控件 | `--ui-control-hover` | `#2c4a41` |
| 激活控件 | `--ui-control-active` | `#33544a` |
| 面板边框 | `--ui-border` | `rgba(255, 255, 255, .16)` |
| 控件边框 | `--ui-control-border` | `rgba(223, 216, 191, .30)` |
| 金色主操作 | `--gold` | `#e6c486` |
| 金色上文字 | `--gold-ink` | `#221b10` |
| 金色边缘 | `--gold-edge` | `#8a6d3b` |
| 焦点 | `--ui-focus` | `#fff4b8` |
| 强调 | `--accent` | `#c9b7ed` |
| 增加/正向 | `--score-plus` | `#9acbaf` |
| 减少/负向 | `--score-minus` | `#e39782` |
| 选中 | `--table-selection` | `#8ce1ed` |
| 遮罩 | `--ui-backdrop` | `rgba(0, 0, 0, .70)` |

`--table-panel` 引用 `--ui-surface`，`--table-brass` 引用 `--gold`，`--table-danger` 引用 `--score-minus`。毡面、羊皮纸和卡纸分别使用 `--felt-*`、`--table-felt`、`--table-parchment`、`--card-paper`。正负反馈表面由 `--ui-positive-surface`、`--ui-negative-surface` 混色生成。

## Typography
正文与控件使用 `--ui-font`；展示标题使用 `--font-display`；卡面使用 `--font-card`。数字采用等宽数字排列。Noto Serif SC 的 600、800 字重由本地字体文件加载，采用 swap。

字阶为 11、12、13、14、16、18、20、24、32px，对应同名 `--font-size-*`。字体栈不限定所有组件为同一字号或行高。`src/ui/theme.css` 中玩家姓名为 600 / 14px / 20px，预测说明为 500 / 14px / 18px，预测数字为 700 / 18px / 22px，自己的指标数字为 700 / 20px / 24px。菜单正文为 400 / 14px / 1.5。

## Layout
首页由背景牌桌、顶部品牌与工具、昵称和三列入口、恢复入口及折叠房间目录组成；加入房间使用独立弹窗。房间及对局保持场景、状态、手牌和操作的分层。

首页布局由 `src/home-dock.css` 与 `src/home-menu.css` 实现：竖屏适配使用 max-width 700px，窄屏使用 max-width 359px；短横屏使用 orientation landscape 且 max-height 540px。`src/ui/theme.css` 在 max-width 850px 的竖屏里将自身行动、倒计时和跟牌要求分列排布。桌面保持牌桌与手牌的空间关系。

## Elevation & Depth
- `--shadow-1`：`0 2px 8px rgba(0, 0, 0, .18)`。
- `--shadow-2`：`0 8px 24px rgba(0, 0, 0, .28)`。
- `--shadow-3`：`0 18px 54px rgba(0, 0, 0, .42)`。

确认出牌按钮使用 `--shadow-1`，菜单与通用弹窗通过 `--ui-shadow` 引用 `--shadow-2`。`--shadow-3` 是较深层级的阴影 token。

卡片厚度、主牌光晕、烛光、胜出牌与选中牌效果分别记录在 `--effect-*` 和 `--glow-candle`，不与普通面板阴影混为一类。完整值见 Tokens 表和 JSON 镜像。

## Shapes
`--radius-sm` 为 8px，`--radius-md` 为 12px，`--radius-lg` 为 14px。首页入口使用 md；`--ui-radius` 引用 lg，供通用弹窗、菜单和确认出牌按钮使用。卡片、扇形手牌、桌沿和场景道具保留专用几何。

## Tokens
数值源为 `src/ui/theme.css`。下表完整记录根级默认 token，别名保留原始 `var()` 表达式；`.impeccable/design.json` 的 `extensions.tokens` 与此逐项镜像。frontmatter 的颜色分别对应 Colors 表中的角色；字体对应 `--ui-font`、`--font-display`、`--font-card`；control/panel 对应 `--radius-md`/`--radius-lg`；sm/md/lg 间距对应 `--space-2`/`--space-4`/`--space-6`；主按钮对应 `--gold`、`--gold-ink`、`--radius-md`。

| Token | 默认值 |
| --- | --- |
| `--ui-font` | `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif` |
| `--font-display` | `"Noto Serif SC", "Songti SC", serif` |
| `--font-card` | `Georgia, "Noto Serif SC", serif` |
| `--ui-text` | `#f7f4ec` |
| `--ui-text-muted` | `#b9c4bb` |
| `--felt-1` | `#254d49` |
| `--felt-2` | `#183933` |
| `--night` | `#111c25` |
| `--ui-surface` | `rgba(18, 30, 28, .92)` |
| `--ui-control` | `rgba(24, 43, 38, .88)` |
| `--ui-control-hover` | `#2c4a41` |
| `--ui-control-active` | `#33544a` |
| `--ui-border` | `rgba(255, 255, 255, .16)` |
| `--ui-control-border` | `rgba(223, 216, 191, .30)` |
| `--gold` | `#e6c486` |
| `--gold-ink` | `#221b10` |
| `--gold-edge` | `#8a6d3b` |
| `--cream` | `#fff0cb` |
| `--accent` | `#c9b7ed` |
| `--card-paper` | `#e8deca` |
| `--ui-focus` | `#fff4b8` |
| `--radius-sm` | `8px` |
| `--radius-md` | `12px` |
| `--radius-lg` | `14px` |
| `--shadow-1` | `0 2px 8px rgba(0, 0, 0, .18)` |
| `--shadow-2` | `0 8px 24px rgba(0, 0, 0, .28)` |
| `--shadow-3` | `0 18px 54px rgba(0, 0, 0, .42)` |
| `--z-base` | `0` |
| `--z-sticky` | `10` |
| `--z-dock` | `20` |
| `--z-banner` | `30` |
| `--z-menu` | `40` |
| `--z-modal` | `50` |
| `--z-toast` | `60` |
| `--duration-1` | `120ms` |
| `--duration-2` | `180ms` |
| `--duration-3` | `240ms` |
| `--ui-easing` | `cubic-bezier(.2, .7, .3, 1)` |
| `--ui-touch-size` | `44px` |
| `--font-size-11` | `11px` |
| `--font-size-12` | `12px` |
| `--font-size-13` | `13px` |
| `--font-size-14` | `14px` |
| `--font-size-16` | `16px` |
| `--font-size-18` | `18px` |
| `--font-size-20` | `20px` |
| `--font-size-24` | `24px` |
| `--font-size-32` | `32px` |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--ui-radius` | `var(--radius-lg)` |
| `--ui-space` | `var(--space-1)` |
| `--ui-space-2` | `var(--space-2)` |
| `--ui-space-3` | `var(--space-3)` |
| `--ui-shadow` | `var(--shadow-2)` |
| `--ui-duration` | `var(--duration-2)` |
| `--table-felt` | `#08231c` |
| `--table-panel` | `var(--ui-surface)` |
| `--table-brass` | `var(--gold)` |
| `--table-parchment` | `#f3ead6` |
| `--table-selection` | `#8ce1ed` |
| `--table-danger` | `var(--score-minus)` |
| `--ui-backdrop` | `rgba(0, 0, 0, .70)` |
| `--score-plus` | `#9acbaf` |
| `--score-minus` | `#e39782` |
| `--score-stripe` | `rgba(255, 255, 255, .03)` |
| `--effect-trump-halo` | `var(--shadow-2), 0 0 16px color-mix(in srgb, currentColor 35%, transparent)` |
| `--ui-positive-surface` | `color-mix(in srgb, var(--score-plus) 12%, var(--ui-surface))` |
| `--ui-negative-surface` | `color-mix(in srgb, var(--score-minus) 12%, var(--ui-surface))` |
| `--effect-cinematic-panel-1` | `0 20px 55px #0005,inset 0 1px #e0c4820e` |
| `--effect-cinematic-primary-2` | `0 3px 0 #604a2b,0 8px 22px #0005` |
| `--effect-cinematic-primary-3` | `0 3px 0 #604a2b,0 8px 28px #c39b4a30` |
| `--effect-cinematic-table-4` | `inset 0 0 70px #0009,0 15px 60px #0004` |
| `--effect-cinematic-has-webgl-table-5` | `0 20px 50px #0005` |
| `--effect-cinematic-player-active-6` | `0 0 0 1px var(--gold),0 0 23px color-mix(in srgb, var(--gold) 12.54902%, transparent)` |
| `--effect-cinematic-has-webgl-played-winner-7` | `0 0 16px color-mix(in srgb, var(--gold) 20%, transparent)` |
| `--effect-cinematic-played-card-8` | `3px 4px 0 #443c2c,8px 15px 16px #0007` |
| `--effect-cinematic-played-winner-card-9` | `0 0 0 2px #f1c46c,0 0 40px #f9ba6055` |
| `--effect-cinematic-bid-10` | `0 0 14px color-mix(in srgb, var(--gold) 20%, transparent)` |
| `--effect-cinematic-wizard-card-jester-11` | `1px 2px 0 #8d7854,2px 4px 0 #514830,3px 6px 0 #332d24,6px 15px 20px #0009` |
| `--effect-cinematic-hand-card-playable-12` | `0 0 0 1px #ddbd7b,1px 3px 0 #897451,3px 6px 0 #3c3324,4px 14px 25px #0008,0 0 16px #e6ba5c1a` |
| `--effect-cinematic-card-hand-card-13` | `0 0 0 1px #f4d890,2px 5px 0 #695332,9px 25px 35px #000b,0 0 26px #e6ba5c33` |
| `--effect-clarity-hand-card-playable-14` | `0 0 0 2px #f5d58c, 0 0 18px #e4ba6f55` |
| `--effect-clarity-played-winner-card-15` | `0 0 0 3px #fff0af, 0 0 0 6px #d29b27, 0 0 32px #ffd35b88` |
| `--effect-clarity-has-webgl-played-winner-16` | `0 0 0 2px var(--gold), 0 3px 18px color-mix(in srgb, var(--gold) 43.92157%, transparent)` |
| `--effect-fullscreen-player-active-17` | `0 0 18px color-mix(in srgb, var(--gold) 12.54902%, transparent)` |
| `--effect-fullscreen-effect-18` | `0 0 8px color-mix(in srgb, var(--score-plus) 25.09804%, transparent)` |
| `--effect-home-menu-menu-options-menu-primary-19` | `0 3px 0 var(--gold-edge)` |
| `--effect-lobby-lobby-felt-20` | `0 0 0 2px #8b7046,inset 0 0 60px #0009` |
| `--effect-round-summary-player-lead-seat-21` | `0 0 0 1px color-mix(in srgb, var(--table-selection) 26.66667%, transparent)` |
| `--effect-round-summary-player-lead-seat-active-22` | `0 0 0 2px var(--table-selection)` |
| `--effect-round-summary-prop-book-23` | `3px 5px 7px #0007` |
| `--effect-round-summary-prop-orb-24` | `0 11px 0 -3px #997c45,0 0 14px #7ad1cf44` |
| `--effect-round-summary-prop-deck-25` | `2px 2px 0 #d0c09a,4px 4px 0 #29413b,5px 6px 0 #c1ae88` |
| `--effect-round-summary-prop-coins-26` | `-7px 4px 0 #b28a48,-2px 8px 0 #73572d` |
| `--effect-round-summary-prop-candle-27` | `0 7px 0 3px #9a7a40` |
| `--glow-candle` | `0 0 15px 8px color-mix(in srgb, var(--gold) 18.82353%, transparent)` |
| `--effect-social-table-trump-29` | `0 0 14px currentColor` |
| `--effect-social-table-ring-30` | `0 0 24px color-mix(in srgb, var(--trump-color) 20%, transparent)` |
| `--effect-spectator-room-directory-31` | `0 14px 45px #0008, inset 0 1px #f7dfab16` |
| `--effect-style-hero-cards-card-32` | `0 12px 30px #0008` |
| `--effect-style-player-active-33` | `inset 0 0 0 1px color-mix(in srgb, var(--gold) 46.67%, transparent)` |
| `--effect-style-played-winner-card-34` | `0 0 0 2px var(--gold),0 0 25px #d7be6244` |
| `--effect-style-card-35` | `0 5px 12px #0004` |
| `--effect-style-card-playable-36` | `0 0 0 1px #e6c780,0 5px 15px #0004` |
| `--effect-table-clarity-own-status-active-avatar-37` | `0 0 0 2px var(--table-selection),0 0 14px color-mix(in srgb, var(--table-selection) 26.66667%, transparent)` |
| `--effect-table-clarity-played-cards-played-winner-38` | `0 1px 4px #0005` |
| `--effect-table-clarity-bid-options-bid-39` | `inset 0 0 0 1px color-mix(in srgb, var(--gold) 30.19608%, transparent)` |
| `--effect-table-play-played-cards-played-card-40` | `0 1px 0 1px #d1be91,1px 3px 3px #020d0960` |
| `--effect-table-play-played-winner-played-state-41` | `0 0 0 1px #031421,0 2px 4px #0009` |
| `--effect-table-polish-bid-state-mark-42` | `0 1px 3px #06130f40` |
| `--effect-table-polish-effect-43` | `0 0 0 2px color-mix(in srgb, var(--gold) 16.86275%, transparent),0 0 8px color-mix(in srgb, var(--gold) 12.54902%, transparent)` |
| `--effect-table-polish-effect-44` | `0 0 0 3px color-mix(in srgb, var(--gold) 41.96078%, transparent),0 0 18px color-mix(in srgb, var(--gold) 25.09804%, transparent)` |
| `--effect-table-polish-played-card-45` | `1px 2px 2px #0c191c20,0 3px 7px #07171124` |
| `--effect-table-polish-played-cards-played-card-contact-shadow-46` | `1px 2px 3px #07171124,0 3px 8px #07171120` |
| `--effect-table-polish-avatar-action-panel-bid-attention-47` | `0 0 0 2px color-mix(in srgb, var(--gold) 30.19608%, transparent),0 0 10px color-mix(in srgb, var(--gold) 16.86275%, transparent)` |
| `--effect-table-ui-player-active-48` | `0 0 22px color-mix(in srgb, var(--gold) 31.37255%, transparent)` |
| `--effect-table-ui-own-status-active-49` | `0 0 19px color-mix(in srgb, var(--gold) 18.82353%, transparent)` |
| `--effect-table-ui-hand-card-playable-50` | `inset 0 0 0 1px var(--gold),0 0 0 1px var(--gold)` |
| `--effect-table-ui-hand-card-selected-51` | `0 0 0 3px #8ce1ed,0 0 16px #85deee77` |
| `--effect-table-ui-selected-preview-card-52` | `0 0 0 2px #98e4ed,0 8px 30px #0008` |
| `--effect-table-ui-continuation-panel-53` | `0 0 0 100vmax #00130bd9` |
| `--effect-table-ui-effect-54` | `0 0 30px color-mix(in srgb, var(--gold) 53.33333%, transparent)` |
| `--effect-table-ui-hand-card-selected-55` | `0 0 0 3px var(--table-selection),0 0 16px #85deee55` |
| `--effect-table-ui-desktop-fan-card-hovered-56` | `0 0 0 2px #f0e6ca,0 8px 20px #0008` |
| `--effect-table-ui-desktop-fan-card-selected-57` | `0 0 0 3px var(--table-selection),0 0 18px #8ce1ed55` |
| `--effect-table-ui-hover-preview-card-58` | `0 0 0 1px var(--table-parchment),0 8px 30px #0008` |
| `--effect-trump-display-trump-reveal-trump-card-face-trump-reveal-back-59` | `0 6px 20px #00130d66` |
| `--ui-text-shadow-color` | `#000` |

### 减弱动态效果
当 `(prefers-reduced-motion: reduce)` 生效时，`--duration-1`、`--duration-2`、`--duration-3` 均为 `0ms`，JSON 的 `extensions.reducedMotion` 单独记录这些覆盖值。

## Components
- 首页主入口使用金色背景与深色文字，其余入口使用控件表面和正文色；悬停、禁用与焦点状态仍由对应语义色表达。
- 菜单和弹窗使用面板边框、lg 圆角及二级阴影；滚动内容位于手牌与行动区域上方的可用空间。
- 普通交互控件的触控尺寸基准为 `--ui-touch-size`（44px）；卡牌保留自己的交互几何。
- 焦点轮廓为 `2px solid var(--ui-focus)`，outline-offset 为 `2px`。
- 常规按钮的背景、边框和阴影过渡使用 `--ui-duration`（引用 `--duration-2`，180ms）与 `--ui-easing`。三级时长 token 为 120/180/240ms；场景演出独立处理。
- 层级由 `--z-base`、`--z-sticky`、`--z-dock`、`--z-banner`、`--z-menu`、`--z-modal`、`--z-toast` 表达，对应 0/10/20/30/40/50/60。

## Do's and Don'ts
- 用语义 token 表达文字、表面、控件、边框、金色和焦点；同一用途复用同一 token。
- 保留卡面、毡面、烛光、渐变、纸张和道具的装饰色与质感。
- 用字体层级与数字对齐区分姓名、预测、分数和当前行动。
- 不把卡片几何当成普通按钮，不用普通面板阴影替代牌桌专用效果。
- 不让面板、灯光装饰和标题抢占手牌及当前行动的阅读空间。
