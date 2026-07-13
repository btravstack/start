// Integration: the WHOLE worker against a real Temporal dev server (testcontainers, the
// `temporalio/temporal` CLI image running `server start-dev`). The REAL @temporalio Worker is
// created exactly as `worker.ts` does — demesne-built activity registry, ApplicationFailure
// adapter, bundled deterministic workflow — and a real Client executes `orderWorkflow` through
// the server:
//   • a valid charge   → the workflow returns the receipt produced by the demesne-wired activity
//   • an over-limit    → PaymentDeclined → non-retryable ApplicationFailure → workflow FAILS
//     immediately (no retry storm), surfacing the domain reason
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { Layer } from "demesne";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityRegistry } from "@btravstack/start-temporal";
import { bootstrap } from "./bootstrap.js";
import { ConfigLive } from "./config.js";
import type { ChargeCommand, Receipt } from "./domain.js";
import { toApplicationFailures } from "./infra/temporal.js";
import { PaymentsLive } from "./infra/payments.js";
import { workflowsPath } from "./workflows-path.js";

type OrderWorkflow = (command: ChargeCommand) => Promise<Receipt>;

let container: StartedTestContainer;
let address = "";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  process.env["LOG_LEVEL"] = "warn";
  process.env["CHARGE_LIMIT"] = "1000";
  container = await new GenericContainer("temporalio/temporal:latest")
    .withCommand(["server", "start-dev", "--ip", "0.0.0.0", "--port", "7233"])
    .withExposedPorts(7233)
    .start();
  address = `${container.getHost()}:${container.getMappedPort(7233)}`;
});

afterAll(async () => {
  await container.stop();
});

// The dev server accepts TCP before the frontend service is fully up — retry the first connect.
const connectWithRetry = async (): Promise<NativeConnection> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await NativeConnection.connect({ address });
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(`temporal dev server never became ready: ${String(lastError)}`);
};

describe("start-temporal-worker (real Worker + workflow vs real Temporal)", () => {
  it("executes the workflow through the demesne-wired activity, and fails a declined charge without retrying", async () => {
    // The exact graph worker.ts assembles.
    const built = await Layer.build(Layer.provideTo(bootstrap(PaymentsLive), ConfigLive));
    const registry = built.match({
      ok: (ctx) => ctx.get(ActivityRegistry),
      err: (error) => {
        throw new Error(`config error: ${error._tag}`);
      },
      defect: (cause) => {
        throw cause;
      },
    });

    const connection = await connectWithRetry();
    const worker = await Worker.create({
      connection,
      namespace: "default",
      taskQueue: "orders",
      activities: toApplicationFailures(registry.activities),
      workflowsPath: workflowsPath(import.meta.url),
    });
    const workerRun = worker.run();

    const clientConnection = await Connection.connect({ address });
    const client = new Client({ connection: clientConnection, namespace: "default" });

    try {
      // 1. a valid charge round-trips: client → server → worker → activity → receipt
      const receipt = await client.workflow.execute<OrderWorkflow>("orderWorkflow", {
        taskQueue: "orders",
        workflowId: "wf-integration-ok",
        args: [{ orderId: "o1", amount: 100 }],
      });
      expect(receipt).toEqual({ receiptId: "rcpt_1" });

      // 2. over the limit → non-retryable ApplicationFailure → the WORKFLOW fails right away
      //    (retry policy allows 5 attempts; non-retryable must short-circuit them)
      let failure: unknown;
      try {
        await client.workflow.execute<OrderWorkflow>("orderWorkflow", {
          taskQueue: "orders",
          workflowId: "wf-integration-declined",
          args: [{ orderId: "o2", amount: 99_999 }],
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeDefined();
      // The chain is WorkflowFailedError → ActivityFailure → ApplicationFailure("over limit");
      // walk it rather than depending on the exact nesting depth.
      const messages: string[] = [];
      for (
        let cause = failure as { readonly message?: string; readonly cause?: unknown } | undefined;
        cause !== undefined && cause !== null;
        cause = cause.cause as { readonly message?: string; readonly cause?: unknown } | undefined
      ) {
        if (typeof cause.message === "string") messages.push(cause.message);
      }
      expect(messages.join(" | ")).toContain("over limit");
    } finally {
      worker.shutdown();
      await workerRun;
      await clientConnection.close();
      await connection.close();
    }
  });
});
