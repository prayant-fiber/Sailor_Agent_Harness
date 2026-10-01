// Sandbox-only type shim for @earendil-works/pi-tui (subset used by Sailor).
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
}
export interface TUI { requestRender(): void }
export class Text implements Component {
  constructor(text: string, paddingX?: number, paddingY?: number);
  setText(text: string): void;
  render(width: number): string[];
  invalidate(): void;
}
export function matchesKey(data: string, key: string): boolean;
export function truncateToWidth(text: string, width: number, ellipsis?: string): string;
export function visibleWidth(text: string): number;
export const Key: Record<string, string>;
