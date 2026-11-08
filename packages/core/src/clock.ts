/**
 * Simulated clock. Real time is compressed so that SLAs measured in hours ("no tracking within 24h")
 * can fire inside a five-minute run. Default factor 60: one real minute = 60 simulated minutes.
 */
export class SimClock {
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private jumped = 0;

  constructor(
    public readonly startedAt: number = Date.now(),
    public readonly factor: number = 60,
  ) {}

  /** Simulated minutes elapsed since the run started, excluding paused time. */
  now(real: number = Date.now()): number {
    const effective = (this.pausedAt ?? real) - this.startedAt - this.pausedTotal;
    return Math.max(0, Math.floor((effective / 60_000) * this.factor) + this.jumped);
  }

  /** Move the simulated clock forward at once, for the settle phase after the shoppers are done. */
  jump(simMinutes: number) {
    this.jumped += Math.max(0, simMinutes);
  }

  pause(real: number = Date.now()) {
    if (this.pausedAt === null) this.pausedAt = real;
  }
  resume(real: number = Date.now()) {
    if (this.pausedAt !== null) {
      this.pausedTotal += real - this.pausedAt;
      this.pausedAt = null;
    }
  }
  get paused() {
    return this.pausedAt !== null;
  }

  /** Real milliseconds that correspond to a number of simulated minutes. */
  realMsFor(simMinutes: number): number {
    return (simMinutes / this.factor) * 60_000;
  }
}

export const SIM = {
  hour: 60,
  day: 24 * 60,
} as const;

export function fmtSim(simMinutes: number): string {
  const d = Math.floor(simMinutes / SIM.day);
  const h = Math.floor((simMinutes % SIM.day) / 60);
  const m = simMinutes % 60;
  return d > 0 ? `day ${d + 1} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
