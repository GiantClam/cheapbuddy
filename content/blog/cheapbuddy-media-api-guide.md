---
slug: cheapbuddy-media-api-guide
category: BUILD GUIDE
date: 2026-09-22
readTime: 7
accent: blue
title: 用 OpenAI 兼容接口接入图片与视频任务
title_en: Build image and video workflows with the OpenAI-compatible API
excerpt: 从第一条图片请求到异步视频下载：理解 CheapBuddy 媒体接口的最短路径。
excerpt_en: From the first image request to an async video download: the shortest path through CheapBuddy media APIs.
---

<!-- zh -->
## 同一个 Key，两个任务形态

图片生成通常可以在一次请求里返回结果，而视频生成需要排队、轮询和下载。CheapBuddy 保留了 OpenAI 风格的请求习惯，同时把视频任务拆成清晰的状态机。

```text
POST /v1/images/generations
POST /v1/videos
GET  /v1/videos/{id}
GET  /v1/videos/{id}/content
```

## 视频任务的三个阶段

提交时拿到公开任务 ID；轮询接口只返回任务状态和进度；完成后再通过 content 路径下载文件。这样做可以避免把上游地址直接暴露给客户端，也方便在队列较长时显示真实进度。

- 创建：POST /v1/videos
- 查询：GET /v1/videos/{id}
- 下载：GET /v1/videos/{id}/content

## 先测试，再扩展

建议先用低分辨率、短时长和小额余额跑通一条链路，再把同样的调用封装到 ComfyUI 或 Hypit。接口字段、错误状态和下载路径在文档页都有对应示例。

<!-- en -->
## One key, two task shapes

Image generation can often return a result in one request. Video generation needs queueing, polling, and downloading. CheapBuddy keeps the familiar OpenAI-style request shape while exposing video as a clear state machine.

```text
POST /v1/images/generations
POST /v1/videos
GET  /v1/videos/{id}
GET  /v1/videos/{id}/content
```

## Three phases for a video task

The create call returns a public task ID. The polling endpoint returns status and progress. Once complete, the content endpoint streams the file. This keeps upstream URLs private and gives long-running jobs a meaningful progress surface.

- Create: POST /v1/videos
- Poll: GET /v1/videos/{id}
- Download: GET /v1/videos/{id}/content

## Test first, then scale

Start with a short, low-resolution job and a small balance. Once the full path works, wrap the same calls in ComfyUI or Hypit. The docs page includes matching examples for fields, failures, and downloads.
