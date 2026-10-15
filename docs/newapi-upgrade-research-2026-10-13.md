# New API 上游升级评估（只读侧车）

核查日期：2026-10-13，Asia/Shanghai。关键 REST 元数据复核时点：11:20（03:20 UTC）。
范围：官方 GitHub release、公开安全公告、固定 tag 的 docs/source，以及本地只读 git 基线。没有升级、部署、fetch/pull、push、修改凭据、读取 .env/secrets 或运行付费/变更型探针；仅新增本文件。未递归委派。

## 结论与版本

**建议：将 v1.0.0-rc.44 列为后续隔离验证候选，不批准直接替换生产，不保证无缝升级。** 当前最重要的阻断项是生产精确上游 commit 不可确认；其次是管理 token 寿命/scope、定制 MiniMax-H3 插件、实际计费和数据库迁移。生产判断与定制兼容性最终由父线程负责。

| 分类 | 版本 | 官方 published_at（UTC） | Asia/Shanghai | 解释 |
| --- | --- | --- | --- | --- |
| GitHub latest / 最新已发布 v1 RC | v1.0.0-rc.44 | 2026-10-12T13:42:01Z | 2026-10-12 21:42:01 | REST prerelease=false、draft=false；tag commit 为 633b4c5b190dc1af99a2814391354d86948e7943 |
| 上一 release | v1.0.0-rc.43 | 2026-10-10T06:11:03Z | 2026-10-10 14:11:03 | REST prerelease=false；不能写成 10/13 的 GitHub prerelease |
| 再上一 release | v1.0.0-rc.42 | 2026-10-08T10:10:46Z | 2026-10-08 18:10:46 | REST prerelease=false；不是 latest |
| 最新无预发布后缀正式版 | v0.13.2 | 2026-04-27T14:11:42Z | 2026-04-27 22:11:42 | 不能与 latest 等同；不是把现有定制 v1 回退至旧正式版的建议 |
| 历史 staging 差异基线 | v1.0.0-rc.30 / 27ff6a8767e728f879d52770c273d4f73214a430 | 2026-08-31T03:55:59Z | 2026-08-31 11:55:59 | 来自旧 pin；不是当前生产 |

**事实：GitHub 的非 prerelease 标记不等于语义上的正式稳定版。** rc.44 release 明说 v1 正式版即将发布，当前仍是最后几个 RC。已复核最近 release 的 REST 字段；父线程此前看到的缓存页面标记/日期与实时 API 冲突时，以官方实时 API 为准。[S1–S4]

### 生产与本地基线边界

- **父线程提供、非本侧车独立验证的生产事实**：Railway production/newapi-private 于 2026-09-27 的部署 9a144e03… 为 SUCCESS，部署 imageDigest 为 8bceef9…；保存的 service.source.image 仍指向 rc.30@94e85…，两者不符。线上 /api/status 返回 HTTP 200、success=true，但 version 为空；构建日志为自行 Dockerfile 构建、go ldflags 读取 VERSION。**不能确认生产精确上游 commit，也不能以 source.image、旧 staging pin 或本地 checkout 代替生产版本。**
- **本地只读 git 事实**：newapi-latest-verify HEAD 是 696a10462341b650553ba43a6564f128e5c9aed1（2026-09-21 16:24:45 +08:00），其父提交 321db1b… 和 HEAD 含 EcoPhase 定制内容；不是纯上游发布 tag。只用于定位定制兼容风险。
- 因此下文是“历史 rc.30 到 rc.44 的上游变化/当前契约”，**不是已证实的生产缺失修复清单**。

## 必须关注的风险（事实与推断分开）

### 1. 管理鉴权与 shadow identity：高风险，但不是所有调用必然失效

**官方事实**：rc.41 已把单个 dashboard Access Token 改为最多 20 个具名 scoped PAT，默认 30 天有效期。rc.44 文档进一步明确：新 PAT 可以选择永不过期；旧 users.access_token 自新版首次启动起有部署级 30 天过渡，期限写入 options.LegacyAccessTokenRetireAt，届时返回 ACCESS_TOKEN_LEGACY_RETIRED。新 PAT 过期返回 ACCESS_TOKEN_EXPIRED；scope 不足或路由未声明返回 403。这是**面板/管理 token**，不是推理 API key 一律 30 天到期。PAT 本身不能创建/轮换 PAT，相关管理接口只接受浏览器登录会话。[S5、S6]

**父线程提供的 Relay 契约**：ProvisionShadowIdentity 用静态 NEWAPI_ADMIN_TOKEN 调用 /api/user/ 创建、search、更新 quota；用户 login 读 data.access_token，再以 JWT 和 New-Api-User 创建/列举 /api/token/，并 POST /api/token/{id}/key。

**官方当前契约**：登录仍返回 data.access_token（短期 JWT）；New-Api-User 不参与鉴权。普通用户创建不要求额外 Proof；add_quota 不要求 Proof。创建管理员、更新其他用户密码/admin_permissions、删除/升降权等高风险操作才要求单次、绑定目标和动作的 X-Security-Proof。API key 创建、列表与 POST /api/token/:id/key 路由仍存在。[S6、S7]

**推断/建议**：需由父线程确认管理 token 属于旧 PAT 还是新 scoped PAT、到期策略与轮换所有者，以及 user:read/user:write 等所需权限；不能因为旧本地 ValidateAccessToken 只查 DB 就推断目标版本永不过期。以“首次升级启动”为过渡期起点，不能拿 9/27 部署日期直接算退役日期。shadow 是 Relay 的账号/API key 管理抽象，不应与 PAT、15 分钟 JWT 或 artifact capability 混称一个 token。普通用户 provisioning 有兼容可能，但不能保证全部管理路径无缝。

### 2. 计费、Responses/media/video：高风险，成功/失败规则不能一刀切

**官方事实**：rc.31 修正 MiniMax-H3 输入图片/视频用量，已有 ModelBillingExpr 不自动加入 input_images/input_video_seconds；任务 polling 的 404/410 会立即失败退款，连续失败上限默认 20。rc.37/38 改进图片数量预扣与结算，截断 Responses stream 不再直接按零用量退款；显式上游失败与截断不是同一情况。rc.39 增加钱包预扣绕过阈值、输入预扣倍数。rc.42 重做搜索计费、修正 Gemini 流用量重复累计，已完成的图片生成即便随后 Responses 失败/取消仍计费。rc.43 修正 multipart boundary、MiniMax v1 下载 410、Grok 视频输出分辨率计费，以及部分模型 -1 自动时长的最大时长预扣/实际时长结算。rc.44 又修正任务结算日志分层计费标记和日志预览保留已记录价格档位。[S8–S12、S3]

**推断/建议**：必须分别验算“未完成失败”“客户端中断”“已完成图片后续 Responses 取消”“视频最大预扣/实际结算”“MiniMax 输入媒体费用”。CheapBuddy 的视频成功结算策略不能未经核对就推广为所有 Responses/media 失败均零费用。实际收费差异需离线 fixture/账单样本核对；本侧车没有付费验证。rc.26 及更早需重配全部视频价格的历史警告，不能直接套用到已知 rc.30 基线，更不能据此推定未知生产状态。

### 3. JS Task Plugin API 与协议转换：高风险定制兼容面

**官方事实**：rc.41 将 JS runtime 改为 moejs，release 声称 plugin API 不变；rc.42 新增可选 json-order@1；rc.43 新增 utils.fetch，限定渠道 Base URL/插件声明域名、GET/HEAD，不跟随重定向，且仅部分渠道已选定的 driver hooks 可用。apiVersion 1 当前文档还包含 additive 字段 retainResult，旧 host 会拒绝未知字段；同步 openai_image immediate 结果可不保留可重查任务，而 openai_responses/openai_video 保留结果。rc.44 修正 Gemini 完整 JSON Schema 转换、Responses→Chat 的 image_url 对象形式、Claude beta/block_binding 透传，以及 Responses WebSocket 的正常 close frame。[S5、S10、S11、S13、S3]

**推断/建议**：API 版本号没变不意味着定制 JS 执行语义、序列化顺序、SSE hook、文件引用与定价都已验证。EcoPhase/MiniMax-H3 必须用原插件和原输入 fixtures 回归 submit/query/stream/retrieve/artifact；确认客户端是否错误假定所有 image 返回都可以之后查询任务。新 fetch 带来额外网络访问面；仅允许必要域名，不把性能改进当作安全或兼容保证。

### 4. Artifact authorization 与安全补丁：要保持边界，不能声称 rc.44 已无漏洞

**源码事实（当前契约，不宣称均为本次新增）**：artifact access 为使用 common.CryptoSecret 的 HMAC-SHA256 capability，绑定 taskID+artifactKey；middleware 支持正常 relay Bearer 或特定 artifact access，进行 query 脱敏、无效访问限制和 private,no-store。签名消息不含到期时间，不能把它描述为自动短期过期 URL。它不是 NEWAPI_ADMIN_TOKEN 或用户推理 key。[S14]

**推断/建议**：验证跨用户、跨 task/artifact、篡改 capability、key 撤销后访问，以及代理/日志/CDN 是否外泄 capability；多节点必须保持签名配置一致，轮换可能使旧链接失效。仅源码检查不证明生产或 Relay 的授权链正确。

**官方安全事实**：公开公告将计费整数溢出 GHSA-8r8v-xf7q-rcpr 的修复边界列为 rc.18，Redis quota cache 覆写 GHSA-j6gc-4893-qwmp 列为 rc.16；都早于历史 rc.30，不能说 rc.44 才修复。另 GHSA-5353-f8fq-65vc（Passkey step-up 绕过）仍列 affected >=v0.10.0、Patched versions None；不能由新版本标签证明公告已闭环，也不能据此认定当前源码仍可利用。rc.34 加强 session/action-bound Proof、统一验证、Argon2id 和 OAuth 秘密日志脱敏；rc.41 收紧创建用户的角色；rc.43 增加 Skip Upstream TLS Verification，覆盖 relay/WebSocket/task/plugin/media 等路径，是应保持关闭的安全敏感选项。rc.44 的 legal-consent 登录修正与依赖更新不构成“修复全部鉴权/CVE”的声明。[S15、S16、S5、S11、S3]

### 5. API/schema/migrations：必须可恢复，不能只换镜像

**官方事实**：rc.30 曾修复 rc.28/29 的 MySQL/PostgreSQL 启动迁移回归；rc.34 继续处理 SQLite unique index、MySQL decimal/PostgreSQL CHAR 的重复 DDL；rc.38 处理 legacy constraints/scoped authorization policies。目标 authentication 文档列出 user_sessions/auth_flows/external_identity_claims、users.auth_version 及 user_access_tokens 等升级契约，并警告身份回填冲突可阻止迁移；旧 session Cookie 已不使用。rc.44 明示升级后 Playground 历史会清空一次，日志查询/导出/看板新增默认 365 天范围限制。[S4、S16、S9、S6、S3]

**推断/建议**：先在脱敏副本核对生产数据库类型、已有迁移状态、唯一约束/身份重复及定制字段；保存可恢复备份并确认 DB 回滚兼容。切换二进制不等于安全回滚。rc.44 的 Playground 清理与日志范围限制属于可见行为变化，需要对运营用户说明。本次没有运行迁移、lint/构建或服务测试；没有修改程序代码。

## 放行条件（仅建议，未执行）

1. 父线程建立生产源码/构建归属，列清定制 patch；无法归属时，以现有镜像及 DB 快照作为恢复依据。
2. 确认管理 PAT 生命周期、scope 与轮换流程，离线覆盖普通用户 provisioning、JWT/key/list/key-read 和敏感操作拒绝路径。
3. 以定制插件 fixtures 对比 JS hooks、SSE、multipart、Responses/video/image、artifact 授权及预扣/结算/退款。
4. 脱敏 DB 升级演练、恢复验证通过后，另行提出灰度方案；本报告不授权升级或部署。

## 官方证据索引

- [S1 官方 latest REST](https://api.github.com/repos/QuantumNous/new-api/releases/latest)；[release 列表 REST](https://api.github.com/repos/QuantumNous/new-api/releases?per_page=100)；[rc.44 tag ref](https://api.github.com/repos/QuantumNous/new-api/git/ref/tags/v1.0.0-rc.44)。发布身份以 REST 为准。
- [S2 最新无 RC 正式版 v0.13.2](https://github.com/QuantumNous/new-api/releases/tag/v0.13.2)。
- [S3 rc.44 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.44)。
- [S4 rc.30 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.30)。
- [S5 rc.41 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.41)。
- [S6 目标 authentication 文档](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.44/docs/authentication.md#pat-调用契约)；[PAT 存储/退役源码](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.44/model/user_access_token.go)。
- [S7 面板 API 路由](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.44/router/api-router.go)；[API key controller](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.44/controller/token.go)。
- [S8 rc.31 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.31)；[rc.37 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.37)。
- [S9 rc.38 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.38)。
- [S10 rc.42 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.42)。
- [S11 rc.43 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.43)。
- [S12 rc.39 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.39)；[rc.40 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.40)。
- [S13 JS Task Plugin API v1](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.44/docs/plugin-api/v1.md)；[utils.fetch 实现](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.44/pkg/jsplugin/fetch.go)。
- [S14 artifact 签名实现](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.44/service/task_artifact_access.go)；[artifact 访问 middleware](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.44/middleware/task_artifact_access.go)。
- [S15 官方公开 advisories](https://github.com/QuantumNous/new-api/security/advisories)；[计费整数溢出](https://github.com/QuantumNous/new-api/security/advisories/GHSA-8r8v-xf7q-rcpr)；[Redis quota cache](https://github.com/QuantumNous/new-api/security/advisories/GHSA-j6gc-4893-qwmp)；[Passkey step-up 公告](https://github.com/QuantumNous/new-api/security/advisories/GHSA-5353-f8fq-65vc)。
- [S16 rc.34 release](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.34)。

证据限制：官方 compare API 报告 rc.30→rc.44 共 275 commits，但单次响应仅含 250 commits、300 files；本报告没有据此宣称穷举全部差异。release 说明不是运行时兼容证明，官方公告缺少修复版本也不是目标版本漏洞复现。生产和 Relay 契约说明来自父线程，未被伪装成上游源码事实。
