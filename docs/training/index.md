# π Agent 实操培训指南

> 适用对象：具备 TypeScript / JavaScript 基础，了解 HTTP、异步编程、React 与 LLM 基础概念的初中级工程师。
>
> 推荐用途：公司内部训练营、自学计划、Agent 工程入门 Workshop。
>
> 目标：不是"看懂文档"，而是让学员能独立解释 Agent Loop、增加工具、处理错误、跑通全栈 Playground，并完成一个业务型 Agent 改造。

---

## 一、培训目标

完成本训练后，学员应能做到：

1. **解释 Agent 的基本工作流**

   ```text
   用户消息
   → LLM
   → Tool Call
   → 工具执行
   → Tool Result
   → 下一轮 LLM
   ```

2. **独立手写一个最小 Agent Loop**。

3. **新增一个工具**，并完成：
   - 工具参数定义
   - 参数校验
   - 工具执行
   - 错误返回
   - Tool Result 回传

4. **理解并调试**：
   - Streaming
   - SSE
   - AgentEvent
   - Session
   - AbortController
   - maxTurns
   - maxMessages

5. **在 Playground 基础上完成一个小型业务 Agent**。

---

## 二、推荐训练方式

建议采用：

```text
30% 阅读
30% 讲解
40% 实操
```

每一个知识点都必须配套：

```text
读一章
跑一次
改一个功能
解释一次设计理由
```

不要让学员一次性读完整套文档后再开始动手。

---

## 三、推荐训练周期

### 方案 A：5 天集中式 Workshop

适合公司内部培训或周末训练营。

| 天数 | 主题 | 核心产出 |
|------|------|----------|
| Day 1 | Agent Loop 基础 | 跑通并解释最小 Agent Loop |
| Day 2 | Tool Call 与错误处理 | 新增一个工具 |
| Day 3 | Streaming、Event、SSE | 看懂前后端消息流 |
| Day 4 | Session、Abort、上下文管理 | 跑通完整 Playground |
| Day 5 | 综合业务改造 | 完成一个业务型 Agent |

### 方案 B：2 周业余学习

适合个人自学。

| 阶段 | 时间 | 目标 |
|------|------|------|
| 第一阶段 | 2 天 | 理解 Agent Loop |
| 第二阶段 | 3 天 | 新增与扩展工具 |
| 第三阶段 | 3 天 | 理解 Streaming 与 SSE |
| 第四阶段 | 2 天 | 理解 Session、Abort、裁剪 |
| 第五阶段 | 4 天 | 完成综合业务 Agent |

---

## 四、Day 1：理解最小 Agent Loop

### 学习目标

理解：

```text
为什么 Agent 不等于一次 LLM 调用
为什么 Tool Result 必须重新回传给模型
为什么 Agent Loop 需要终止条件
```

### 阅读材料

优先阅读：

```text
docs/guide/01-why-agent.md
docs/guide/04-message-flow.md
docs/guide/05-agent-loop.md
examples/01-manual-loop
```

### 实操任务 1：跑通最小示例

执行：

```bash
cd examples/01-manual-loop
npm install
npm run typecheck
npm run start
```

### 实操任务 2：手工画出执行流程

要求学员写出：

```text
用户输入
→ mockLLM
→ toolCall
→ executeTool
→ toolResult
→ mockLLM
→ final answer
```

### 实操任务 3：增加日志

在每一步增加日志：

```text
[UserMessage]
[AssistantMessage]
[ToolCall]
[ToolResult]
[FinalAnswer]
```

### 验收标准

学员能独立回答：

1. 为什么工具执行后不能直接结束？
2. Tool Result 为什么要重新加入 messages？
3. maxTurns 的作用是什么？
4. 什么情况下 Agent Loop 应该停止？

---

## 五、Day 2：工具系统与参数校验

### 学习目标

掌握：

```text
工具定义
参数 Schema
运行时校验
工具异常
模型自纠正
```

### 阅读材料

```text
docs/guide/07-tool-system.md
docs/demos/03-tool-calls.md
playground/backend/src/tools
playground/backend/src/core/agent-loop.ts
```

### 实操任务 1：新增汇率查询工具

增加：

```text
exchange_rate
```

参数：

```ts
{
  from: string
  to: string
  amount: number
}
```

Mock 返回：

```text
100 USD = 720 CNY
```

### 实操任务 2：故意传错参数

测试：

```text
amount = "100"
缺少 from
to = null
```

要求：

- 工具不能执行；
- 返回结构化错误；
- 错误能够进入 Tool Result；
- 模型能够看到错误。

### 实操任务 3：增加工具耗时日志

记录：

```text
toolName
toolCallId
startTime
endTime
duration
success / error
```

### 验收标准

学员能解释：

1. 为什么 LLM 输出不能直接信任？
2. 参数校验应放在工具内部还是统一执行层？
3. Tool Error 为什么不应该直接抛到最外层？
4. 什么情况下应当阻止工具执行？

---

## 六、Day 3：Streaming、Event 与 SSE

### 学习目标

理解前后端如何把 Agent 的执行过程可视化。

### 阅读材料

```text
docs/demos/04-event-ui.md
docs/project/04-backend-api.md
docs/project/05-frontend-chat.md
playground/shared/types.ts
playground/frontend/src/hooks/useAgent.ts
```

### 实操任务 1：观察事件流

启动 Playground：

```bash
cd playground/backend
npm install
npm run dev
```

另开终端：

```bash
cd playground/frontend
npm install
npm run dev
```

在浏览器中输入：

```text
请帮我计算 23 * 19
```

记录事件顺序：

```text
message_start
message_update
message_end
tool_execution_start
tool_execution_end
agent_end
```

### 实操任务 2：增加 Progress Event

增加一个事件：

```ts
{
  type: 'progress'
  message: string
}
```

例如：

```text
正在调用 calculator...
正在整理结果...
```

### 实操任务 3：故意制造错误

模拟：

```text
后端返回 500
SSE 中断
工具执行失败
sessionId 不存在
```

要求前端能展示明确提示。

### 验收标准

学员能解释：

1. 为什么不能只返回最终文本？
2. SSE 和 WebSocket 的区别是什么？
3. messageId 为什么必须稳定？
4. 为什么 decoder 需要流式处理？

---

## 七、Day 4：Session、Abort 与上下文管理

### 学习目标

理解 Agent 从 Demo 到工程项目后，为什么要管理状态和资源。

### 阅读材料

```text
docs/guide/08-session-compaction.md
playground/backend/src/session/session-manager.ts
playground/backend/src/core/agent.ts
playground/backend/src/api/routes.ts
```

### 实操任务 1：验证 Session 隔离

打开两个浏览器窗口。

窗口 A：

```text
我叫张三
```

窗口 B：

```text
我是谁？
```

要求：

```text
窗口 B 不应知道窗口 A 的历史
```

### 实操任务 2：验证 Abort

输入一个会产生较长流式输出的问题，然后主动中止。

观察：

```text
前端停止输出
后端停止继续执行
Agent 状态恢复
```

### 实操任务 3：验证 maxMessages

将：

```text
maxMessages
```

改成较小值，例如：

```text
6
```

进行多轮对话，观察裁剪前后：

```text
messages 数量
保留的完整 turn
是否存在孤立 toolResult
```

### 实操任务 4：验证 reset

测试：

```text
空闲 session reset
不存在 session reset
正在 streaming 的 session reset
```

期望：

```text
空闲 → 200
不存在 → 404
忙碌 → 409
```

### 验收标准

学员能解释：

1. 为什么不能共用 default session？
2. 为什么 reset 不能直接清空状态？
3. AbortController 应该由谁持有？
4. maxMessages 为什么不能简单 slice？
5. 真实生产环境为什么更适合 token budget + compaction？

---

## 八、Day 5：综合业务 Agent

### 推荐项目：金融运营助手

适合金融、券商、基金、托管、运营和 IT 开发背景。

### 业务目标

实现一个能够处理模拟运营任务的 Agent。

### 必备工具

#### 1. 产品信息查询

```text
get_product_info
```

输入：

```ts
{
  productCode: string
}
```

返回：

```text
产品名称
产品类型
风险等级
状态
```

#### 2. 任务查询

```text
list_pending_tasks
```

输入：

```ts
{
  date?: string
  status?: string
}
```

返回：

```text
待处理任务列表
```

#### 3. 异常汇总

```text
summarize_exceptions
```

输入：

```ts
{
  taskIds: string[]
}
```

返回：

```text
异常数量
异常原因
优先级
建议动作
```

#### 4. 模拟通知

```text
create_notification_draft
```

输入：

```ts
{
  recipient: string
  subject: string
  body: string
}
```

返回：

```text
通知草稿
```

### 综合要求

必须包含：

```text
多工具调用
参数校验
Tool Error
SSE
Tool Card
Session
Abort
日志
```

### 验收任务

输入：

```text
请查询今天所有未完成任务，找出异常任务，并生成一份通知运营同事的草稿。
```

预期 Agent：

```text
list_pending_tasks
→ summarize_exceptions
→ create_notification_draft
→ 输出最终汇总
```

---

## 九、阶段性 Checkpoint

### Checkpoint 1：最小闭环

完成条件：

- [ ] 跑通 manual loop
- [ ] 能解释 toolCall / toolResult
- [ ] 能解释 maxTurns
- [ ] 能画出消息流

### Checkpoint 2：工具系统

完成条件：

- [ ] 新增 exchange_rate
- [ ] 参数校验有效
- [ ] 工具错误能回传
- [ ] 模型能根据错误重试

### Checkpoint 3：全栈 Playground

完成条件：

- [ ] 后端启动
- [ ] 前端启动
- [ ] SSE 正常
- [ ] Tool Card 正常
- [ ] Session 隔离正常
- [ ] Abort 正常

### Checkpoint 4：业务 Agent

完成条件：

- [ ] 新增至少 3 个业务工具
- [ ] 支持多工具调用
- [ ] 有错误处理
- [ ] 有日志
- [ ] 能完成业务流程

---

## 十、每章练习题模板

建议后续给每章增加：

### 基础题

用于确认理解。

示例：

```text
给 weather 工具增加默认城市
```

### 进阶题

用于练习工程能力。

示例：

```text
给工具增加 timeout 和 AbortSignal
```

### 挑战题

用于迁移到真实场景。

示例：

```text
实现一个需要两次工具调用的业务流程
```

每题必须有：

```text
输入
预期输出
验收方式
常见错误
```

---

## 十一、培训验收标准

### 学员必须独立完成

```text
1. 手写最小 Agent Loop
2. 新增一个工具
3. 增加参数校验
4. 调试一次 Tool Error
5. 跑通 Playground
6. 解释 SSE 事件
7. 验证 Session 隔离
8. 验证 Abort
9. 完成业务型 Agent
```

### 推荐评分方式

| 维度 | 分值 |
|------|------|
| Agent Loop 理解 | 20 |
| 工具系统 | 20 |
| Streaming / SSE | 15 |
| Session / Abort | 15 |
| 代码质量 | 10 |
| 综合业务 Agent | 20 |

总分：

```text
100
```

建议：

```text
60 分：达到入门要求
80 分：可以独立完成简单 Agent
90 分：具备进一步深入工程实践的能力
```

---

## 十二、推荐后续扩展

当前培训完成后，可以继续扩展：

```text
RAG
MCP
Memory
Compaction
Evaluation
Observability
Approval Workflow
权限控制
工具沙箱
多 Agent 协作
```

但不建议在入门阶段一次性全部加入。

优先顺序：

```text
Agent Loop
→ Tool
→ Streaming
→ Session
→ Abort
→ 业务项目
→ RAG / MCP / Evaluation
```

---

## 十三、最终建议

这套材料已经可以开始正式培训。

后续不要继续把主要时间投入在底层边角优化上，而应优先增加：

```text
每章练习题
阶段性 checkpoint
业务型综合项目
讲师演示脚本
学员验收表
```

最重要的学习闭环是：

```text
读一章
跑一次
改一个功能
解释一次设计理由
完成一个业务项目
```
