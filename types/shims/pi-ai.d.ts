// Sandbox-only type shim for @earendil-works/pi-ai (StringEnum helper only).
import type { TSchema } from "typebox";
export function StringEnum<T extends readonly string[]>(values: T, opts?: { description?: string; default?: T[number] }): TSchema & { static: T[number] };
