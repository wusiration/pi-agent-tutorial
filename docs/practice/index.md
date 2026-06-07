# 练习与实战

> 光看不练，等于白看。这里提供 4 个渐进式练习和 1 个综合小项目，帮你把学到的知识转化为肌肉记忆。

## 练习列表

| 练习 | 主题 | 考察点 | 难度 | 预计时间 |
|------|------|--------|------|---------|
| [练习 1](exercises#练习-1-修复损坏的工具-schema) | 修复损坏的工具 Schema | JSON Schema、TypeBox、参数校验 | ⭐ | 15 分钟 |
| [练习 2](exercises#练习-2-为-mini-agent-cli-添加货币转换工具) | 为 Mini Agent CLI 添加货币转换工具 | 工具定义、异步请求、错误处理 | ⭐⭐ | 30 分钟 |
| [练习 3](exercises#练习-3-在自定义-agent-loop-中实现-maxturns-限制) | 实现 `maxTurns` 限制 | 循环控制、边界条件、状态管理 | ⭐⭐ | 25 分钟 |
| [练习 4](exercises#练习-4-在工具执行中途处理-abort) | 工具执行中途处理 Abort | `AbortSignal`、协作式取消、资源清理 | ⭐⭐⭐ | 40 分钟 |
| [小项目](exercises#mini-project-代码审查-agent) | 代码审查 Agent | 文件读取、多工具协作、结构化输出 | ⭐⭐⭐ | 2-3 小时 |

## 如何使用这些练习

### 方式一：按顺序完成（推荐初学者）

每个练习建立在前一个的基础上，循序渐进：

```
练习 1 → 练习 2 → 练习 3 → 练习 4 → 小项目
```

### 方式二：按需挑选

| 如果你刚学完... | 做哪个练习 |
|----------------|-----------|
| `examples/02-tool-calls` | 练习 1 |
| `examples/03-event-stream` | 练习 2 |
| `examples/04-session-context` | 练习 3 |
| `examples/05-steering-abort` | 练习 4 |
| `examples/06-mini-agent-cli` + `playground/` | 小项目 |

### 方式三：对比学习

先自己尝试实现，再对照参考答案，思考差异：

```
读题 → 独立思考 20 分钟 → 写下你的方案 → 看参考答案 → 对比差异
```

**关键问题**："参考答案为什么要这样设计？我的方案有什么隐患？"

## 准备环境

所有练习都基于 `examples/06-mini-agent-cli` 的代码结构。建议先复制一份：

```bash
cd pi-agent-tutorial
cp -r examples/06-mini-agent-cli examples/06-mini-agent-cli-practice
cd examples/06-mini-agent-cli-practice
npm install
```

## 检查清单

完成每个练习后，用以下清单自评：

- [ ] 代码能编译通过（`npx tsc --noEmit`）
- [ ] 能运行并产生预期输出
- [ ] 能解释每一行关键代码的作用
- [ ] 能说出至少一种"错误输入"和对应的处理

---

## 开始练习

→ [查看详细练习与解答](exercises)
