export function buildWranglerDevLaunch({
  platform = process.platform,
  env = process.env,
  port = 8790
} = {}) {
  const safePort = Number.parseInt(String(port), 10);
  if (!Number.isFinite(safePort) || safePort < 1 || safePort > 65535) {
    throw new Error("invalid benchmark port");
  }

  const wranglerArgs = [
    "wrangler",
    "dev",
    "--config",
    "wrangler.model-eval.jsonc",
    "--port",
    String(safePort),
    "--local"
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
