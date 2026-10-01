// Sandbox-only type shim for `typebox` (TypeBox 1.x). Only the builders Sailor uses.
type Opts = { description?: string; default?: unknown; minimum?: number; maximum?: number; minItems?: number; maxItems?: number };
export type TSchema = { static?: unknown; [k: string]: unknown };
export type Static<T> = T extends { static: infer S } ? S : any;
export declare const Type: {
  Object<P extends Record<string, TSchema>>(props: P, opts?: Opts): TSchema & { static: { [K in keyof P]: Static<P[K]> } };
  String(opts?: Opts): TSchema & { static: string };
  Number(opts?: Opts): TSchema & { static: number };
  Integer(opts?: Opts): TSchema & { static: number };
  Boolean(opts?: Opts): TSchema & { static: boolean };
  Optional<T extends TSchema>(t: T): T & { static: Static<T> | undefined };
  Array<T extends TSchema>(t: T, opts?: Opts): TSchema & { static: Static<T>[] };
  Literal<V extends string | number | boolean>(v: V, opts?: Opts): TSchema & { static: V };
  Union<T extends TSchema[]>(ts: [...T], opts?: Opts): TSchema & { static: Static<T[number]> };
  Record<K extends TSchema, V extends TSchema>(k: K, v: V, opts?: Opts): TSchema & { static: Record<string, Static<V>> };
  Any(opts?: Opts): TSchema & { static: any };
  Unsafe<T = any>(schema: Record<string, unknown>): TSchema & { static: T };
};
