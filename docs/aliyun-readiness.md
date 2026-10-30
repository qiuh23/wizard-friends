# 双部署实际交付状态

核验日期：2026-10-30（北京时间）。这是实际证据快照；操作方法见 [部署说明](aliyun-deployment.md)。用户已合并 PR #12，本轮已发布经检查的最新 main，并启用阿里云自动发布与两端生产入口配置；新一轮 README／控件细节改动另交 PR，未发布功能分支。

## 线上版本与自动发布

| 游戏／入口 | 实际运行完整 SHA | 对应仓库 main 完整 SHA | 本轮核验 |
| --- | --- | --- | --- |
| 运动会 Cloudflare `https://magical-athlete.qiuh23.workers.dev` | `64b478ec88016db486fc9cc14546c985856fadea` | `64b478ec88016db486fc9cc14546c985856fadea` | 公网 deployment.json 匹配 |
| 运动会阿里云 `http://115.29.188.62/` | `64b478ec88016db486fc9cc14546c985856fadea` | `64b478ec88016db486fc9cc14546c985856fadea` | 公网版本、HTTP／Socket.IO 无房间探测通过 |
| 运动会阿里云预览 `http://115.29.188.62:8080/` | `fa0f251171fa08b9ae1ee988df5bb34b0b5a71b2` | 预览沿用 PR #36，不以 main 为发布目标 | 原版本、HTTP／Socket.IO 无房间探测通过 |
| 巫师牌 Cloudflare `https://wizard-friends.qiuh23.workers.dev` | `d15f231b3bdf2cb0d9b5fc6b4cac0eca172a4540` | `d15f231b3bdf2cb0d9b5fc6b4cac0eca172a4540` | 已检查 main／原前端产物手动同步，公开版本、协议、联机与双向跳转通过 |
| 巫师牌阿里云 `http://115.29.188.62:8081/` | `d15f231b3bdf2cb0d9b5fc6b4cac0eca172a4540` | `d15f231b3bdf2cb0d9b5fc6b4cac0eca172a4540` | 正式服务 active，8081→127.0.0.1:3002；实际 OIDC 发布、外网联机及重启恢复通过 |

运动会：原 `AUTO_DEPLOY_ENABLED=true`。[Checks #40866262661](https://github.com/qiuh23/magical-athlete-online/actions/runs/40866262661) 与 [正式发布 #40868512996](https://github.com/qiuh23/magical-athlete-online/actions/runs/40868512996) 已真实成功，线上已匹配最新 main，无需再发布一次。本轮没有修改运动会工作区、玩法、数据、发布脚本、权限或预览版本。

巫师牌：当前 main 的 [Verify #40999706795](https://github.com/qiuh23/wizard-friends/actions/runs/40999706795) 成功并真实打出 Linux 产物。[首次正式发布 #41000001042](https://github.com/qiuh23/wizard-friends/actions/runs/41000001042) 通过 OIDC→云助手→固定安装器→公网 SHA／WebSocket 验证。外网验收后设 `ALIYUN_AUTO_DEPLOY_ENABLED=true`，重跑原检查完成事件的 [自动发布 #40999823436，attempt 2](https://github.com/qiuh23/wizard-friends/actions/runs/40999823436/attempts/2) 全部通过，未重复构建。该次 event 为 workflow_run，安装器确认相同精确版本已运行；不是新提交的第二次版本切换。后续新 main 合并时的自然触发结果需在对应运行记录中继续核对。

## 已实际完成的 ECS 准备

- SSH 实查现有 Ubuntu ECS，复用 `/opt/node/bin/node` 24.22.1、Nginx、SQLite、systemd。安装前 8081／3002 空闲；现有 3000、3001、80、8080 保留。磁盘约 27 GiB 可用，内存约 1.2 GiB available；不在该机编译。
- 安装独立 `wizard`／`wizard-deploy`、`wizard-friends.service`、固定 root 安装器及部署／配置／数据／日志／备份目录。运行数据与配置权限分别为 wizard:wizard 0750、root:wizard 0640；备份目录 0700。
- 单独的 Nginx sites-available 文件经临时主配置 `nginx -t` 验收。另启动临时回环 Nginx 与协议桩，实际验证 HTTP Host 保留 `115.29.188.62:8081`、Origin 保留、WebSocket 返回 101；测试进程已退出。这不是巫师牌公网游戏验收。
- `systemd-analyze verify`、Bash／Node／Python 语法与 sudoers 检查通过。`wizard-deploy` 仅可 sudo 巫师牌安装器；尝试运动会安装器被拒绝。
- 复用现有 GitHub OIDC provider，新增独立 `wizard-friends-production-deploy` role／`WizardFriendsProductionDeploy` policy，限定当前 ECS 和 `wizard-deploy`。GitHub `production` environment 限 main，所需非秘密变量已配置。
- 准备阶段经云助手以 `wizard-deploy` 运行 `id -un`／`sudo -n -l` 成功；本轮首次正式发布与 workflow_run 又实际完成 GitHub OIDC→独立角色 STS→同一用户安装，已不止于本机授权验证。
- 已真实执行运行中 SQLite 在线备份，`integrity_check=ok`，同时保留 root:root 0600 的配置备份。重启前后只比较房主、身份、随机流与手牌的 SHA256 摘要，不输出认证映射或随机密钥。
- 运动会两个启用站点的 SHA256 在前后保持 `3ca6679c9532abef91625dfc5d2d2c3916dafa02ebbd058eca2a6b75587b0e04`、`cedbd7d5ae70091eb708ce5f2f466970fa560be112406b371e9a0cbe4ec8e03d`；两个原服务 active，公网 HTTP 和实时探测仍通过。

## PR #12 的本地验证基线

- `npm run check`、`npm test` **256/256**、前端构建、Worker dry-run、Git 空白检查通过；保留现有 Three.js 分包体积提示。
- 7 项 Node 集成测试使用真实 WebSocket／SQLite，覆盖三客户端一轮、聊天／观众权限、鉴权、重复请求、最后有效连接、心跳／帧限制、写盘失败不发送 ready／state、暂停及剩余时限、身份／手牌／随机流恢复、实际子进程 SIGKILL 后恢复、无人重连时恢复到期任务、关闭墓碑不可复活。
- 复用 `scripts/authority-smoke.mjs`，以 `GAME_BACKEND=aliyun` 在 **`http://59.66.16.119:3002/`** 实际三浏览器会话完成一轮和下一轮首墩，验证暂停聊天、房主关闭标签页后返回、刷新、剩余时限、得分一致、观众权限、解散墓碑，`errors=[]`。这是本机非 localhost HTTP 地址，不是 ECS 或异地设备验收。
- 非 localhost HTTP Chrome 确认 `isSecureContext=false`、`crypto.randomUUID` 不存在，安全 UUID 回退成功；练习操作／刷新、分享完整文本选择、桌面及 390px 入口布局、受信整页导航、外来邀请不切换原局通过，无 Cloudflare 运行时请求、`errors=[]`。
- 本地真实 Durable Objects 短回归通过：旧无前缀加入、C- 观战邀请、聊天、房主刷新及返回身份、目录、国内按钮禁用，`errors=[]`；没有重复运行完整对局矩阵。
- 发布边界测试覆盖过时 main、失败检查、外来调用用户、产物摘要／身份、路径逃逸、符号／硬链接及特殊文件；Bash、Python、工作流 YAML 检查通过。

本轮日志位于忽略提交的 `.local/dual-{check,tests,build-final,worker,node-browser,worker-browser}.log`；HTTP 专项脚本 `.local/entry-http-review.mjs`。未增加远端浏览器矩阵、重复前端构建步骤或运动会 CI。

## 首次正式发布与公网验收

- 重新确认 8081／3002 空闲，只新增 TCP 8081 公网入站；原安全组规则保留，3002 只监听回环。安装器使用 main Verify 的 `aliyun-d15f231...` 产物（ID `12952484500`），ZIP SHA256 `f2034b7bd04da811631d96e7f63ffbce272cb7d86579fba7db58b86d02e19cb0`；没有在 ECS 构建。
- 三个真实 WebSocket 客户端及观众经公网 ECS 建入房、聊天、私密手牌／隐藏预测与只读权限、目录、访客断线重连通过。暂停后在线备份并实际 `systemctl restart wizard-friends`，重启前后房主／身份／随机流／手牌摘要一致，事件序号和历史不变、剩余时间保持 30285ms；原认证恢复、重试去重、恢复时限、解散墓碑通过，`errors=[]`。
- 复用 authority-smoke 在正式 HTTP 8081 完成三独立浏览器会话一轮与下一轮首墩，覆盖聊天、观众、暂停、刷新、房主关标签后返回、结算和关房墓碑，`errors=[]`。实际是本机浏览器经公网访问 ECS；手机使用尺寸模拟，不声称不同运营商或实体设备实测。
- 首次验收后备份并将 ECS `BACKENDS_CONFIG_JSON` 的国内项设 true。自动工作流 replay 成功且当前版本保留。运动会原 80／8080 的公开 HTTP 与 Socket.IO 探测仍通过，版本和站点哈希未变。
- Cloudflare 当时仍为旧 `13c8558`。由于现有凭据对 Builds API 返回 403，且 Computer Use 因 Windows 当前 URL 识别保护而停止，未读取到构建日志，不能推断是未触发还是失败。未修改其 Workers Builds 设置。
- 为同步已检查 main，从精确 main 导出 Worker／源码，使用 Verify 的原 `verified-frontend` 产物（ID `12953395308`，ZIP SHA256 `a57c5cd58343989dbc7c18ad352fe6c7c6f797251384c37b36d408818f2c43d2`），没有重建前端。仅在发布暂存目录覆盖公开 `dist/runtime-config.json`：`relayOrigin:""`、Aliyun enabled=true。该项是明确的生产配置覆盖，不能把覆盖后的所有文件仍说成与原 ZIP 完全一致。
- Wrangler 保留原变量、DO 绑定及 v1 迁移，记录旧版本 `27178a8b-d32c-4a92-a4dd-f5a52f362ab9` 后手动发布。新 Worker 版本 `7906a756-fefe-46ed-8fb2-9a8e5704ee4f` 的 tag 为完整 main SHA。公开 build-info／v2、旧无前缀加入、C- 观战、聊天、刷新与返回、目录通过；测试房已解散。手动同步不代表 Cloudflare 自动构建原因已查明或自动链路已重新验证。
- 桌面 1440×900 与手机 390×844 均完成 Cloudflare→阿里云→Cloudflare 的整页导航，两端 runtime 均同源且入口开启，`errors=[]`。完整版本均为表中 main；线上采用已经合并的原入口控件。新“选择服务器／切换”文案、44px 控件、README 和移除 Google 字体请求的改动仅在本轮后续 PR，不发布未合并应用代码。

本次新增证据：`.local/public-recovery.status.json`、`public-authority-browser.log`、`public-cf-protocol.log`、`cloudflare-main-publish.log`、`.local/checked-main-cf/record.json`；浏览器导航／版本结果及截图为 `output/playwright/public-entries/`。

## 后续边界

国内入口和阿里云自动发布已开启。用户后续合并本轮小 PR 后，阿里云应由新 main 的 Verify 完成事件自动更新；继续核对实际运行结果，不以开关代替发布证据。Cloudflare 原自动构建设置保留，但本轮未取得 Builds 读取权限，新的自然触发仍需实查。线上未故意触发失败回滚演练；已保留备份、旧 Cloudflare 版本及固定回滚入口，不把部署边界测试声称为实际版本回滚。
