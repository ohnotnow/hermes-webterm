import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";

const HOST_SCRIPT = join(import.meta.dir, "pty-host.cjs");

export type PtySession = {
  child: ChildProcess;
  dispose: () => void;
};

export function spawnForSocket(ws: ServerWebSocket<unknown>, cols: number, rows: number): PtySession {
  const child = spawn("node", [HOST_SCRIPT], {
    env: {
      ...process.env,
      PTY_COLS: String(cols),
      PTY_ROWS: String(rows),
    },
    stdio: ["pipe", "pipe", "inherit"],
  });

  child.stdout!.on("data", (chunk: Buffer) => {
    if (ws.readyState === 1) ws.send(chunk);
  });

  child.on("exit", (code) => {
    if (ws.readyState === 1) {
      const display = code == null ? "?" : code;
      ws.send(`\r\n\x1b[33m[process exited with code ${display}]\x1b[0m\r\n`);
      ws.close(1000, "process-exit");
    }
  });

  child.on("error", (err) => {
    if (ws.readyState === 1) {
      ws.send(`\r\n\x1b[31m[failed to spawn pty host: ${err.message}]\x1b[0m\r\n`);
      ws.close(1011, "spawn-error");
    }
  });

  let disposed = false;
  return {
    child,
    dispose: () => {
      if (disposed) return;
      disposed = true;
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
