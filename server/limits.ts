// Pure-logic abuse limits. No IO, no globals — every class is constructed
// with explicit caps so tests can drive them with small numbers without
// touching the real-world defaults below.

export const ALLOWED_ORIGINS = new Set([
  "https://hackathon-puppet.fly.dev",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
]);

export const MAX_CONCURRENT_PER_IP = 3;
export const SESSION_RATE_LIMIT_PER_MIN = 8;
export const SESSION_LIFETIME_CAP = 150;
export const GLOBAL_DAILY_CAP = 8000;

/**
 * In-memory count of active WebSocket connections per IP.
 * Keys are deleted when their count reaches zero so the map stays bounded
 * by the number of currently-connected unique IPs.
 */
export class IpConnectionCounter {
  private counts = new Map<string, number>();

  constructor(private readonly limit: number = MAX_CONCURRENT_PER_IP) {}

  tryAcquire(ip: string): boolean {
    const current = this.counts.get(ip) ?? 0;
    if (current >= this.limit) return false;
    this.counts.set(ip, current + 1);
    return true;
  }

  release(ip: string): void {
    const current = this.counts.get(ip) ?? 0;
    if (current <= 1) this.counts.delete(ip);
    else this.counts.set(ip, current - 1);
  }

  /** For tests / debugging. */
  size(): number {
    return this.counts.size;
  }

  countFor(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }
}

/**
 * Per-session call budget. Two limits:
 *   - sliding window: at most `perWindow` calls in the trailing `windowMs`.
 *   - lifetime: at most `lifetime` calls for the lifetime of this budget.
 *
 * Each successful `consume()` records a timestamp; older timestamps are
 * pruned at the start of every check so the array stays tiny.
 */
export class CallBudget {
  private recent: number[] = [];
  private lifetime = 0;

  constructor(
    private readonly perWindow: number = SESSION_RATE_LIMIT_PER_MIN,
    private readonly windowMs: number = 60_000,
    private readonly lifetimeCap: number = SESSION_LIFETIME_CAP,
  ) {}

  consume(now: number): "ok" | "rate" | "lifetime" {
    if (this.lifetime >= this.lifetimeCap) return "lifetime";

    // Drop timestamps that have aged out of the window.
    const cutoff = now - this.windowMs;
    while (this.recent.length > 0 && this.recent[0]! <= cutoff) {
      this.recent.shift();
    }
    if (this.recent.length >= this.perWindow) return "rate";

    this.recent.push(now);
    this.lifetime++;
    return "ok";
  }

  /** For tests / debugging. */
  state(): { recent: number; lifetime: number } {
    return { recent: this.recent.length, lifetime: this.lifetime };
  }
}

/**
 * Shared kill-switch: at most `cap` LLM calls per UTC day across all
 * sessions. Counter resets the first time `consume()` is called on a new
 * UTC date.
 */
export class GlobalCeiling {
  private day = "";
  private count = 0;

  constructor(private readonly cap: number = GLOBAL_DAILY_CAP) {}

  consume(now: Date): "ok" | "exhausted" {
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (this.count >= this.cap) return "exhausted";
    this.count++;
    return "ok";
  }

  /** For tests / debugging. */
  state(): { day: string; count: number } {
    return { day: this.day, count: this.count };
  }
}

/**
 * Pulls the client's IP from Fly's edge headers. Falls back to the first
 * `x-forwarded-for` entry, then to a literal "local" bucket so dev-time
 * connections share one slot rather than each getting "" or "::1".
 */
export function clientIpFrom(headers: Headers): string {
  const fly = headers.get("fly-client-ip");
  if (fly) return fly.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "local";
}

export function originAllowed(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}
