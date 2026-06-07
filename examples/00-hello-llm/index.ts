/**
 * 00-hello-llm
 *
 * The simplest possible LLM call: a raw fetch to an OpenAI-compatible chat
 * completions endpoint with streaming enabled.
 *
 * This example exists to show *why* we need an Agent framework later.
 * When you run this, notice what's missing:
 *   - No tool calling
 *   - No conversation memory
 *   - No retry / error handling
 *   - No structured output parsing
 *   - No streaming back-pressure
 *
 * Those gaps are exactly what the Agent framework fills in.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Your OpenAI-compatible API key. Falls back to mock mode if unset. */
const API_KEY = process.env.OPENAI_API_KEY;

/** Endpoint base URL (defaults to OpenAI official endpoint). */
const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

/** Model name to use for the chat completion. */
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// ---------------------------------------------------------------------------
// Mock mode — simulates streaming when no API key is available
// ---------------------------------------------------------------------------

/** Simulates a server-sent event (SSE) stream without hitting a real API. */
async function* mockStream(): AsyncGenerator<string> {
  const words = [
    "Hello!",
    " This",
    " is",
    " a",
    " mock",
    " response",
    " because",
    " no",
    " OPENAI_API_KEY",
    " was",
    " set.",
    "\n\n",
    "Set",
    " the",
    " env",
    " var",
    " to",
    " call",
    " a",
    " real",
    " LLM.",
  ];
  for (const word of words) {
    // Simulate network latency for realism
    await new Promise((r) => setTimeout(r, 80));
    yield word;
  }
}

// ---------------------------------------------------------------------------
// Real API mode — fetch with streaming
// ---------------------------------------------------------------------------

/**
 * Calls the OpenAI chat completions endpoint with streaming and yields
 * decoded text chunks as they arrive.
 */
async function* realStream(): AsyncGenerator<string> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Say hello in one sentence." }],
      stream: true, // <-- enable streaming
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  // The response body is a ReadableStream of server-sent events (SSE).
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Decode the raw bytes into a string, keeping incomplete multi-byte chars.
    buffer += decoder.decode(value, { stream: true });

    // Split into lines; the last element may be an incomplete line.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === "[DONE]") return; // stream finished

      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // Ignore malformed JSON lines (e.g. keep-alive pings)
      }
    }
  }

  // Flush any remaining bytes in the decoder.
  buffer += decoder.decode();

  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data:")) {
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr !== "[DONE]") {
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Ignore malformed JSON lines
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!API_KEY) {
    console.log("[NOTE] OPENAI_API_KEY not set — running in mock mode.\n");
  }

  const stream = API_KEY ? realStream() : mockStream();

  process.stdout.write("LLM: ");
  for await (const token of stream) {
    process.stdout.write(token); // print tokens as they arrive
  }
  process.stdout.write("\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
