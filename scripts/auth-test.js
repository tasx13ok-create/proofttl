import {
  AUTH_PATH_PREFIX,
  authProviderRedirectURI,
  authRuntimeStatus,
  handleProofTTLAuth
} from "../src/auth.js";
import {
  applyAuthCors,
  authPreflightResponse,
  isAllowedAuthOrigin
} from "../src/auth-cors.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function run() {
  const baseRequest = new Request("https://proofttl.tasx13ok.workers.dev/api/auth/get-session");
  const disabled = authRuntimeStatus({}, baseRequest);
  assert(disabled.configured === false, "auth is disabled without D1, secret, and base URL");
  assert(disabled.totp === false, "TOTP is not advertised without auth storage/secret");
  assert(disabled.emailSignIn === false, "email sign-in remains disabled without delivery infrastructure");
  assert(disabled.basePath === AUTH_PATH_PREFIX, "auth base path is stable");

  const unavailable = await handleProofTTLAuth(baseRequest, {});
  assert(unavailable.status === 503, "auth handler fails closed when not configured");
  const unavailableBody = await unavailable.json();
  assert(unavailableBody.error === "auth_not_configured", "disabled auth returns explicit error code");

  const env = {
    MONITOR_DB: {},
    BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
    BETTER_AUTH_URL: "https://proofttl.tasx13ok.workers.dev",
    PROOFTTL_AUTH_PUBLIC_URL: "https://proofttl-web.vercel.app",
    GITHUB_CLIENT_ID: "github-client",
    GITHUB_CLIENT_SECRET: "github-secret",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    DISCORD_CLIENT_ID: "discord-client",
    DISCORD_CLIENT_SECRET: "discord-secret",
    PROOFTTL_AUTH_TRUSTED_ORIGINS: "https://app.example.test, https://preview.example.test",
    PROOFTTL_PASSKEY_RP_ID: "app.example.test",
    PROOFTTL_PASSKEY_ORIGIN: "https://app.example.test"
  };

  const enabled = authRuntimeStatus(env, baseRequest);
  assert(enabled.configured === true, "D1, auth secret, and public auth base URL enable the auth backend");
  assert(enabled.baseURL === "https://proofttl-web.vercel.app", "public auth URL wins over the Worker origin");
  assert(enabled.socialProviders.github === true, "configured GitHub OAuth is advertised");
  assert(enabled.socialProviders.google === true, "configured Google OAuth is advertised");
  assert(enabled.socialProviders.discord === true, "configured Discord OAuth is advertised");
  assert(enabled.passkeys === true, "passkeys require explicit RP ID and origin");
  assert(enabled.totp === true && enabled.recoveryCodes === true, "TOTP and recovery codes are enabled with auth storage/secret");
  assert(enabled.trustedOrigins.includes("https://app.example.test"), "configured frontend origin is trusted");
  assert(
    authProviderRedirectURI(enabled.baseURL, "github") === "https://proofttl-web.vercel.app/api/auth/callback/github",
    "GitHub OAuth callback is pinned to the first-party web origin"
  );
  assert(
    authProviderRedirectURI(enabled.baseURL, "google") === "https://proofttl-web.vercel.app/api/auth/callback/google",
    "Google OAuth callback is pinned to the first-party web origin"
  );
  assert(
    authProviderRedirectURI(enabled.baseURL, "discord") === "https://proofttl-web.vercel.app/api/auth/callback/discord",
    "Discord OAuth callback is pinned to the first-party web origin"
  );

  const allowedRequest = new Request(baseRequest.url, {
    method: "OPTIONS",
    headers: {
      origin: "https://app.example.test",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });
  assert(isAllowedAuthOrigin(allowedRequest, env), "configured auth origin is accepted");
  const allowedPreflight = authPreflightResponse(allowedRequest, env);
  assert(allowedPreflight.status === 204, "allowed auth preflight returns HTTP 204");
  assert(allowedPreflight.headers.get("access-control-allow-origin") === "https://app.example.test", "auth CORS echoes only the approved origin");
  assert(allowedPreflight.headers.get("access-control-allow-credentials") === "true", "auth CORS permits credentialed requests");
  assert(allowedPreflight.headers.get("access-control-allow-origin") !== "*", "credentialed auth CORS never uses wildcard origin");

  const responseWithCookie = new Response("ok", {
    status: 200,
    headers: { "set-cookie": "proofttl.session_token=test; Secure; HttpOnly; SameSite=None" }
  });
  const corsResponse = applyAuthCors(responseWithCookie, allowedRequest, env);
  assert(corsResponse.headers.get("set-cookie")?.includes("HttpOnly"), "auth CORS preserves Set-Cookie headers");

  const deniedRequest = new Request(baseRequest.url, {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" }
  });
  assert(isAllowedAuthOrigin(deniedRequest, env) === false, "untrusted auth origin is rejected");
  const deniedPreflight = authPreflightResponse(deniedRequest, env);
  assert(deniedPreflight.status === 403, "untrusted auth preflight returns HTTP 403");
  assert(!deniedPreflight.headers.has("access-control-allow-credentials"), "rejected origins receive no credentialed CORS permission");

  console.log(`\nSUCCESS: ${passed} ProofTTL auth boundary checks passed.`);
}

run().catch((error) => {
  console.error("\nAUTH TEST FAILED:", error.message || error);
  process.exitCode = 1;
});
