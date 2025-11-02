Web Search 基础联网搜索工具支持通过 Responses API 调用直接获取公开域互联网信息（如新闻、商品、天气等），适用于需动态获取最新网络数据的场景（如产品对比、旅游推荐、图文关联搜索等）。工具通过模型自动判断是否需要搜索

## 核心功能
- 支持多轮搜索：复杂问题支持多轮搜索补充信息。
- 支持图文输入：支持 VLM 模型以图文作为输入，搜索后输出文字结果（例如根据图片判断城市并查询天气）。

## 快速开始示例代码
```Bash
curl --location 'https://ark.cn-beijing.volces.com/api/v3/responses' \
--header "Authorization: Bearer $ARK_API_KEY" \
--header 'Content-Type: application/json' \
--data '{
    "model": "doubao-seed-1-6-250615",
    "stream": true,
    "tools": [
        {
            "type": "web_search",
            "max_keyword": 3
        }
    ],
    "input": [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "今天有什么热点新闻"
                }
            ]
        }
    ]
}'
```

## 最佳实践

边想边搜使用示例
以下代码通过 OpenAI SDK 调用火山方舟 Web Search 工具，实现 “AI 思考 - 联网搜索 - 答案生成” 全链路自动化，可针对时效、盲区、动态信息类问题自动触发工具补数据，通过流式响应实时输出思考、搜索、回答过程，保障信息可追溯、决策可感知。
```Python
import os
from openai import OpenAI
from datetime import datetime

def realize_think_while_search():

    # 1. 初始化OpenAI客户端
    client = OpenAI(
        base_url="https://ark.cn-beijing.volces.com/api/v3", 
        api_key=os.getenv("ARK_API_KEY")
    )

    # 2. 定义系统提示词（核心：规范“何时搜”“怎么搜”“怎么展示思考”）
    system_prompt = """
    你是AI个人助手，需实现“边想边搜边答”，核心规则如下：
    一、思考与搜索判断（必须实时输出思考过程）：
    1. 若问题涉及“时效性（如近3年数据）、知识盲区（如具体企业薪资）、信息不足”，必须调用web_search；
    2. 每次调用web_search仅能改写1个最关键的搜索词（如“2021-2023世界500强在华企业平均工资”）；
    3. 思考时需说明“是否需要搜索”“为什么搜”“搜索关键词是什么”。

    二、回答规则：
    1. 优先使用搜索到的资料，引用格式为`[1] (URL地址)`；
    2. 结构清晰（用序号、分段），多使用简单易懂的表述；
    3. 结尾需列出所有参考资料（格式：1. [资料标题](URL)）。
    """

    # 3. 构造API请求（触发思考-搜索-回答联动）
    response = client.responses.create(
        model="doubao-seed-1-6-250615",  
        input=[
            # 系统提示词（指导AI行为）
            {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
            # 用户问题（可替换为任意需边想边搜的问题）
            {"role": "user", "content": [{"type": "input_text", "text": "世界500强企业在国内所在的城市，近三年的平均工资是多少？"}]}
        ],
        tools=[
            # 配置Web Search工具参数
            {
                "type": "web_search",
                "limit": 10,  # 最多返回10条搜索结果
                "sources": ["toutiao", "douyin", "moji"],  # 优先从头条、抖音、知乎搜索
                "user_location": {  # 优化地域相关搜索结果（如国内城市）
                    "type": "approximate",
                    "country": "中国",
                    "region": "浙江",
                    "city": "杭州"
                }
            }
        ],
        stream=True,  # 启用流式响应（核心：实时获取思考、搜索、回答片段）
        extra_body={"thinking": {"type": "auto"}},  # 自动触发AI思考（无需手动干预）
    )

    # 4. 处理流式响应（实时展示“思考-搜索-回答”过程）
    # 状态变量：避免重复打印标题
    thinking_started = False  # AI思考过程是否已开始打印
    answering_started = False  # AI回答是否已开始打印

    print("=== 边想边搜启动 ===")
    for chunk in response:  # 遍历每一个实时返回的片段（chunk）
        chunk_type = getattr(chunk, "type", "")  # 获取片段类型（思考/搜索/回答）

        # ① 处理AI思考过程（实时打印“为什么搜、搜什么”）
        if chunk_type == "response.reasoning_summary_text.delta":
            if not thinking_started:
                print(f"\n🤔 AI思考中 [{datetime.now().strftime('%H:%M:%S')}]:")
                thinking_started = True
            # 打印思考内容（delta为实时增量文本）
            print(getattr(chunk, "delta", ""), end="", flush=True)

        # ② 处理搜索状态（开始/完成提示）
        elif "web_search_call" in chunk_type:
            if "in_progress" in chunk_type:
                print(f"\n\n🔍 开始搜索 [{datetime.now().strftime('%H:%M:%S')}]")
            elif "completed" in chunk_type:
                print(f"\n✅ 搜索完成 [{datetime.now().strftime('%H:%M:%S')}]")

        # ③ 处理搜索关键词（展示AI实际搜索的内容）
        elif (chunk_type == "response.output_item.done" 
              and hasattr(chunk, "item") 
              and str(getattr(chunk.item, "id", "")).startswith("ws_")):  # ws_为搜索结果标识
            if hasattr(chunk.item.action, "query"):
                search_keyword = chunk.item.action.query
                print(f"\n📝 本次搜索关键词：{search_keyword}")

        # ④ 处理最终回答（实时整合搜索结果并输出）
        elif chunk_type == "response.output_text.delta":
            if not answering_started:
                print(f"\n\n💬 AI回答 [{datetime.now().strftime('%H:%M:%S')}]:")
                print("-" * 50)
                answering_started = True
            # 打印回答内容（实时增量输出）
            print(getattr(chunk, "delta", ""), end="", flush=True)

    # 5. 流程结束
    print(f"\n\n=== 边想边搜完成 [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ===")

# 运行函数
if __name__ == "__main__":
    realize_think_while_search()
```

## 系统提示词示例

系统提示词的设置对搜索请求有着较大影响，建议进行优化以提升搜索的准确性与效率。以下为您提供两种系统提示词模板示例，供您在实际应用中参考。

说明:

为获得更佳搜索结果，推荐在系统提示词中添加以下内容。

  注意：每次调用 web_search 时，只能改写出一个最关键的问题。如果有任何冲突设置，以当前指令为准。

### 模板一
```
# 定义系统提示词
system_prompt = """
你是AI个人助手，负责解答用户的各种问题。你的主要职责是：
1. **信息准确性守护者**：确保提供的信息准确无误。
2. **搜索成本优化师**：在信息准确性和搜索成本之间找到最佳平衡。
# 任务说明
## 1. 联网意图判断
当用户提出的问题涉及以下情况时，需使用 `web_search` 进行联网搜索：
- **时效性**：问题需要最新或实时的信息。
- **知识盲区**：问题超出当前知识范围，无法准确解答。
- **信息不足**：现有知识库无法提供完整或详细的解答。
**注意**：每次调用 `web_search` 时，**只能改写出一个最关键的问题**。如果有任何冲突设置，以当前指令为准。
## 2. 联网后回答
- 在回答中，优先使用已搜索到的资料。
- 回复结构应清晰，使用序号、分段等方式帮助用户理解。
## 3. 引用已搜索资料
- 当使用联网搜索的资料时，在正文中明确引用来源，引用格式为：  
`[1]  (URL地址)`。
## 4. 总结与参考资料
- 在回复的最后，列出所有已参考的资料。格式为：  
1. [资料标题](URL地址1)
2. [资料标题](URL地址2)
"""
```
模板二
```
# 定义系统提示词
system_prompt = """
# 角色
你是AI个人助手，负责解答用户的各种问题。你的主要职责是：
1. **信息准确性守护者**：确保提供的信息准确无误。
2. **回答更生动活泼**：请在模型的回复中多使用适当的 emoji 标签 🌟😊🎉
# 任务说明
## 1. 联网意图判断
当用户提出的问题涉及以下情况时，需使用 `web_search` 进行联网搜索：
- **时效性**：问题需要最新或实时的信息。
- **知识盲区**：问题超出当前知识范围，无法准确解答。
- **信息不足**：现有知识库无法提供完整或详细的解答。
## 2. 联网后回答
- 在回答中，优先使用已搜索到的资料。
- 回复结构应清晰，使用序号、分段等方式帮助用户理解。
## 3. 引用已搜索资料
- 当使用联网搜索的资料时，在正文中明确引用来源，引用格式为：  
`[1]  (URL地址)`。
## 4. 总结与参考资料
- 在回复的最后，列出所有已参考的资料。格式为：  
1. [资料标题](URL地址1)
2. [资料标题](URL地址2)
"""
```