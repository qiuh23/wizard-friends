# 巫师牌最小安全整改：运行实现与验证

检查基线：`12b53979fb6d4272b6a527a8bd300c31c946bf2a`（2026-11-05 main）。这里只说明本 PR 代码与本地验证，**未部署生产**。逐项填报、生产实测、容量与迁移/回滚说明见本目录的《公安备案填报参考.txt》和运维说明。

## 复用与实际补缺

继续使用 `worker/room-authority.js` 的服务器权威、原房主令牌摘要校验、房主控制、角色校验、`src/player-names.js` 昵称校验和原数据库。没有新建账号系统、实名接入、词库或 AI 审核。`src/game.js` 当前聊天上限 300 字符、每成员每 5 秒最多 5 条，最近 100 条；现有房间 WebSocket 每秒 40 帧、每房间 64 个连接、10 秒认证超时保持。

发现并修复的缺口：没有独立留存的安全审计、没有独立站长权限和持久处置、没有举报联系方式；任意未认证房间码可能形成空上下文/空 SQLite 行。新增 `ConnectionGuard` 使用有界的 4096 个来源窗口，每来源每分钟允许 120 次房间/在线目录连接尝试；Node 在分配房间前检查，未持久化的无连接上下文可移除，新的待认证房间上下文最多 128 个，空房间认证失败不再落盘。窗口在 Node 重启或 Cloudflare 对象实例重建后重置，不是跨区域防 DDoS 保证；现有已认证连接与探测保留。

## 独立审计与字段

`worker/security.js` 共享字段白名单与操作接口；`server/security-store.js` 使用 Node24 自带 SQLite，默认在房间 SQLite 同目录的 `security.sqlite`，可设置 `SECURITY_DATABASE_PATH`。它与房间数据库分开，房间关闭不删除审计。

Cloudflare 绑定独立 `SECURITY` / `SecurityLedger` SQLite Durable Object，固定对象名 `security-v1`，`wrangler.jsonc` 追加迁移 `v2-security`，与 `ROOMS` 不同对象。不是 ECS 磁盘，也不是游戏房间内的短期日志。缺少绑定时真实请求拒绝新发布；仅直接控制器测试使用显式 `SECURITY_TEST_NO_AUDIT:true`。

审计只记录事件编号、时间、到期时间、事件种类，以及适用的房间码、游戏成员 ID、随机连接 ID、来源 IP、路由类别、操作种类和结果。网络连接 ID 与身份确认/聊天/改名元数据关联；观战身份只记 `spectator`，不记录其令牌摘要。站长处置另记操作、原因、目标成员/消息号和该项必要的文字证据。固定站长角色记为 `stationmaster`，此版本不区分多名管理员。

不记录 URL 查询串、Authorization、密码、令牌、Cookie、完整手牌或无关游戏状态。Node 仅在 `TRUST_PROXY=1` 且直接连接来自回环地址时信任单值 `X-Real-IP`；否则记直连地址，不把代理回环地址猜成真实玩家 IP。Cloudflare 使用其提供的 `CF-Connecting-IP`。源端口、硬件指纹、实名未采集；是否还需补充须向受理单位确认。

- 网络、鉴权拒绝、限流和发布操作元数据：200 天（保守覆盖不少于六个月）。
- 人工查看/处置及必要证据：默认 90 天；保全原因记录随原记录一同保全，至少 90 天且持续至明确解除；解除后适用原到期时间（若已过期可清理），另新增的解除操作原因保存 90 天。保全原因记录通过其 `seq` 指向的原记录控制，不单独嵌套保全/解除。这是运行用途期限，不能据此声称所有聊天法定六个月。
- 普通聊天：房间最近 100 条，最长 7 天，在正常发布/闹钟中清理；关闭后清除聊天、公开聊天事件和操作回执等短期副本。活动房间常规闹钟最多约 30 秒，故清理有调度延迟。
- 独立处置状态（隐藏消息/公开事件编号、替代昵称、受限成员、关闭标记）：默认 200 天。对应房间已写入的清理、关闭 tombstone 仍保留。到期按 100 行批量清理；关联保全事件或自身 held 标记阻止删除。
- `held=1` 保全事件不自动删除。设定/解除保全需要站长权限、目标 ID、布尔 held、理由；变更与审计在同一事务。保全目的结束后由站长按适用要求解除，不自动推定案件结束。

Node 每分钟最多清理 500 条已到期且未保全事件；Cloudflare 每小时批次 500 条，积压时约一分钟继续，持续写入不推迟已有清理闹钟。SQLite 删除后空间先供后续写入复用，文件通常不会立即变小，不在请求中执行 VACUUM。

默认 `SECURITY_MAX_BYTES=268435456`（256MiB），Node `SECURITY_MIN_FREE_BYTES=268435456`，可调整。Node 用活跃 SQLite 页和文件系统可用空间判断；Cloudflare 用 SQL trigger 维护的活跃记录字节估算，避免每次写入全表扫描。80% 发出容量警告。`/api/security/health` 还对固定用量行执行一次值不变的 UPDATE，验证当前可写而不增加事件或改变计数。遇到容量/写入问题输出明确错误并返回 503；依赖审计的新增连接、身份确认、聊天、改名及站长发布处置失败，不删除未到期/保全数据腾空间。告警的接收与线上监控仍需站长配置；不得将本地失败注入当作生产告警链路验收。

表：`security_events(id,at,expires_at,event,held)`；`security_moderation(room,state,expires_at,held)`；`security_usage(id,bytes)` 为触发器维护的容量计数。备份恢复先建表/触发器、恢复事件和完整处置状态，计数由触发器重建；不要覆盖仍需保全的较新处置。

## 举报与站长工具

首页与房间菜单提供“隐私 / 举报”。公开联系方式经本次用户确认：`qiutian0808@163.com`。`REPORT_CONTACT` 可设置其他经确认邮箱或空字符串（显示待配置），`/api/security/contact` 供前端读取。点击只打开邮件编辑器，不自动发送。聊天显示 `#消息编号`；举报者提供线路、房间码、消息号、时间、原因即可，不应附恢复凭据或证件。

站长使用 `scripts/stationmaster.mjs`，从受保护环境读取独立 `SECURITY_ADMIN_TOKEN`（至少 32 字符，运营者应安全随机生成），不使用玩家令牌或房主权限。只接受 HTTPS 目标或回环 SSH 隧道，不把密钥放入 argv、URL、页面或仓库。Node 环境与 Worker Secret 分别配置；不在这里提供任何真实密钥。

操作 JSON 从 stdin 提供，例如：

```json
{"action":"inspect"}
{"action":"hide-chat","seq":1,"reason":"核实举报后隐藏此消息"}
{"action":"hide-name","memberId":"从 inspect 取得的成员 ID","reason":"昵称不当"}
{"action":"restrict-member","memberId":"从 inspect 取得的成员 ID","reason":"持续滥用"}
{"action":"close-room","reason":"停止房间继续扩散"}
```

用法：`node scripts/stationmaster.mjs https://wizard.magical-athlete-online.cn ABCDEFGH`（stdin 为一个 JSON 对象）。`inspect` 只给当前公开昵称、成员 ID、聊天和处置状态，不给手牌、房间恢复令牌或完整权威快照。日志接口用 room 参数 `security` 与 `{"action":"list","after":0}` 分页，每次最多 100 条。保全用 `{"action":"hold","id":1,"held":true,"reason":"具体保全依据"}`；解除设 `held:false`。

决策和证据先写独立安全库，再清理房间公开内容/回执并广播完整状态。在线聊天 DOM、已有消息气泡及昵称同时同步，历史改名链也被清理；旧版没有可靠作者标记的公开记事在改名处置时保守清除，重连/重启再应用独立处置状态；原消息对应公开事件也清理。限制目标成员会关闭其现有连接，重连仍拒绝；这是限制该游戏身份，不保证阻止换浏览器/换身份再次进入。关闭房间写原有 tombstone，旧链接不能复活。备份恢复时必须同时恢复处置状态，不能单独回滚房间旧库绕过隐藏。

## 本地验证（2026-11-05，Windows，Node24.22.1）

`npm test`：332/332；`npm run check`、`npm run build`、`npm run worker:check`（Wrangler 纯 dry-run）通过。构建原有大于 500kB 分包提醒仍存在。`tests/security-remediation.test.js` 的 11 项测试包括真实 Node WebSocket、SQLite 重启/重连、独立权限、聊天/改名隐藏、限制成员、关闭、到期分批清理、保全、磁盘余量失败、容量耗尽后页复用、无秘密字段、有界连接窗口和空房间回收、普通聊天 7 天清理；还使用实际 Miniflare SQLite Durable Object 和 WebSocket 验证 Cloudflare 审计、处置、闹钟清理，不只模拟存储 API。已有 `tests/node-server.test.js` 还覆盖真实子进程被杀后的恢复和失败提交不确认成功。

Chrome headless 本地 Node 界面检查：390×844、1440×900，隐私/举报按钮可用，确认邮箱及期限说明显示正确，弹窗在屏幕内、可关闭，页面错误 0。未把这些检查称为真机验收。

未验证：生产部署/Secret/代理配置/告警接收、跨实例灾难恢复、真实 Cloudflare 账单与备份导出、实体手机、多地网络、线上磁盘耗尽。完整运维恢复演练和生产只读容量数据以运维文档为准。本次不合并、不发布、不关闭现有线上入口。
