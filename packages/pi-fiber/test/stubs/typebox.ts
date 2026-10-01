// Runtime stub of `typebox` for the fake-Pi wiring test (emits plain JSON Schema).
const opt = (o?: Record<string, unknown>) => o ?? {};
export const Type = {
  Object: (properties: Record<string, any>, o?: any) => ({ type: "object", properties, required: Object.entries(properties).filter(([, v]) => !v.__optional).map(([k]) => k), ...opt(o) }),
  String: (o?: any) => ({ type: "string", ...opt(o) }),
  Number: (o?: any) => ({ type: "number", ...opt(o) }),
  Integer: (o?: any) => ({ type: "integer", ...opt(o) }),
  Boolean: (o?: any) => ({ type: "boolean", ...opt(o) }),
  Optional: (t: any) => ({ ...t, __optional: true }),
  Array: (items: any, o?: any) => ({ type: "array", items, ...opt(o) }),
  Literal: (v: any) => ({ const: v }),
  Union: (anyOf: any[], o?: any) => ({ anyOf, ...opt(o) }),
  Record: (_k: any, v: any, o?: any) => ({ type: "object", additionalProperties: v, ...opt(o) }),
  Any: (o?: any) => ({ ...opt(o) }),
  Unsafe: (s: any) => s,
};
