export function buildWranglerDevLaunch({
  platform = process.platform,
  env = process.env,
  port = 8790,
  benchmarkToken
} = {}) {
  const safePort = Number.parseInt(String(port), 10);
  if (!Number.isFinite(safePort) || safePort < 1 || safePort > 65535) {
    throw new Error("invalid benchmark port");
  }

  const safeToken = String(benchmarkToken || "");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(safeToken)) {
    throw new Error("invalid benchmark token");
  }

  // Full remote preview is deliberate here. The user's Wrangler session showed
  // that the per-binding remote AI proxy was still being surfaced as local,
  // while `wrangler dev --remote` guarantees both Worker execution and the AI
  // binding run on Cloudflare. This creates a temporary preview session, not a
  // production deployment.
  const wranglerArgs = [
    "wrangler",
    "dev",
    "--remote",
    "--config",
    "wrangler.model-eval.jsonc",
    "--port",
    String(safePort),
    "--var",
    `BENCHMARK_TOKEN:${safeToken}`
  ];

  if (platform === "win32") {
    // .cmd files are not directly executable by CreateProcess. Launch npx.cmd
    // through the Windows command processor instead of spawn("npx.cmd", ...).
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        `npx.cmd ${wranglerArgs.join(" ")}`
      ]
    };
  }

  return {
    command: "npx",
    args: wranglerArgs
  };
}
