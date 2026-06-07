# 05-steering-abort

This example demonstrates how to **cooperatively cancel** a long-running agent
operation using `AbortController`, and how to **steer** (inject a new message
into) an agent while it is still running.

## Files

| File           | Purpose                              |
|----------------|--------------------------------------|
| `index.ts`     | Main demo (Agent class + 3 scenarios)|
| `package.json` | Dependencies & scripts               |
| `tsconfig.json`| TypeScript configuration             |

## Scenarios

1. **Normal completion** – The agent runs all 5 turns without interruption.
2. **User aborts mid-stream** – An `AbortController` cancels the run after ~1.1 s.
3. **Steering (runtime interrupt)** – A new message is injected into the agent
   while the run is in progress.

## Run

```bash
# With ts-node (no build step)
npx ts-node index.ts

# Or build first and then run
npm run build
node dist/index.js
```

No API key is required.
