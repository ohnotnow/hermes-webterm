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
import {
  createSession as createTmuxSession,
  killSession as killTmuxSession,
  listSessions as listTmuxSessions,
  isValidSessionName,
  SESSION_PREFIX,
} from "./tmux";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

type WsData = {
  authed: boolean;
  ip: string;
  pty: PtySession | null;
  cols: number;
  rows: number;
};

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
      return Response.json({ authed: isValidSession(token), prefix: SESSION_PREFIX });
    },

    "/api/sessions": {
      GET: async (req) => {
        const token = getSessionFromCookie(req.headers.get("cookie"));
        if (!isValidSession(token)) return new Response("unauthorized", { status: 401 });
        const sessions = await listTmuxSessions();
        return Response.json({ sessions });
      },
      POST: async (req) => {
        const token = getSessionFromCookie(req.headers.get("cookie"));
        if (!isValidSession(token)) return new Response("unauthorized", { status: 401 });
        let body: { name?: string } = {};
        try { body = await req.json(); } catch {}
        try {
          const info = await createTmuxSession(body.name);
          return Response.json({ session: info });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 });
        }
      },
    },

    "/api/sessions/:name": {
      DELETE: async (req) => {
        const token = getSessionFromCookie(req.headers.get("cookie"));
        if (!isValidSession(token)) return new Response("unauthorized", { status: 401 });
        const name = req.params.name;
        if (!isValidSessionName(name) || !name.startsWith(SESSION_PREFIX)) {
          return Response.json({ error: "invalid name" }, { status: 400 });
        }
        await killTmuxSession(name);
        return new Response(null, { status: 204 });
      },
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
      const ok = srv.upgrade(req, {
        data: { authed: true, ip, pty: null, cols: 80, rows: 24 } as WsData,
      });
      if (ok) return undefined;
      return new Response("upgrade failed", { status: 500 });
    }
    return new Response("not found", { status: 404 });
  },

  websocket: {
    open(_ws) {
      // Wait for the client to attach to a session before doing anything.
    },
    message(ws, raw) {
      if (!ws.data.authed) return;
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      let msg: { t?: string; d?: string; c?: number; r?: number; name?: string };
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
        ws.data.cols = Math.max(1, Math.floor(msg.c));
        ws.data.rows = Math.max(1, Math.floor(msg.r));
        if (ws.data.pty) resizePty(ws.data.pty, ws.data.cols, ws.data.rows);
        return;
      }

      if (msg.t === "attach" && typeof msg.name === "string") {
        const name = msg.name;
        if (!isValidSessionName(name) || !name.startsWith(SESSION_PREFIX)) {
          ws.send(JSON.stringify({ t: "error", message: "invalid session name" }));
          return;
        }
        // silently dispose the previous attach so its exit doesn't trigger a "detached" cascade
        ws.data.pty?.dispose(true);
        ws.data.pty = spawnForSocket(ws, ws.data.cols, ws.data.rows, name);
        ws.send(JSON.stringify({ t: "attached", name }));
        return;
      }
    },
    close(ws) {
      ws.data.pty?.dispose();
      ws.data.pty = null;
    },
  },
});

console.log(`hermes-webterm listening on http://${HOST}:${PORT}`);
