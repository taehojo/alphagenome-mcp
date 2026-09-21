// src/utils/config.ts

/**
 * Runtime configuration read from the environment.
 *
 * Kept as pure functions that take the environment as an argument so they can
 * be unit-tested without touching process.env.
 */

/** Default time allowed for one Python bridge call, in milliseconds. */
export const DEFAULT_BRIDGE_TIMEOUT_MS = 180000;

type Env = Record<string, string | undefined>;

/**
 * Timeout for one Python bridge call.
 *
 * Override with ALPHAGENOME_TIMEOUT_MS. Values that are not positive integers
 * are ignored so a typo cannot disable the timeout.
 */
export function getBridgeTimeoutMs(env: Env = process.env): number {
  const raw = env.ALPHAGENOME_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_BRIDGE_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_BRIDGE_TIMEOUT_MS;
  }
  return parsed;
}

/**
 * Python executables to try, in order.
 *
 * ALPHAGENOME_PYTHON pins one interpreter (useful for virtualenvs and on
 * Windows, where `python3` usually does not exist). Without it, `python3` is
 * tried first and `python` second.
 */
export function getPythonCandidates(env: Env = process.env): string[] {
  const pinned = env.ALPHAGENOME_PYTHON;
  if (pinned !== undefined && pinned.trim() !== '') {
    return [pinned.trim()];
  }
  return ['python3', 'python'];
}
