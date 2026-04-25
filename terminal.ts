import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const termEl = document.getElementById("term") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const toolbar = document.getElementById("toolbar") as HTMLDivElement;
const ctrlBtn = document.getElementById("btn-ctrl") as HTMLButtonElement;
const pasteBtn = document.getElementById("btn-paste") as HTMLButtonElement;

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

let ws: WebSocket | null = null;
let ctrlSticky = false;

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

async function connect() {
  setStatus("connecting…", "");

  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ authed: false }));
  if (!me.authed) {
    window.location.href = "/";
    return;
  }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    setStatus("connected", "connected");
    fit.fit();
    sendResize();
    term.focus();
  };

  ws.onmessage = (e) => {
    if (typeof e.data === "string") {
      term.write(e.data);
    } else if (e.data instanceof Blob) {
      e.data.text().then((s) => term.write(s));
    }
  };

  ws.onclose = () => {
    setStatus("disconnected — reconnecting…", "disconnected");
    setTimeout(connect, 1500);
  };

  ws.onerror = () => {
    // onclose will follow and trigger reconnect
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
