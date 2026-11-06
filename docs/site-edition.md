# 巫师牌站点隔离与发布

2026-11-06 新方案覆盖此前共用昵称库、国内快捷短句/表情、服务器选择和跨站自动跳转方案。本文描述源码契约；此次未执行公网部署，不能将本地通过视作实际发布或公网验收。

## 可信配置与产物

- `SITE_EDITION=cn|global` 由构建与服务端部署配置确定，客户端 URL、存储、hello、建房和 action 参数均不改变服务端策略。`vite.config.js` 固化前端模式，`build-info.json`/`runtime-config.json` 记录模式；生产 Node 缺失模式、前端缺失模式或不匹配均拒绝启动。Worker 入口缺失模式返回 503。
- `public/runtime-config.json` 是本地 global 默认；`scripts/build-info.mjs` 在每次构建后生成本站唯一地址。Node 与 Worker 提供可信同源 runtime。前端拒绝双站注册表和模式不匹配，API/WebSocket 强制使用当前页面 origin。
- Cloudflare `wrangler.jsonc` 声明 `SITE_EDITION=global`，原 Workers Builds 使用 `npm run build:cloudflare` / `npm run deploy:cloudflare`；固定目标构建脚本设置 global，发布前验证产物、注册表和 Worker 模式。保留原 main 自然发布通道，不新增远端 CI 工作流。
- 既有 Verify 先检查并构建 global，运行 Worker dry-run 并保存 global 前端；main 打包步骤再独立 `SITE_EDITION=cn npm run build`，只把 cn 产物交给 Aliyun。Linux 包、解包、可信 host env 和公网 probe 分别校验 cn 模式。生产/预览权限、精确 main SHA 门禁、OIDC 和回滚边界沿用原实现。

## 合并前后的部署配置

1. 国内 root 管理的 `/etc/wizard-friends/server.env` 设置 `SITE_EDITION=cn`，删除过时的 `BACKENDS_CONFIG_JSON`；保留数据库路径、凭据、端口、原 PUBLIC_ORIGIN、精确旧 HTTP allowed origin 和私有审计文件。新国内版不再打开或写入安全审计账本，不再依赖账本健康；Nginx 访问日志关闭，错误日志保留。部署工具停用本游戏旧审计 cron/timer，旧数据库和归档不删除。更新固定 installer/`unpack.py`/`probe.mjs` 后再接收新发布包。`bootstrap.sh` 在既有备份保护下补充该配置，拒绝现有非 cn 值；不能清空数据库。
2. Cloudflare 使用仓库更新后的固定 global 构建入口与 `wrangler.jsonc`，不把 cn 的 dist 发布给 Worker。`SITE_EDITION` 若由控制台覆盖，也须为 global。旧 Pages 独立 relay 发布不再符合本站同源协议，停止使用；本任务保留的海外站为 Workers 域名。
3. 合并后分别核对 Verify、Aliyun 自动发布和 Workers Builds，自然发布成功后再核对两端 health/build-info/runtime 的 SHA、edition、本站唯一入口和 WebSocket。旧 IP/HTTP 同样核验 cn 策略。物理手机、运营商与可信 TLS 需实际公网验收。
4. 回滚须使用带 cn 产物及 `.cn-policy` 标记的兼容代码，部署器会拒绝旧开放版本并停服，避免恢复交流；旧开放国内聊天代码不应重新上线。数据库和私有安全审计不随回滚清空。旧版 probe 不能验证新策略，应先安装更新后的部署工具。

三个仓库 PR 无代码导入依赖，可分别合并；建议先合并本游戏和卡坦岛，再合并运动会/大厅，让大厅的三个入口对齐各游戏策略。实际发布必须按各站点配置分别进行，不能仅改浏览器配置。

## 昵称与迁移

完整 32 词及 `wizard-cn-01` 至 `wizard-cn-32` ID 在 `src/site-policy.js`。昵称与 player ID、token、座位和游戏随机流分离。旧记录载入时幂等迁移，结构化 history/events、手牌、得分和随机流保留；旧聊天、旧自由文本 publicEvents/log 不再公开。此类文本缺少足够结构，不能可靠还原，迁移后仅生成可信游戏播报。浏览器会清理旧昵称偏好并迁移练习/旧会话缓存；旧服务端昵称处置仅影响私有映射，不能恢复任意显示名。国内取消交流及访问/连接安全审计和举报入口，保留认证、协议校验、内存限流、故障与游戏数据；海外审计行为不变。

## 本地验证

```powershell
npm run check
npm run test:release
node --test tests/room-authority.test.js tests/relay-worker.test.js tests/social.test.js tests/names.test.js tests/nickname-preference.test.js tests/practice-clock.test.js tests/room-session.test.js tests/room-transport.test.js tests/random.test.js tests/security-remediation.test.js tests/node-server.test.js
python scripts/deploy/test_archive.py
$env:SITE_EDITION='cn'; npm run build
$env:SITE_EDITION='global'; npm run build; npm run worker:check
node scripts/site-edition-review.mjs
```

`site-edition.test.js` 包括真实 Node+SQLite+WebSocket 的恶意昵称、客户端伪造 edition、聊天拒绝和重启恢复，以及原/新交流协议、旧成功回执、旧存档、管理员映射和海外恢复验证。浏览器脚本本地构建两种模式，检查桌面/手机横屏、本站邀请、练习/观战及海外聊天恢复；截图保存在 `output/playwright/`，不会提交。

## 本次本地结果（2026-11-06）

- 语法、`git diff --check` 通过；发布与站点专项 30/30、相关生命周期/恢复/昵称/随机/安全及 Node/Miniflare 119/119、Linux 包离线提取防护 5/5 通过。没有重复执行完整游戏回归。
- cn/global 均成功构建，global Worker dry-run 通过。双模式浏览器 5 组通过：两站各桌面 1440×900 与手机横屏 844×390 的联机、观战、刷新身份；另加国内旧练习缓存恢复。检查国内无交流/改名/举报 UI、固定库昵称、完整四字昵称、同站 WS/大厅/邀请与海外聊天恢复，页面错误为空。
- 截图：`output/playwright/edition-cn-1440.png`、`edition-cn-844.png`、`edition-global-1440.png`、`edition-global-844.png`；结果 JSON：`output/playwright/site-edition-results.json`。均为本机 Chrome 模拟视口；未进行物理手机、公网 TLS、运营商、正式部署、合并或云端回滚验收。
- 用户后续明确追加停用国内交流及访问安全审计；本实现按该追加执行，旧私有数据未删除。海外审计与历史行为保留。
