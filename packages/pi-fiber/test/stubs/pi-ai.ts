export const StringEnum = (values: readonly string[], o?: Record<string, unknown>) => ({ type: "string", enum: [...values], ...(o ?? {}) });
