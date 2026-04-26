import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILES_DIR =
  process.env.HERMES_PROFILES_DIR ?? join(homedir(), ".hermes", "profiles");

const PROFILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function isValidProfileName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 64 &&
    PROFILE_NAME_RE.test(name)
  );
}

export async function listProfiles(): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(PROFILES_DIR);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (!isValidProfileName(name)) continue;
    try {
      const s = await stat(join(PROFILES_DIR, name));
      if (s.isDirectory()) out.push(name);
    } catch {
      // skip entries we can't stat
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export { PROFILES_DIR };
