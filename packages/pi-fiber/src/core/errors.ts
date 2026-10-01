export class SailorError extends Error {
  constructor(message: string, public readonly code: string, public readonly hint?: string) {
    super(message);
    this.name = "SailorError";
  }
}

export class FiberHttpError extends SailorError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly opId: string,
    public readonly body?: unknown,
    public readonly errorCode?: string,
    hint?: string,
  ) {
    super(message, `FIBER_${status}`, hint);
    this.name = "FiberHttpError";
  }
}

export class InvalidKeyError extends FiberHttpError {
  constructor(opId: string, body?: unknown) {
    super("Fiber rejected the API key (401). Run /fiber login to replace it.", 401, opId, body, undefined, "/fiber login");
    this.name = "InvalidKeyError";
  }
}

export class OutOfCreditsError extends FiberHttpError {
  constructor(opId: string, public readonly purchaseUrl?: string, body?: unknown) {
    super(
      `Out of Fiber credits (402)${purchaseUrl ? `. Top up: ${purchaseUrl}` : ""}.`,
      402,
      opId,
      body,
      undefined,
      purchaseUrl ?? "https://fiber.ai/app",
    );
    this.name = "OutOfCreditsError";
  }
}

export class RateLimitedError extends FiberHttpError {
  constructor(opId: string, public readonly retryAfterMs: number, body?: unknown) {
    super(`Rate limited on ${opId}; retry after ${Math.ceil(retryAfterMs / 1000)}s.`, 429, opId, body);
    this.name = "RateLimitedError";
  }
}

/** A paid, non-idempotent call timed out or dropped: we cannot know whether it was charged (edge case C4). */
export class UnknownOutcomeError extends SailorError {
  constructor(public readonly opId: string, cause: string) {
    super(
      `${opId} did not complete (${cause}). It is a paid call, so Sailor did NOT retry automatically — it may or may not have been charged. Check /credits and retry only if needed.`,
      "UNKNOWN_OUTCOME",
    );
    this.name = "UnknownOutcomeError";
  }
}

export class BlockedByPolicyError extends SailorError {
  constructor(opId: string, reason: string) {
    super(`${opId} is blocked by Sailor policy: ${reason}`, "POLICY_BLOCK");
    this.name = "BlockedByPolicyError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof SailorError) return err.hint ? `${err.message} (${err.hint})` : err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
