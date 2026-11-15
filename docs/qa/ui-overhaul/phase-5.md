# 巫师牌 UI 阶段 5：视觉提升

基线：阶段 4 已合并 main `a2980f1b791f82f37836d455a3f02cbe915c7ce5`。按《UI改造指令-给GPT.md》的 Wizard 阶段 5 执行。继续遵守用户的后续选择：不按总颜色数压色，卡面、3D 烛光、道具材质与无关装饰保持原样；本阶段指定的毡面与新增辉光是明确的视觉变更。

## 改动

- `style.css`、`cinematic.css`、`fullscreen.css`、`table-ui.css`：游戏牌桌各级联声明统一为 `--felt-1` → `--felt-2`，不再让后加载样式把它覆盖为另一套绿。3D 资产、灯光、相机和首页背景未改。
- `round-summary.css`、`table-clarity.css`：复用既有 2D 道具，同一组样式覆盖桌面和手机。蜡烛、书、水晶球背后增加金色径向光池与 `--glow-candle`；去掉把整组道具强制压到 0.3 透明度的 `!important`，保留 0.8。现有插画材质和几何值不变。
- `trump-display.js/.css`：只新增 CSS 变量注入点。普通主牌辉光用现有花色色，巫师和小丑用 `--accent`；牌桌主牌变量、选色、翻牌时钟、弹窗打开/关闭均不改。徽标和揭晓标签使用半透明表面、`--shadow-2` 与具名 halo，预览框同样使用表面和浮起阴影。真实卡图不改。
- `ui/settlement.tsx`、`immersive-table.css`：只增加表现类。命中/未中为 3px 左边线和对应颜色 10% 透明底。赢墩和观战提示不误染成命中；正负分沿用 `--score-plus/#9acbaf`、`--score-minus/#e39782`。
- 终局排名第一（含并列第一）使用金色展示字体和 24px 大字，其余排名用次级文字色。成绩单元格高度 40px，偶数行 3% 白色斑马纹；保留现有滚动、长昵称换行与短横屏布局。长内容可自然增高，不截断可访问信息。
- `home-menu.css`、`ui/theme.css`：首页主按钮实体下沿为 `0 3px 0 var(--gold-edge)`，`--gold-edge:#8a6d3b`；次按钮用 `--ui-control`。禁用和键盘焦点仍沿用原流程。

## 变量对照

| 用途 | 阶段 4 | 阶段 5 |
| --- | --- | --- |
| 游戏毡面 | 7 处不同或重复渐变 | 同一 `--felt-1` → `--felt-2` |
| 2D 烛光 | `#e9a45a30` 阴影 | `--gold` 约 18.82% 透明阴影，加 24% 中心径向光池 |
| 主牌辉光 | 无统一展示光晕 | `--effect-trump-halo`，包含 `--shadow-2` 与当前主牌/魔法色 |
| 主按钮下沿 | `#846739` | `--gold-edge:#8a6d3b` |
| 计分正负色 | `--score-plus/--score-minus` | 原值保留 |
| 终局斑马纹 | 无 | `--score-stripe:rgba(255,255,255,.03)` |

## 删除与保留证据

没有删除任何正在使用的组件或选择器，没有新增 CSS 文件，也没有更改 DOM 结构或 ARIA 属性。`git grep -nE 'table-props|prop-candle|prop-book|prop-orb' -- src/*.js src/ui/*.tsx` 指向 `src/ui/table.tsx` 的既有道具节点，因此保留这些规则，只把同一组定义移出移动端媒体条件供 2D 桌面复用。保留所有其他阶段 4 的 `!important`；仅移除上述妨碍本阶段道具光池的透明度强制项。

阶段 4 的 180 条原美术保护检查继续执行。`tests/fixtures/stage5-art-updates.json` 对请求明确改变的毡面、金色烛光与道具规则新作用域逐项记录原值和新值，其余仍逐条要求精确相等，不关闭整类保护。

## 实际验证

- `npm run check`：JavaScript 语法与 TypeScript 通过。
- `npm test`：448 项通过，0 失败。包含 8 项阶段 5 专项及原阶段 4/翻牌/玩法/发布测试。
- `npm run test:release`：39 项通过。
- `SITE_EDITION=global npm run build`：通过，74 个 immutable 资源和 16 个 GLB 校验通过。
- `npm run worker:check`：国际版 Worker 打包 dry-run 通过，没有发布。
- `SITE_EDITION=cn npm run build`：通过，同样通过资源缓存校验。
- `git diff --check`：通过。
- 独立级联复核发现后加载 `immersive-table.css` 曾把主牌底色/边框清空；已在同一现有规则修正，并增加按 `main.js` 实际导入顺序的回归检查。
- 新专项直接执行原生主牌 renderer 与 React 服务端渲染，覆盖四花色、待选/已选巫师、小丑、无牌/单色牌库、重复渲染、预览关闭和焦点恢复、揭晓光晕、命中/未中/观战/赢墩、并列第一、续局/离开/等待确认，以及原输入对象不变。

本阶段按用户要求跳过截图，不等待限流；未运行浏览器或 Playwright，不宣称 1440×900、390×844、844×390 的像素/遮挡验收通过。已有几何/揭晓范围单测通过，但不等同真实浏览器视觉验收。构建保留既有大 chunk 提醒，没有新增依赖、CI 矩阵或防御性运行分支。两站自动发布结果在交付时另行核对精确合并 SHA。
