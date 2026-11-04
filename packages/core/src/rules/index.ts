import type { SwarmEvent } from "../events";
import { DISCOVERABILITY_RULES } from "./discoverability";
import { FULFILMENT_RULES } from "./fulfilment";
import { RESILIENCE_RULES } from "./resilience";
import { TRANSACTABILITY_RULES } from "./transactability";
import { makeContext, type Finding, type Rule, type RuleConfig } from "./types";

export * from "./types";
export * from "./fulfilment";
export * from "./transactability";
export * from "./resilience";
export * from "./discoverability";

export const RULES: Rule[] = [...DISCOVERABILITY_RULES, ...TRANSACTABILITY_RULES, ...FULFILMENT_RULES, ...RESILIENCE_RULES];

export function evaluateRules(events: SwarmEvent[], config: Partial<RuleConfig> = {}, rules: Rule[] = RULES): Finding[] {
  const ctx = makeContext(events, config);
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  return rules
    .flatMap((r) => {
      try {
        return r.evaluate(ctx);
      } catch (e) {
        return [{ rule: r.id, severity: "info" as const, dimension: r.dimension, title: `${r.id} could not be evaluated`, detail: String((e as Error).message ?? e), fix: "Report this; the rule crashed on this event log.", eventIds: [], paypalIds: [] }];
      }
    })
    .sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule));
}
