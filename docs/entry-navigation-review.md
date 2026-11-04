# 2026-11-05 入口核验与邀请修复

本次从 `main` `aa18110e2e3240c8ab0d8f2e537dab5b6a865745` 建立独立工作区；原工作区未提交改动为空，原分支保留。只提交代码和文档，不执行生产发布、DNS、证书、安全组、云权限或正式房间写入。

## 公网实际状态

以下为 2026-11-05 00:10（北京时间）附近的只读快照；之后的自动发布可能改变它，不能把本地构建或 PR 合并当作两端均已上线。

| 项目 | 实际证据 |
| --- | --- |
| 巫师牌 Cloudflare | `/build-info.json` 为 `aa18110e2e3240c8ab0d8f2e537dab5b6a865745`，health 为协议 v2；Workers Builds check `126687260085` 成功，对应 Worker version `0e773bce-0d3a-4e80-91be-4ffab28ed5cf` |
| 巫师牌阿里云旧 HTTP8081 | build-info 与 health 为 `496603d65f460c8ff1cc4049861cc6fd63a2b26e`，仍比 main 旧；[Verify game 41862175852](https://github.com/qiuh23/wizard-friends/actions/runs/41862175852) 当时 queued，尚不能宣布本次阿里云发布完成 |
| Cloudflare 大厅 | `https://magical-athlete.qiuh23.workers.dev/lobby/` 的 HTML、app、routing、CSS、config、favicon 均 200 且 MIME 正确；六文件 SHA256 与运动会 main `485f54fa62867d5b7193ad01027bbf886f0e5936` 对应源码一致 |
| 国内 HTTPS 大厅与两游戏子域 | `magical-athlete-online.cn`、`athlete.magical-athlete-online.cn`、`wizard.magical-athlete-online.cn` 均未完成可信公网 HTTPS 验收；本机探测 TLS 握手失败。保持“暂未开放”，不启用或猜测可用入口 |
| 国内旧 80 端口的 `/lobby/` | 返回运动会 SPA fallback，不能当作国内独立大厅已部署 |

巫师牌两个现有公网游戏的首页、入口脚本、CSS、动态脚本、各 54 个牌图及 favicon 逐项只读读取：状态和 MIME 正确，无游戏房间创建。Cloudflare runtime 仍使用 `backendId:cloudflare`、`relayOrigin:null`，国内项为旧 HTTP8081；阿里云 runtime 使用 `backendId:aliyun`、`relayOrigin:""`。本次不修改生产 runtime、旧 HTTP 地址或现有身份存储策略。

大厅与 HTTPS 站点的拥有仓库、构建、部署模板和上线步骤仍以 [HTTPS 过渡说明](https-domain-transition.md) 及运动会仓库的统一大厅手册为准。本次登录用户提供的阿里云控制台，只读确认域名为“管局审核通过”，网站号 **京ICP备2026075006号-1**；DNS 当前只有启用的 `@ A → 115.29.188.62`（TTL 10 分钟），未配置 `athlete`、`wizard` 两子域。证书 V2 正式与个人测试两列表无记录，但未据此断言主机本地或其他证书列表不存在证书。备案通过与公网 HTTPS 验收分别记录。

00:21（北京时间）跟进现有自然 main 流程：[Verify 41862175852](https://github.com/qiuh23/wizard-friends/actions/runs/41862175852) 已成功，新 [Aliyun release 41865713450](https://github.com/qiuh23/wizard-friends/actions/runs/41865713450) 仍排队；旧 HTTP8081 公开 SHA 当时仍为 `496603d`。本次没有手动触发 CI。交付时如已有后续结果，以 PR 中注明时间的复核为准。

## 本次修复

游戏直达邀请现在统一解析 `room`、`server`、`game` 和 `watch`：显式服务器对旧无前缀房间码生效，`A-`/`C-` 冲突、重复参数、错误游戏、无效观战位或房间码明确停止。外服目标未开放时展示原因，不连接当前服查找同码房间。跨入口导航只从受信 runtime 表重建 room/watch，丢弃其他 query 和 hash；页面同时设置 `no-referrer`，避免邀请原始参数进入导航 Referer。

保留旧无前缀码的当前服语义及原“已有进行中房间先恢复原权威端”的过渡方案。恢复原房间不自动迁移身份；用户可以明确离开原局后使用新邀请。配置读取增加超时并拒绝重定向；失败或邀请无效时可明确返回当前服务器，不静默改服。

## 本地实测

Node 24.22.2 下 `npm test` **320/320**、`npm run check`、`npm run build`、`npm run worker:check` 及 `git diff --check` 通过。既有 Three.js 分包体积提示仍在，没有新增依赖或远端 CI。

`node scripts/entry-smoke.mjs` 自动启动两个临时本地 Node/SQLite 服务，使用 Edge headless 二维界面：双向整页切换、邀请显式服务器/观战/敏感参数清理、观众刷新、原房主身份刷新、进行中房间恢复、冲突/重复/错误游戏/未开放状态均通过；320×780、390×844 和 844×390 无横向溢出。请求与 WebSocket 只来自两个本地 origin，页面错误为空。截图保存在忽略提交的 `.local/wizard-entry/`；Cloudflare runtime 在此专项中为测试替身，不能据此声称公网 Worker 验收。

另外运行真实本地 Wrangler/DO 上的既有 `scripts/authority-smoke.mjs`：三客户端完整一轮及下一轮首墩、秘密预测和手牌隐私、只读观众、暂停聊天、关页后返回、房主刷新、同步得分、收墩和解散墓碑通过，13 条 WebSocket 均为本地 Worker，`errors=[]`。实体手机、真实运营商、公网 TLS/WSS、国内独立大厅和线上回滚尚未验收。

## 上线顺序与回滚

1. 审查两仓库 PR；维持国内 HTTPS 未开放。审查分支使用 `[skip ci]` 和既有 `codex/review-only/` Cloudflare build guard，避免功能分支发布共享预览；合并时按既有手册移除跳过标记，由既有 main 发布链路运行。
2. 分别观察巫师牌 Verify、阿里云 release、Cloudflare Builds，不手动追加 CI；核对两端公网完整 SHA、runtime、静态资源和无房间 WebSocket 探针。任一端较旧都单独记录，不能用另一端成功代替。
3. 国内 DNS、证书、站点和正式入口切换须另获用户授权。两个游戏子域和国内独立大厅全部通过 HTTPS、API/WSS、邀请/观众/刷新/旧身份过渡验证后，才持久更新源 runtime/production 公开变量，最后启用大厅国内入口。
4. 回滚先禁用故障国内入口，再按各自精确 commit/runId 回退对应应用和受信配置；保持当前 SQLite、旧 HTTP8081、Cloudflare 及运动会服务。Nginx/env/DNS/证书的回滚与代码回滚分别审查和授权，不把旧数据库覆盖作为普通发布回滚。详情见 [原 HTTPS 回滚步骤](https-domain-transition.md#回滚)。
