/**
 * 05-steering-abort
 *
 * Demonstrates:
 *   1. AbortController / AbortSignal for cooperative cancellation
 *   2. Steering: injecting a new user message while the agent is running
 *   3. Proper cleanup when an operation is aborted mid-stream
 */

// ---------------------------------------------------------------------------
// Agent class
// ---------------------------------------------------------------------------

interface AgentConfig {
  /** An optional AbortSignal that the caller can use to cancel the run. */
  signal?: AbortSignal;
}

interface TurnResult {
  turn: number;
  content: string;
}

class Agent {
  private messages: string[] = [];

  constructor(private config: AgentConfig = {}) {}

  /**
   * Simulate a long-running operation consisting of `totalTurns` steps.
   * Each step waits `delayMs` milliseconds and then "produces" a chunk of
   * output.  The method checks `signal.aborted` before every turn so that
   * it can stop early when the caller requests cancellation.
   */
  async run(totalTurns = 5, delayMs = 500): Promise<TurnResult[]> {
    const results: TurnResult[] = [];
    const { signal } = this.config;

    for (let turn = 1; turn <= totalTurns; turn++) {
      // Cooperative cancellation point #1: before the async work.
      if (signal?.aborted) {
        console.log(`  [Agent] Aborted before turn ${turn}`);
        throw new Error(`Aborted: ${signal.reason ?? "user request"}`);
      }

      // Simulate async work (e.g. an LLM streaming chunk).
      await sleep(delayMs);

      // Cooperative cancellation point #2: after the async work.
      if (signal?.aborted) {
        console.log(`  [Agent] Aborted after turn ${turn}`);
        throw new Error(`Aborted: ${signal.reason ?? "user request"}`);
      }

      const content = `Turn ${turn} output`;
      results.push({ turn, content });
      console.log(`  [Agent] ${content}`);
    }

    return results;
  }

  /** Push a new user message into the conversation (steering). */
  steer(message: string): void {
    this.messages.push(message);
    console.log(`  [Agent] Steered with message: "${message}"`);
  }

  getHistory(): readonly string[] {
    return this.messages;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Scenario A – Normal completion (no abort)
// ---------------------------------------------------------------------------

async function scenarioNormal(): Promise<void> {
  console.log("\n=== Scenario A: Normal completion ===");
  const agent = new Agent();
  const results = await agent.run(5, 500);
  console.log(`  Completed with ${results.length} turns.`);
}

// ---------------------------------------------------------------------------
// Scenario B – User aborts mid-stream
// ---------------------------------------------------------------------------

async function scenarioAbort(): Promise<void> {
  console.log("\n=== Scenario B: User aborts mid-stream ===");
  const controller = new AbortController();
  const agent = new Agent({ signal: controller.signal });

  // Abort after 1.1 s (somewhere inside the second turn).
  const abortTimer = setTimeout(() => {
    console.log("  [User] Calling controller.abort()…");
    controller.abort("User clicked stop");
  }, 1100);

  try {
    await agent.run(5, 500);
  } catch (err: any) {
    console.log(`  Caught: ${err.message}`);
  } finally {
    clearTimeout(abortTimer);
    console.log("  Cleanup finished (timer cleared).");
  }
}

// ---------------------------------------------------------------------------
// Scenario C – Steering: inject a message while running
// ---------------------------------------------------------------------------

async function scenarioSteering(): Promise<void> {
  console.log("\n=== Scenario C: Steering (runtime interrupt) ===");
  const controller = new AbortController();
  const agent = new Agent({ signal: controller.signal });

  // Start the long-running work.
  const runPromise = agent.run(5, 500);

  // After 800 ms (mid first turn / early second turn), steer the agent.
  const steerTimer = setTimeout(() => {
    console.log("  [User] Injecting steering message…");
    agent.steer("Please focus on security topics.");
    // In a real implementation you might also re-trigger generation here.
  }, 800);

  // Wait for the run to finish (or be aborted).
  try {
    const results = await runPromise;
    console.log(`  Completed with ${results.length} turns.`);
  } catch (err: any) {
    console.log(`  Caught: ${err.message}`);
  } finally {
    clearTimeout(steerTimer);
    console.log(`  History after steering: ${JSON.stringify(agent.getHistory())}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await scenarioNormal();
  await scenarioAbort();
  await scenarioSteering();
  console.log("\nAll scenarios finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
