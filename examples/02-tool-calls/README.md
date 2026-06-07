# Example: Tool Calls — Schema, Validation & Parallel Execution

This example demonstrates the core mechanics of **LLM tool calling** without needing an external API key. Everything runs locally with a mock LLM.

## What This Demonstrates

1. **Tool Schema Definition** — Each tool declares its name, description, and parameters using JSON Schema (via TypeBox). This is exactly what you send to OpenAI / Anthropic / Gemini so the model knows what tools are available.
2. **Parameter Validation** — Before executing a tool, we validate that the arguments match the schema (required fields, correct types, enum constraints). Invalid calls are caught early and reported cleanly.
3. **Parallel Execution** — When the LLM returns multiple tool calls in one turn, we execute them concurrently with `Promise.all` and collect the results.
4. **End-to-End Flow** — See the full loop: `user input → LLM decides tools → validate arguments → execute in parallel → return results`.

## Tools Included

| Tool | Description |
|------|-------------|
| `get_weather` | Returns weather for a city with optional unit (celsius / fahrenheit). |
| `calculate` | Evaluates a simple math expression (add, subtract, multiply, divide). |
| `search_web` | Mock web search returning snippets for a query. |

## How to Run

```bash
# Install dependencies
npm install

# Run the example
npx tsx index.ts
```

No API key is required — the LLM is mocked so the example is fully self-contained.
