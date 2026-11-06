> **2026-11-06 方案替代说明：** 本文早期关于选择服务器、跨站自动跳转、同一前端产物、国内自由昵称/聊天的描述及验收为历史记录，已被 [站点隔离与发布](site-edition.md) 取代。现行国内为固定天文昵称且关闭所有玩家交流，两站入口/房间/身份独立。历史公网结果不代表本次源码已发布。

# 巫师牌 HTTPS 子域与统一大厅接入

**2026-11-05当前进展：** 用户后来授权实际上线，新巫师牌HTTPS已完成可信TLS和真人/AI/观众、聊天、合法预测及刷新专项；本PR持久切换公开runtime到新域，与已更新并回读的production公开变量一致。旧8081原游戏/身份继续兼容保留。国内大厅资源与两游戏专项已验，源门禁和runtime合并后的自然发布、最终大厅点击及全部证书续期仍分别核对，详见[最新记录](entry-navigation-review.md)顶部。以下2026-11-04方案和旧PR边界为历史记录。

2026-11-04 的方案；**本 PR 没有修改生产主机、DNS、安全组、证书、云权限或发布环境变量**。本地通过和正式上线分别验收，不能据本文件认定域名已可用。2026-11-05 的后续代码、实测及动态发布快照见 [入口核验](entry-navigation-review.md)；以下旧版本与旧审查分支名称是历史记录。

本次审查分支为 `codex/review-only/unified-lobby-https`，HEAD提交使用 `[skip ci]` 抑制GitHub Actions，避免未合并代码的自动发布。Cloudflare Builds分支/预览设置只读API返回403，未扩大权限；`preinstall` 和构建入口调用 `scripts/review-build-guard.mjs`，仅在 `WORKERS_CI=1` 且分支以 `codex/review-only/` 开头时失败，阻止本次分支部署。main及普通预览分支维持原行为；可能仍产生远端构建/预览记录，不声称没有任何远端动作。最终合并消息须移除 `[skip ci]` 才会触发正常main检查/自动更新。审查期间不要去掉HEAD标记推送或手动发布本分支。

## 已核实的边界

- 用户确认本次备案域名 `magical-athlete-online.cn`，完整网站备案号 **京ICP备2026075006号-1**。统一大厅由 `qiuh23/magical-athlete-online` 维护；国内根域大厅独立提供静态页面，海外复用同仓库 `/lobby/`，保留游戏原 Cloudflare 根入口。
- 待上线巫师牌地址：`https://wizard.magical-athlete-online.cn`；运动会为 `https://athlete.magical-athlete-online.cn`。子域命名是本次实施方案，不代表已有 DNS 或 TLS 证书。
- 保留 `https://wizard-friends.qiuh23.workers.dev` 和旧 `http://115.29.188.62:8081`。Node 仍独立运行在 `127.0.0.1:3002`，原 SQLite、备份、受限安装器和回滚通道保留；不合并两个游戏后端，不修改运动会 3000、3001、8080。
- 仓库当前生效的 `public/runtime-config.json` 仍使用旧 HTTP 国内地址。这样合并后的既有自动发布不会在证书准备前把玩家导向尚未验证的子域。HTTPS 候选配置仅离线生成，正式验收后再显式启用。

## 离线生成可审查材料

在新本地目录生成，不连接云 API、不调用 SSH 或 certbot，不覆盖已有目录：

```sh
mkdir -p .local
node scripts/deploy/prepare-https.mjs .local/wizard-https-review
```

输出包含正式 Nginx 候选、临时 ACME 站点、待合并的公开环境变量、Cloudflare runtime 候选和续期 reload hook。可用 `PUBLIC_ORIGIN`、`PORT`、`LEGACY_PUBLIC_ORIGIN` 显式覆盖；校验要求 HTTPS 使用具体 DNS 主机和 443，内部端口不能使用运动会保留端口，旧 HTTP 必须使用独立高端口。实际生产配置、密钥和数据库不进入材料。

`bootstrap.sh` 现在支持两种部署：旧独立 HTTP 高端口，或共享 Nginx 443 的精确 `server_name` HTTPS。重跑默认读取已有 root 环境的 `PUBLIC_ORIGIN`，不恢复为旧 IP。原环境与请求不一致会停止，不静默重写环境。已有 8081 listener 切 HTTPS 时必须显式指定 `LEGACY_PUBLIC_ORIGIN`，防止无意撤掉旧入口。TLS 模板安装前要求证书已存在；不能先装缺证书的 443 配置再申请证书。

## 合并后实施顺序

下述操作在 PR 合并前一律不执行。主机、DNS、证书、安全组和正式配置仍需在合并后由获授权的操作者完成，不扩大现有云权限。

1. 记录两个游戏、运动会预览的运行 SHA、Nginx 站点摘要、服务状态和监听端口。执行原巫师牌在线 SQLite/配置备份；保留旧完整 env 与 Nginx 文件、current/previous 指针。不要清空数据库、复制运行中 SQLite 主文件或通过 URL 转移凭据。
2. 确认根域及两个游戏子域的 DNS 均直指同一现有 ECS，国内链路不经过 Cloudflare 代理。只按已有授权核对公网 80/443；3002 保持回环。巫师牌自己的临时 ACME 站点精确匹配 `wizard.magical-athlete-online.cn`，与根域及运动会站点共存，不增加 `default_server`，不覆盖原文件。
3. 安装 ACME webroot `/var/www/wizard-friends-acme` 和生成的 `wizard-friends-acme.nginx.conf`，在共享 `/run/lock/game-sites.configure.lock` 下启用这个临时站点。先单独解析未启用的候选，再执行全局 `nginx -t` 后 reload。用真实域名确认挑战测试文件可取，再删除测试文件。保留原 8081 站点和游戏。
4. 使用现有 certbot 的 webroot 模式仅签发此主机名，例如 `certbot certonly --webroot -w /var/www/wizard-friends-acme -d wizard.magical-athlete-online.cn`；账户邮箱/服务条款由操作者在官方客户端处理。证书默认路径须与候选一致；不将私钥、ACME 账户材料或环境文件内容复制到 PR/日志。
5. 检查证书 SAN、链、有效期以及系统时间。在共享配置锁下移除临时 ACME 站点链接，并将正式候选替换**巫师牌自己的**站点；它同时包含新域 80 ACME/HTTPS 跳转、443 TLS 反代和原 8081 反代。`nginx -t` 失败立即恢复原站点，不 reload 失败配置。此时不改变旧入口，先验证新域可信 TLS、页面、静态资源和 health；应用仍只允许旧 Origin，下一步更新精确允许配置后才验收新域 WSS。
6. 把 `server.env.patch` 的公开值合并进原 root 管理的 `/etc/wizard-friends/server.env`，保留 `HOST=127.0.0.1`、`PORT=3002`、原数据库和静态目录。新 canonical `PUBLIC_ORIGIN`、国内 backend origin 均使用 HTTPS，`relayOrigin` 仍由 Node 强制为 `""`；`ALLOWED_ORIGINS` 仅列精确旧 `http://115.29.188.62:8081`。重启巫师牌会断开连接，应安排窗口并先备份；持久化支持重连，但不能称为完全零中断。此后验收新 HTTPS 的 WSS 与旧 HTTP 原身份刷新恢复。合并后按原受限入口更新固定安装器及其 `site-config.mjs`/`probe.mjs`；不在发布包中执行未审查 root 脚本。
7. 通过下表验收后，显式把仓库 `public/runtime-config.json` 国内项切为新 HTTPS，并同步 Cloudflare 发布的 runtime；更新本仓库 GitHub production 的 `ALIYUN_PUBLIC_ORIGIN` 为相同 HTTPS。更新运动会仓库统一大厅受信配置，最后启用国内巫师牌入口。不要让一次旧的 CF 构建重新发布旧 HTTP runtime；以源配置提交和实际返回值核对。旧值保留在回滚记录中。
8. 走一次既有 main 自动发布，不添加远端 CI 矩阵；再次检查公开 runtime、前后端完整 SHA、静态文件、WSS。固定安装器只读取 root env，发布包不覆盖它；新增部署 probe 会因 runtime 回退旧 HTTP 或静态资源变成 HTML fallback 而失败，触发既有应用回滚路径。

## 两端持续自动更新

保留现有两条发布通道，不要求维护者日后分别手动上传网页：

- 阿里云：main 的 `Verify game` 成功后，由 `Deploy checked Wizard to Aliyun` 的 `workflow_run` 自动选择同一精确 main 的已验证 Linux 包，既有 `ALIYUN_AUTO_DEPLOY_ENABLED=true` 开关和独立角色保持。root 管理的 PUBLIC_ORIGIN/BACKENDS 配置不由应用包生成或覆盖。
- Cloudflare：保留原 Workers Builds 仓库集成及 main 生产分支，构建命令 `npm run build:cloudflare`，发布命令 `npm run deploy:cloudflare`。现有命令最终执行的 `verify-deployment.mjs` 现在还将线上 runtime 与该构建的 `dist/runtime-config.json` 对照；即使 SHA 正确，入口被覆盖旧 HTTP 也会报错。先把最终 HTTPS 值提交到源 `public/runtime-config.json`，不依赖某次手工修改 dist 永久生效。

2026-11-04 只读核查现状：main `496603d65f460c8ff1cc4049861cc6fd63a2b26e` 的 `Workers Builds: wizard-friends` check 在 2026-11-01 01:49:19 UTC 成功；[Verify 41262534954](https://github.com/qiuh23/wizard-friends/actions/runs/41262534954) 和[阿里云自动发布 41262595419](https://github.com/qiuh23/wizard-friends/actions/runs/41262595419) 成功。两现有公网游戏返回同一 main SHA。这修正此前 2026-10-30 记录中“尚未确认后续 Cloudflare 自然触发”的历史状态；本次没有调整 Builds 或自动发布开关。

HTTPS 切换后仍需一次新的自然 main 合并，分别记录 GitHub Verify、Aliyun release、Workers Builds check/版本、两端公网 SHA 和 runtime。若原 CF 仓库集成命令在控制台有覆盖，先只读核实与上述预期一致；变更须在合并后按授权进行。Cloudflare 原构建平台保留其自身失败版本处理能力，当前校验发现配置差异会使发布任务失败，但不会把它误称为已自动撤销已经发布的 CF 版本；必要时由操作者使用保留版本回滚。

## 证书续期

正式站点始终保留精确主机的 `/.well-known/acme-challenge/` webroot，不先跳转挑战路径。安装生成的 reload hook 为 root 管理的 `/etc/letsencrypt/renewal-hooks/deploy/wizard-friends-nginx`、权限 0750；hook 仅在 `nginx -t` 成功后 reload。检查现有 `certbot.timer` 的 enabled/active 与下次触发，不另建重复定时任务。执行此证书的 `certbot renew --cert-name wizard.magical-athlete-online.cn --dry-run --run-deploy-hooks`，查看结果并再次读取外网证书。若当前 certbot 不支持 `--run-deploy-hooks`，按该版本帮助完成 staging 续期和 hook 单独验证，明确分别记录。

备份脚本现在同时保存巫师牌 ACME 站点与 reload hook（均为固定路径）。证书由现有受限权限的 `/etc/letsencrypt` 管理；不把证书私钥放到发布包或应用用户可读目录。不使用 `HSTS includeSubDomains`，避免把尚未迁移的入口强制升级。

## 房间、身份与旧入口过渡

两个服务端房间池、身份和数据库继续独立，不跨服查房、不自动切服。带 `A-`/`C-` 的邀请优先于大厅偏好；巫师牌保留旧无前缀 8 位码的当前服语义、观战 `watch=1`，与已有恢复会话保护。跨入口只生成配置内 origin 加公开房间码/观战位，丢弃其他 query 和 fragment，不接受任意目标 URL。

**同一 Aliyun 服务不等于同一浏览器身份。** 旧 HTTP、HTTPS、各子域的 localStorage/sessionStorage 均不共享。原玩家使用原浏览器、原 HTTP8081 入口恢复在局身份；新 HTTPS 浏览器首次访问不能自动占回原座位。邀请从旧入口分享仍保留旧 origin；新入口生成 HTTPS 邀请。旧 listener 不自动重定向，旧 Origin 仅用精确允许项维持 WS，API/静态/实时都跟随所在页面同源。切换时先暂停/结束原局或明确离开，再从新入口开始；不传输令牌。

旧 8081 的下线日期不能预先假定。至少等旧在局自然结束并确认用户已知新入口后再单独批准撤除；下线前发布说明并保留恢复/回滚窗口。运动会旧根 IP 与预览由运动会仓库独立管理，本 PR 不调整。

## 验收与尚未执行项

本地 Node 24.22.2：`npm test` **319/319**、`npm run check`、`npm run build`、Worker dry-run、两个改动 Bash 脚本的语法及 `git diff --check` 通过。保留原 Three.js 大分包提示；未增加依赖或远端 CI 工作流。

| 范围 | 本地证据／合并后要求 |
| --- | --- |
| 本地配置、邀请和安全 | 新增自动测试覆盖 HTTPS443/旧8081、保留运动会端口、禁止地址注入、A/C邀请/观战清理、旧入口分享与恢复、HTTPS→WSS、精确 Origin、不接受通配符、离线生成拒绝覆盖 |
| 服务持久化 | 既有真实 Node/SQLite 测试覆盖三客户端一轮、观众隐私、原身份刷新/重连、进程终止恢复、随机流与手牌、重复请求和墓碑；新增双 Origin 接受及其他 origin 403 |
| 发布持久化 | 新 probe 检查完整前后端 SHA、runtime 国内 origin、保留 CF、同源 script/CSS、错误 HTML fallback、WebSocket协议标记；本地测试故意回退旧HTTP配置会失败 |
| 本地浏览器 | Chrome 2D：Node+SQLite 和本地 Durable Objects 各三客户端完成一轮/下一轮首墩、观众隐私、暂停聊天、房主关闭标签后返回、刷新、结算与解散墓碑，均 `errors=[]`。独立入口检查在1440/390/320px完成双向整页切换；外服 A-观战邀请跳回正确入口、去掉token/next/hash、观众刷新与房主原身份刷新，网络仅两个本地origin、`errors=[]`。修复原手机背景装饰卡片的18px横向溢出后，三尺寸均文档宽度等于视口。均为本地HTTP/模拟尺寸，不能替代公网可信证书、真实手机或国内运营商验证 |
| 正式验收待执行 | 根域大厅及四个入口；HTTPS两玩家建入房/聊天/有效操作/刷新；观众邀请/只读；CF原入口；旧8081原身份；实际静态资源无404、无HTTP混合内容、WSS101；运动会生产/预览原SHA和连接；可信证书链、续期dry-run/hook；发布后runtime不被覆盖；不同设备/移动网络 |

所有正式域名 TLS、续期和上线后配置持久性项目在本 PR 阶段**未实际执行**。本地模板检查不等于 Nginx/ACME 公网验收。已有自动发布、DNS 或 ECS 的历史成功记录也不能替代本次检查。

## 回滚

先将大厅国内巫师牌项禁用或恢复已验证旧入口，再恢复本仓库/Cloudflare runtime 与 production `ALIYUN_PUBLIC_ORIGIN`；避免用户继续进入故障地址。恢复备份的**巫师牌** Nginx 站点和 root env，在共享配置锁下 `nginx -t`、reload，仅按需重启巫师牌。保留原 8081、CF、运动会正式和预览；不要撤销整个根域 DNS 或覆盖另一个游戏站点。

应用代码仍使用原固定安装器按精确 commit/runId 回退 current/previous；新代码回滚不会自动恢复 Nginx、env、DNS 或证书，配置回滚必须明确分别执行。保持当前 SQLite，不用旧数据库覆盖发布后的动作；只有灾难恢复经操作者确认丢失范围后才恢复备份。证书可保留到故障原因查明，无需为了代码回滚删除证书或 ACME 账户。
