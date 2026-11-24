import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ask } from "./ask.js";

describe("ask", () => {
  it("answers the typed line", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const answer = ask("Agree? [y/N] ", input, output);
    input.write("y\n");
    expect(await answer).toBe("y");
  });

  // Ctrl-D at the prompt ends the input: that's no answer, so the command goes on to say nothing
  // was recorded, instead of the process leaving with nothing said.
  it("answers nothing when the input ends before a line", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const answer = ask("Agree? [y/N] ", input, output);
    input.end();
    expect(await answer).toBe("");
  });
});
