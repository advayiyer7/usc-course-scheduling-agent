import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { EXTENSION_ORIGIN } from "../packages/contracts/src/extension.js";

const HOST_NAME = "edu.usc.course_planner";
const CODEX_VERSION = "0.153.4";
const DESCRIPTION = "USC Course Planner companion (managed local pilot)";
const LAUNCHER_MARKER = "# USC Course Planner native launcher v1";

export interface InstallerOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  repositoryRoot?: string;
  nodePath?: string;
  chromeUserDataDir?: string;
  xdgConfigHome?: string;
  uninstall?: boolean;
}
interface LauncherConfig {
  repositoryRoot: string;
  nodePath: string;
}

function absolute(value: string, label: string): string {
  if (!isAbsolute(value) || value.includes("\0"))
    throw new Error(`${label} must be an absolute path.`);
  return resolve(value);
}
function defaultRepository(): string {
  const parent = fileURLToPath(new URL("../", import.meta.url));
  return basename(parent) === "dist" ? dirname(parent) : parent;
}
export function companionPaths(options: InstallerOptions = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux")
    throw new Error(
      "The companion pilot supports macOS and Linux only. Windows is not supported.",
    );
  const home = absolute(options.homeDir ?? homedir(), "Home directory");
  const defaultChrome =
    platform === "darwin"
      ? join(home, "Library", "Application Support", "Google", "Chrome")
      : join(
          absolute(
            options.xdgConfigHome || join(home, ".config"),
            "XDG configuration directory",
          ),
          "google-chrome",
        );
  const chrome = options.chromeUserDataDir
    ? absolute(options.chromeUserDataDir, "Chrome user data directory")
    : defaultChrome;
  const stateDir = join(home, ".usc-course-planner");
  const launcherDir = join(stateDir, "bin");
  const manifestDir = join(chrome, "NativeMessagingHosts");
  // Custom browser registrations must not remove another browser's launcher.
  const suffix =
    chrome === defaultChrome
      ? ""
      : `-${createHash("sha256").update(chrome).digest("hex").slice(0, 16)}`;
  return {
    stateDir,
    launcherDir,
    manifestDir,
    launcher: join(launcherDir, `native-host${suffix}.sh`),
    manifest: join(manifestDir, `${HOST_NAME}.json`),
  };
}
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function launcherText(config: LauncherConfig): string {
  return [
    "#!/bin/sh",
    LAUNCHER_MARKER,
    `# Configuration: ${JSON.stringify(config)}`,
    "set -eu",
    `cd ${shellQuote(config.repositoryRoot)}`,
    `exec ${shellQuote(config.nodePath)} ${shellQuote(join(config.repositoryRoot, "dist", "apps", "companion", "src", "main.js"))} "$@"`,
    "",
  ].join("\n");
}
function ownsLauncher(contents: string): boolean {
  try {
    const lines = contents.split("\n");
    if (
      lines[0] !== "#!/bin/sh" ||
      lines[1] !== LAUNCHER_MARKER ||
      !lines[2]?.startsWith("# Configuration: ")
    )
      return false;
    const config = JSON.parse(
      lines[2].slice("# Configuration: ".length),
    ) as LauncherConfig;
    if (
      typeof config.repositoryRoot !== "string" ||
      typeof config.nodePath !== "string"
    )
      return false;
    const normalized = {
      repositoryRoot: absolute(config.repositoryRoot, "Repository"),
      nodePath: absolute(config.nodePath, "Node"),
    };
    return launcherText(normalized) === contents;
  } catch {
    return false;
  }
}
function manifestValue(launcher: string) {
  return {
    name: HOST_NAME,
    description: DESCRIPTION,
    path: launcher,
    type: "stdio",
    allowed_origins: [`${EXTENSION_ORIGIN}/`],
  };
}
function ownsManifest(contents: string, launcher: string): boolean {
  try {
    const actual = JSON.parse(contents) as Record<string, unknown>;
    const expected = manifestValue(launcher);
    return (
      Object.keys(actual).length === Object.keys(expected).length &&
      Object.entries(expected).every(
        ([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value),
      )
    );
  } catch {
    return false;
  }
}
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
async function existingFile(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new Error(
        `Refusing to modify a linked or non-regular file: ${path}`,
      );
    return await readFile(path, "utf8");
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
async function checkDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(
        `Refusing to use a linked or non-directory location: ${path}`,
      );
  } catch (error) {
    if (!missing(error)) throw error;
  }
}
async function replaceOwned(
  path: string,
  contents: string,
  previous: string | null,
  mode: number,
) {
  // Refuse a file changed since ownership checks, including newly introduced links.
  if ((await existingFile(path)) !== previous)
    throw new Error(`Registration changed during installation: ${path}`);
  if (previous === null) {
    await writeFile(path, contents, { flag: "wx", mode });
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: "wx", mode });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!missing(error)) throw error;
    });
  }
}

export async function installCompanion(options: InstallerOptions = {}) {
  const paths = companionPaths(options);
  // Validate both files before changing either. Uninstall does not require a surviving build/runtime.
  for (const directory of [
    paths.stateDir,
    paths.launcherDir,
    paths.manifestDir,
  ])
    await checkDirectory(directory);
  const previousManifest = await existingFile(paths.manifest);
  const previousLauncher = await existingFile(paths.launcher);
  if (
    previousManifest !== null &&
    !ownsManifest(previousManifest, paths.launcher)
  )
    throw new Error(
      `Refusing to overwrite or remove an unrelated or modified manifest: ${paths.manifest}`,
    );
  if (previousLauncher !== null && !ownsLauncher(previousLauncher))
    throw new Error(
      `Refusing to overwrite or remove an unrelated or modified launcher: ${paths.launcher}`,
    );
  if (options.uninstall) {
    if (previousManifest !== null) await unlink(paths.manifest);
    if (previousLauncher !== null) await unlink(paths.launcher);
    return {
      ...paths,
      action: "uninstalled" as const,
      accountDataRetained: true,
    };
  }
  const config = {
    repositoryRoot: absolute(
      options.repositoryRoot ?? defaultRepository(),
      "Repository directory",
    ),
    nodePath: absolute(options.nodePath ?? process.execPath, "Node executable"),
  };
  const entry = join(
    config.repositoryRoot,
    "dist",
    "apps",
    "companion",
    "src",
    "main.js",
  );
  try {
    await access(config.nodePath, constants.X_OK);
    if (!(await stat(config.nodePath)).isFile())
      throw new Error("Node is not a file");
    await access(entry, constants.R_OK);
    if (!(await stat(entry)).isFile()) throw new Error("Entry is not a file");
    const runtime = JSON.parse(
      await readFile(
        join(
          config.repositoryRoot,
          "node_modules",
          "@openai",
          "codex",
          "package.json",
        ),
        "utf8",
      ),
    ) as { version?: string };
    if (runtime.version !== CODEX_VERSION)
      throw new Error(`Expected @openai/codex ${CODEX_VERSION}`);
  } catch (error) {
    throw new Error(
      `Companion prerequisites are missing or incompatible. Run npm ci and npm run build first. ${error instanceof Error ? error.message : ""}`,
    );
  }
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.launcherDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.manifestDir, { recursive: true, mode: 0o700 });
  await replaceOwned(
    paths.launcher,
    launcherText(config),
    previousLauncher,
    0o700,
  );
  await replaceOwned(
    paths.manifest,
    `${JSON.stringify(manifestValue(paths.launcher), null, 2)}\n`,
    previousManifest,
    0o600,
  );
  return { ...paths, action: "installed" as const, accountDataRetained: true };
}

export function parseInstallerArguments(
  args: string[],
): Pick<InstallerOptions, "uninstall" | "chromeUserDataDir"> {
  const options: Pick<InstallerOptions, "uninstall" | "chromeUserDataDir"> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--uninstall" && !options.uninstall) options.uninstall = true;
    else if (
      arg === "--chrome-user-data-dir" &&
      !options.chromeUserDataDir &&
      args[index + 1]
    )
      options.chromeUserDataDir = absolute(
        args[++index]!,
        "Chrome user data directory",
      );
    else
      throw new Error(
        `Unknown or incomplete argument: ${arg}. Use --uninstall or --chrome-user-data-dir /absolute/path.`,
      );
  }
  return options;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const result = await installCompanion({
      ...parseInstallerArguments(process.argv.slice(2)),
      xdgConfigHome: process.env.XDG_CONFIG_HOME,
    });
    console.log(
      `Companion ${result.action}. Chrome registration: ${result.manifest}`,
    );
    console.log(
      result.action === "installed"
        ? "Reload the extension and open its side panel. Keep this repository and Node installation at their current paths."
        : "Account data and conversation files were retained. Remove the Chrome extension separately if desired.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Companion installation failed.",
    );
    process.exitCode = 1;
  }
}
