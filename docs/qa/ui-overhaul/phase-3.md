# UI 阶段 3 组件归一

基于 main `7e035fbd`。`style.css` 纯格式化单独提交 `45d88bd`，PostCSS 解析树完全一致，构建通过。后续组件整理另一个提交；不更改游戏规则、状态、协议、DOM 或扇形几何 JS。

## 归属和删除依据

- `.roundbar` 的基础、媒体和数据属性规则全部集中到 `table-ui.css`；保留实际级联获胜声明。
- `.table-icon-button` 集中到 `ui/theme.css`，包含通用按钮、工具栏、聊天与先见之明入口。
- 聊天外观及 `chat-arrive` 关键帧集中到 `social.css`，定位、键盘可视高度、响应式和观战隐藏条件集中到 `table-dock.css`。保留两个 ID 的 compact 规则优先级。主题混合 `:is` 拆分时用现有 `#table-menu-panel` 保持菜单的 ID 强度，未新增原来未命中的计分表皮肤。
- 手牌尺寸仅由 `table-ui.css` 负责：桌面、≤1100、≤580 的宽度上限分别为74/66/62px，以现有 `--hand-height` 限制高度，保持短横屏46×69和极矮横屏40×60；桌面仍消费 `--fan-card-width`。这项按新目标收敛旧尺寸，不声称全部旧尺寸原样保留。
- 基础按钮悬停不再上浮，移除首页和主题中为抵消上浮而存在的 `transform:none`。
- 删除 `style.css`、`cinematic.css` 的独立 `.landing/.entry/.how/.facts` 及其后代、媒体规则。生产 JS/TSX 没有这些类；`entry-context` 是不同类。`scripts/browser-smoke.mjs` 只断言旧营销元素不存在。
- 删除 `.hero h1/.hero .eyebrow/.hero .intro`：实际首页标题是 `.hero` 的兄弟元素。保留 `entry.tsx`、`main.js` 使用的 `.hero/.hero-cards` 和场景挂载样式。
- 删除 `style.css` 五条 `.card.red/.green/.yellow/.wizard/.jester` 旧着色。类仍由 `primitives.tsx` 动态使用，删除依据是后置 `cinematic.css` 和 `card-face.css` 已覆盖这些着色声明，**不是类无引用**。
- `--table-*` 移入 `theme.css` 唯一主题来源，本阶段保持这些变量原值；阶段4按语义合并。

引用复核命令：

```sh
rg -n 'landing|entry|how|facts|hero|hero-cards' src --glob '*.js' --glob '*.tsx'
rg -n 'card.*(red|green|yellow|wizard|jester)|card.kind|card.suit' src --glob '*.js' --glob '*.tsx'
rg -n '\.roundbar|\.table-icon-button|#room-chat' src --glob '*.css'
```

逐声明删除、迁移及覆盖依据保存于交付页的 `consolidation-report.json`，并随阶段报告提供补丁。

## 验证

`npm run check`、`npm test`（433/433）、`SITE_EDITION=global npm run build`、`npm run worker:check`、`git diff --check` 通过。独立静态审查确认原选择器条件及关键优先级保留。仓库 Playwright 的 Chromium/headless shell 与 WebKit 系统库缺项仍未解决；按用户要求不重试本地 Chromium，手动检查不计作 Playwright 通过。

受支持云预览的首页、大厅分别检查1440×900、390×844、844×390。无页面横向溢出；短横屏首页纵向滚动，大厅规则区内部滚动，开始游戏按钮均可见。桌面额外检查聊天开关。共七张原始JPG：短横屏首页裁切接口超时，保留原生浏览器截图，图中应用 iframe 为844×390，截图包含工具栏及外围画布；其余直接按应用视口截图。当前平台WebGL禁用，均为2D fallback。线上试玩和双站部署在合并后另行记录。

## 可复现颜色计数

基线阶段2：27个受Git跟踪CSS、784种不同hex、40处!important。阶段3：754种不同hex、40处!important；本阶段不宣称达到最终视觉尺度。计数包括3/4/6/8位hex（大小写归一），不将生成目录或依赖CSS算作项目源码。

```sh
python - <<'PY'
import re, subprocess
from pathlib import Path
files = subprocess.check_output(['git', 'ls-files', '*.css'], text=True).splitlines()
colors = {v.lower() for p in files for v in re.findall(r'#[0-9a-fA-F]{3,8}\b', Path(p).read_text())}
print(len(colors))
PY
```

阶段4将 cinematic.css、style.css、table-ui.css 的 --table-* 和其余散色按语义收进共同 token，实际计数必须≤200；不得靠改写成rgb绕过。

交付页：https://chatgpt.com/space/page_bb0e4add86088191a89ffc24381aea43
