# hermes-webterm

A small web terminal for accessing the `hermes` CLI (or any command) from a browser on your LAN.

- **Server**: Bun (HTTP, WebSocket, frontend bundling)
- **Frontend**: xterm.js with a 4-digit PIN login
- **PTY**: a tiny Node child process per session (Node hosts `node-pty`; Bun handles everything else)

## Setup

```bash
bun install
cp .env.example .env
# edit .env — at minimum set HERMES_PIN
```

`.env` keys:

| key | default | purpose |
| --- | --- | --- |
| `HERMES_PIN` | _(required, 4 digits)_ | PIN required to log in |
| `HERMES_CMD` | `hermes` | command to spawn in the PTY |
| `HERMES_ARGS` | _(empty)_ | space-separated args |
| `HOST` | `0.0.0.0` | bind address |
| `PORT` | `3000` | listen port |

## Run

```bash
bun run dev     # with hot reload
bun run start   # plain
```

Then open `http://<lan-ip>:3000/` from any device on your LAN, enter the PIN, and you're in.

## Auth

- 4-digit PIN, kept in `.env` (not committed).
- Sessions are random 32-byte tokens stored in memory; cookie is `HttpOnly`, `SameSite=Strict`, 24h.
- Rate limit: 5 wrong PINs per IP triggers a 30s lockout.
- Sessions are wiped on server restart — that's fine, just log in again.

## Files

| | |
| --- | --- |
| `server.ts` | Bun.serve — routes, WebSocket, cookie gate |
| `auth.ts` | PIN check, session map, rate limiter |
| `pty.ts` | Spawns one `pty-host.cjs` per WebSocket and bridges I/O |
| `pty-host.cjs` | Node helper that hosts `node-pty` (Bun + node-pty don't play nicely yet) |
| `login.html` / `login.ts` | PIN entry page |
| `terminal.html` / `terminal.ts` | xterm.js page with mobile toolbar |

## Notes

- The Node child per session is the workaround for a Bun + `node-pty` incompatibility (the PTY exits with SIGHUP under Bun). Each session = one short-lived `node` process. Cheap enough on a Pi.
- Closing the browser tab kills the child process and the underlying `hermes` (or whatever you spawned).
- Mobile toolbar provides `esc`, `tab`, arrows, sticky `ctrl`, `^C`, `^D`, and `paste`.
