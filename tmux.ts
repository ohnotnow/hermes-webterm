import { $ } from "bun";

export const SESSION_PREFIX = process.env.TMUX_SESSION_PREFIX ?? "hermes-";
const RUN_CMD = process.env.HERMES_CMD ?? "hermes";
const RUN_ARGS = process.env.HERMES_ARGS ?? "";
const PROFILE_OPT = "@hermes-profile";

export type SessionInfo = {
  name: string;
  created: number;   // unix seconds
  attached: number;  // attached client count
  profile: string;   // empty string when launched via HERMES_CMD
};

export async function listSessions(): Promise<SessionInfo[]> {
  const fmt = `#{session_name}|#{session_created}|#{session_attached}|#{${PROFILE_OPT}}`;
  const result = await $`tmux list-sessions -F ${fmt}`.nothrow().quiet();
  if (result.exitCode !== 0) {
    // exit code 1 with "no server running" / "no sessions" stderr is fine
    return [];
  }
  const out: SessionInfo[] = [];
  for (const line of result.stdout.toString().split("\n")) {
    if (!line.startsWith(SESSION_PREFIX)) continue;
    const [name, created, attached, profile] = line.split("|");
    if (!name) continue;
    out.push({
      name,
      created: Number(created) || 0,
      attached: Number(attached) || 0,
      profile: profile ?? "",
    });
  }
  return out;
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

export type CreateSessionOpts = {
  name?: string;
  profile?: string; // when set, runs `hermes -p <profile>` instead of HERMES_CMD
  shortcut?: { name: string; cmd: string }; // arbitrary command run via `sh -c`
};

export async function createSession(opts: CreateSessionOpts = {}): Promise<SessionInfo> {
  const sessionName = opts.name ?? (await nextAutoName());
  if (!isValidSessionName(sessionName)) {
    throw new Error(`invalid session name: ${sessionName}`);
  }
  if (!sessionName.startsWith(SESSION_PREFIX)) {
    throw new Error(`session name must start with "${SESSION_PREFIX}"`);
  }
  if (await sessionExists(sessionName)) {
    throw new Error(`session already exists: ${sessionName}`);
  }

  // Hide tmux's status bar — we have our own tab strip.
  // Use a detached session so it survives the pty-host child dying.
  // The literal string "hermes" is a sentinel meaning "plain hermes, no -p flag",
  // independent of HERMES_CMD. Anything else is treated as a real profile name.
  if (opts.shortcut) {
    await $`tmux new-session -d -s ${sessionName} sh -c ${opts.shortcut.cmd}`.quiet();
    await $`tmux set-option -t ${sessionName} ${PROFILE_OPT} ${opts.shortcut.name}`.nothrow().quiet();
  } else if (opts.profile === "hermes") {
    await $`tmux new-session -d -s ${sessionName} hermes`.quiet();
    await $`tmux set-option -t ${sessionName} ${PROFILE_OPT} hermes`.nothrow().quiet();
  } else if (opts.profile) {
    await $`tmux new-session -d -s ${sessionName} hermes -p ${opts.profile}`.quiet();
    await $`tmux set-option -t ${sessionName} ${PROFILE_OPT} ${opts.profile}`.nothrow().quiet();
  } else {
    const args = RUN_ARGS.split(" ").filter(Boolean);
    await $`tmux new-session -d -s ${sessionName} ${RUN_CMD} ${args}`.quiet();
  }
  await $`tmux set-option -t ${sessionName} status off`.nothrow().quiet();

  return {
    name: sessionName,
    created: Math.floor(Date.now() / 1000),
    attached: 0,
    profile: opts.shortcut?.name ?? opts.profile ?? "",
  };
}

export async function killSession(name: string): Promise<void> {
  if (!isValidSessionName(name)) throw new Error("invalid session name");
  await $`tmux kill-session -t ${name}`.nothrow().quiet();
}
