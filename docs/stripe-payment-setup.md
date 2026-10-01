# Stripe 多通道配置

这套 CheapBuddy/Sub2API 集成支持多个支付 provider 实例。建议保留国内人民币通道，同时新增一个 Stripe 美元通道：

- 中文界面：继续使用 `easypay` / 支付宝人民币通道。
- 英文界面：只选择 `stripe`，金额以 USD 创建 PaymentIntent。
- 英文界面要求 Stripe provider 明确返回 `currency: USD`；缺失或配置成其他币种时，前端会拒绝创建订单。
- 多个同类实例：在 Sub2API 中配置多个实例，并把负载策略设为 `round-robin` 或 `least-amount`。

## Sub2API 后台配置

进入 **Admin Dashboard -> Settings -> Payment Settings**：

1. 开启 Payment。
2. 将 `Enabled payment types` 至少设置为 `easypay,stripe`（保留现有支付宝通道时不要删除 `easypay`）。
3. 将负载策略设置为 `Round Robin`，或者需要按日累计金额分流时设置为 `Least Amount`。
4. 在 **Provider Management -> Add Provider** 新增 Stripe 实例。

Stripe 实例填写：

| 字段 | 值 |
| --- | --- |
| Provider | `Stripe` |
| Secret Key | `sk_live_...` |
| Publishable Key | `pk_live_...` |
| Webhook Secret | `whsec_...` |
| Currency | `USD` |
| Supported types | 在后台勾选 `card`；需要 Stripe Payment Element 的 Link/支付宝/微信时可同时勾选 `link`、`alipay`、`wxpay`。用户侧统一显示为 `stripe` |
| Enabled | 开启 |

先用 Stripe Test mode 的 `sk_test_...`、`pk_test_...` 验证完整支付和回调流程，再切换到 live keys。密钥只填入 Sub2API 后台或部署密钥存储，不要写进 CheapBuddy 前端环境变量或 Git。

## Stripe Webhook

在 Stripe Dashboard 的 **Developers -> Webhooks** 添加：

```text
https://<公开 API 域名>/api/v1/payment/webhook/stripe
```

至少订阅：

- `payment_intent.succeeded`
- `payment_intent.payment_failed`

将端点生成的 `whsec_...` 填回 Stripe provider。回调必须从公网 HTTPS 可访问，并且不能被 Cloudflare、反向代理或防火墙拦截。Sub2API 会校验 `Stripe-Signature`，验证成功后才把余额订单入账。

## CheapBuddy 前端

英文结账逻辑现在只选择可用的 `stripe`；如果 Stripe 未启用，会明确提示配置缺失，不会回退到支付宝。中文逻辑保持 `easypay -> alipay -> alipay_direct` 的原有优先级。

Stripe 创建订单后返回 `client_secret`，前端会打开 Sub2API 原生 `/payment/stripe` 页面。若原生支付页面不在 API 同域部署，请在构建官网时设置：

```powershell
$env:VITE_SUB2API_STRIPE_PAYMENT_URL = "https://<Sub2API-前台域名>"
```

该变量只需要填写站点根地址，前端会自动追加 `/payment/stripe?order_id=...&client_secret=...`。不要把 Stripe Secret Key 放在这里。

## 验证清单

1. `GET /api/v1/payment/checkout-info` 同时返回 `easypay` 和 `stripe`，且 Stripe 的 `currency` 为 `USD`。
2. 中文界面创建订单时 `payment_type` 为 `easypay` 或支付宝类型。
3. 英文界面创建订单时 `payment_type` 必须为 `stripe`，Stripe Dashboard 中金额和币种显示为 USD。
4. 测试卡支付成功后，订单从 `PENDING` 变为 `PAID` 再变为 `COMPLETED`，余额只入账一次。
5. 在 Stripe Dashboard 的 webhook 日志中确认 `2xx` 响应，并测试支付失败事件不会入账。

当前仓库不包含 Stripe 凭据，因此只能完成前端路由和配置说明；实际生产通道仍需管理员在 Sub2API 和 Stripe Dashboard 中填入自己的 live 凭据。
