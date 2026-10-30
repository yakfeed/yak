import { createInterface } from "node:readline";

/**
 * Reads a line without echoing it (for tokens). The question is written once; every later write
 * readline makes (the typed characters, and the redraws after a backspace or an arrow key, which
 * start with the question and carry the text so far) is dropped.
 */
export function readSecret(question: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    output.write(question);
    rl.question("", (answer) => {
      rl.close();
      output.write("\n");
      resolve(answer);
    });
  });
}
