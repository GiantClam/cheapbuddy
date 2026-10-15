# Sub2API 升级评估：定制 0.2.13 → 上游 v0.2.15

调研日期：2026-10-13，Asia/Shanghai。范围已按父线程要求收窄，不追溯 v0.1.183。

## 结论与建议

**确定：生产对应本地提交 b485e6a 未包含 v0.2.14 的 EasyPay 下单签名重放／伪造支付成功回调修复。建议尽快将该安全补丁移植到定制分支；完整升级到 v0.2.15 则需保留 CheapBuddy bridge、USD 钱包及支付定制后验证，不能直接以官方镜像替换。** 若实际启用 EasyPay，这是优先处理的资金安全风险；本次未检查支付启用状态，也未对线上发起漏洞验证，不能据此断言已有利用。

生产版本为定制 0.2.13 + b485e6a，是父线程已确认的部署事实，本侧车不重复部署调查。本地实际检查的是不可变提交 `b485e6a17de3ca317f28a2a215c573613a6fe30a`，而不是只看 VERSION 字符串。

## 版本事实

来源：[官方 latest API](https://api.github.com/repos/Wei-Shaw/sub2api/releases/latest)、[最近发布列表](https://api.github.com/repos/Wei-Shaw/sub2api/releases?per_page=10)。以下均为正式版，`draft=false`、`prerelease=false`：

| 版本 | 官方 published_at（UTC） | Asia/Shanghai |
| --- | --- | --- |
| [v0.2.13](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.13) | 2026-10-02 12:16:38Z | 2026-10-02 20:16:38 |
| [v0.2.14](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.14) | 2026-10-07 02:02:43Z | 2026-10-07 10:02:43 |
| [v0.2.15](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.15) | 2026-10-09 03:35:49Z | 2026-10-09 11:35:49 |

查询时 latest 稳定版为 v0.2.15；最近 10 条 release 中未见更新的 prerelease。没有穷举历史预发布。官方 v0.2.13 比较基点是 `3040209f205472038c1ba745a1bedd2edd9053b1`，本地 shallow 基点为 `b8dece9`；不能仅凭版本号认定二者源码完全一致。

## EasyPay：直接实现差异（确定证据）

本地路径均位于 `C:/Users/liula/Documents/cheapbuddy/sub2api-coworkany/`；行号来自 `git show b485e6a:<path>`。

| 修复点 | 本地 b485e6a | 上游 v0.2.14 |
| --- | --- | --- |
| 客户端 return_url 查询参数 | `backend/internal/service/payment_resume_service.go:235–257` 的 `CanonicalizeReturnURL` 只清空 Fragment，未清空 RawQuery；`:291–302` 的 `buildPaymentReturnURL` 在原查询上追加系统参数 | CanonicalizeReturnURL 新增 `parsed.RawQuery = ""`，移除客户端查询参数 |
| 通知参数边界 | `backend/internal/payment/provider/easypay.go:371–387` 将全部通知键写入 params 后验签；没有允许参数白名单 | 验签前通过 `easyPayNotifyAllowedParams` 拒绝非标准通知键 |
| 回调成功判定 | `easypay.go:388–403` 在验签后依据 trade_status 生成成功通知；`:580–602` 签名基串仍直接拼接未转义参数值 | 保留签名协议，以参数隔离阻止下单签名跨用途复用 |

官方源码证据：
- [return_url 防注入修改](https://github.com/Wei-Shaw/sub2api/blob/v0.2.14/backend/internal/service/payment_resume_service.go#L235-L266)。源码注释明确关联 issue #7881 与下单签名被重放成支付成功通知。
- [通知验签参数边界](https://github.com/Wei-Shaw/sub2api/blob/v0.2.14/backend/internal/payment/provider/easypay.go#L371-L391)。白名单在该文件末尾；允许 pid、trade_no、out_trade_no、type、name、money、trade_status、param、sign、sign_type。
- [完整安全修复提交 d1aac6b](https://github.com/Wei-Shaw/sub2api/commit/d1aac6b98989b79d66c0f52bd18dc8c3142e7601)，真实合并 PR 为 [#7888](https://github.com/Wei-Shaw/sub2api/pull/7888)；#7881 是 issue，不是该补丁 PR。
- [官方安全回归测试](https://github.com/Wei-Shaw/sub2api/blob/v0.2.14/backend/internal/payment/provider/easypay_notify_security_test.go)包含拒绝伪造签名复用、拒绝下单 URL 重放、接受正常回调、拒绝未知参数四类测试。

必要源码改动应以该官方提交为准：两个生产文件及 `easypay_notify_security_test.go`、`payment_resume_service_test.go`，而不是只改 VERSION。移植后应验证合法回调、伪造回调、QueryOrder 对账、重复回调幂等与锁定汇率下 USD 入账。**这些是后续建议，本次没有实施或执行测试。** 某些 EasyPay 变体若添加非标准通知字段可能被新白名单拒绝，这是兼容性风险；不要为兼容而无条件撤销白名单。

## .14 / .15 其他升级风险（简要）

- **.14 管理员初始化安全**：随机默认管理员邮箱、显式管理员密码 8–72 字节及邮箱格式校验；破坏性变化仅涉及全新 AUTO_SETUP，已有管理员／用户的实例不因此阻断启动，也不会自动修复已有弱凭据。[官方 .14 说明](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.14)。本次未读取生产配置、凭据或审计管理员。
- **.15 计费与协议**：官方记录修复 Responses WebSocket 后续轮次未使用最新分组价格、WS 图片输入漏计、多协议 Claude 计费／钱包冷却，以及 Chat↔Responses 的 developer/tool_choice/function_call/refusal 转换与流式心跳问题。[官方 .15 说明](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.15)。建议将长连接多轮、图片用量和 USD 扣费一致性列为升级回归重点；未逐项核实定制分支是否已有独立等效修复。
- **.15 数据库变化**：[新增 242_drop_platform_check_constraints.sql](https://github.com/Wei-Shaw/sub2api/blob/v0.2.15/backend/migrations/242_drop_platform_check_constraints.sql)删除两个平台 CHECK 约束，平台白名单转由应用层验证。定制提交已有 `242_payment_usd_ledger_precision.sql`，将 amount、bonus_amount、refund_amount 改为 DECIMAL(20,8)。同前缀不代表必然迁移冲突：本地 `backend/internal/repository/migrations_runner.go:180–218` 按完整文件名排序、按 filename 与 checksum 记账。但仍应保留已应用的自定义文件名／内容，验证合并顺序、约束与精度，不能用上游迁移目录覆盖定制目录。这是兼容性评估，不是发现了已发生迁移失败。

比较依据：[官方 v0.2.13...v0.2.15](https://github.com/Wei-Shaw/sub2api/compare/v0.2.13...v0.2.15)及对应 GitHub API。父代理继续负责完整定制兼容性与生产变更决策。

## 执行边界与证据限制

已调用 web.run 查询官方 release 页面，但该工具此次未返回可用内容；通过官方 GitHub connector／只读 REST API及官方 tag 源码补足证据。遵循 research skill 的 primary-source 原则，本侧车不递归委派。

仅使用只读 git show/grep/log/ls-tree、官方 GitHub GET。未 fetch/pull、升级、部署、push、修改 Git 状态、读取 .env 或 secrets、操作数据库，也没有主动测试线上支付漏洞。唯一写入文件是本记录；其他既有未提交修改未触碰。未运行构建或测试，避免引入非报告写入及将静态检查误称为运行验证。
