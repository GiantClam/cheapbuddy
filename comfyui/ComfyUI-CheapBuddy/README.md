# ComfyUI-CheapBuddy

CheapBuddy 的 ComfyUI 自定义节点，规划为三个通用节点：文本生成、图片生成和视频生成。模型、能力、生成类型及参数通过 CheapBuddy API 动态发现。

## 节点

- **CheapBuddy Text Generate**：文本生成；连接图片后可调用支持 Vision 的模型。
- **CheapBuddy Image Generate**：文生图、图像编辑和图像变体。
- **CheapBuddy Video Generate**：文生视频、图生视频、参考素材生视频，并支持任务续取。

每个节点直接配置 API Key、`base_url`、模型和任务参数。API Key 会随工作流保存。素材直接随任务请求发送，不需要独立 Config 或远端 Upload 节点。视频结果由视频节点保存并注册为 ComfyUI 标准输出。

安装目标目录：

```text
ComfyUI/custom_nodes/ComfyUI-CheapBuddy
```

## 安装

将本目录整体放入 `ComfyUI/custom_nodes/ComfyUI-CheapBuddy`，重启 ComfyUI 后在 CheapBuddy 分类中使用三个节点。节点从 ComfyUI 本机服务端刷新模型；模型及参数 schema 来自当前 API Key 可访问的 Relay 目录。

## 测试工作流

导入 `workflows/CheapBuddy-Test-Workflow.json`。默认启用“文本生成 → 文生图 → 图生视频”链路；运行前，在这三个节点分别填入轮换后的 API Key，并刷新、选择各自支持的模型。提交该链路会产生文本、图片和视频 API 用量。

工作流还包含默认禁用的图像编辑、图片变体、文生视频、首尾帧生视频和参考视频生视频分支。每次只启用要验证的分支，并确认模型 capabilities 与参数 schema 匹配。首尾帧分支初始将同一张生成图连到两个帧端口，用于检查字段传递；要验证不同首尾画面，请替换其中一个图片输入。多图数量通过所选模型 schema 支持的参数（如 `n`）设置。

API Key 保存在工作流节点参数中。导出或分享 workflow JSON、含工作流元数据的输出文件前，先移除或轮换密钥。节点不会把 API Key 写入日志。

视频节点支持文生、首帧/尾帧图生及图像、参考视频、参考音频素材输入；轮询超时会输出 task ID，可切换到 `resume` 续取，续取不会重新提交创建请求。视频保存至当前 ComfyUI 实例的 output 目录并返回原生 `VIDEO` 对象。

模型参数通过“高级参数 JSON”输入，并按 Relay 的 `parameter_schema` 做基础字段、类型、选项和范围校验。模型选择后会载入 schema 默认值并按 capabilities 收窄图片/视频生成类型。部署版 ComfyUI/API 的实际 multipart 字段、最小核心版本及 RunningHub/Comfy.icu 产物可见性仍需按 OpenSpec 验收清单确认。

详细接口、能力、安全边界、视频任务状态和宿主验证见 [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md)。
