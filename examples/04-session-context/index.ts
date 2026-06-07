/**
 * Example: Session Management — Context, History, Trimming & Limits
 *
 * This example demonstrates how to manage conversation state in an agent loop.
 * No API key is needed; we use a mock LLM to simulate responses.
 *
 * Key concepts:
 *   1. Session holds an array of messages (user + assistant turns).
 *   2. Context grows with each turn and must be trimmed to stay within limits.
 *   3. Trimming removes oldest complete turns (never splits a user/assistant pair).
 *   4. maxTurns protects against infinite loops in the agent.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = "system" | "user" | "assistant";

interface Message {
  role: Role;
  content: string;
}

// ---------------------------------------------------------------------------
// Session class
// ---------------------------------------------------------------------------

class Session {
  /** Ordered message history. */
  private messages: Message[] = [];

  /** Add a single message to the end of the history. */
  addMessage(role: Role, content: string): void {
    this.messages.push({ role, content });
  }

  /** Return a shallow copy of the full history. */
  getHistory(): readonly Message[] {
    return [...this.messages];
  }

  /** Clear all messages. */
  reset(): void {
    this.messages = [];
  }

  /**
   * Trim the context so that at most `maxMessages` remain.
   *
   * We always trim in complete "turns" (user + assistant pairs) so that
   * the LLM never sees a dangling user message without a reply, or vice versa.
   * System messages at index 0 are preserved if possible.
   */
  trimContext(maxMessages: number): void {
    if (this.messages.length <= maxMessages) return;

    // If the first message is a system prompt, keep it.
    const hasSystem = this.messages[0]?.role === "system" ? 1 : 0;
    const excess = this.messages.length - maxMessages;

    // Calculate how many non-system messages to drop, rounding up to whole turns.
    const toDrop = Math.ceil(excess / 2) * 2;
    const startIndex = hasSystem + toDrop;

    this.messages = [
      ...(hasSystem ? [this.messages[0]] : []),
      ...this.messages.slice(startIndex),
    ];
  }
}

// ---------------------------------------------------------------------------
// Mock LLM
// ---------------------------------------------------------------------------

/** Simulates an LLM that echoes the last user message. */
function mockLLM(history: readonly Message[]): string {
  const lastUser = history.slice().reverse().find((m) => m.role === "user");
  const topic = lastUser ? lastUser.content : "your request";
  return `Acknowledged: "${topic}"`;
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

/**
 * Runs a mock agent conversation.
 *
 * @param session   The Session instance to use.
 * @param inputs    Array of user messages to feed into the loop.
 * @param maxTurns  Safety cap to prevent infinite loops.
 * @param maxMsgs   Context window limit (triggers trimming when exceeded).
 */
async function runAgentLoop(
  session: Session,
  inputs: string[],
  maxTurns: number,
  maxMsgs: number
): Promise<void> {
  for (let i = 0; i < inputs.length && i < maxTurns; i++) {
    // 1. Add user message.
    session.addMessage("user", inputs[i]);

    // 2. Build context (may have been trimmed previously).
    const context = session.getHistory();

    // 3. Call LLM.
    const reply = mockLLM(context);

    // 4. Add assistant response.
    session.addMessage("assistant", reply);

    // 5. Trim if we exceeded the message budget.
    session.trimContext(maxMsgs);
  }
}

// ---------------------------------------------------------------------------
// Demonstration
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const session = new Session();

  // Set a system prompt that should survive trimming.
  session.addMessage(
    "system",
    "You are a helpful assistant. Keep answers concise."
  );

  // Simulate a long conversation.
  const userInputs = [
    "What is TypeScript?",
    "How do I install it?",
    "Show me a hello-world example.",
    "How do I compile it?",
    "What is tsconfig.json?",
    "Explain strict mode.",
  ];

  console.log("=== Before agent loop ===");
  console.log(`History length: ${session.getHistory().length} message(s)\n`);

  // Run with a tight message limit so trimming kicks in.
  await runAgentLoop(session, userInputs, /* maxTurns */ 10, /* maxMsgs */ 5);

  console.log("=== After agent loop ===");
  console.log(`History length: ${session.getHistory().length} message(s)`);
  console.log("Messages:");
  for (const msg of session.getHistory()) {
    console.log(`  [${msg.role}] ${msg.content}`);
  }

  // Demonstrate reset.
  console.log("\n=== Resetting session ===");
  session.reset();
  console.log(`History length after reset: ${session.getHistory().length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
