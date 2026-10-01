export class Text { constructor(public text: string, _x = 0, _y = 0) {} setText(t: string) { this.text = t; } render(_w: number) { return this.text.split("\n"); } invalidate() {} }
export const matchesKey = (_d: string, _k: string) => false;
export const truncateToWidth = (t: string, w: number) => t.slice(0, w);
export const visibleWidth = (t: string) => t.length;
export const Key = {};
