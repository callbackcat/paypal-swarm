import type { Severity } from "./events";
import { DIMENSIONS, type Dimension, type Finding } from "./rules/types";

export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  discoverability: 0.2,
  transactability: 0.35,
  fulfilment: 0.25,
  resilience: 0.2,
};
export const DIMENSION_LABELS: Record<Dimension, string> = {
  discoverability: "Discoverability",
  transactability: "Transactability",
  fulfilment: "Fulfilment",
  resilience: "Resilience",
};

const DEDUCTION: Record<Severity, number> = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };
/** A single rule firing twenty times should not zero a dimension on its own. */
const PER_RULE_CAP = 40;

export interface Score {
  overall: number;
  dimensions: Record<Dimension, number>;
  deductions: Array<{ rule: string; dimension: Dimension; count: number; points: number }>;
  grade: "A" | "B" | "C" | "D" | "F";
}

export function scoreFindings(findings: Finding[]): Score {
  const perRule = new Map<string, { dimension: Dimension; count: number; points: number }>();
  for (const f of findings) {
    const rec = perRule.get(f.rule) ?? { dimension: f.dimension, count: 0, points: 0 };
    rec.count++;
    rec.points = Math.min(PER_RULE_CAP, rec.points + DEDUCTION[f.severity]);
    perRule.set(f.rule, rec);
  }
  const dimensions = Object.fromEntries(DIMENSIONS.map((d) => [d, 100])) as Record<Dimension, number>;
  for (const rec of perRule.values()) dimensions[rec.dimension] = Math.max(0, dimensions[rec.dimension] - rec.points);
  const overall = Math.round(DIMENSIONS.reduce((s, d) => s + dimensions[d] * DIMENSION_WEIGHTS[d], 0));
  return {
    overall,
    dimensions,
    deductions: [...perRule.entries()].map(([rule, r]) => ({ rule, ...r })).sort((a, b) => b.points - a.points),
    grade: overall >= 90 ? "A" : overall >= 75 ? "B" : overall >= 60 ? "C" : overall >= 40 ? "D" : "F",
  };
}
