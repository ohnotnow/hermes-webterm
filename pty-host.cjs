// Node-only helper: hosts a single PTY and bridges it to its parent over stdio.
// Stdin: JSON lines, one of:
//   {"t":"i","d":"..."}     input bytes for the PTY
//   {"t":"r","c":80,"r":24} resize
// Stdout: raw bytes from the PTY (no framing).
// Exit code mirrors the child shell's exit code.
//
// Mode is selected by env:
//   TMUX_SESSION=<name>     attach to an existing tmux session
//   (otherwise)             spawn HERMES_CMD directly

const pty = require("node-pty");

const tmuxSession = process.env.TMUX_SESSION || "";
const cmd = tmuxSession ? "tmux" : (process.env.HERMES_CMD || "hermes");
const args = tmuxSession
  ? ["attach-session", "-t", tmuxSession]
  : (process.env.HERMES_ARGS || "").split(" ").filter(Boolean);

const cols = Number(process.env.PTY_COLS || 80);
const rows = Number(process.env.PTY_ROWS || 24);

const env = { ...process.env, TERM: "xterm-256color" };
// don't inherit our own parent tmux's TMUX socket — we want a fresh client
delete env.TMUX;

const proc = pty.spawn(cmd, args, {
  name: "xterm-256color",
  cols,
  rows,
  cwd: process.env.HOME || process.cwd(),
  env,
});

proc.onData((d) => {
  process.stdout.write(d);
});

proc.onExit(({ exitCode }) => {
  process.exit(exitCode == null ? 0 : exitCode);
});

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.t === "i" && typeof msg.d === "string") {
      proc.write(msg.d);
    } else if (msg.t === "r" && typeof msg.c === "number" && typeof msg.r === "number") {
      try { proc.resize(msg.c, msg.r); } catch {}
    }
  }
});

process.stdin.on("end", () => { try { proc.kill(); } catch {} });
process.on("SIGTERM", () => { try { proc.kill(); } catch {} process.exit(0); });
