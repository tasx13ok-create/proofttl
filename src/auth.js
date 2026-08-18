import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

const AUTH_PREFIX = "/api/auth";
const DEFAULT_SESSION_SECONDS = 60 * 60 * 24 * 7;

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalProvider(clientId, clientSecret) {
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function authTrustedOrigins(env, request) {
  const configured = csv(env.PROOFTTL_AUTH_TRUSTED_ORIGINS);
  const workerOrigin = new URL(request.url).origin;
  return [...new Set([workerOrigin, ...configured])];
}

export function authRuntimeStatus(env, request) {
  const trustedOrigins = authTrustedOrigins(env, request);
  const socialProviders = {
    github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    discord: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET)
  };
  const passkeys = Boolean(env.PROOFTTL_PASSKEY_RP_ID && env.PROOFTTL_PASSKEY_ORIGIN);
  const database = Boolean(env.MONITOR_DB);
  const secret = Boolean(env.BETTER_AUTH_SECRET);

  return {
    configured: database && secret,
    database,
    secret,
    socialProviders,
    passkeys,
    totp: database && secret,
    recoveryCodes: database && secret,
    emailSignIn: false,
    basePath: AUTH_PREFIX,
    trustedOrigins
  };
}

export function createProofTTLAuth(env, request) {
  const status = authRuntimeStatus(env, request);
  if (!status.database || !status.secret) return null;

  const socialProviders = {};
  const github = optionalProvider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);
  const google = optionalProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  const discord = optionalProvider(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET);
  if (github) socialProviders.github = github;
  if (google) socialProviders.google = google;
  if (discord) socialProviders.discord = discord;

  const plugins = [
    twoFactor({
      issuer: "ProofTTL",
      allowPasswordless: true
    })
  ];

  if (status.passkeys) {
    plugins.push(
      passkey({
        rpID: env.PROOFTTL_PASSKEY_RP_ID,
        rpName: "ProofTTL",
        origin: String(env.PROOFTTL_PASSKEY_ORIGIN).replace(/\/$/, "")
      })
    );
  }

  const crossOrigin = String(env.PROOFTTL_AUTH_CROSS_ORIGIN || "").toLowerCase() === "true";

  return betterAuth({
    appName: "ProofTTL",
    database: env.MONITOR_DB,
    secret: env.BETTER_AUTH_SECRET,
    basePath: AUTH_PREFIX,
    trustedOrigins: status.trustedOrigins,
    emailAndPassword: { enabled: false },
    socialProviders,
    plugins,
    session: {
      expiresIn: Number(env.PROOFTTL_SESSION_SECONDS) || DEFAULT_SESSION_SECONDS,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10
    },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: "proofttl",
      defaultCookieAttributes: crossOrigin
        ? { secure: true, httpOnly: true, sameSite: "none" }
        : { secure: true, httpOnly: true, sameSite: "lax" }
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60
    }
  });
}

export async function getOptionalProofTTLSession(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const authorization = request.headers.get("authorization") || "";
  const mayHaveSession = /proofttl/i.test(cookie) || /^Bearer\s+/i.test(authorization);
  if (!mayHaveSession) return null;

  const auth = createProofTTLAuth(env, request);
  if (!auth) return null;

  try {
    return await auth.api.getSession({ headers: request.headers });
  } catch (error) {
    console.warn(JSON.stringify({
      event: "auth_optional_session_lookup_failed",
      error: error?.name || error?.constructor?.name || "Error"
    }));
    return null;
  }
}

export async function handleProofTTLAuth(request, env) {
  const auth = createProofTTLAuth(env, request);
  if (!auth) {
    return Response.json(
      {
        error: "auth_not_configured",
        message: "ProofTTL authentication is not configured on this deployment."
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  return auth.handler(request);
}

export const AUTH_PATH_PREFIX = AUTH_PREFIX;
