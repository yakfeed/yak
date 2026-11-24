import { createInterface } from "node:readline";

/** Asks at the terminal. The input ending first (Ctrl-D) answers nothing, so the caller still says what happened. */
export function ask(question: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    rl.on("close", () => resolve(""));
    rl.question(question, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
}
