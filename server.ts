import login from "./login.html";
import terminal from "./terminal.html";
import {
  checkPin,
  clearFails,
  createSession,
  destroySession,
  getSessionFromCookie,
  isLockedOut,
  isValidSession,
  recordFail,
  SESSION_COOKIE_ATTRS,
} from "./auth";
import { resizePty, spawnForSocket, writeToPty, type PtySession } from "./pty";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

type WsData = { authed: boolean; ip: string; pty: PtySession | null };

function clientIp(req: Request, server: { requestIP: (r: Request) => { address: string } | null }): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return server.requestIP(req)?.address ?? "unknown";
}

const server = Bun.serve<WsData, {}>({
  port: PORT,
  hostname: HOST,
  development: { hmr: false, console: true },

  routes: {
    "/": login,
    "/terminal": terminal,

    "/api/me": (req) => {
      const token = getSessionFromCookie(req.headers.get("cookie"));
      return Response.json({ authed: isValidSession(token) });
    },

    "/login": {
      POST: async (req) => {
        const ip = clientIp(req, server);
        const lockMs = isLockedOut(ip);
        if (lockMs > 0) {
          return Response.json({ error: "locked", retryAfterMs: lockMs }, { status: 429 });
        }

        let pin = "";
        try {
          const body = await req.json();
          pin = String(body?.pin ?? "");
        } catch {
          return Response.json({ error: "bad request" }, { status: 400 });
        }

        if (!checkPin(pin)) {
          recordFail(ip);
          return Response.json({ error: "wrong pin" }, { status: 401 });
        }

        clearFails(ip);
        const token = createSession();
        return new Response(null, {
          status: 204,
          headers: { "Set-Cookie": `session=${token}; ${SESSION_COOKIE_ATTRS}` },
        });
      },
    },

    "/logout": {
      POST: (req) => {
        const token = getSessionFromCookie(req.headers.get("cookie"));
        destroySession(token);
        return new Response(null, {
          status: 204,
          headers: { "Set-Cookie": `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` },
        });
      },
    },
  },

  fetch(req, srv) {
    if (new URL(req.url).pathname === "/ws") {
      const token = getSessionFromCookie(req.headers.get("cookie"));
      if (!isValidSession(token)) {
        return new Response("unauthorized", { status: 401 });
      }
      const ip = clientIp(req, srv);
      const ok = srv.upgrade(req, { data: { authed: true, ip, pty: null } as WsData });
      if (ok) return undefined;
      return new Response("upgrade failed", { status: 500 });
    }
    return new Response("not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      // PTY spawned on first resize message (so we know the right size)
      ws.send("\x1b[2J\x1b[H");
    },
    message(ws, raw) {
      if (!ws.data.authed) return;
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      let msg: { t?: string; d?: string; c?: number; r?: number };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.t === "i" && typeof msg.d === "string") {
        if (ws.data.pty) writeToPty(ws.data.pty, msg.d);
        return;
      }
      if (msg.t === "r" && typeof msg.c === "number" && typeof msg.r === "number") {
        const cols = Math.max(1, Math.floor(msg.c));
        const rows = Math.max(1, Math.floor(msg.r));
        if (!ws.data.pty) {
          ws.data.pty = spawnForSocket(ws, cols, rows);
        } else {
          resizePty(ws.data.pty, cols, rows);
        }
      }
    },
    close(ws) {
      ws.data.pty?.dispose();
      ws.data.pty = null;
    },
  },
});

console.log(`hermes-webterm listening on http://${HOST}:${PORT}`);
