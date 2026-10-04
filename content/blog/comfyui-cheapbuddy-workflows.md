---
slug: comfyui-cheapbuddy-workflows
category: ECOSYSTEM
date: 2026-09-15
readTime: 6
accent: orange
title: 把 CheapBuddy 放进 ComfyUI 工作流
title_en: Bring CheapBuddy into your ComfyUI workflow
excerpt: 用三个节点覆盖文本、图片和视频，把模型切换留在工作流里完成。
excerpt_en: Use three focused nodes for text, image, and video generation, while keeping model changes inside the workflow.
---

<!-- zh -->
## 为什么选择节点化入口

当提示词、参考图和输出格式需要反复调整时，节点比脚本更容易复用。CheapBuddy ComfyUI 节点把鉴权、模型列表和任务提交封装起来，让画布保留给创作本身。

## 从一个最小工作流开始

先安装插件并重启 ComfyUI，然后用 Text 节点确认 Key 和模型列表可用，再接入 Image 或 Video 节点。每一步都可以单独替换模型，不需要重建整条链路。

- 安装到 ComfyUI/custom_nodes/ComfyUI-CheapBuddy
- 重启 ComfyUI 并搜索 CheapBuddy 节点
- 从 Text 节点开始验证连接

## 保持配置可迁移

把 API Key 放在本机配置或环境变量中，不要写进公开工作流。导出工作流时只保留模型名、提示词和尺寸等非敏感字段。

<!-- en -->
## Why a node-based entry point

When prompts, reference images, and output formats need repeated iteration, nodes are easier to reuse than scripts. CheapBuddy ComfyUI nodes keep auth, model discovery, and task submission out of the way so the canvas stays focused on creation.

## Start with a minimal workflow

Install the plugin and restart ComfyUI. Start with the Text node to verify the key and model list, then connect Image or Video. Each model can be swapped without rebuilding the workflow.

- Install into ComfyUI/custom_nodes/ComfyUI-CheapBuddy
- Restart ComfyUI and search for CheapBuddy nodes
- Verify the connection with the Text node first

## Keep the config portable

Keep the API key in local config or an environment variable, never inside a public workflow. Export model names, prompts, and dimensions, but leave credentials out.
