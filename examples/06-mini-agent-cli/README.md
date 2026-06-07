# Example: Mini Agent CLI — Interactive Command-Line Agent

This is the **capstone example** that brings together every concept from the previous tutorials into a single, fully interactive CLI application.

## What This Demonstrates

| Concept | Source Example | How It's Used Here |
|---------|---------------|-------------------|
| **Mock LLM with tool support** | `02-tool-calls` | The Agent decides when to call `weather` or `calculator` based on your input. |
| **Event-driven streaming output** | `03-event-stream` | Assistant replies are printed character-by-character for a typing effect. |
| **Session management & history** | `04-session-context` | All messages are stored in a session object that survives across turns. |
| **AbortController for cancellation** | `05-session-manager` | `/abort` immediately cancels an in-flight LLM request or tool execution. |
| **Interactive readline loop** | — new — | A persistent prompt lets you chat with the Agent turn after turn. |

## Interactive Commands

| Command | Description |
|---------|-------------|
| `<normal text>` | Send a message to the Agent. |
| `/reset` | Wipe the current session and start fresh. |
| `/abort` | Cancel the request currently in progress. |
| `/history` | Print the full message history for this session. |
| `/quit` | Exit the CLI. |

## Tools Included

| Tool | Description |
|------|-------------|
| `weather` | Returns random weather data for a given city. |
| `calculator` | Evaluates a simple math expression (`+ - * /`). |

## How to Run

```bash
# Install dependencies
npm install

# Start the interactive CLI
npm start
```

No API key is required — the LLM is mocked so the example is fully self-contained.

## Example Session

```
============================================
  🚀 Mini Agent CLI (Capstone Example)
============================================
> 北京天气怎么样？
🤖 我来查询 北京的天气。
🔧 执行工具: weather({"city":"北京"})
📋 工具结果: 北京：多云，22°C
🤖 根据查询结果：北京：多云，22°C

> /history
=== 消息历史 ===
👤 北京天气怎么样？
🤖 我来查询 北京的天气。
📋 北京：多云，22°C
🤖 根据查询结果：北京：多云，22°C
================

> /quit
👋 Goodbye!
```
