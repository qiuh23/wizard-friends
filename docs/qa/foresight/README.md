# 先见之明分组、排序与保密提示本地验收

基于 `origin/main` `6f0730f`，2026-11-05 在本机 Node 26.13.0、Chrome 完成。手机、平板均为浏览器模拟，未验证实体 iPhone / Safari、系统方向锁或生产网络。本次未改 CI、依赖、玩法、发牌、协议或后端权限。

## 最终界面

按用户追加要求移除公开手牌面板的大面积底色和外框。牌组直接显示在桌面，用完整姓名、张数和轻分隔线对应；标题栏在有足够高度时吸顶，极矮横屏允许它一起滚走，以保留整张牌的阅读空间。

- [电脑六人、每人 10 张](desktop.png)
- [手机竖屏六人、每人 10 张](portrait.png)
- [手机横屏六人、每人 10 张](landscape.png)
- [280px 高横屏压力场景](short-landscape.png)：初始只显示牌组顶部，滚走标题后可完整查看每张牌。

## 已通过

| 检查 | 结果和覆盖 |
| --- | --- |
| `node scripts/check-syntax.mjs` | 通过 |
| `node --test tests/*.test.js` | 333/333，0 skipped |
| `node node_modules/vite/bin/vite.js build` 与 `node scripts/build-info.mjs` | 通过；保留既有 Three.js 500kB 分包提示 |
| `node scripts/foresight-review.mjs` | **103 项通过**，errors=[]、failures=[] |
| `node scripts/foresight-network-review.mjs` | 最终生产 bundle、本地独立 Node/SQLite、3 个真人浏览器和 1 位观众通过；检查 40 条状态帧，errors=[]，见[结果](network-results.json) |
| `GAME_URL=http://127.0.0.1:5196/ node scripts/variant-browser-smoke.mjs --foresight-layout-only` | 四人单色第 5 轮、每人 8 张，桌面与手机各组首尾牌完整可达 |
| 原手机专项的 `REVIEW_PHASE=rotation` | 普通预言 390×844 → 844×390 → 390×844；测量与保留的操作栏高度相等 |
| `git diff --check` | 通过 |

103 项专项包括：

- 标准 3/4/6 人，1 张与完整局最大 20/15/10 张；单色 3 人 4 张、4 人 15 张；公开、隐藏、秘密预估。夹具由正式引擎合法操作生成，不伪造规则状态。
- 1440×900、1280×720、768×1024、390×844、360×640、320×568、844×390、568×320、844×300、844×280。另测 3/4/6 人的巫师翻牌选色阶段。
- 每人独占一组、组内换行、无横向溢出；逐个滚动到**每个姓名和每张牌**，验证实际裁切后的整张可见性；面板与全部身份区、实赢/预测、状态、个人信息、主牌及操作区不相交；预测按钮中心实际命中。
- 桌面真实 `mouse.wheel` 无需点击/聚焦、连续小幅触控板式增量、Home / End / PageDown；手机 CDP 原生触摸滑动；二维与真实 WebGL。
- 初始顺序继承本人的排序；切换花色/点数复用现有 `sortCards`，包括 W/J 和同脸不同 ID 的特殊牌。逐组核对完整 ID 顺序、集合和张数，切换前后完整引擎 JSON 不变。
- 转屏、刷新、预测状态更新后无丢牌/重复；更新快照保留滚动位置（误差不超过 1px）与焦点。本人提交但他人尚未完成时，保密提示及其他人公开牌继续保留；最后一人提交后才切回普通自己的手牌。
- 真实联机分别改变一个访客的排序，另两人的排序不变；访客提交前/后刷新均建立新鉴权 WebSocket，排序及许可手牌保留。直接检查服务端状态帧，本人的牌在预测阶段从未下发；观众始终没有手牌，秘密数字继续受原权限过滤。

完整本地记录位于忽略提交的 `output/playwright/foresight/results.json`、`.local/foresight-{layout,network,unit,build}.log`，两份新增专项均仅本地手动执行。

## 普通界面的基线核对与既有失败

没有把旧专项的整套运行记为通过。`scripts/mobile-layout-review.mjs` 的 13 组普通预言/出牌/轮末/终局几何及 3 组展开手牌，均与未修改主分支的结果**逐字段完全一致**，见[16 组对比](ordinary-baseline-comparison.json)。聊天、浮层、排序、选牌、单次合法出牌与收起恢复的已有检查在对应出牌场景通过。

整套旧专项在当前分支及原主分支均遇到：

1. 六人 844×300 的普通终局中，`red-3` 公共牌与身份区相交；几何记录逐字段相同。它不处于先见之明阶段，本次保留普通玩法布局。
2. 随后的 320px 大厅设置交互中，旧脚本点击 `#trump-motion` 时被 `.room-heading/.lobby-current` 拦截，重试至超时；两边同样复现。

未放宽旧专项断言、隐藏失败、强制点击或为这两项改动普通界面。基线记录在 `output/playwright/foresight-baseline-full-*`，当前分支记录在 `foresight-regression-*`；本次新增先见之明专项全部通过。
