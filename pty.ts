import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";

const HOST_SCRIPT = join(import.meta.dir, "pty-host.cjs");

export type PtySession = {
  child: ChildProcess;
  sessionName: string;
  dispose: (silent?: boolean) => void;
};

export function spawnForSocket(
  ws: ServerWebSocket<unknown>,
  cols: number,
  rows: number,
  tmuxSessionName: string,
): PtySession {
  const child = spawn("node", [HOST_SCRIPT], {
    env: {
      ...process.env,
      PTY_COLS: String(cols),
      PTY_ROWS: String(rows),
      TMUX_SESSION: tmuxSessionName,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });

  let disposed = false;
  let silent = false;

  child.stdout!.on("data", (chunk: Buffer) => {
    if (!silent && ws.readyState === 1) ws.send(chunk);
  });

  child.on("exit", (code) => {
    // suppress notification when the dispose was intentional (e.g. switching tabs)
    if (silent) return;
    if (ws.readyState === 1) {
      const display = code == null ? "?" : code;
      ws.send(JSON.stringify({ t: "detached", name: tmuxSessionName, code: display }));
    }
  });

  child.on("error", (err) => {
    if (!silent && ws.readyState === 1) {
      ws.send(`\r\n\x1b[31m[failed to spawn pty host: ${err.message}]\x1b[0m\r\n`);
    }
  });

  return {
    child,
    sessionName: tmuxSessionName,
    dispose: (silentMode = false) => {
      if (disposed) return;
      disposed = true;
      if (silentMode) silent = true;
      try { child.kill(); } catch {}
    },
  };
}

export function writeToPty(session: PtySession, data: string): void {
  session.child.stdin?.write(JSON.stringify({ t: "i", d: data }) + "\n");
}

export function resizePty(session: PtySession, cols: number, rows: number): void {
  session.child.stdin?.write(JSON.stringify({ t: "r", c: cols, r: rows }) + "\n");
}
