中文 | [English](https://github.com/vran-dev/obsidian-form-flow/blob/master/README.md)

## 什么是表单？

还在为杂乱的笔记、重复的任务或需要编程的复杂工具而苦恼？我们的可视化表单工具是你的救星！它能帮你轻松收集信息、自动化流程、提升效率——完全不需要写代码。拖拽式界面简单到像整理待办事项，却强大到能取代 Templater、QuickAdd 等插件，让你的工作更省心！

## 能做什么？

- 💡 随时捕捉灵感：灵感闪现？一键记录到指定位置，再也不怕创意溜走或迷失在目录的层级中！
- 🚀 效率模板：用表单轻松搞定会议模板、联系人模板、项目模板，实现更高效的内容输出！
- 🛫 释放无限可能：从简单的记录到复杂的自动化，内置了创建文件、插入文本、更新属性、执行脚本等多种功能，可以自由编排构建自动化流程。
- 🚢 零代码，轻松上手：全可视化编辑，配置就像搭积木，简单直观，零技术门槛。

## 使用方式

1. 安装插件
2.  ctrl+p (mac cmd+p) 打开命令面板，输入 `Form` 选择 `Form Flow: 创建表单`
3. 在弹出的表单编辑器中，添加你需要的字段和功能

## 循环动作 API

循环动作是 Form Flow 的流程控制中枢，可在单个动作中执行列表遍历、条件循环、计数循环与分页循环，并在内部嵌套任意动作序列。

### 循环类型

| 类型 | 描述 | 典型配置 |
| --- | --- | --- |
| **列表循环 (LoopType.LIST)** | 遍历任意数组或 JSON 列表，支持表单字段、前置动作输出、JSON 字符串、逗号/换行分隔文本。 | `listDataSource` 指向 `state.values` 或 JSON |
| **条件循环 (LoopType.CONDITION)** | 类似 `while` 循环，基于布尔表达式决定是否继续。 | `conditionExpression` 支持任意 JS 表达式（可引用 `values` 与循环变量） |
| **计数循环 (LoopType.COUNT)** | 类似 `for` 循环，基于起始值、结束值和步长执行固定次数。 | `countStart`、`countEnd`、`countStep` |
| **分页循环 (LoopType.PAGINATION)** | 针对分页 API 的专用循环，内置页码变量、延迟、最大页数控制。 | `paginationConfig`：当前页变量、是否有下一页表达式、请求间隔等 |

### 循环变量

- **item**：当前元素（可在设置中重命名）
- **index**：当前索引，从 0 开始
- **total**：总迭代次数（列表/计数类型）
- 所有变量均注入 Loop 作用域，不会污染表单字段，可直接在模板或脚本中通过 `{{@item}}`、`{{@index}}` 引用。

### 控制参数

- 最大循环次数、总超时时间、单次执行超时
- 错误处理策略：跳过、停止、重试（可配置重试次数与间隔）
- Break/Continue 动作：在循环内部添加 `Break` 或 `Continue` 动作立即中断/跳过当前迭代
- 进度显示：可配置在日志中输出迭代进度

### 示例：遍历 API 分页结果并生成文件

```jsonc
{
  "type": "loop",
  "loopType": "pagination",
  "listDataSource": "{{output:users}}",
  "paginationConfig": {
    "currentPageVariable": "page",
    "hasNextPageCondition": "values.hasMore === true",
    "requestInterval": 300
  },
  "itemVariableName": "user",
  "nestedActions": [
    {
      "type": "createFile",
      "filePath": "{{@user.username}}.md",
      "content": "- 姓名：{{@user.name}}\n- 邮箱：{{@user.email}}"
    }
  ]
}
```

> 提示：分页循环通常搭配 `Run Script` 或 `AI` 动作获取 API 数据，Loop 只负责分页控制与内层动作调度。