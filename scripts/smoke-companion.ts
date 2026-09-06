import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startRuntime } from "../apps/companion/src/runtime.js";
import { disabledFeatures } from "../apps/companion/src/runtime.js";

// Real protocol test, with a temporary unauthenticated profile; no model request.
const profile = await mkdtemp(join(tmpdir(), "usc-codex-smoke-"));
let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;
try {
  runtime = await startRuntime(profile);
  const result = (await runtime.rpc.request("account/read", {
    refreshToken: false,
  })) as { account: unknown };
  assert.equal(result.account, null);
  const config = (await runtime.rpc.request("config/read", {
    includeLayers: false,
  })) as { config: { features: Record<string, unknown> } };
  for (const feature of disabledFeatures)
    assert.equal(config.config.features[feature], false, feature);
  const thread = (await runtime.rpc.request("thread/start", {
    cwd: runtime.workspace,
    environments: [],
    runtimeWorkspaceRoots: [],
    selectedCapabilityRoots: [],
    ephemeral: true,
    sandbox: "read-only",
    approvalPolicy: "on-request",
    dynamicTools: [
      {
        type: "function",
        name: "list_terms",
        description: "List ingested USC terms",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  })) as { thread: { id: string } };
  assert.ok(thread.thread.id);
  console.log(
    "PASS: pinned Codex initialized; account is signed out; restricted configuration and dynamic-tool thread accepted. No login or inference performed.",
  );
} finally {
  runtime?.rpc.close();
  // Wait for the child to release its temporary profile before removal.
  await new Promise((resolve) => setTimeout(resolve, 200));
  await rm(profile, { recursive: true, force: true });
}
