import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SHORTCUTS_FILE =
  process.env.HERMES_SHORTCUTS_FILE ??
  join(import.meta.dir, "shortcuts.json");

const SHORTCUT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export type Shortcut = { name: string; cmd: string };

export function isValidShortcutName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 64 &&
    SHORTCUT_NAME_RE.test(name)
  );
}

export async function listShortcuts(): Promise<Shortcut[]> {
  let raw: string;
  try {
    raw = await readFile(SHORTCUTS_FILE, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const out: Shortcut[] = [];
  for (const [name, cmd] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isValidShortcutName(name)) continue;
    if (typeof cmd !== "string") continue;
    const trimmed = cmd.trim();
    if (!trimmed || trimmed.length > 1024) continue;
    out.push({ name, cmd: trimmed });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getShortcut(name: string): Promise<Shortcut | null> {
  if (!isValidShortcutName(name)) return null;
  const list = await listShortcuts();
  return list.find((s) => s.name === name) ?? null;
}

export { SHORTCUTS_FILE };
