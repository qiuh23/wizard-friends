# 安全留存、容量与恢复（未上线）

本文记录 2026-11-05 的代码方案和只读实测。整改代码未合并、未安装到生产；不能把下述模板、测试或现有服务正常等同于已具备六个月留存。填报逐项说明另见 `公安备案填报参考.txt`。运行字段和站长接口以 `security-runtime.md`、实际源码为准。

## 已核对的实际部署

11:31～11:33（北京时间），通过已有固定主机指纹和管理密钥，只读执行 `df`、`du`、`find`、SQLite 只读 PRAGMA、服务状态及配置中非秘密项；没有上传文件、改配置或重启。现有运动会正式、预览和巫师牌三个 systemd 服务均 active。同日另只读核对 systemctl show：分别使用 athlete、athlete-preview、wizard 专用用户和组，NoNewPrivileges=yes、ProtectSystem=strict、ProtectHome=yes；可写路径分别限定为各自 /var/lib 目录，巫师牌另含其 /var/log 目录。

| 对象 | 只读实测 |
| --- | --- |
| ECS 根盘（同一 `/dev/vda3`） | 总 41,882,943,488 字节，已用 13,879,681,024，可用 26,067,525,632，使用 35%；inode 使用 17% |
| 运动会正式 SQLite | `/var/lib/magical-athlete/rooms.sqlite` 978,944 字节；WAL 0；SHM 32,768；239 页×4096 字节，其中 187 个空闲页 |
| 运动会预览 SQLite | `/var/lib/magical-athlete-preview/rooms.sqlite` 77,824 字节；WAL 0；SHM 32,768 |
| 巫师牌 SQLite | `/var/lib/wizard-friends/rooms.sqlite` 241,664 字节；WAL 0；SHM 32,768；59 页×4096，其中 20 个空闲页 |
| 备份目录总量 | 运动会正式 27,435,008 字节；预览 1,478,656；巫师牌 3,490,792 |
| 日志 | `/var/log/nginx` 1,061,365 字节；journald 16 MiB |
| 已留版本目录 | `/opt/magical-athlete/releases` 4,838,153,724 字节；`/opt/wizard-friends/releases` 401,572,267 字节 |

现有 Nginx 配置是通用 `daily / rotate 14 / compress / delaycompress`，不足以证明网络日志六个月留存；通用 access/error 格式也不满足本次避免完整 URL/凭据进入新增日志的设计。历史缺失的记录不能事后补造。主机上尚无本 PR 的独立 `security.sqlite` 和相关 cron。

公网版本探测只读、不建房：运动会旧 HTTP IP 入口和 Cloudflare 的 `/deployment.json` 都为 `1771b54dec43b94aeded429ab7155a57fea329ab`（run 41961623322）；巫师牌旧 HTTP8081 与 Cloudflare 的 `/build-info.json` 都为 `12b53979fb6d4272b6a527a8bd300c31c946bf2a`。同日另以正常证书校验只读核对根域 HTTPS 返回 200，运动会 HTTPS 的 deployment.json 为同一 1771b54 完整提交、巫师牌 HTTPS build-info.json 为同一 12b5397 完整提交，两 HTTPS health 均 200；返回仍无新增安全功能标记。版本信息只能证明当时返回的版本，不能证明整改生效。

实际 Node 均仅监听回环：运动会 3000、预览 3001，已有 `TRUST_PROXY=1`；巫师牌 3002，当时没有 `TRUST_PROXY`。运动会代理覆盖 `X-Real-IP`，巫师牌旧代理只有追加 X-Forwarded-For。本 PR 的巫师牌站点生成器补充覆盖 X-Real-IP，启用信任仍须配置并验证。不要信任任意公网请求自带的 IP 头。

## 存储与期限

游戏房间 SQLite 和安全 SQLite 分离。运动会使用 `DATA_DIR/security.sqlite`；巫师牌默认房间库同目录的 `security.sqlite`（可通过 `SECURITY_DATABASE_PATH` 配置，但本机固定运维脚本使用上述默认路径，改路径必须同步修改并复核 root 管理的脚本）。房间关闭、过期或游戏库回滚不删除独立安全库。

安全事件字段是明确白名单，禁止记录密码、Bearer/恢复令牌、Cookie、手牌或完整游戏状态。网络/安全事件至少六个日历月；运动会计算 UTC 日历月并钳制月底，巫师牌用 200 天（长于六个月）。处置理由、指定内容证据按本次用途设 90 天；安全隐藏/限制标记保留到各实现的房间安全周期，避免旧房间复活。保全记录不按到期任务清理，须通过独立站长权限明确解除并记原因。具体字段/适用性由填报参考区分，不能据此声称所有聊天都应保存六个月。

新增 Nginx `game_network` 只记录时间、代理实际看到的源/目标 IP 和端口、固定 server_name、请求方法、状态、响应字节、耗时和连接编号。它不记录 URI、查询串、Authorization、Cookie、User-Agent 或聊天。经代理时端口可能只是代理连接端口，不能承诺能拿到端用户 NAT 前端口；Cloudflare 应用不能取得同样的全部传输字段。没有采集硬件指纹，是否需要补充由属地确认。

`game-network.logrotate` 按每日或 10 MiB 阈值轮转并压缩；共享 cron 每 15 分钟调用一次检查（阈值不是实时硬上限），`rotate -1` 不因数量/大小删旧记录；`security-ops.py cleanup-network` 每次最多删除 20 个关闭且压缩、mtime 已满六个日历月的指定命名日志。活动 `.log` 不删除。mtime 选取关闭/压缩后的时间会延长保存，不能缩短期限。目录 `HOLD` 保全全部归档，单个 `.gz.hold` 保全对应文件。已有通用 `/var/log/nginx/*.log` 不应充当新的留存目录，避免原 14 份规则提前删除。

## 容量、告警与增长

root 运维预警阈值默认取“2 GiB 可用空间”和“盘总量的 10%”中的较大值，inode 低于 5% 也拒绝新版本。配置位于各游戏 `/etc/<服务名>/security-ops.json`，只允许 `minFreeBytes`、`warnFreePercent` 两项非秘密值。应用另有 `SECURITY_MIN_FREE_BYTES`、`SECURITY_MAX_BYTES`，需结合实测设置；这些是两层保护，不能只改其中一处。默认单库上限是保护性暂停阈值，不能当作六个月容量已经够用。

`security-preflight.sh` 在新 release 解包/切换前检查可用空间、审计库 quick_check 和现有应用 `/api/security/health`。首次迁移可在审计库不存在时仅通过空间检查，新应用必须完成初始化/健康检查后才可成功发布；已有增量游标而库丢失则拒绝发布，先恢复。必要应用审计写入失败由运行时代码告警并拒绝依赖它的新建房/发言/改名等操作。运维脚本失败输出错误、非零退出，并用 `logger -p daemon.err -t game-security` 留告警；15 分钟检查，小时级增量备份/清理。**这是本地日志告警，尚未接入已验证的远程通知渠道，值守人和通知方式待本人配置。** 不因低空间删未到期或保全记录。

2026-11-05 本地 Node 24.22.1，5000 条合成网络事件（房间号、UUID、IP、操作结果，不含内容），checkpoint 后实测：运动会 28,672→1,413,120 字节，约 276.89 字节/条；巫师牌 24,576→1,318,912，约 258.87 字节/条。仅是该样本的主库与索引，不含 WAL、归档、临时恢复空间。规划至少按 1 KiB/条另留余量：合计 1 万条/天×200 天≈1.91 GiB 的一份主记录；再加增量归档、Nginx 日志、保全、游戏备份、历史 release 和临时解包。不能把两游戏每种操作、每个 HTTP 请求漏掉后再声称 40 GB 足够。上线后测至少一周的真实日增量和峰值，再调阈值；达上限先暂停依赖记录的发布，安排归档/扩容，不能提前删除。

SQLite DELETE 会释放页供之后写入复用，通常不缩小主文件；WAL checkpoint 处理 WAL，不等于删除主库。例行任务不每天 VACUUM；VACUUM/切换文件需要额外临时空间和停机/一致性安排。低空间时禁止尝试靠完整复制/压缩主库救急。

## 备份与恢复

原 `backup.sh` 仍使用 SQLite 在线 `.backup` 保存短期游戏房间库，14 天轮换；不加入 `security.sqlite`。巫师牌原配置备份可能包含秘密，只留 root 可读目录、不能提交或公开上传。

安全备份按单调 ID 增量写入 `/var/backups/<服务名>/security-incremental/events-<first>-<last>.json.gz`，按长/短期用途和到期 UTC 日分片（每片最多 5000 条，封片可使归档内单条保存延长不到一日），SHA256 校验；短期处置内容不会因混入网络分片被延长到六个月；`cursor.json` 记录高水位。`state-latest.json.gz` 保存小型最新隐藏/限制状态、当前保全 ID，以及运动会指定证据，替换这份小快照，不每天复制整个长期审计库。快照附事件分片清单、长度与哈希；常规增量任务核对已有分片存在、长度及校验侧文件，只读取新片，不每小时重读整个长期归档。恢复逐片完整计算 SHA256，拒绝坏校验；恢复和后续备份都拒绝缺片或游标/快照不一致，不能用 SQLite integrity_check 冒充完整日志齐全。保全后应立刻再备份，备份恢复点只覆盖最近一次成功完整快照。

安全备份清理每次最多 20 片，仅当片内所有记录到期且当前数据库无保全时删除；旧备份显示保全、当前库不能证明已解除时继续保存。先更新清单再删除，崩溃残留的多余片只有经证明全部到期、未保全才可在恢复时忽略。整个安全备份目录的 `HOLD` 禁止片清理。证据最新快照替换时随源库清理；恢复也过滤未保全且过期的证据/事件。备份不是永久额外留一套过期聊天。

本地同盘备份不能应对整盘损坏、账号丢失或整机销毁。尚未设置异机加密副本、值守或实际灾备恢复；须本人选择现有安全目的地，不自动购买或上传。复制时要复制完整成功快照、游标、清单内所有分片及校验文件，保留权限。不要在复制中途混用两个时刻的 `state-latest` 与校验；若失败，工具会拒绝恢复，应重做一次完整备份/复制，不跳过校验。

恢复（下面以运动会正式为例；巫师牌改为对应路径/服务）：

1. 在维护窗口阻止新发布/连接，保留故障库、WAL、SHM 和原备份；暂停该服务及相关维护任务。不得删除还需保全的故障副本。
2. `python3 /usr/local/lib/magical-athlete-deploy/security-ops.py restore --archive-dir /var/backups/magical-athlete/security-incremental --restore-to /var/lib/magical-athlete/security-recovered.sqlite`。目标必须不存在，工具不覆盖活动库；验证全部必要分片、当前保全 ID、最新处置状态、索引和 SQLite 完整性。巫师牌的派生 `security_usage` 会重算并安装触发器，不导入旧计数器。
3. 离线核对恢复点、处置内容和安全事件数量，确认所需尾部记录是否尚在原库/故障 WAL；缺失时明确记录恢复缺口，不能声称零丢失。设置正确服务用户和 `0600`，受控原子切换安全库，隔离旧 WAL/SHM，保留旧库用于调查。
4. 先启动已包含整改的版本，检查审计健康、处置内容不复现、受限成员不能发布、独立管理员鉴权、断线重连；完成新的增量备份后再开放。恢复后若 ID/归档目录不匹配，工具拒绝继续；保留旧归档并使用新的独立目录，不删旧记录重置游标。

回滚代码不能回滚/删除安全库、保全标记或处置状态。**已有安全记录或处置后禁止直接退回不识别安全标记的旧版本，否则可能重新显示旧内容；应保留整改层向前修复，必要时维护暂停。** 安装器仅在新版本审计健康且首轮备份完成后写 root 管理的 .security-aware 标记；自动/手动回滚遇到未标记的旧版本，会检查独立库，已有审计或处置时拒绝回退。自动失败回退不安全时会停止应用等待向前修复。首次安装在安全库仍无记录时才可恢复旧指针。修改 root 安装器后需重新安装受审查的 root 工具；PR 中代码更新本身不会自动更改它们。

## 上线配置和未验证

1. 合并/上线另由本人确认。先审查 `install-security.sh` 和容量配置，安装 root 管理工具、共享 Nginx 格式、独立轮转规则、cron。两仓库的共享格式/轮转文件相同，仅安装一份；已有文件不同会停止，须人工复核。
2. 配置运行时独立管理员秘密、真实公开联系方式、容量值；秘密放现有受保护环境文件/Cloudflare Secret，不进 Git。巫师牌需补 `TRUST_PROXY=1` 并配套覆盖 X-Real-IP。保持 Node 回环及原精确 Origin 白名单。
3. 原活动 vhost 不会被 `install-security.sh` 自动重写。逐个复核运动会正式/HTTPS/旧入口/预览及大厅、巫师牌 HTTPS/旧8081，在每个相关 server 使用对应 `/var/log/game-network/*.log game_network`；对相关 vhost 用 `error_log /dev/null emerg` 避免默认错误行带完整 URL。用应用的脱敏错误告警和 Nginx 配置/服务检查排错。按生成器重新生成时保持原监听器和路由，`nginx -t` 后再受控 reload。通用旧日志仅保留到适用期限/保全要求，不直接暴露。
4. 新 Node 发布成功必须审计健康；先做增量备份/恢复演练，再验证 cron 和 `logrotate --debug`、实际轮转压缩、六个月边界/保全。这里仅验证本地函数和 Bash 语法，未在 ECS 上安装/运行新增任务，未实际模拟生产满盘或重启。
5. 本地 `python -m unittest discover -s tests -p security_ops_test.py -v` 共 10 项通过：增量、后加保全、解除保全、证据/处置恢复、到期不复活、缺片/坏校验/不完整快照拒绝、零事件恢复及巫师牌派生用量、低空间不删除、日历月/日志 HOLD、短期内容与网络归档分离、旧代码回滚保护、不覆盖活动库。Git Bash `bash -n` 通过。Linux Nginx 新模板解析、实际 logrotate/cron/systemd、告警送达、异机备份、真实掉电/磁盘写满仍未验证。应用测试证据在填报参考及 PR。

## Cloudflare 独立核对

同日使用现有部署令牌只读 API：两个正式 Worker 的 usage_model 为 `standard`，observability 未启用、logpush=false；运动会 RoomRelay、巫师牌 RoomRelay/RoomDirectory 均为 SQLite Durable Objects。账户订阅接口返回 403，无法据此确认实际计费套餐、账单或存储用量。没有修改权限或部署，也不能将 usage_model=standard 当作已核实付费账单。

新的安全 DO 与房间 DO 分离，房间关闭不能删除它；部署迁移和 Secret 仍待配置。应用范围的网络/安全事件由新 DO 保存，静态资源及 Cloudflare 平台底层全部访问日志覆盖不等同 ECS Nginx，适用范围待确认。新增告警要在平台侧设置/验收；源码 console 错误不代表已连接运维通知。Cloudflare 的配额、计费和故障保护独立于 ECS 的 40 GB。

2026-11-05 查阅 [官方定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)：SQLite Free 总存储 5 GB、每日读 500 万行/写 10 万行；Paid 含 5 GB-month、额外 $0.20/GB-month，读行含 250 亿/月后 $0.001/百万，写行含 5000 万/月后 $1/百万。删除、设置 alarm 也计写行，KV API 底层仍使用 SQLite。请求/时长另按官方计划核算，未在这里估算实际账单。单个 DO 的 [容量限制](https://developers.cloudflare.com/durable-objects/platform/limits/) 是 10 GB；应用应在更早的可调阈值暂停依赖记录的发布。

[SQLite DO PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) 只覆盖过去 30 天且本地不支持，不是六个月日志留存替代品，也不是已完成异地导出备份。安全库需自身保存满足期限，超配额/必要写失败拒绝新的发布。账户实际用量、费用预警、生产 alarm 持久化清理、迁移失败/恢复、跨 DO 故障和必要独立导出流程仍需上线前核对，不能用本地测试或 ECS 备份声称 Cloudflare 已验收。
