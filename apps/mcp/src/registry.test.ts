import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// server.json is this server's entry in the official MCP Registry. The registry accepts it only
// when the npm package at the stated version carries the same name in `mcpName`, so the two files
// move together: bump the version in all three places at once.
const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")) as Record<string, unknown>;
const pkg = read("package.json") as { name: string; version: string; mcpName: string; repository: { url: string; directory: string } };
const server = read("server.json") as {
  $schema: string;
  name: string;
  description: string;
  version: string;
  repository: { url: string; source: string; subfolder: string };
  packages: { registryType: string; registryBaseUrl: string; identifier: string; version: string; transport: { type: string } }[];
};

describe("the MCP Registry entry", () => {
  it("names the package's mcpName, in the registry's name form", () => {
    expect(server.name).toBe(pkg.mcpName);
    // reverse-DNS namespace, one slash, then the server's name (the registry's schema)
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  });

  it("points at this package and version on npm", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toEqual([expect.objectContaining({ registryType: "npm", registryBaseUrl: "https://registry.npmjs.org", identifier: pkg.name, version: pkg.version, transport: { type: "stdio" } })]);
  });

  it("points at the package's own source", () => {
    expect(server.repository).toEqual({ url: pkg.repository.url, source: "github", subfolder: pkg.repository.directory });
  });

  it("stays within the registry's limits", () => {
    expect(server.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });
});
