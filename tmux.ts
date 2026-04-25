import { $ } from "bun";

export const SESSION_PREFIX = process.env.TMUX_SESSION_PREFIX ?? "hermes-";
const RUN_CMD = process.env.HERMES_CMD ?? "hermes";
const RUN_ARGS = process.env.HERMES_ARGS ?? "";

export type SessionInfo = {
  name: string;
  created: number;   // unix seconds
  attached: number;  // attached client count
};

export async function listSessions(): Promise<SessionInfo[]> {
  const fmt = "#{session_name}|#{session_created}|#{session_attached}";
  const result = await $`tmux list-sessions -F ${fmt}`.nothrow().quiet();
  if (result.exitCode !== 0) {
    // exit code 1 with "no server running" / "no sessions" stderr is fine
    return [];
  }
  return result.stdout
    .toString()
    .split("\n")
    .filter((l) => l.startsWith(SESSION_PREFIX))
    .map((line) => {
      const [name, created, attached] = line.split("|");
      return {
        name,
        created: Number(created) || 0,
        attached: Number(attached) || 0,
      };
    });
}

export async function sessionExists(name: string): Promise<boolean> {
  const r = await $`tmux has-session -t ${name}`.nothrow().quiet();
  return r.exitCode === 0;
}

export function isValidSessionName(name: string): boolean {
  // tmux disallows ".", ":" and whitespace; we additionally lock to alnum + dash + underscore
  return /^[A-Za-z0-9_-]+$/.test(name) && name.length > 0 && name.length <= 64;
}

export async function nextAutoName(): Promise<string> {
  const sessions = await listSessions();
  const used = new Set(sessions.map((s) => s.name));
  for (let i = 1; i < 1000; i++) {
    const candidate = `${SESSION_PREFIX}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("could not allocate a session name");
}

export async function createSession(name?: string): Promise<SessionInfo> {
  const sessionName = name ?? (await nextAutoName());
  if (!isValidSessionName(sessionName)) {
    throw new Error(`invalid session name: ${sessionName}`);
  }
  if (!sessionName.startsWith(SESSION_PREFIX)) {
    throw new Error(`session name must start with "${SESSION_PREFIX}"`);
  }
  if (await sessionExists(sessionName)) {
    throw new Error(`session already exists: ${sessionName}`);
  }

  const args = RUN_ARGS.split(" ").filter(Boolean);
  // Hide tmux's status bar — we have our own tab strip.
  // Use a detached session so it survives the pty-host child dying.
  await $`tmux new-session -d -s ${sessionName} ${RUN_CMD} ${args}`.quiet();
  await $`tmux set-option -t ${sessionName} status off`.nothrow().quiet();

  return {
    name: sessionName,
    created: Math.floor(Date.now() / 1000),
    attached: 0,
  };
}

export async function killSession(name: string): Promise<void> {
  if (!isValidSessionName(name)) throw new Error("invalid session name");
  await $`tmux kill-session -t ${name}`.nothrow().quiet();
}
