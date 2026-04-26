import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const termEl = document.getElementById("term") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const toolbar = document.getElementById("toolbar") as HTMLDivElement;
const ctrlBtn = document.getElementById("btn-ctrl") as HTMLButtonElement;
const pasteBtn = document.getElementById("btn-paste") as HTMLButtonElement;
const tabsEl = document.getElementById("tabs") as HTMLDivElement;
const tabAddGroup = document.getElementById("tab-add-group") as HTMLDivElement;
const tabAddBtn = document.getElementById("tab-add") as HTMLButtonElement;
const tabAddProfile = document.getElementById("tab-add-profile") as HTMLSelectElement;

const term = new Terminal({
  cursorBlink: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 14,
  theme: {
    background: "#0d1117",
    foreground: "#c9d1d9",
    cursor: "#58a6ff",
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
  },
});

const fit = new FitAddon();
term.loadAddon(fit);
term.open(termEl);
fit.fit();

type SessionInfo = { name: string; created: number; attached: number; profile?: string };

let ws: WebSocket | null = null;
let ctrlSticky = false;
let sessions: SessionInfo[] = [];
let activeSession: string | null = null;
let switching = false;

const LAST_SESSION_KEY = "hermes-webterm:lastSession";

function setStatus(text: string, cls: "" | "connected" | "disconnected") {
  statusEl.textContent = text;
  statusEl.classList.remove("connected", "disconnected");
  if (cls) statusEl.classList.add(cls);
}

function send(obj: object) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function sendInput(data: string) {
  send({ t: "i", d: data });
}

function sendResize() {
  send({ t: "r", c: term.cols, r: term.rows });
}

function renderTabs() {
  // Remove existing tab buttons (keep #tab-add)
  Array.from(tabsEl.querySelectorAll(".tab")).forEach((el) => el.remove());

  const sorted = [...sessions].sort((a, b) => a.created - b.created);
  for (const s of sorted) {
    const tab = document.createElement("button");
    tab.className = "tab" + (s.name === activeSession ? " active" : "");
    tab.dataset.name = s.name;
    tab.title = s.name;

    const label = document.createElement("span");
    const num = s.name.replace(/^hermes-/, "");
    label.textContent = s.profile ? `${num} · ${s.profile}` : num;
    tab.appendChild(label);

    const x = document.createElement("span");
    x.className = "x";
    x.dataset.kill = s.name;
    x.textContent = "×";
    x.title = `kill ${s.name}`;
    tab.appendChild(x);

    tabsEl.insertBefore(tab, tabAddGroup);
  }
}

async function fetchSessions(): Promise<SessionInfo[]> {
  try {
    const r = await fetch("/api/sessions");
    if (!r.ok) return [];
    const data = await r.json();
    return data.sessions ?? [];
  } catch {
    return [];
  }
}

async function refreshSessions() {
  sessions = await fetchSessions();
  renderTabs();
}

async function createNewSession(profile?: string): Promise<string | null> {
  tabAddBtn.disabled = true;
  tabAddProfile.disabled = true;
  try {
    const payload: { profile?: string } = {};
    if (profile) payload.profile = profile;
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.session?.name ?? null;
  } catch {
    return null;
  } finally {
    tabAddBtn.disabled = false;
    tabAddProfile.disabled = false;
  }
}

async function refreshProfiles() {
  let list: string[] = [];
  try {
    const r = await fetch("/api/profiles");
    if (r.ok) {
      const data = await r.json();
      list = Array.isArray(data.profiles) ? data.profiles : [];
    }
  } catch {}

  const placeholder = tabAddProfile.querySelector("option[disabled]") as HTMLOptionElement | null;
  tabAddProfile.innerHTML = "";
  if (placeholder) tabAddProfile.appendChild(placeholder);
  for (const p of list) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    tabAddProfile.appendChild(opt);
  }
  if (placeholder) placeholder.selected = true;
}

async function killSessionOnServer(name: string) {
  try {
    await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
  } catch {
    // best-effort
  }
}

function attach(name: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (name === activeSession) return; // no-op
  switching = true;
  send({ t: "attach", name });
}

function pickInitialSession(list: SessionInfo[]): string | null {
  if (list.length === 0) return null;
  const remembered = localStorage.getItem(LAST_SESSION_KEY);
  if (remembered && list.some((s) => s.name === remembered)) return remembered;
  // most recently created
  return [...list].sort((a, b) => b.created - a.created)[0]?.name ?? null;
}

async function initOnConnect() {
  await Promise.all([refreshSessions(), refreshProfiles()]);
  if (sessions.length === 0) {
    const created = await createNewSession();
    if (created) await refreshSessions();
  }
  const target = pickInitialSession(sessions);
  if (target) {
    attach(target);
  } else {
    setStatus("no sessions — tap + to create one", "disconnected");
  }
}

tabAddProfile.addEventListener("change", async () => {
  const profile = tabAddProfile.value;
  // Reset the visible label back to "⌄" immediately so the picker is reusable.
  const placeholder = tabAddProfile.querySelector("option[disabled]") as HTMLOptionElement | null;
  if (placeholder) placeholder.selected = true;
  if (!profile) return;
  const name = await createNewSession(profile);
  await refreshSessions();
  if (name) attach(name);
});

// Refresh the profile list whenever the user is about to open the picker, so
// new directories on disk show up without a page reload.
tabAddProfile.addEventListener("pointerdown", () => {
  void refreshProfiles();
});

async function connect() {
  setStatus("connecting…", "");

  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ authed: false }));
  if (!me.authed) {
    window.location.href = "/";
    return;
  }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    setStatus("connected", "connected");
    fit.fit();
    sendResize();
    term.focus();
    initOnConnect();
  };

  ws.onmessage = (e) => {
    if (typeof e.data === "string") {
      // JSON control frame from the server
      let msg: { t?: string; name?: string; code?: number; message?: string };
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.t === "attached" && msg.name) {
        switching = false;
        activeSession = msg.name;
        localStorage.setItem(LAST_SESSION_KEY, msg.name);
        renderTabs();
        sendResize();
        return;
      }

      if (msg.t === "detached" && msg.name) {
        if (switching) return; // we triggered this by switching tabs; ignore.
        // unexpected detach (hermes exited, session killed externally...). pick another.
        if (activeSession === msg.name) activeSession = null;
        refreshSessions().then(() => {
          const next = pickInitialSession(sessions);
          if (next) attach(next);
          else setStatus("no sessions — tap + to create one", "disconnected");
        });
        return;
      }

      if (msg.t === "error") {
        setStatus(msg.message ?? "error", "disconnected");
        return;
      }
    } else if (e.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(e.data));
    } else if (e.data instanceof Blob) {
      e.data.arrayBuffer().then((b) => term.write(new Uint8Array(b)));
    }
  };

  ws.onclose = () => {
    setStatus("disconnected — reconnecting…", "disconnected");
    setTimeout(connect, 1500);
  };
}

term.onData((data) => sendInput(data));

const ro = new ResizeObserver(() => {
  fit.fit();
  sendResize();
});
ro.observe(termEl);

window.addEventListener("resize", () => {
  fit.fit();
  sendResize();
});

tabsEl.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;

  if (target === tabAddBtn || (target.closest("#tab-add") && !target.closest("#tab-add-profile"))) {
    const name = await createNewSession();
    await refreshSessions();
    if (name) attach(name);
    return;
  }

  // close button on a tab
  const killName = (target.dataset.kill || target.closest(".x")?.getAttribute("data-kill")) as string | undefined;
  if (killName) {
    e.stopPropagation();
    if (!confirm(`Kill session ${killName}?`)) return;

    // If killing the active session, switch to a fallback FIRST so the active
    // pty is silently disposed before we tear down the tmux session.
    if (activeSession === killName) {
      const others = sessions.filter((s) => s.name !== killName);
      let target: string | null = null;
      if (others.length > 0) {
        target = pickInitialSession(others);
      } else {
        target = await createNewSession();
      }
      if (target) attach(target);
    }

    await killSessionOnServer(killName);
    await refreshSessions();
    return;
  }

  // tab body
  const tab = target.closest(".tab") as HTMLElement | null;
  if (tab && tab.dataset.name && tab.dataset.name !== activeSession) {
    attach(tab.dataset.name);
  }
});

toolbar.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;

  if (btn === ctrlBtn) {
    ctrlSticky = !ctrlSticky;
    ctrlBtn.classList.toggle("sticky-on", ctrlSticky);
    term.focus();
    return;
  }

  if (btn === pasteBtn) {
    navigator.clipboard?.readText().then((t) => {
      if (t) sendInput(t);
    }).catch(() => {});
    term.focus();
    return;
  }

  const code = btn.dataset.code;
  if (code) {
    sendInput(String.fromCharCode(parseInt(code, 10)));
    term.focus();
    return;
  }

  const send = btn.dataset.send;
  if (send) {
    sendInput(send);
    term.focus();
    return;
  }

  const key = btn.dataset.key;
  if (key) {
    const seq = keyToSequence(key, ctrlSticky);
    if (seq) sendInput(seq);
    if (ctrlSticky) {
      ctrlSticky = false;
      ctrlBtn.classList.remove("sticky-on");
    }
    term.focus();
  }
});

function keyToSequence(key: string, ctrl: boolean): string {
  if (ctrl && key.length === 1) {
    const c = key.toLowerCase().charCodeAt(0);
    if (c >= 97 && c <= 122) return String.fromCharCode(c - 96);
  }
  switch (key) {
    case "Escape": return "\x1b";
    case "Tab": return ctrl ? "\x1b[Z" : "\t";
    case "ArrowUp": return "\x1b[A";
    case "ArrowDown": return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft": return "\x1b[D";
    case "Enter": return "\r";
    case "Backspace": return "\x7f";
    default: return "";
  }
}

connect();
