// Sandbox-only type shim for @earendil-works/pi-coding-agent.
// Mirrors the subset of the public extension API that Sailor uses (from docs/extensions.md and
// examples/extensions/*.ts). The real package provides the authoritative types at runtime/install time.
import type { Component, TUI } from "@earendil-works/pi-tui";

export type NotifyLevel = "info" | "warning" | "error";

export interface Theme {
  fg(color: string, text: string): string;
  bg?(color: string, text: string): string;
  bold(text: string): string;
  italic?(text: string): string;
}

export interface ExtensionUIContext {
  notify(message: string, level?: NotifyLevel): void;
  select(title: string, options: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  input(label: string, placeholder?: string): Promise<string | undefined>;
  editor?(label: string, prefilled?: string): Promise<string | undefined>;
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, content: string[] | undefined): void;
  setTitle?(title: string): void;
  setEditorText?(text: string): void;
  custom<T>(factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (result: T) => void) => Component): Promise<T>;
}

export interface SessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
  message?: any;
}

export interface ExtensionContext {
  cwd: string;
  mode: "tui" | "print" | "json" | "rpc" | string;
  hasUI: boolean;
  signal?: AbortSignal;
  ui: ExtensionUIContext;
  sessionManager: {
    getBranch(): SessionEntry[];
    getEntries(): SessionEntry[];
    getSessionId?(): string;
  };
}

export interface TextContent { type: "text"; text: string }
export interface AgentToolResult<D = unknown> { content: TextContent[]; details: D; isError?: boolean }
type ToolResult<D = unknown> = AgentToolResult<D>;

export interface ToolDefinition<P = any, D = any> {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: P,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: ToolResult<D>) => void) | undefined,
    ctx: ExtensionContext,
  ): Promise<ToolResult<D>>;
  renderCall?(args: P, theme: Theme, context: unknown): Component;
  renderResult?(result: ToolResult<D>, opts: { expanded: boolean; isPartial?: boolean }, theme: Theme, context: unknown): Component;
}

export interface ToolCallEvent { toolName: string; toolCallId: string; input: Record<string, any> }
export interface ToolResultEvent { toolName: string; toolCallId: string; input: Record<string, any>; content: TextContent[]; details?: unknown; isError?: boolean }
export interface BeforeAgentStartEvent { systemPrompt: string; prompt?: string }
export interface InputEvent { text: string }

export interface ExtensionAPI {
  on(event: "session_start", handler: (event: any, ctx: ExtensionContext) => void | Promise<void>): void;
  on(event: "session_shutdown", handler: (event: { reason?: string }, ctx: ExtensionContext) => void | Promise<void>): void;
  on(event: "before_agent_start", handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => any): void;
  on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ExtensionContext) => Promise<{ block: true; reason?: string } | void> | { block: true; reason?: string } | void): void;
  on(event: "tool_result", handler: (event: ToolResultEvent, ctx: ExtensionContext) => any): void;
  on(event: "input", handler: (event: InputEvent, ctx: ExtensionContext) => any): void;
  on(event: string, handler: (event: any, ctx: ExtensionContext) => any): void;
  registerTool<P = any, D = any>(tool: ToolDefinition<P, D>): void;
  registerCommand(name: string, def: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }): void;
  registerShortcut(keys: string, def: { description: string; handler: (ctx: ExtensionContext) => Promise<void> | void }): void;
  registerFlag(name: string, def: { description?: string; type: "boolean"; default?: boolean } | { description?: string; type: "string"; default?: string }): void;
  getFlag(name: string): boolean | string | undefined;
  sendMessage(msg: { customType: string; content: string; display?: boolean; details?: unknown }, opts?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
  appendEntry(customType: string, data: unknown): void;
  getActiveTools(): string[];
  getAllTools(): { name: string; sourceInfo?: { source: string } }[];
  setActiveTools(names: string[]): void;
}

export function defineTool<P = any, D = any>(tool: ToolDefinition<P, D>): ToolDefinition<P, D>;
