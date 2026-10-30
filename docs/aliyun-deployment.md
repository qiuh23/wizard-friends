# Cloudflare 与阿里云独立部署

当前主机准备、线上版本与尚未执行项目见 [实际状态记录](aliyun-readiness.md)。以下流程说明不能替代实际发布／验收证据。

Cloudflare 保留现有 Workers Builds、Durable Objects 与 main 发布配置。阿里云复用同一套 `src/game.js`、`RoomAuthority` 和 WebSocket v2 协议，以 Node 24、ws、SQLite 运行；无需 Cloudflare API、Redis 或多进程集群。首页切换是整页导航，网页资源、API、WebSocket、房间目录均来自本部署。两端房间池独立，邀请保留所属 origin 和端口，不迁移对局或身份，旧 Cloudflare 链接继续有效。

国内按钮由受信 `/runtime-config.json` 控制，仓库默认 `enabled:false`。仅在真实外网建房、加入、聊天、重连和重启恢复后，分别把需要的入口中阿里云配置改成 true；PR 合并、健康检查通过都不能代替此验收。国内当前网页仍可使用自己的后端。HTTPS 首页不请求 HTTP 国内健康接口。Node 运行时的 `relayOrigin:""` 覆盖构建时 `VITE_RELAY_URL`，同一份已检查前端供两端使用；手动 Pages 仍保留原 relay 校验。

## 固定隔离范围

| 项目 | 运动会正式 | 运动会预览 | 巫师牌正式 |
| --- | --- | --- | --- |
| 公网入口 | `http://115.29.188.62/` | `http://115.29.188.62:8080/` | 拟用 `http://115.29.188.62:8081/` |
| 内部回环端口 | 3000 | 3001 | 默认 3002，可配置 |
| 服务／运行用户 | 现有配置 | 现有配置 | `wizard-friends`／`wizard` |
| 发布用户 | 现有配置 | 现有配置 | `wizard-deploy` |

巫师牌只使用 `/opt/wizard-friends`、`/etc/wizard-friends`、`/var/lib/wizard-friends`、`/var/log/wizard-friends`、`/var/backups/wizard-friends`、`/var/lib/wizard-friends-deploy-state`。Nginx 独立站点名 `wizard-friends`，代理日志 `/var/log/nginx/wizard-friends.*.log`，应用日志 `journalctl -u wizard-friends`。不修改运动会代码、数据、受限安装器和预览流程。

## 一次性主机准备

使用现有 Ubuntu 24.04 x64 ECS，复用 `/opt/node/bin/node` 24、Nginx、SQLite、Python 3.12+、systemd、curl、flock、sudo。脚本不购买资源，不调整安全组。先核实内存／磁盘与 `ss -ltnp`，确认 8081、3002 无占用；换端口也须先核实，脚本拒绝运动会 3000、3001、8080 和低位保留端口。

从审查过的 PR 文件执行以下准备，不发布功能分支应用：

```sh
sudo env PUBLIC_ORIGIN=http://115.29.188.62:8081 PUBLIC_PORT=8081 PORT=3002 \
  bash scripts/deploy/bootstrap.sh
```

它创建无登录用户、独立目录、systemd 服务、每日在线备份、独立 Nginx `sites-available` 和固定 root 安装器。首次不启动游戏、不启用站点、不开放 8081。已有 server.env 保留并核对端口匹配。未链接的新 Nginx 文件需以临时主配置单独语法验收，不能把普通 `nginx -t` 当作已解析它；首次发布在回环验收后才启用自己的站点，并执行 `nginx -t` 和 reload。共享站点修改锁为 `/run/lock/game-sites.configure.lock`，人工同时维护多个游戏站点时也应取此锁。

`/etc/wizard-friends/server.env` 的关键内容（root:wizard 0640）：

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3002
DATABASE_PATH=/var/lib/wizard-friends/rooms.sqlite
STATIC_DIR=/opt/wizard-friends/current/dist
PUBLIC_ORIGIN=http://115.29.188.62:8081
BACKENDS_CONFIG_JSON='{"backends":[{"id":"cloudflare","origin":"https://wizard-friends.qiuh23.workers.dev","enabled":true},{"id":"aliyun","origin":"http://115.29.188.62:8081","enabled":false}]}'
```

公开 origin 必须包含端口。代理用 `$http_host` 保留 Host 与端口，转发 Origin、Upgrade、Connection，100 秒读取超时覆盖心跳窗口。只开放所需公网 8081，3002 始终回环监听。首次正式发布的公网自检和 Actions 外网验证前，须按授权在安全组新增 8081；模板或回环检查不能证明外网可用。不要为验收启动未合并分支正式服务。

## GitHub 自动发布

复用运动会 GitHub OIDC → 阿里云 STS → ECS 云助手传递签名构建包的方式。巫师牌使用独立 RAM role 与 production environment，不扩大运动会角色／安装器权限。production 仅允许 main；OIDC 信任限定巫师牌仓库和此 environment；ecs:RunCommand 只允许固定实例与 wizard-deploy，另允许读调用结果。该用户仅可 sudo `/usr/local/sbin/wizard-friends-ci-install`，固定安装器只操作巫师牌。

production 非秘密变量：`ALIYUN_ROLE_ARN`、`ALIYUN_OIDC_PROVIDER_ARN`、`ALIYUN_REGION_ID`、`ALIYUN_INSTANCE_ID`、`ALIYUN_PUBLIC_ORIGIN`。可以复用现有 GitHub OIDC provider，不复用运动会 role，不存长期 AccessKey，不把 GitHub token 发往 ECS。

Verify game 保留现有语法、测试、一次前端构建、Worker dry-run 和一组三客户端 Worker 冒烟。Node 升至24验证内置 SQLite，仓库 `.node-version` 同样指定24，使原 Cloudflare 构建也使用相同主版本；若控制台另有 NODE_VERSION 覆盖，需保持24。[Workers Builds 官方版本配置](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)支持此版本文件。仅 main 检查通过后，将同一提交、同一前端结果打包为 `aliyun-<完整SHA>`；生产依赖在 Linux runner 锁定安装，不重复构建网页，不在低配 ECS 编译。原 Cloudflare 构建、Pages 手动发布都保留，不增加浏览器矩阵或完整对局 CI。

Deploy checked Wizard to Aliyun 只加载 main 控制脚本。等待发布队列后核对成功 Verify run、仓库、事件、当前 main SHA、唯一未过期产物和 GitHub SHA256。失败／过时任务保留当前版本。按游戏串行且 cancel-in-progress:false，不取消切换。主机下载前后再次核对公开 GitHub main、成功检查和产物摘要；API 不可用／限额时报错停止，不能忽略核验。只执行固定主机脚本，不以 root 运行包内脚本。

主机验证 ZIP 摘要、包内身份、Linux x64／Node24／存档 schema，拒绝路径逃逸、链接、特殊文件。更新前在线备份 SQLite 并检查完整性，版本目录 `/opt/wizard-friends/releases/<SHA>-<Verify run ID>` 不可变，current 原子切换。运行用户无权改代码。启动重读 SQLite，不清空房间或关闭墓碑。回环与公网均检查前端 SHA、后端 SHA、v2 和真实 WebSocket 升级；失败只恢复巫师牌旧代码，保留当前数据库。相同检查的失败重试可复用相同已核验只读版本。

## 首次启用顺序

1. 完成主机准备、固定安装器权限拒绝测试、独立云权限；仓库变量 `ALIYUN_AUTO_DEPLOY_ENABLED=false`。未合并 workflow 时仅记准备完成。
2. 由用户合并 PR。本任务不自动合并，也不发布功能分支。等最新 main 的 Verify game 成功并产生 Linux 包；最新 main 失败则修复，保留当前正常版本。
3. 核实端口／安全组，以 main 运行 Deploy checked Wizard to Aliyun 的 workflow_dispatch，填该成功 Verify run ID。产物保留一天，过期重跑原 Verify，不能改选旧 SHA。
4. 首次真实发布后，完成下方额外联机和重启验收，记录 SHA 与证据，同时确认运动会两个入口仍正常。
5. 真实成功后再设 `ALIYUN_AUTO_DEPLOY_ENABLED=true`，用后续一次真实 main 发布确认自动触发；外网联机验收后才开启国内按钮。创建 workflow／RAM role／sudoers 本身不代表自动更新已启用。

两个仓库日后各自主分支检查通过后各自发布。运动会沿用原 Deploy checked backends 和原预览流程，巫师牌发布不重发运动会。若 main 只有文档变更而原 paths-ignore 跳过 Verify，线上保持原版本；确需发布该精确 main 可手动运行原 Verify 后选择新包。

## 备份、回滚与存档兼容

每日及更新前通过 SQLite `.backup` 覆盖 WAL 已提交数据并执行 integrity_check。备份含完整身份、手牌和随机流，目录0700、文件0600，保留14天。同一次备份另存固定巫师牌 env、systemd unit、Nginx站点、sudoers、备份任务及 current/previous 版本指针的配置压缩包；旧代码仍保留在不可变版本目录中，不重复复制。尚无数据库也备份已有配置，bootstrap 重写主机配置前同样调用此备份。手动执行 `sudo bash /usr/local/lib/wizard-friends-deploy/backup.sh`。不要直接复制运行中数据库的单个主文件。日志／数据不进入发布包。

回滚由 wizard-deploy 调用同一固定 sudo 入口，参数是 base64 JSON `{ "action":"rollback", "commit":"当前版本完整SHA", "runId":当前版本Verify编号 }`。只允许回滚此精确当前尝试，不能选择运动会或任意路径；切回记录的前版并验收。首次没有前版则停止巫师牌，撤下自己的站点。GitHub 公网验收失败自动调用回滚，安装中失败由主机回退。操作前核查当前版本，不中途取消切换，不以定时无条件 git pull 代替发布。

代码回滚不恢复旧数据库，保留发布期间已确认动作。v1存档只允许本次兼容 RoomAuthority 完整记录；未来不兼容规则／结构需提供兼容读写迁移，或暂停新建房、等待旧局自然结束后切换，明确备份影响。不能跳过 schema 检查或清空房间。灾难恢复先停服、另存当前库与 WAL/SHM、核验备份、由操作者确认回退范围，再恢复；旧备份会丢失此后的动作。

## 验收与状态边界

- 本地语法、相关规则／生命周期测试、构建、Worker dry-run；Node三客户端一轮、聊天／观众权限，断线／刷新／进程重启后原身份、手牌、随机流、暂停／截止时间，关闭墓碑不可复活。
- 非 localhost HTTP origin 验证 UUID 初始化、建入房、操作及分享；复制失败可选择完整文本。记录地址与安全上下文，不能以 localhost 代替。
- 代理语法、含端口 Host、WS 转发、同源静态/API/WS、前后端完整 SHA；国内浏览器运行不等待 Cloudflare；Cloudflare原协议与连接路径必要回归。
- 首次真实外网两台独立设备建入房、聊天、断线／刷新及服务重启恢复，记录地址、时间、SHA；模拟设备和回环通过单独标注。
- 发布前后核验运动会80和8080入口及各自原 SHA、实时连接。不为此新建运动会整局，也不重新发布运动会。
- 两个游戏分别交付自动发布状态、实际运行 SHA、对应 main SHA、入口、实际执行结果；未合并、未开放端口、未外网联机、未验证 GitHub OIDC、未成功发布都明确留待办。
