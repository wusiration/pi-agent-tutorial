# 00-hello-llm

The simplest possible example: call an OpenAI-compatible API and stream the response to the console.

## What This Demonstrates

- **Raw LLM streaming** with `fetch` and `TextDecoder`
- **Mock mode** that works without an API key
- **Why we need an Agent framework** — this script has no tools, no memory, no retries, no structured output, and no back-pressure handling

## How to Run

### Mock mode (no API key needed)

```bash
npm install
npm start
```

### Real API mode

```bash
export OPENAI_API_KEY="sk-..."
# optionally:
# export OPENAI_BASE_URL="https://api.openai.com/v1"
# export OPENAI_MODEL="gpt-4o-mini"

npm start
```

## Key Takeaways

1. **Streaming feels instant** — tokens appear as they are generated rather than waiting for the full response.
2. **Boilerplate adds up quickly** — parsing SSE chunks, decoding JSON, handling errors, and managing state become tedious in real applications.
3. **An Agent framework abstracts this away** — so you can focus on logic instead of plumbing.
