import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  companionPaths,
  installCompanion,
  parseInstallerArguments,
  type InstallerOptions,
} from "../scripts/install-companion.js";

const run = promisify(execFile);
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function put(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "usc-companion-installer-"));
  temporaryDirectories.push(directory);
  const repositoryRoot = join(
    directory,
    "student's course repo $HOME `false` $(false)\nsecond line",
  );
  const homeDir = join(directory, "student's home with spaces");
  const nodePath = join(directory, "node's binary $HOME `false` $(false)");
  await symlink(process.execPath, nodePath);
  const entry = join(
    repositoryRoot,
    "dist",
    "apps",
    "companion",
    "src",
    "main.js",
  );
  await put(join(repositoryRoot, "package.json"), '{"type":"module"}');
  await put(
    entry,
    "process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));",
  );
  const runtime = join(
    repositoryRoot,
    "node_modules",
    "@openai",
    "codex",
    "package.json",
  );
  await put(runtime, '{"version":"0.153.4"}');
  const options: InstallerOptions = {
    homeDir,
    repositoryRoot,
    nodePath,
    platform: "darwin",
  };
  return { directory, options, entry, runtime, paths: companionPaths(options) };
}

describe("companion installer", () => {
  it("uses per-user Chrome locations and supports explicit Chrome user data roots", () => {
    const homeDir = "/temporary-student-home";
    expect(companionPaths({ homeDir, platform: "darwin" }).manifest).toBe(
      `${homeDir}/Library/Application Support/Google/Chrome/NativeMessagingHosts/edu.usc.course_planner.json`,
    );
    expect(companionPaths({ homeDir, platform: "linux" }).manifest).toBe(
      `${homeDir}/.config/google-chrome/NativeMessagingHosts/edu.usc.course_planner.json`,
    );
    expect(
      companionPaths({
        homeDir,
        platform: "linux",
        xdgConfigHome: "/temporary-xdg",
      }).manifest,
    ).toBe(
      "/temporary-xdg/google-chrome/NativeMessagingHosts/edu.usc.course_planner.json",
    );
    expect(
      companionPaths({
        homeDir,
        platform: "darwin",
        chromeUserDataDir: "/temporary-chrome-for-testing",
      }).manifest,
    ).toBe(
      "/temporary-chrome-for-testing/NativeMessagingHosts/edu.usc.course_planner.json",
    );
    expect(() => companionPaths({ homeDir, platform: "win32" })).toThrow(
      "Windows is not supported",
    );
    expect(() =>
      companionPaths({ homeDir, platform: "linux", xdgConfigHome: "relative" }),
    ).toThrow("absolute path");
  });

  it.each(["darwin", "linux"] as const)(
    "installs and executes an argv-safe launcher for %s",
    async (platform) => {
      const f = await fixture();
      const result = await installCompanion({ ...f.options, platform });
      expect(JSON.parse(await readFile(result.manifest, "utf8"))).toEqual({
        name: "edu.usc.course_planner",
        description: "USC Course Planner companion (managed local pilot)",
        path: result.launcher,
        type: "stdio",
        allowed_origins: [
          "chrome-extension://hcihcmbmpmfdihdgejlclbaegnhgjhdk/",
        ],
      });
      expect((await stat(result.launcher)).mode & 0o777).toBe(0o700);
      expect((await stat(result.manifest)).mode & 0o777).toBe(0o600);
      const args = [
        "chrome-extension://hcihcmbmpmfdihdgejlclbaegnhgjhdk/",
        "quote ' \" $HOME $(false) `false`",
        "",
        "one\ntwo",
      ];
      const launched = await run(result.launcher, args, {
        cwd: f.directory,
        env: { PATH: "/usr/bin:/bin" },
      });
      expect(launched.stderr).toBe("");
      expect(JSON.parse(launched.stdout)).toEqual({
        args,
        cwd: await realpath(f.options.repositoryRoot!),
      });
    },
  );

  it("is repeatable, repairs owned file permissions, and can point an owned install at a new checkout", async () => {
    const first = await fixture();
    const other = await fixture();
    const installed = await installCompanion(first.options);
    const original = await readFile(installed.launcher, "utf8");
    await chmod(installed.launcher, 0o600);
    await installCompanion(first.options);
    expect(await readFile(installed.launcher, "utf8")).toBe(original);
    expect((await stat(installed.launcher)).mode & 0o777).toBe(0o700);
    await installCompanion({
      ...first.options,
      repositoryRoot: other.options.repositoryRoot,
    });
    const launched = await run(installed.launcher, []);
    expect(JSON.parse(launched.stdout).cwd).toBe(
      await realpath(other.options.repositoryRoot!),
    );
  });

  it("uninstalls only its registration and launcher, keeping account data and unrelated files", async () => {
    const f = await fixture();
    await installCompanion(f.options);
    const profile = join(f.paths.stateDir, "codex", "auth.json");
    const unrelated = join(f.paths.launcherDir, "other-file.txt");
    await put(profile, '{"synthetic_test_account":"keep"}');
    await put(unrelated, "keep this file");
    await rm(f.options.repositoryRoot!, { recursive: true });
    const result = await installCompanion({ ...f.options, uninstall: true });
    expect(result.action).toBe("uninstalled");
    await expect(lstat(f.paths.manifest)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(f.paths.launcher)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(profile, "utf8")).toBe(
      '{"synthetic_test_account":"keep"}',
    );
    expect(await readFile(unrelated, "utf8")).toBe("keep this file");
    await expect(
      installCompanion({ ...f.options, uninstall: true }),
    ).resolves.toMatchObject({ action: "uninstalled" });
  });

  it.each(["manifest", "launcher"] as const)(
    "refuses an unrelated %s before writing either file",
    async (target) => {
      const f = await fixture();
      await put(f.paths[target], "unrelated file");
      await expect(installCompanion(f.options)).rejects.toThrow(
        "unrelated or modified",
      );
      await expect(
        installCompanion({ ...f.options, uninstall: true }),
      ).rejects.toThrow("unrelated or modified");
      expect(await readFile(f.paths[target], "utf8")).toBe("unrelated file");
      const other = target === "manifest" ? "launcher" : "manifest";
      await expect(lstat(f.paths[other])).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.each(["manifest", "launcher"] as const)(
    "refuses a modified owned %s during reinstall or uninstall",
    async (target) => {
      const f = await fixture();
      await installCompanion(f.options);
      const other = target === "manifest" ? "launcher" : "manifest";
      const otherOriginal = await readFile(f.paths[other], "utf8");
      const original = await readFile(f.paths[target], "utf8");
      const changed =
        target === "launcher"
          ? `${original}echo modified\n`
          : JSON.stringify({
              ...JSON.parse(original),
              allowed_origins: ["chrome-extension://different-extension/"],
            });
      await writeFile(f.paths[target], changed);
      await expect(installCompanion(f.options)).rejects.toThrow(
        "unrelated or modified",
      );
      await expect(
        installCompanion({ ...f.options, uninstall: true }),
      ).rejects.toThrow("unrelated or modified");
      expect(await readFile(f.paths[target], "utf8")).toBe(changed);
      expect(await readFile(f.paths[other], "utf8")).toBe(otherOriginal);
    },
  );

  it.each(["manifest", "launcher"] as const)(
    "refuses a symbolic-link %s and preserves its target",
    async (target) => {
      const f = await fixture();
      const unrelated = join(f.directory, "unrelated-target");
      await put(unrelated, "unrelated");
      await mkdir(dirname(f.paths[target]), { recursive: true });
      await symlink(unrelated, f.paths[target]);
      await expect(installCompanion(f.options)).rejects.toThrow(
        "linked or non-regular",
      );
      await expect(
        installCompanion({ ...f.options, uninstall: true }),
      ).rejects.toThrow("linked or non-regular");
      expect((await lstat(f.paths[target])).isSymbolicLink()).toBe(true);
      expect(await readFile(unrelated, "utf8")).toBe("unrelated");
    },
  );

  it("refuses a linked companion state directory", async () => {
    const f = await fixture();
    const target = join(f.directory, "other-state");
    await mkdir(target);
    await mkdir(f.options.homeDir!, { recursive: true });
    await symlink(target, f.paths.stateDir);
    await expect(installCompanion(f.options)).rejects.toThrow(
      "linked or non-directory",
    );
    await expect(lstat(f.paths.manifest)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each(["entry", "version", "node"] as const)(
    "checks %s prerequisites before creating a registration",
    async (failure) => {
      const f = await fixture();
      if (failure === "entry") await rm(f.entry);
      if (failure === "version")
        await writeFile(f.runtime, '{"version":"0.1.0"}');
      if (failure === "node")
        f.options.nodePath = join(f.directory, "missing-node");
      await expect(installCompanion(f.options)).rejects.toThrow(
        "npm ci and npm run build",
      );
      await expect(lstat(f.paths.manifest)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(lstat(f.paths.launcher)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("rejects unsupported platforms before changing any files", async () => {
    const f = await fixture();
    await expect(
      installCompanion({ ...f.options, platform: "win32" }),
    ).rejects.toThrow("Windows is not supported");
    await expect(lstat(f.paths.stateDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps the default Chrome connection when a custom browser registration is removed", async () => {
    const f = await fixture();
    const defaultInstall = await installCompanion(f.options);
    const customOptions = {
      ...f.options,
      chromeUserDataDir: join(f.directory, "Chrome for Testing"),
    };
    const customInstall = await installCompanion(customOptions);
    expect(customInstall.launcher).not.toBe(defaultInstall.launcher);
    await installCompanion({ ...customOptions, uninstall: true });
    expect((await stat(defaultInstall.manifest)).isFile()).toBe(true);
    expect((await stat(defaultInstall.launcher)).isFile()).toBe(true);
    await expect(lstat(customInstall.launcher)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("validates CLI arguments without interpreting shell content", () => {
    expect(
      parseInstallerArguments([
        "--uninstall",
        "--chrome-user-data-dir",
        "/tmp/student's chrome $(false)",
      ]),
    ).toEqual({
      uninstall: true,
      chromeUserDataDir: "/tmp/student's chrome $(false)",
    });
    for (const args of [
      ["--force"],
      ["--uninstall", "--uninstall"],
      ["--chrome-user-data-dir"],
      ["--chrome-user-data-dir", "relative"],
    ])
      expect(() => parseInstallerArguments(args)).toThrow();
  });
});
