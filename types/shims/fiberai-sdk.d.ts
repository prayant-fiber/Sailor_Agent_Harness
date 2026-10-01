// Sandbox-only type shim for @fiberai/sdk (used only by examples/scripts). Real types ship with the package.
type Envelope<T = any> = Promise<{ data?: T; error?: any; response: Response }>;
export function getOrgCredits(opts: { query: { apiKey: string } }): Envelope;
export function peopleSearch(opts: { body: Record<string, unknown> }): Envelope;
export function companySearch(opts: { body: Record<string, unknown> }): Envelope;
export function syncQuickContactReveal(opts: { body: Record<string, unknown> }): Envelope;
export function kitchenSinkBulkCompany(opts: { body: Record<string, unknown> }): Envelope;
export const client: { setConfig(cfg: Record<string, unknown>): void };
