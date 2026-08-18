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
    windows.args.at(-1).includes("--config wrangler.model-eval.jsonc"),
    "Windows command uses the isolated benchmark Wrangler config"
  );
  assert(
    windows.args.at(-1).includes("--port 8790 --local"),
    "Windows command preserves the local benchmark port and mode"
  );

  const posix = buildWranglerDevLaunch({ platform: "linux", port: 8791 });
  assert(posix.command === "npx", "POSIX launcher continues to invoke npx directly");
  assert(posix.args[0] === "wrangler" && posix.args[1] === "dev", "POSIX launcher invokes wrangler dev");
  assert(posix.args.includes("8791"), "POSIX launcher preserves the requested port");

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
