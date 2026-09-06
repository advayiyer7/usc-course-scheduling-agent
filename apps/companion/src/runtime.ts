import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { CODEX_VERSION } from "../../../packages/contracts/src/companion.js";
import { AppServerRpc } from "./rpc.js";

export const disabledFeatures = [
  "shell_tool",
  "unified_exec",
  "apply_patch_freeform",
  "js_repl",
  "code_mode",
  "code_mode_only",
  "multi_agent",
  "collab",
  "apps",
  "connectors",
  "plugins",
  "remote_plugin",
  "recommended_plugins",
  "hooks",
  "codex_hooks",
  "plugin_hooks",
  "browser_use",
  "computer_use",
  "in_app_browser",
  "image_generation",
  "view_image",
  "memories",
  "memory_tool",
  "skill_search",
  "skill_mcp_dependency_install",
  "request_permissions",
  "request_permissions_tool",
  "external_agent_memory_import",
  "external_migration",
  "goals",
];
export async function startRuntime(profile: string, signal?: AbortSignal) {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("@openai/codex/package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  if (pkg.version !== CODEX_VERSION)
    throw new Error(
      "Unsupported Codex runtime version. Run npm ci to restore the pinned version.",
    );
  const workspace = join(profile, "workspace"),
    codexHome = join(profile, "codex");
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  // This app-owned profile has no imported user config, MCP servers, skills or API keys.
  // Codex alone owns authentication files here. Never read or copy auth.json.
  await writeFile(
    join(codexHome, "config.toml"),
    [
      'forced_login_method = "chatgpt"',
      'web_search = "disabled"',
      'approval_policy = "on-request"',
      'sandbox_mode = "read-only"',
      "project_doc_max_bytes = 0",
      "include_environment_context = false",
      "[analytics]",
      "enabled = false",
      "[features]",
      ...disabledFeatures.map((f) => `${f} = false`),
      "skip_host_skill_discovery = true",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  const env: NodeJS.ProcessEnv = { CODEX_HOME: codexHome };
  for (const key of [
    "HOME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SystemRoot",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (process.env[key]) env[key] = process.env[key];
  const child = spawn(
    process.execPath,
    [
      join(dirname(packagePath), "bin/codex.js"),
      "app-server",
      "--strict-config",
      "--listen",
      "stdio://",
    ],
    { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, signal },
  );
  const rpc = new AppServerRpc(child);
  try {
    await rpc.initialize();
  } catch (e) {
    rpc.close();
    throw e;
  }
  return { rpc, workspace };
}
