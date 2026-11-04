/**
 * Seeded persona factory (idea borrowed from TinyTroupe / langwatch-scenario): the same seed always
 * yields the same shoppers, so re-running a scenario reuses them for free and findings stay comparable.
 * Zero LLM calls; names and backstories come from trait tables.
 */
export interface Persona {
  id: string;
  name: string;
  age: number;
  occupation: string;
  budget: number;
  intent: string;
  style: "terse" | "chatty" | "skeptical" | "impulsive" | "methodical";
  priorities: string[];
  patience: "low" | "medium" | "high";
  cardBrand: "VISA" | "MASTERCARD" | "AMEX";
  /** Index permutation of the catalog as this persona will see it (for POSITION_BIAS). */
  catalogOrder: number[];
  seed: number;
  /** Set by the chaos runner: this persona's capture will be declined. */
  declineKind?: string;
  backstory: string;
}

const FIRST = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Ethan", "Ines", "Kai", "Priya", "Mateo", "Sofia", "Leo", "Nadia", "Omar", "Freya", "Jonas", "Yuki", "Tariq", "Elena", "Rafael", "Hana", "Ciaran", "Amara", "Luca"];
const LAST = ["Okafor", "Lindqvist", "Marsh", "Delgado", "Chen", "Haddad", "Novak", "Brennan", "Ivanova", "Moreau", "Patel", "Kowalski", "Ruiz", "Tanaka", "Abebe", "Fischer", "Rossi", "Singh", "Byrne", "Costa"];
const OCCUPATIONS = ["bike courier", "nurse on night shifts", "data analyst", "primary school teacher", "weekend gravel rider", "retired engineer", "student", "barista", "software developer", "landscape gardener", "commuter by bike", "triathlete", "parent of three", "freelance photographer", "warehouse supervisor"];
const INTENTS = [
  { intent: "needs a front light before the clocks go back", keywords: ["light", "visib", "lumen"] },
  { intent: "wants warm socks and gloves for winter commuting", keywords: ["sock", "glove", "merino", "thermal"] },
  { intent: "is fixing up an old bike and needs tools and bar tape", keywords: ["tool", "tape", "pump"] },
  { intent: "is preparing for a bikepacking weekend and needs bags", keywords: ["pannier", "bag", "frame"] },
  { intent: "wants to be more visible at night", keywords: ["reflect", "light", "band"] },
  { intent: "needs new tyres before a gravel event", keywords: ["tyre", "tire", "gravel"] },
  { intent: "is buying a small gift for a cycling friend under $30", keywords: ["bottle", "sock", "tool"] },
  { intent: "wants a hydration setup for long rides", keywords: ["bottle", "insulated"] },
];
const PRIORITY_POOL = ["price", "quality", "fast shipping", "returns policy", "brand", "reviews", "weight", "durability", "colour"];
const STYLES: Persona["style"][] = ["terse", "chatty", "skeptical", "impulsive", "methodical"];
const PATIENCE: Persona["patience"][] = ["low", "medium", "high"];
const CARDS: Persona["cardBrand"][] = ["VISA", "VISA", "MASTERCARD", "AMEX"];

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function makePersonas(count: number, seed: number, catalogSize: number): Persona[] {
  const rng = mulberry32(seed * 7919 + count);
  const out: Persona[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
    while (used.has(name)) name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
    used.add(name);
    const intent = pick(rng, INTENTS);
    const age = 19 + Math.floor(rng() * 50);
    const budget = Math.round((20 + rng() * 120) / 5) * 5;
    const occupation = pick(rng, OCCUPATIONS);
    const style = pick(rng, STYLES);
    const patience = pick(rng, PATIENCE);
    const priorities = shuffle(rng, PRIORITY_POOL).slice(0, 2 + Math.floor(rng() * 2));
    const personaSeed = Math.floor(rng() * 1e9);
    out.push({
      id: `shopper-${String(i + 1).padStart(2, "0")}`,
      name,
      age,
      occupation,
      budget,
      intent: intent.intent,
      style,
      priorities,
      patience,
      cardBrand: pick(rng, CARDS),
      catalogOrder: shuffle(rng, Array.from({ length: catalogSize }, (_, k) => k)),
      seed: personaSeed,
      backstory: `${name}, ${age}, ${occupation}. ${capitalise(intent.intent)}. Cares about ${priorities.join(" and ")}. Budget about $${budget}. ${styleLine(style)} ${patienceLine(patience)}`,
    });
  }
  return out;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const styleLine = (s: Persona["style"]) =>
  ({
    terse: "Writes short messages and dislikes small talk.",
    chatty: "Asks a lot of questions and shares context freely.",
    skeptical: "Double-checks prices and policies before paying.",
    impulsive: "Decides quickly and rarely compares more than two options.",
    methodical: "Compares options carefully and reads descriptions in full.",
  })[s];
const patienceLine = (p: Persona["patience"]) =>
  ({ low: "Gives up after one unanswered message.", medium: "Will follow up once if ignored.", high: "Patient, but remembers bad service." })[p];
