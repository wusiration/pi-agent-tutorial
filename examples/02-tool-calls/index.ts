/**
 * Example 02: Tool Calls — Schema, Validation & Parallel Execution
 *
 * This file walks through the complete tool-calling lifecycle:
 *   1. Define tool schemas (JSON Schema) so the LLM knows what each tool expects.
 *   2. Mock an LLM that decides which tools to call based on user input.
 *   3. Validate every tool call against its schema before execution.
 *   4. Execute all validated calls in parallel with Promise.all.
 *   5. Print the final results.
 *
 * No API key needed — the LLM is mocked for a fully local, reproducible demo.
 */

import { Type, type Static, type TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// =============================================================================
// 1. TOOL SCHEMA DEFINITIONS (JSON Schema via TypeBox)
// =============================================================================
// Each tool is described by:
//   - name:        The identifier the LLM uses to request this tool.
//   - description: Human-readable explanation; the LLM reads this to decide
//                  when to invoke the tool.
//   - parameters:  A JSON Schema object describing the expected arguments.
//
// In real integrations (OpenAI, Anthropic, Gemini) you serialize these schemas
// into the "tools" or "functions" array of the chat-completion request.

const WeatherSchema = Type.Object(
  {
    city: Type.String({ description: "City name, e.g. 'Beijing'" }),
    unit: Type.Optional(
      Type.Union([Type.Literal("celsius"), Type.Literal("fahrenheit")], {
        description: "Temperature unit",
      })
    ),
  },
  { additionalProperties: false }
);

const CalculateSchema = Type.Object(
  {
    expression: Type.String({
      description: "Math expression with two numbers, e.g. '12 / 4'",
    }),
  },
  { additionalProperties: false }
);

const SearchSchema = Type.Object(
  {
    query: Type.String({ description: "Search keywords" }),
    limit: Type.Optional(
      Type.Number({
        description: "Max number of results (1-10)",
        minimum: 1,
        maximum: 10,
      })
    ),
  },
  { additionalProperties: false }
);

// Aggregate every tool into a registry so we can look them up by name later.
interface ToolDefinition {
  name: string;
  description: string;
  parameters: TObject; // generic schema placeholder
  execute: (args: unknown) => Promise<unknown>;
}

// =============================================================================
// 2. TOOL IMPLEMENTATIONS (the actual work each tool performs)
// =============================================================================
// These are plain async functions. In a production agent they might hit
// external APIs, query databases, or run code. Here we mock the results.

async function getWeather(args: Static<typeof WeatherSchema>) {
  const unit = args.unit ?? "celsius";
  const temp = unit === "celsius" ? 26 : 79;
  return {
    city: args.city,
    temperature: temp,
    unit,
    condition: "sunny",
    source: "mock-weather-api",
  };
}

async function calculate(args: Static<typeof CalculateSchema>) {
  // WARNING: eval is used here for demo simplicity only.
  // In production, use a proper math parser (e.g. mathjs) or sandbox.
  const result = eval(args.expression);
  return { expression: args.expression, result, source: "mock-calculator" };
}

async function searchWeb(args: Static<typeof SearchSchema>) {
  const limit = args.limit ?? 3;
  const snippets = Array.from({ length: limit }, (_, i) => ({
    title: `Result ${i + 1} for "${args.query}"`,
    url: `https://example.com/search?q=${encodeURIComponent(args.query)}&page=${i + 1}`,
    snippet: `This is a mock search snippet #${i + 1} related to ${args.query}.`,
  }));
  return { query: args.query, results: snippets, source: "mock-search-engine" };
}

// Build the registry that wires schemas to implementations.
const TOOLS: ToolDefinition[] = [
  {
    name: "get_weather",
    description: "Get the current weather for a specific city.",
    parameters: WeatherSchema,
    execute: (args) => getWeather(args as Static<typeof WeatherSchema>),
  },
  {
    name: "calculate",
    description: "Evaluate a simple mathematical expression with two numbers.",
    parameters: CalculateSchema,
    execute: (args) => calculate(args as Static<typeof CalculateSchema>),
  },
  {
    name: "search_web",
    description: "Search the web for a given query and return result snippets.",
    parameters: SearchSchema,
    execute: (args) => searchWeb(args as Static<typeof SearchSchema>),
  },
];

// =============================================================================
// 3. MOCK LLM — simulates what a real chat-completion API returns
// =============================================================================
// A real LLM receives the tool schemas and the user message, then decides
// whether to respond with text or with one (or many) "tool_calls".
// We mimic that behavior with simple keyword matching.

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

function mockLLM(userInput: string): { toolCalls: ToolCall[] } {
  const input = userInput.toLowerCase();
  const calls: ToolCall[] = [];

  // The LLM can decide to call MULTIPLE tools in a single turn.
  // This is common when a question contains several independent sub-tasks.

  if (input.includes("weather") || input.includes("temperature")) {
    // Extract a naive city guess from the input.
    const cityMatch = userInput.match(/in\s+([A-Za-z\s]+)/);
    const city = cityMatch ? cityMatch[1].trim() : "Beijing";
    calls.push({
      id: `call_${calls.length + 1}`,
      name: "get_weather",
      arguments: { city, unit: "celsius" },
    });
  }

  if (input.includes("calculate") || /\d+\s*[-+*/]\s*\d+/.test(userInput)) {
    const exprMatch = userInput.match(/(\d+\s*[-+*/]\s*\d+)/);
    const expression = exprMatch ? exprMatch[1] : "1 + 1";
    calls.push({
      id: `call_${calls.length + 1}`,
      name: "calculate",
      arguments: { expression },
    });
  }

  if (input.includes("search") || input.includes("find")) {
    const queryMatch = userInput.match(/(?:search|find)\s+(.+)/i);
    const query = queryMatch ? queryMatch[1].trim() : userInput;
    calls.push({
      id: `call_${calls.length + 1}`,
      name: "search_web",
      arguments: { query, limit: 2 },
    });
  }

  // If no keyword matched, still return a default search so the demo runs.
  if (calls.length === 0) {
    calls.push({
      id: "call_1",
      name: "search_web",
      arguments: { query: userInput, limit: 2 },
    });
  }

  return { toolCalls: calls };
}

// =============================================================================
// 4. VALIDATION LAYER — reject malformed tool calls before execution
// =============================================================================
// Real APIs can hallucinate parameter names, forget required fields, or send
// wrong types. We validate every call against its JSON Schema and surface
// clear errors instead of letting them crash downstream code.

function validateToolCall(call: ToolCall): {
  ok: true; args: unknown;
} | {
  ok: false; error: string;
} {
  const tool = TOOLS.find((t) => t.name === call.name);
  if (!tool) {
    return { ok: false, error: `Unknown tool "${call.name}".` };
  }

  const errors = [...Value.Errors(tool.parameters, call.arguments)];
  if (errors.length > 0) {
    const messages = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    return {
      ok: false,
      error: `Validation failed for "${call.name}": ${messages}`,
    };
  }

  return { ok: true, args: call.arguments };
}

// =============================================================================
// 5. PARALLEL EXECUTION — run all validated tools concurrently
// =============================================================================
// Promise.all fires every tool at the same time. This is safe when the tools
// are independent (no shared state, no ordering requirements). If ordering
// matters, use sequential execution or a dependency graph instead.

async function executeToolCalls(toolCalls: ToolCall[]) {
  // Validate everything first so we fail fast.
  const validated = toolCalls.map((call) => ({
    call,
    validation: validateToolCall(call),
  }));

  // Build an array of promises — one per valid call.
  const promises = validated.map(async ({ call, validation }) => {
    if (!validation.ok) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        status: "error" as const,
        result: validation.error,
      };
    }

    const tool = TOOLS.find((t) => t.name === call.name)!;
    try {
      const result = await tool.execute(validation.args);
      return {
        toolCallId: call.id,
        toolName: call.name,
        status: "success" as const,
        result,
      };
    } catch (err) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        status: "error" as const,
        result: String(err),
      };
    }
  });

  // Execute all promises in parallel and wait for every one to settle.
  return Promise.all(promises);
}

// =============================================================================
// 6. MAIN DEMO — wire everything together
// =============================================================================

async function main() {
  // You can swap this string to see different tool-calling behavior.
  const userInput =
    "What's the weather in Shanghai? Also calculate 15 * 8 and search for TypeScript tips.";

  console.log("=".repeat(60));
  console.log("User input:", userInput);
  console.log("=".repeat(60));

  // Step A: LLM decides which tools to call.
  const { toolCalls } = mockLLM(userInput);
  console.log("\n[LLM] Decided to call the following tools:");
  for (const tc of toolCalls) {
    console.log(`  • ${tc.name} (id=${tc.id})`);
    console.log(`    args: ${JSON.stringify(tc.arguments)}`);
  }

  // Step B: Validate + execute in parallel.
  const results = await executeToolCalls(toolCalls);

  // Step C: Print results.
  console.log("\n[Results]");
  for (const r of results) {
    console.log(`\n  Tool: ${r.toolName} (${r.status})`);
    console.log(`  Data: ${JSON.stringify(r.result, null, 2)}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Demo complete!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
