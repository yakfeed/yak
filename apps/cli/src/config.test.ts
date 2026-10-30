import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileConfigStore, writeAtomically } from "./config.js";

describe("fileConfigStore", () => {
  const dirs: string[] = [];
  const configFile = (saved: object) => {
    const dir = mkdtempSync(join(tmpdir(), "yak-config-"));
    dirs.push(dir);
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify(saved));
    return path;
  };
  const onDisk = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const saved = { apiUrl: "https://api.example", token: "yf_saved", agents: { bot: { privateKey: "k" } }, activeAgent: "bot" };

  it("applies YAK_* overrides on load but never writes them into the file", () => {
    const path = configFile(saved);
    const store = fileConfigStore(path, { YAK_API_URL: "http://localhost:9", YAK_TOKEN: "yf_env" });
    const config = store.load();
    expect(config).toMatchObject({ apiUrl: "http://localhost:9", token: "yf_env" });
    expect(config.activeAgent).toBeUndefined();
    store.save({ ...config, agents: { ...config.agents, other: { privateKey: "k2" } } });
    expect(onDisk(path)).toEqual({ ...saved, agents: { bot: { privateKey: "k" }, other: { privateKey: "k2" } } });
  });

  it("keeps YAK_AGENT out of the file too", () => {
    const path = configFile({ ...saved, agents: { ...saved.agents, other: { privateKey: "k2" } } });
    const store = fileConfigStore(path, { YAK_AGENT: "a/other" });
    const config = store.load();
    expect(config.activeAgent).toBe("other");
    store.save(config);
    expect(onDisk(path).activeAgent).toBe("bot");
  });

  it("writes in one step: no temporary file left, permissions kept, a new file only for you (review of agent keys)", () => {
    const path = configFile(saved);
    chmodSync(path, 0o600);
    const store = fileConfigStore(path, {});
    store.save({ ...store.load(), token: "yf_new" });
    expect(onDisk(path).token).toBe("yf_new");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dirname(path))).toEqual(["config.json"]);
    // A file someone made readable by others is narrowed to its owner.
    chmodSync(path, 0o644);
    store.save(store.load());
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // A brand-new config is 0600 too.
    const fresh = join(dirname(path), "sub", "config.json");
    fileConfigStore(fresh, {}).save({ apiUrl: "https://api.example", token: "yf_x" });
    expect(statSync(fresh).mode & 0o777).toBe(0o600);
  });

  it("keeps a symlinked config a symlink, writing through to the file it points at", () => {
    const path = configFile(saved);
    const link = join(dirname(path), "link.json");
    symlinkSync(path, link);
    const store = fileConfigStore(link, {});
    store.save({ ...store.load(), token: "yf_linked" });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(onDisk(path).token).toBe("yf_linked");
  });

  it("leaves the old file whole when the write fails", () => {
    const path = configFile(saved);
    expect(() => writeAtomically(join(dirname(path), "missing-dir", "config.json"), "{}")).toThrow();
    expect(onDisk(path)).toEqual(saved);
    expect(readdirSync(dirname(path))).toEqual(["config.json"]);
  });

  it("saves a field a command changed, even with an override set", () => {
    const path = configFile(saved);
    const store = fileConfigStore(path, { YAK_TOKEN: "yf_env" });
    store.save({ ...store.load(), token: "yf_new" });
    expect(onDisk(path).token).toBe("yf_new");
  });
});
