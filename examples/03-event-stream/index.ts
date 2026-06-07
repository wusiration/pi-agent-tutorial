/**
 * 03-event-stream
 *
 * Demonstrates an event-driven architecture where a central Agent emits typed
 * events during its lifecycle and multiple independent subscribers react to
 * those events without the agent knowing they exist.
 *
 * Key concepts:
 * - Observer pattern (publish / subscribe)
 * - Decoupled subscribers (logging, stats, history)
 * - Streaming simulation via incremental events
 */

// ---------------------------------------------------------------------------
// Event type definitions
// ---------------------------------------------------------------------------

/** Base shape shared by every event. */
interface BaseAgentEvent {
  type: string;
  timestamp: number;
}

/** Fired once when the agent begins processing a user request. */
interface AgentStartEvent extends BaseAgentEvent {
  type: "agent_start";
}

/** Fired at the beginning of each reasoning / generation turn. */
interface TurnStartEvent extends BaseAgentEvent {
  type: "turn_start";
  turn: number;
}

/** Fired when the LLM starts emitting a new message (text or tool call). */
interface MessageStartEvent extends BaseAgentEvent {
  type: "message_start";
  role: "assistant";
}

/** Fired for every chunk of streamed content. */
interface MessageUpdateEvent extends BaseAgentEvent {
  type: "message_update";
  chunk: string;
}

/** Fired when the full message has been assembled. */
interface MessageEndEvent extends BaseAgentEvent {
  type: "message_end";
  content: string;
}

/** Fired just before a tool is invoked. */
interface ToolExecutionStartEvent extends BaseAgentEvent {
  type: "tool_execution_start";
  tool: string;
  input: Record<string, unknown>;
}

/** Fired after a tool finishes and returns a result. */
interface ToolExecutionEndEvent extends BaseAgentEvent {
  type: "tool_execution_end";
  tool: string;
  output: string;
}

/** Fired when a turn completes (after any tool results have been consumed). */
interface TurnEndEvent extends BaseAgentEvent {
  type: "turn_end";
  turn: number;
}

/** Fired once when the agent finishes the entire request. */
interface AgentEndEvent extends BaseAgentEvent {
  type: "agent_end";
}

/** Discriminated union of all possible agent events. */
type AgentEvent =
  | AgentStartEvent
  | TurnStartEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionEndEvent
  | TurnEndEvent
  | AgentEndEvent;

// ---------------------------------------------------------------------------
// Agent implementation (the "publisher")
// ---------------------------------------------------------------------------

type Listener = (event: AgentEvent) => void;

class Agent {
  private listeners: Listener[] = [];

  /** Register a listener. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Emit an event to every subscriber. */
  emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      // Catch errors so one broken subscriber doesn't break the others.
      try {
        listener(event);
      } catch (err) {
        console.error("Subscriber error:", err);
      }
    }
  }

  /**
   * Simulate a multi-turn conversation with streaming and tool use.
   * No real LLM is called — everything is mocked via events.
   */
  async prompt(userMessage: string): Promise<void> {
    this.emit({ type: "agent_start", timestamp: Date.now() });

    // Turn 1: simple text response with fake streaming
    this.emit({ type: "turn_start", turn: 1, timestamp: Date.now() });
    this.emit({ type: "message_start", role: "assistant", timestamp: Date.now() });

    const textChunks = ["Hello! ", "You asked: ", `"${userMessage}". `, "Let me think..."];
    let fullText = "";
    for (const chunk of textChunks) {
      await sleep(150);
      fullText += chunk;
      this.emit({ type: "message_update", chunk, timestamp: Date.now() });
    }
    this.emit({ type: "message_end", content: fullText, timestamp: Date.now() });
    this.emit({ type: "turn_end", turn: 1, timestamp: Date.now() });

    // Turn 2: tool call simulation
    this.emit({ type: "turn_start", turn: 2, timestamp: Date.now() });
    this.emit({
      type: "tool_execution_start",
      tool: "calculator",
      input: { expression: "2 + 2" },
      timestamp: Date.now(),
    });
    await sleep(300);
    this.emit({
      type: "tool_execution_end",
      tool: "calculator",
      output: "4",
      timestamp: Date.now(),
    });

    // Turn 2: assistant message after tool result
    this.emit({ type: "message_start", role: "assistant", timestamp: Date.now() });
    const finalChunks = ["The result is ", "4."];
    let finalText = "";
    for (const chunk of finalChunks) {
      await sleep(150);
      finalText += chunk;
      this.emit({ type: "message_update", chunk, timestamp: Date.now() });
    }
    this.emit({ type: "message_end", content: finalText, timestamp: Date.now() });
    this.emit({ type: "turn_end", turn: 2, timestamp: Date.now() });

    this.emit({ type: "agent_end", timestamp: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function color(type: string): string {
  const map: Record<string, string> = {
    agent_start: "\x1b[32m", // green
    turn_start: "\x1b[36m", // cyan
    message_start: "\x1b[33m", // yellow
    message_update: "\x1b[90m", // gray
    message_end: "\x1b[33m", // yellow
    tool_execution_start: "\x1b[35m", // magenta
    tool_execution_end: "\x1b[35m", // magenta
    turn_end: "\x1b[36m", // cyan
    agent_end: "\x1b[32m", // green
  };
  return map[type] ?? "\x1b[0m";
}

function reset(): string {
  return "\x1b[0m";
}

// ---------------------------------------------------------------------------
// Subscribers (the "observers")
// ---------------------------------------------------------------------------

/** Subscriber 1: pretty-print every event to the console. */
const loggerSubscriber: Listener = (event) => {
  const c = color(event.type);
  const r = reset();
  switch (event.type) {
    case "agent_start":
      console.log(`${c}[AGENT START]${r}`);
      break;
    case "turn_start":
      console.log(`${c}[TURN START] turn=${event.turn}${r}`);
      break;
    case "message_start":
      console.log(`${c}[MESSAGE START] role=${event.role}${r}`);
      break;
    case "message_update":
      process.stdout.write(`${c}${event.chunk}${r}`);
      break;
    case "message_end":
      console.log(`\n${c}[MESSAGE END] length=${event.content.length}${r}`);
      break;
    case "tool_execution_start":
      console.log(`${c}[TOOL START] ${event.tool}(${JSON.stringify(event.input)})${r}`);
      break;
    case "tool_execution_end":
      console.log(`${c}[TOOL END] ${event.tool} => ${event.output}${r}`);
      break;
    case "turn_end":
      console.log(`${c}[TURN END] turn=${event.turn}${r}`);
      break;
    case "agent_end":
      console.log(`${c}[AGENT END]${r}`);
      break;
  }
};

/** Subscriber 2: maintain running statistics. */
const stats = { turns: 0, toolsUsed: 0, messages: 0 };
const statsSubscriber: Listener = (event) => {
  switch (event.type) {
    case "turn_start":
      stats.turns += 1;
      break;
    case "message_end":
      stats.messages += 1;
      break;
    case "tool_execution_start":
      stats.toolsUsed += 1;
      break;
  }
};

/** Subscriber 3: build a message history array. */
const history: Array<{ role: string; content: string }> = [];
const historySubscriber: Listener = (event) => {
  if (event.type === "message_end") {
    history.push({ role: "assistant", content: event.content });
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const agent = new Agent();

  // Wire up subscribers — the agent has no knowledge of what they do.
  const unsubLogger = agent.subscribe(loggerSubscriber);
  const unsubStats = agent.subscribe(statsSubscriber);
  const unsubHistory = agent.subscribe(historySubscriber);

  console.log("=== Running agent ===\n");
  await agent.prompt("What is 2 + 2?");

  console.log("\n=== Results ===");
  console.log("Stats:", stats);
  console.log("History:", history);

  // Demonstrate unsubscribe: remove the logger so a second run is quieter.
  unsubLogger();
  console.log("\n=== Running agent again (logger unsubscribed) ===");
  await agent.prompt("Tell me a joke.");
  console.log("\nFinal Stats:", stats);
}

main().catch(console.error);
