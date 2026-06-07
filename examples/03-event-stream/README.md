# 03-event-stream

Demonstrates an **event-driven architecture** where a central `Agent` emits typed lifecycle events and multiple independent subscribers react to them.

## What it shows

- **Observer pattern** — `subscribe(listener)` / `emit(event)`
- **Decoupled subscribers** — logging, statistics, and message history are built by separate listeners that the agent knows nothing about
- **Streaming simulation** — a mock LLM loop emits `message_update` chunks to mimic real-time token streaming
- **Tool execution events** — `tool_execution_start` / `tool_execution_end` wrap fake tool calls

## File structure

```
.
├── index.ts       # Agent class, event types, subscribers, and main demo
├── package.json   # Scripts and dependencies
├── tsconfig.json  # TypeScript configuration
└── README.md      # This file
```

## Running

```bash
npm install
npm start
```

No API key is required — everything is mocked.
