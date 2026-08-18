import fs from "node:fs";
import { buildWranglerDevLaunch } from "../benchmark/launcher.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function run() {
  console.log("ProofTTL benchmark launcher regression test\n");

  const windows = buildWranglerDevLaunch({
    platform: "win32",
    env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    port: 8790
  });

  assert(
    windows.command.toLowerCase().endsWith("cmd.exe"),
    "Windows benchmark launches through cmd.exe rather than spawning npx.cmd directly"
  );
  assert(windows.args.includes("/c"), "Windows launcher uses cmd.exe /c");
  assert(
    windows.args.at(-1).includes("npx.cmd wrangler dev"),
    "Windows command invokes Wrangler through npx.cmd inside cmd.exe"
  );
  assert(
    windows.args.at(-1).includes("--remote"),
    "Windows benchmark uses Cloudflare remote preview mode"
  );
  assert(
    windows.args.at(-1).includes("--config wrangler.model-eval.jsonc"),
    "Windows command uses the isolated benchmark Wrangler config"
  );
  assert(
    windows.args.at(-1).includes("--port 8790"),
    "Windows command preserves the local proxy port"
  );
  assert(
    !windows.args.at(-1).includes("BENCHMARK_TOKEN"),
    "Windows launcher does not inject a redundant preview token"
  );
  assert(
    !windows.args.at(-1).includes("--local"),
    "Windows benchmark never disables remote resources with --local"
  );

  const posix = buildWranglerDevLaunch({ platform: "linux", port: 8791 });
  assert(posix.command === "npx", "POSIX launcher continues to invoke npx directly");
  assert(posix.args[0] === "wrangler" && posix.args[1] === "dev", "POSIX launcher invokes wrangler dev");
  assert(posix.args.includes("--remote"), "POSIX benchmark uses Cloudflare remote preview mode");
  assert(posix.args.includes("8791"), "POSIX launcher preserves the requested port");
  assert(!posix.args.some((arg) => arg.includes("BENCHMARK_TOKEN")), "POSIX launcher does not inject a redundant preview token");

  const configText = fs.readFileSync("wrangler.model-eval.jsonc", "utf8");
  const config = JSON.parse(configText);
  assert(config.ai?.binding === "AI", "benchmark config binds Workers AI as AI");
  assert(
    config.ai?.remote === undefined,
    "full remote preview uses a native AI binding instead of a local remote-binding proxy"
  );
  assert(config.workers_dev === false, "benchmark config remains non-deployable to workers.dev by default");

  let invalidPortRejected = false;
  try {
    buildWranglerDevLaunch({ platform: "linux", port: 70000 });
  } catch {
    invalidPortRejected = true;
  }
  assert(invalidPortRejected, "launcher rejects invalid TCP ports");

  console.log(`\nSUCCESS: ${passed} ProofTTL benchmark launcher checks passed.`);
}

try {
  run();
} catch (error) {
  console.error("\nBENCHMARK LAUNCHER TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
}
