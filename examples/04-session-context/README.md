# Example: Session Management — Context, History, Trimming & Limits

This example demonstrates how to manage conversation state in an agent loop without needing an external API key. Everything runs locally with a mock LLM.

## What This Demonstrates

1. **Session Storage** — A `Session` class holds an ordered array of messages (system, user, assistant).
2. **Context Growth** — With every turn the history grows; LLMs have finite context windows.
3. **Trimming by Whole Turns** — When the history exceeds a message limit, oldest *complete* turns are removed. We never split a user/assistant pair, so the LLM always sees coherent context.
4. **System Prompt Preservation** — If a system message exists at index 0, it is kept even during trimming.
5. **maxTurns Protection** — The agent loop caps the number of iterations to prevent runaway execution.
6. **Reset** — The session can be wiped clean to start a fresh conversation.

## How to Run

```bash
# Install dependencies
npm install

# Run the example
npx tsx index.ts
```

No API key is required — the LLM is mocked so the example is fully self-contained.
