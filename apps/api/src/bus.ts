import { EventEmitter } from "node:events";
import type { SwarmEvent } from "@swarm/core";

/** In-process fan-out from the executor to SSE subscribers. One api process per deployment for v1. */
export class Bus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(e: SwarmEvent) {
    this.emitter.emit(`run:${e.runId}`, e);
    this.emitter.emit("*", e);
  }
  subscribe(runId: string, fn: (e: SwarmEvent) => void): () => void {
    const key = `run:${runId}`;
    this.emitter.on(key, fn);
    return () => this.emitter.off(key, fn);
  }
  subscribeAll(fn: (e: SwarmEvent) => void): () => void {
    this.emitter.on("*", fn);
    return () => this.emitter.off("*", fn);
  }
}
