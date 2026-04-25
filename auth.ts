import { randomBytes } from "node:crypto";

const PIN = process.env.HERMES_PIN ?? "";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCKOUT_MS = 30 * 1000;

if (!/^\d{4}$/.test(PIN)) {
  console.error("HERMES_PIN must be a 4-digit string in your .env file");
  process.exit(1);
}

type Session = { expiresAt: number };
type Attempt = { fails: number; lockedUntil: number };

const sessions = new Map<string, Session>();
const attempts = new Map<string, Attempt>();

export function isLockedOut(ip: string): number {
  const a = attempts.get(ip);
  if (!a) return 0;
  const remaining = a.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function recordFail(ip: string): void {
  const a = attempts.get(ip) ?? { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.lockedUntil = Date.now() + LOCKOUT_MS;
    a.fails = 0;
  }
  attempts.set(ip, a);
}

export function clearFails(ip: string): void {
  attempts.delete(ip);
}

export function checkPin(pin: string): boolean {
  // length-aware compare; PIN is short and from env, so timing risk is minimal
  // but we still avoid early-return on mismatch
  if (pin.length !== PIN.length) return false;
  let diff = 0;
  for (let i = 0; i < PIN.length; i++) {
    diff |= pin.charCodeAt(i) ^ PIN.charCodeAt(i);
  }
  return diff === 0;
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

export function getSessionFromCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "session") return v;
  }
  return undefined;
}

export const SESSION_COOKIE_ATTRS = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
