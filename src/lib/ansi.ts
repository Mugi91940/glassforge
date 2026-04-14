// Minimal ANSI escape sequence stripper for PTY output.
// Handles CSI (\x1b[...m cursor/color), OSC (\x1b]...BEL), and the
// single-char escapes that claude's pretty output tends to emit.

// eslint-disable-next-line no-control-regex
const CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// eslint-disable-next-line no-control-regex
const SINGLE = /\u001b[@-Z\\-_]/g;

export function stripAnsi(input: string): string {
  return input.replace(CSI, "").replace(OSC, "").replace(SINGLE, "");
}
