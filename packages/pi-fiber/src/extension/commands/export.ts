import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { saveGlobalConfig, sailorHome } from "../../core/config";
import { errorMessage } from "../../core/errors";
import { deviceAuthorize, disconnectGoogle, googleClientFromEnv, isGoogleConnected, loopbackAuthorize } from "../../core/google/oauth";
import { setSecret } from "../../core/secrets";
import type { Runtime } from "../runtime";
import { doExport } from "../tools/export";
import { flagBool, flagStr, parseArgs } from "./args";

function say(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info") {
  if (ctx.hasUI) ctx.ui.notify(msg, level); else console.log(msg);
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => undefined);
}

export function registerExportCommands(pi: ExtensionAPI, rt: Runtime): void {
  pi.registerCommand("export", {
    description: "Export a list: /export <list> <sheets|csv|xlsx> [--preset outreach|apollo|hubspot|salesloft|instantly|smartlead] [--mode new|append|upsert] [--sheet URL] [--title T] [--valid-only] [--path P]",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args, ["valid-only"]);
      const [list, target = "csv"] = a._;
      if (!list) { say(ctx, "Usage: /export <list> <sheets|csv|xlsx> [options]", "warning"); return; }
      try {
        const msg = await doExport(rt, {
          list, target: target as any, preset: flagStr(a, "preset") as any, mode: flagStr(a, "mode") as any, sheetUrl: flagStr(a, "sheet"),
          title: flagStr(a, "title"), validOnly: flagBool(a, "valid-only"), path: flagStr(a, "path"),
        }, (m) => ctx.ui?.setStatus("sailor-progress", m));
        ctx.ui?.setStatus("sailor-progress", undefined);
        say(ctx, msg);
      } catch (err) { say(ctx, errorMessage(err), "error"); }
    },
  });

  pi.registerCommand("sheets", {
    description: "Google Sheets: /sheets connect [--device] | disconnect | status | client <id> [secret]",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args, ["device"]);
      const sub = a._[0] ?? "status";
      try {
        if (sub === "client") {
          if (!a._[1]) { say(ctx, "Usage: /sheets client <oauth client id> [client secret]", "warning"); return; }
          setSecret("google:client_id", a._[1]);
          if (a._[2]) setSecret("google:client_secret", a._[2]);
          say(ctx, "Saved Google OAuth client. Now run /sheets connect.");
          return;
        }
        if (sub === "disconnect") { disconnectGoogle(); say(ctx, "Disconnected Google."); return; }
        if (sub === "status") { say(ctx, isGoogleConnected() ? "Google Sheets connected (scope: drive.file — only files Sailor creates or opens)." : "Google not connected. Run /sheets connect."); return; }
        if (sub === "connect") {
          const client = googleClientFromEnv(rt.config.google.clientIdEnv, rt.config.google.clientSecretEnv);
          if (!client) {
            say(ctx, `Sailor needs your own Google OAuth client (Desktop app type). Create one at https://console.cloud.google.com/apis/credentials (enable Sheets + Drive APIs), then set ${rt.config.google.clientIdEnv}/${rt.config.google.clientSecretEnv} or run /sheets client <id> <secret>.`, "warning");
            return;
          }
          const headless = flagBool(a, "device") || !!process.env.SSH_CONNECTION || (!process.env.DISPLAY && process.platform === "linux");
          if (headless) {
            await deviceAuthorize(client, (url, code) => say(ctx, `Open ${url} on any device and enter code ${code}`), ctx.signal);
          } else {
            await loopbackAuthorize(client, (url) => { say(ctx, `Opening your browser for Google sign-in… If it doesn't open: ${url}`); openBrowser(url); });
          }
          say(ctx, "✓ Google Sheets connected. Try: /export <list> sheets");
          return;
        }
        say(ctx, "Unknown subcommand.", "warning");
      } catch (err) { say(ctx, errorMessage(err), "error"); }
    },
  });

  pi.registerCommand("feedback", {
    description: "Save feedback for the Sailor maintainers (local file; nothing is sent): /feedback <text>",
    handler: async (args, ctx) => {
      rt.init(ctx);
      let text = (args ?? "").trim();
      if (!text && ctx.hasUI) text = (await ctx.ui.input("What worked / what didn't?", ""))?.trim() ?? "";
      if (!text) return;
      const dir = join(sailorHome(), "feedback");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
      writeFileSync(file, `# Sailor feedback\n\n- version: 0.1.0\n- mode: ${rt.config.mode}\n- tools: ${rt.config.toolsProfile}\n- node: ${process.version}\n- platform: ${process.platform}\n\n${text}\n`);
      say(ctx, `Thanks! Saved to ${file}. Attach it to a GitHub issue if you'd like.`);
    },
  });

  pi.registerCommand("telemetry", {
    description: "Opt in/out of anonymous usage counts (off by default; never includes list contents, prompts or keys): /telemetry on|off",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const on = (args ?? "").trim() === "on";
      saveGlobalConfig({ telemetry: { enabled: on } } as any);
      rt.reloadConfig();
      say(ctx, `Telemetry ${on ? "on (local counters only in this version)" : "off"}.`);
    },
  });
}
