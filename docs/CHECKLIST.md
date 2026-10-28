# DeepSeek V4.1 Flash 上线检查清单

> 2026-10-28 检查发现：EcoPhase 实时模型目录不含 `deepseek-4.1-flash-1017`。
> 旧公开模型恢复直通 `deepseek-v4.1-flash`；1017 仍需渠道商开放对应上游组权限。

## 历史线上状态（2026-10-15）

- [x] `CheapBuddy OpenAI` 为 Active，倍率 `0.72x`
- [x] 组白名单包含 `deepseek/deepseek-v4.1-flash`
- [x] 组白名单包含 `deepseek-flash`
- [x] `ecophase-ai.com` 为 Active、Schedulable、Priority 1
- [x] 账户保留 `deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`
- [x] 账户保留 `deepseek-v4.1-flash` → `deepseek-v4.1-flash`
- [x] 新配置中 `deepseek-flash` → `deepseek-4.1-flash-1017`
- [x] 真实请求返回 200
- [x] 历史 Usage 记录曾命中 `ecophase-ai.com`
- [x] Requested Model 为公开 ID
- [x] Final Upstream Model 为上游实际 ID
- [x] 用户计费和账户成本均已生成

线上验证 Request ID：
`1fa7d9aab0f6c178a687873c7f4cde3c`。

## 当前账户映射（2026-10-27）

- [x] `ecophase-ai.com` 保留 `deepseek/deepseek-v4.1-flash` 和
  `deepseek-v4.1-flash` → `deepseek-v4.1-flash`
- [x] `ecophase-ai.com` 映射 `deepseek-flash` → `deepseek-4.1-flash-1017`
- [x] `ecophase-ai.com` 白名单包含 `deepseek-4.1-flash-1017`
- [x] `pptoken-deepseek` 保留为 Priority 2 后备

## 2026-10-28 线上复核

- [x] `CheapBuddy OpenAI` 与 `CheapBuddy Shared` 白名单包含 1017 ID
- [x] `CheapBuddy Shared` composite route 包含 1017 ID
- [x] EcoPhase 实时目录包含旧模型 ID
- [ ] EcoPhase 实时目录包含 `deepseek-4.1-flash-1017`
- [ ] 使用 EcoPhase 请求 1017 成功
- [x] Relay 旧公开 ID保持不变，避免被重写到当前未开放的 1017

## 每次发布前

- [x] `src/models.js` 中 DeepSeek 仅声明公开 ID
- [ ] WorkBuddy、Claude Code、OpenCode、Codex 配置均输出公开 ID
- [ ] `relay/config/model-aliases.json` 映射公开 ID → 内部路由 ID
- [ ] Relay 部署环境设置 `RELAY_MODEL_ALIASES_FILE`，或提供等价
  `RELAY_MODEL_ALIASES`
- [ ] 不在文档或配置中把 `deepseek-flash` 称为官方上游 ID
- [ ] `npm test`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] `cd relay; go test ./...`
- [ ] `cd relay; go vet ./...`
- [ ] `cd relay; go build ./cmd/relay`
- [ ] `cd media-mcp; npm test`
- [ ] `node comfyui/ComfyUI-CheapBuddy/tests/test_model_dropdown.mjs`

## 发布后验收

1. 使用有效的用户 Key，只请求公开 ID：

```powershell
.\scripts\verify-deepseek-routing.ps1
```

2. 在 Usage 记录中核对：

- [ ] Account：`ecophase-ai.com`
- [ ] Requested Model：`deepseek/deepseek-v4.1-flash`
- [ ] Final Upstream Model：`deepseek-4.1-flash-1017`
- [ ] Inbound：`/v1/chat/completions`
- [ ] 请求成功且 Cost 非空

3. 如果命中备用账户，运行只读配置审计：

```powershell
.\scripts\setup-deepseek-routing.ps1
```

该脚本不会提交不完整的账户更新；发现差异时应在管理后台编辑并保存完整账户配置。
