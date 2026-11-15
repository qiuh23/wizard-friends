# Wizard UI 阶段 4：语义颜色与界面尺度

## 基线与范围

从已上线阶段 3 的 `354cafffa066c7fabc9b9650b9e69dadedc918cb` 新建工作树重新实施。此前以颜色数量为目标的候选改动全部弃用，未将旧候选补丁复制或重新应用。

用户最新口径取代阶段 2、3 记录中的「最终 ≤200 色」：没有颜色数量上限；只统一文字、表面、控件、边框、金色、焦点和状态等语义角色。卡面、烛光、道具、场景、装饰渐变保持原样。此阶段没有修改游戏逻辑、React DOM、手牌模型、网络、素材、灯光、依赖或发布配置，没有进入阶段 5。

## 颜色角色

`src/ui/theme.css :root` 是语义色唯一声明处：

- 正文 `--ui-text`，次要文字 `--ui-text-muted`；深底可读性阴影 `--ui-text-shadow-color`。
- 面板 `--ui-surface`，遮罩 `--ui-backdrop`；普通、悬停、按下控件分别为 `--ui-control` / `--ui-control-hover` / `--ui-control-active`。
- 普通边框 `--ui-border`，控件边框和滚动条滑块 `--ui-control-border`。
- 金色 `--gold` 与金底文字 `--gold-ink`；键盘焦点 `--ui-focus`。
- 成功/加分 `--score-plus`，危险/扣分 `--score-minus`，选择/领先 `--table-selection`。正负表面由角色色与统一表面混合，不定义近似散色。
- `--table-panel`、`--table-brass`、`--table-danger` 是上述语义角色的兼容别名。`--table-parchment: #f3ead6` 则保留为卡片预览材质，界面正文不再引用它。

有意统一：表单、工具栏、菜单、聊天、目录、预测、结算、分数账本、在线/提交状态、领先状态、焦点、滚动条，以及 active-player/bid-attention 等 16 个状态阴影的色彩部分。状态阴影保留原位置、范围、透明度，只改角色引用。成功提交与等待状态仍分别使用成功色和金色。

有意保留：所有渐变与图片声明，牌面/花色/角色小图标的颜色，蜡烛/书/水晶球/金币，桌毡和场景背景，卡片厚度/接触阴影，装饰性内框和实体按钮暗色边沿。没有把这些素材色强行改成统一金色。装饰性空桌符号也保持原色及透明度。

## 文字、圆角、阴影与触控

- 信息文字使用 11/12/13/14/16/18/20/24/32px 九档，普通字重 400/500/600/700/800。原字号 clamp 归到明确档位，几何变量的嵌套 fallback 不当作字号修改。真实装饰字形及隐藏重复标签的 0px 不算信息字级。
- 界面圆角使用 8/12/14px，胶囊及圆形保留。交互卡片外壳和全尺寸覆层采用 8px，卡角标签、书/蜡烛等造型和椭圆场景边缘保留。
- 普通界面投影统一三档；需要保持视觉的材质/光效以具名 token 保存原值。焦点统一 2px 实线、2px 外偏移，游戏领先牌轮廓不是键盘焦点，仍保持原样。
- 按钮、导航/图标入口、文本输入、选择框和既有复选/单选标签有 44px 最小交互区域，复选/单选图形保持原尺寸。短横屏旧 35px 手部按钮最小高度改为同一 44px token，未增加 `!important`。
- 手牌 CSS 宽度底线 44px，高度严格为同一宽度的 1.5 倍，保留原 2:3 比例与横向滚动。没有修改手牌模型、扇形/座位布局；卡片重叠时实际露出点击区域仍须真实交互检查，不能用 CSS 最小宽度代替。

## 可复现检查

新增 `tests/ui-stage4.test.js` 七项目标测试和基于阶段 3 的 `tests/fixtures/stage4-art-preservation.json`：

1. 180 条原装饰声明逐值保持（具名阴影先解析再比较）。
2. 唯一语义角色及兼容别名。
3. 九档信息字号与五档字重。
4. 三档界面阴影或明确具名光效。
5. 键盘焦点与游戏轮廓分离。
6. 44px 触控、原选择图形、手牌比例。
7. 剩余字面色只能属于已记录的原装饰声明，滚动条/正负分数/状态光效引用正确角色。

静态审计额外核对全部 52 条 gradient/url 声明原样保留，源码 `!important` 仍为 40 处。Git 跟踪的 27 个 CSS 按原口径实测 **212 种不同 hex**，只作描述，不是目标或验收上限；没有以 rgb/hsl 改写绕过计数。

```sh
npm run check
npm test
SITE_EDITION=cn npm run build
SITE_EDITION=global npm run build
npm run worker:check
git diff --check
python3 - <<'PY'
import re, subprocess
from pathlib import Path
files = subprocess.check_output(['git', 'ls-files', '*.css'], text=True).splitlines()
colors = {v.lower() for p in files for v in re.findall(r'#[0-9a-fA-F]{3,8}\b', Path(p).read_text())}
print(len(colors))
PY
```

本地 check、440 项测试、双站构建、global Worker dry-run、diff 检查通过。GitHub 常规 PR 检查只执行 release 子集与构建，不宣称其运行了全部 440 项。本阶段最后的精确提交和发布结果另附交付记录。

## 浏览器与发布边界

本地 Chromium 已知 socket EPERM，不再尝试启动。Cloudflare 截图服务处于长时间限流，本阶段未重试。没有可验证的现成 PR 预览地址，不建立临时外部页面，也不上传私有夹具。

仅使用受支持云浏览器直接打开原始正式站点，合并后检查首页/大厅与实际练习流程。其原生窗口检查不能冒充 1440×900、390×844、844×390 的精确矩阵，也不能冒充手机触屏或 WebGL 实测。实际取得的截图、可用视口、试玩步骤、未覆盖项目在交付记录中逐项列明。按用户要求，不制作对局截图，不因缺少对局截图阻塞常规提交/合并。
