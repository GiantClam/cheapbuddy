# ComfyUI-CheapBuddy

CheapBuddy 的 ComfyUI 自定义节点。通过 [cheapbuddy.cc](https://cheapbuddy.cc/) 获取 API Key 后，可以在 ComfyUI 中使用统一的文本、图片和视频模型入口。

## 官方链接

- 官网：[https://cheapbuddy.cc/](https://cheapbuddy.cc/)
- ComfyUI 使用说明：[https://cheapbuddy.cc/comfyui/](https://cheapbuddy.cc/comfyui/)
- API 文档：[https://cheapbuddy.cc/api-docs/](https://cheapbuddy.cc/api-docs/)
- ZIP 下载：[https://cheapbuddy.cc/downloads/ComfyUI-CheapBuddy-0.1.0.zip](https://cheapbuddy.cc/downloads/ComfyUI-CheapBuddy-0.1.0.zip)
- 源码仓库：[https://github.com/GiantClam/cheapbuddy](https://github.com/GiantClam/cheapbuddy)

## 节点

- **CheapBuddy Text Generate**：文本生成；连接图片后可调用支持 Vision 的模型。
- **CheapBuddy Image Generate**：文生图、图生图、文生多图、图生多图、图片编辑和图片变体。
- **CheapBuddy Video Generate**：文生视频、图生视频、参数视频生视频、首帧/首尾帧生视频，以及参考素材生视频。

每个节点直接配置 API Key、`base_url`、模型和任务参数。API Key 会随工作流保存。素材直接随任务请求发送，不需要独立 Config 或远端 Upload 节点。视频结果由视频节点保存并注册为 ComfyUI 标准输出。

安装目标目录：

```text
ComfyUI/custom_nodes/ComfyUI-CheapBuddy
```

## 安装

### ZIP 安装

1. 从 [官网 ZIP 下载地址](https://cheapbuddy.cc/downloads/ComfyUI-CheapBuddy-0.1.0.zip) 下载压缩包。
2. 解压得到 `ComfyUI-CheapBuddy` 目录。
3. 将目录放入 `ComfyUI/custom_nodes/ComfyUI-CheapBuddy`。
4. 重启 ComfyUI，在节点搜索中搜索 `CheapBuddy`。

### 源码安装

```bash
git clone https://github.com/GiantClam/cheapbuddy.git
cp -R cheapbuddy/comfyui/ComfyUI-CheapBuddy ComfyUI/custom_nodes/
```

Windows 可以将 `comfyui/ComfyUI-CheapBuddy` 目录复制到 `ComfyUI/custom_nodes/`。

节点从 ComfyUI 本机服务端刷新模型；模型及参数 schema 来自当前 API Key 可访问的 Relay 目录。

## 配置和运行

1. 访问 [cheapbuddy.cc](https://cheapbuddy.cc/) 注册或登录。
2. 在账户中心创建或复制 CheapBuddy API Key。
3. 在每个节点中填写：

   ```text
   base_url: https://api.cheapbuddy.cc
   api_key: 你的 CheapBuddy API Key
   ```

4. 点击模型下拉框，节点会按 API Key 自动加载可用模型。
5. 选择生成类型，填写提示词和高级参数 JSON。
6. 点击 ComfyUI 的 Queue Prompt。

## 测试工作流

导入 `workflows/CheapBuddy-Test-Workflow.json`。默认启用“文本生成 → 文生图 → 图生视频”链路；运行前，在这三个节点分别填入自己的 API Key，并选择各自支持的模型。提交该链路会产生文本、图片和视频 API 用量。

工作流还包含默认禁用的图像编辑、图片变体、文生视频、首尾帧生视频和参考视频生视频分支。每次只启用要验证的分支，并确认模型 capabilities 与参数 schema 匹配。首尾帧分支初始将同一张生成图连到两个帧端口，用于检查字段传递；要验证不同首尾画面，请替换其中一个图片输入。多图数量通过所选模型 schema 支持的参数（如 `n`）设置。

API Key 会保存在工作流节点参数中。导出或分享 workflow JSON、含工作流元数据的输出文件前，先移除或轮换密钥。节点不会把 API Key 写入日志。不要分享包含真实密钥的工作流，也不要将其上传到 GitHub、RunningHub 或 Comfy.icu。

视频节点支持文生、首帧/尾帧图生及图像、参考视频、参考音频素材输入；轮询超时会输出 task ID，可切换到 `resume` 续取，续取不会重新提交创建请求。视频保存至当前 ComfyUI 实例的 output 目录并返回原生 `VIDEO` 对象。

模型参数通过“高级参数 JSON”输入，并按 Relay 的 `parameter_schema` 做基础字段、类型、选项和范围校验。模型选择后会载入 schema 默认值并按 capabilities 收窄图片/视频生成类型。部署版 ComfyUI/API 的实际 multipart 字段、最小核心版本及 RunningHub/Comfy.icu 产物可见性仍需按 OpenSpec 验收清单确认。

详细接口、能力、安全边界、视频任务状态和宿主验证见 [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md)。
