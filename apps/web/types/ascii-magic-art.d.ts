/** The parts of ascii-magic-art's kit the hero animation draws with. The package ships plain ESM without types. */
declare module "ascii-magic-art/lib/kit.js" {
  export class Grid {
    constructor(cols: number, rows: number);
    cols: number;
    rows: number;
    ch: string[];
    co: string[];
    clear(ch?: string, co?: string): this;
    inside(x: number, y: number): boolean;
    set(x: number, y: number, ch: string, co?: string): void;
    get(x: number, y: number): string;
    text(x: number, y: number, s: string, co?: string): void;
    block(x: number, y: number, s: string, co?: string, solid?: boolean): void;
    hline(x0: number, x1: number, y: number, ch?: string, co?: string): void;
    vline(x: number, y0: number, y1: number, ch?: string, co?: string): void;
    box(x: number, y: number, w: number, h: number, style?: "light" | "heavy" | "double" | "round" | "ascii" | string, co?: string): void;
    fill(x: number, y: number, w: number, h: number, ch?: string, co?: string): void;
    line(x0: number, y0: number, x1: number, y1: number, ch?: string | ((x: number, y: number) => string), co?: string): void;
    circle(cx: number, cy: number, r: number, ch?: string, co?: string, aspect?: number): void;
    shade(fn: (x: number, y: number, u: number, v: number) => [string, string?] | undefined | null | false): void;
    frame(): string | { text: string; color: string };
  }
  export function ramp(v: number, chars?: string): string;
  export function fbm(x: number, y: number, octaves?: number, seed?: number): number;
  export function noise2(x: number, y: number, seed?: number): number;
  export function rng(seed?: number): () => number;
  export const clamp: (v: number, a?: number, b?: number) => number;
  export const lerp: (a: number, b: number, t: number) => number;
}
