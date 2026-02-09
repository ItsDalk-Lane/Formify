# Provider Compatibility Matrix

本文档描述 Formify 当前各 Provider 的能力、路由策略与已知限制，作为设置项与实际请求行为的对齐依据。

## 路由与能力矩阵

| Provider | 文本生成 | 图像理解 | 图像生成 | Tool Calling | 推理输出 | 路由策略 |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI | Yes | Yes | No | Yes | Yes | `enableReasoning=true` 时走 `responses`，否则走 `chat.completions` |
| Azure OpenAI | Yes | Yes | No | Yes | Yes | `enableReasoning=true` 时走 `responses`，否则走 `chat.completions` |
| Grok | Yes | Yes | No | Partial | Yes | `enableReasoning=true` 时走 `responses`，否则走 `chat.completions` |
| OpenRouter | Yes | Yes | Yes | Yes | Yes | 推理场景走 `responses`；图像生成模型写入 `response_format` |
| Claude | Yes | Yes | No | Web Search Tool | Yes | Anthropic Messages API |
| Gemini | Yes | Yes | Partial | Partial | Partial | 优先 `@google/genai`，失败回退 Gemini OpenAI-compatible |
| Qwen | Yes | Yes | No | Partial | Yes | OpenAI-compatible Chat Completions |
| Zhipu | Yes | Partial | No | Partial | Yes | OpenAI-compatible Chat Completions |
| DeepSeek | Yes | No | No | Yes | Yes | OpenAI-compatible Chat Completions |
| QianFan | Yes | Yes | Yes | Partial | Yes | OpenAI-compatible `/v2` 接口；图像模型走 `/v2/images/generations` |
| Doubao | Yes | Yes | No | No | Yes | Chat Completions / Responses(Web Search) |
| DoubaoImage | No | No | Yes | No | No | 图像生成 API，支持 SSE 统一解析 |
| Kimi | Yes | Yes | No | Partial | Yes | OpenAI-compatible Chat Completions |
| SiliconFlow | Yes | Yes | No | Partial | Yes | OpenAI-compatible Chat Completions |
| Ollama | Yes | Model-dependent | Model-dependent | Model-dependent | Model-dependent | 本地 Ollama API |
| GPT-Image | No | No | Yes | No | No | 图像生成 API |

## 模型列表策略

- Claude/Qwen/Zhipu/DeepSeek/QianFan/DoubaoImage 已支持远端拉取模型列表。
- 远端拉取失败时自动回退到内置静态模型列表（fallback）。
- QianFan 优先尝试 `/v2/models`；DoubaoImage 优先尝试 `/api/v3/models`。

## 关键设置项与生效范围

- OpenRouter `imageResponseFormat` 仅在图像生成模型生效，并写入请求体 `response_format`。
- OpenRouter `reasoningEffort` 仅在启用推理且命中 Responses API 时生效。
- OpenAI/Azure/Grok 的推理开关会触发 `chat.completions -> responses` 路由切换。
- QianFan 使用单一 Bearer Token（API Key），不再依赖 API Secret + OAuth token 交换。

## 已知限制

- 部分第三方模型名可能在上游下线，建议优先使用模型选择器远端列表。
- 不同 Provider 的 Tool Calling 返回结构存在差异，跨 Provider 会按统一格式尽量兼容。
- Responses API 事件字段在不同厂商实现可能有差异，已做容错解析，但仍建议优先使用官方推荐模型。
