import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readSecret } from "./secret.js";

describe("readSecret", () => {
  it("writes only the question, even when the line is edited", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk: Buffer) => (shown += chunk.toString()));
    const answer = readSecret("API token (yf_…): ", input, output);
    // Typed, then a backspace and the left and right arrows (each redraws the line), then Enter.
    input.write("yf_secretx");
    input.write("\x7f");
    input.write("\x1b[D");
    input.write("\x1b[C");
    input.write("\r");
    expect(await answer).toBe("yf_secret");
    expect(shown).toContain("API token (yf_…): ");
    expect(shown).not.toMatch(/yf_s|secret/);
  });
});
