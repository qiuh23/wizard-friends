# 双部署实际交付状态

核验日期：2026-10-30（北京时间）。这是实际证据记录；操作方法见 [部署说明](aliyun-deployment.md)。本功能仍在 PR 分支，未自动合并，也未把分支代码发布为正式服务。

## 线上版本与自动发布

| 游戏／入口 | 实际运行完整 SHA | 对应仓库 main 完整 SHA | 本轮核验 |
| --- | --- | --- | --- |
| 运动会 Cloudflare `https://magical-athlete.qiuh23.workers.dev` | `64b478ec88016db486fc9cc14546c985856fadea` | `64b478ec88016db486fc9cc14546c985856fadea` | 公网 deployment.json 匹配 |
| 运动会阿里云 `http://115.29.188.62/` | `64b478ec88016db486fc9cc14546c985856fadea` | `64b478ec88016db486fc9cc14546c985856fadea` | 公网版本、HTTP／Socket.IO 无房间探测通过 |
| 运动会阿里云预览 `http://115.29.188.62:8080/` | `fa0f251171fa08b9ae1ee988df5bb34b0b5a71b2` | 预览沿用 PR #36，不以 main 为发布目标 | 原版本、HTTP／Socket.IO 无房间探测通过 |
| 巫师牌 Cloudflare `https://wizard-friends.qiuh23.workers.dev` | `13c8558352afe2206b4b29946202737b4045370b` | `13c8558352afe2206b4b29946202737b4045370b` | 公网 build-info.json、WebSocket v2 健康标记通过 |
| 巫师牌阿里云，拟用 `http://115.29.188.62:8081/` | **无，尚未发布** | `13c8558352afe2206b4b29946202737b4045370b` | 主机准备完成；无 current 版本、服务停用、站点未启用、安全组未开放 8081 |

运动会：原 `AUTO_DEPLOY_ENABLED=true`。[Checks #40866262661](https://github.com/qiuh23/magical-athlete-online/actions/runs/40866262661) 与 [正式发布 #40868512996](https://github.com/qiuh23/magical-athlete-online/actions/runs/40868512996) 已真实成功，线上已匹配最新 main，无需再发布一次。本轮没有修改运动会工作区、玩法、数据、发布脚本、权限或预览版本。

巫师牌：Cloudflare 原 Workers Builds 保留，当前线上与 main 匹配；[原 main Verify #40995065506](https://github.com/qiuh23/wizard-friends/actions/runs/40995065506) 成功。新增阿里云自动发布**尚未启用**，`ALIYUN_AUTO_DEPLOY_ENABLED=false`，国内按钮默认关闭。新流程须合入 main 后真实成功一次，才能确认链路；安装器、RAM 配置不等于自动发布成功。

## 已实际完成的 ECS 准备

- SSH 实查现有 Ubuntu ECS，复用 `/opt/node/bin/node` 24.22.1、Nginx、SQLite、systemd。安装前 8081／3002 空闲；现有 3000、3001、80、8080 保留。磁盘约 27 GiB 可用，内存约 1.2 GiB available；不在该机编译。
- 安装独立 `wizard`／`wizard-deploy`、`wizard-friends.service`、固定 root 安装器及部署／配置／数据／日志／备份目录。运行数据与配置权限分别为 wizard:wizard 0750、root:wizard 0640；备份目录 0700。
- 单独的 Nginx sites-available 文件经临时主配置 `nginx -t` 验收。另启动临时回环 Nginx 与协议桩，实际验证 HTTP Host 保留 `115.29.188.62:8081`、Origin 保留、WebSocket 返回 101；测试进程已退出。这不是巫师牌公网游戏验收。
- `systemd-analyze verify`、Bash／Node／Python 语法与 sudoers 检查通过。`wizard-deploy` 仅可 sudo 巫师牌安装器；尝试运动会安装器被拒绝。
- 复用现有 GitHub OIDC provider，新增独立 `wizard-friends-production-deploy` role／`WizardFriendsProductionDeploy` policy，限定当前 ECS 和 `wizard-deploy`。GitHub `production` environment 限 main，所需非秘密变量已配置。
- 经云助手以 `wizard-deploy` 实际运行 `id -un`／`sudo -n -l` 成功；此调用使用现有本机阿里云账号授权，**没有验证 GitHub OIDC → STS**。后者留待 main 首次发布。
- 重新运行准备脚本保存了 root:root 0600 的巫师牌配置备份；没有游戏数据库，未把配置备份声称为运行中 SQLite 备份验收。
- 运动会两个启用站点的 SHA256 在前后保持 `3ca6679c9532abef91625dfc5d2d2c3916dafa02ebbd058eca2a6b75587b0e04`、`cedbd7d5ae70091eb708ce5f2f466970fa560be112406b371e9a0cbe4ec8e03d`；两个原服务 active，公网 HTTP 和实时探测仍通过。

## 本地实际验证

- `npm run check`、`npm test` **256/256**、前端构建、Worker dry-run、Git 空白检查通过；保留现有 Three.js 分包体积提示。
- 7 项 Node 集成测试使用真实 WebSocket／SQLite，覆盖三客户端一轮、聊天／观众权限、鉴权、重复请求、最后有效连接、心跳／帧限制、写盘失败不发送 ready／state、暂停及剩余时限、身份／手牌／随机流恢复、实际子进程 SIGKILL 后恢复、无人重连时恢复到期任务、关闭墓碑不可复活。
- 复用 `scripts/authority-smoke.mjs`，以 `GAME_BACKEND=aliyun` 在 **`http://59.66.16.119:3002/`** 实际三浏览器会话完成一轮和下一轮首墩，验证暂停聊天、房主关闭标签页后返回、刷新、剩余时限、得分一致、观众权限、解散墓碑，`errors=[]`。这是本机非 localhost HTTP 地址，不是 ECS 或异地设备验收。
- 非 localhost HTTP Chrome 确认 `isSecureContext=false`、`crypto.randomUUID` 不存在，安全 UUID 回退成功；练习操作／刷新、分享完整文本选择、桌面及 390px 入口布局、受信整页导航、外来邀请不切换原局通过，无 Cloudflare 运行时请求、`errors=[]`。
- 本地真实 Durable Objects 短回归通过：旧无前缀加入、C- 观战邀请、聊天、房主刷新及返回身份、目录、国内按钮禁用，`errors=[]`；没有重复运行完整对局矩阵。
- 发布边界测试覆盖过时 main、失败检查、外来调用用户、产物摘要／身份、路径逃逸、符号／硬链接及特殊文件；Bash、Python、工作流 YAML 检查通过。

本轮日志位于忽略提交的 `.local/dual-{check,tests,build-final,worker,node-browser,worker-browser}.log`；HTTP 专项脚本 `.local/entry-http-review.mjs`。未增加远端浏览器矩阵、重复前端构建步骤或运动会 CI。

## 合并后仍需执行

1. 用户合并 PR；取得该精确最新 main 的成功 Verify 与 Linux 产物。目前未真实执行 Linux 正式打包／安装、版本切换或应用回滚。
2. 再实查端口，按部署说明开放独立 8081 安全组；3002 保持回环。保持国内按钮与自动触发关闭。
3. 从 main 手动运行新发布工作流，选择该 Verify run，实际证明 GitHub OIDC、云助手、受限安装器、产物和前后端 SHA／WebSocket 验收。最新 main 失败或过时不得改发旧提交。
4. 首次 ECS 外网验证建房、加入、聊天、断线／刷新、服务重启后同身份同牌局恢复；验证真实在线 SQLite 备份及对应代码回滚，重新核验运动会 80／8080 原入口。
5. 外网联机通过后开启受信配置中的国内按钮；真实成功发布后再启用自动触发，并用一次真实 main 发布确认。上述未执行项目均未记为已完成。
