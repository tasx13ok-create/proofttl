export const BASE_URL = "https://proofttl.tasx13ok.workers.dev";

export const DISCOVERY = {
  service: "ProofTTL",
  version: "0.3.1",
  protocol: "ProofTTL/0.3.1",
  description: "Expiring, source-backed fact leases for machines.",
  base_url: BASE_URL,
  capabilities: [
    "source_backed_verification",
    "persistent_fact_leases",
    "automatic_reverification",
    "automatic_revocation",
    "source_fingerprinting",
    "x402_payments",
    "text_and_voice_product_assistant",
    "contextual_assistant_history",
    "assistant_daily_quota",
    "account_entitlements",
    "deployment_readiness"
  ],
  verdicts: ["SUPPORTED", "CONTRADICTED", "UNKNOWN"],
  lease_states: ["ACTIVE", "REVOKED", "EXPIRED"],
  lease_status_semantics: {
    status: "Legacy/original verdict retained for compatibility.",
    issued_status: "Verdict when the Fact Lease was issued.",
    current_status: "Latest observed verdict. Clients should prefer this field when evaluating a stored lease."
  },
  limits: {
    verify_request_body_max_bytes: 16384,
    verify_content_type: "application/json",
    source_text_max_chars: 30000,
    source_fetch_raw_prefix_multiplier: 3,
    automatic_checks_per_monitor_run: 10,
    assistant_audio_max_bytes: 524288,
    assistant_text_max_chars: 1200,
    assistant_history_max_messages: 6,
    assistant_history_message_max_chars: 600,
    assistant_free_daily_messages_default: 20,
    assistant_member_daily_messages_default: 200
  },
  endpoints: {
    health: { method: "GET", path: "/health" },
    readiness: { method: "GET", path: "/readiness" },
    verify: { method: "POST", path: "/verify", payment_required: true },
    lease: { method: "GET", path: "/lease/{lease_id}" },
    reverify: {
      method: "POST",
      path: "/lease/{lease_id}/reverify",
      public_enabled: false,
      status: "manual_reverify_disabled"
    },
    monitor: { method: "GET", path: "/monitor/status" },
    pricing: { method: "GET", path: "/pricing" },
    assistant_voice: {
      method: "POST",
      path: "/assistant/voice",
      input: "audio/*",
      output: "application/json",
      payment_required: false
    },
    assistant_text: {
      method: "POST",
      path: "/assistant/text",
      input: "application/json",
      output: "application/json",
      payment_required: false
    },
    assistant_usage: {
      method: "GET",
      path: "/assistant/usage",
      payment_required: false
    },
    account_entitlement: {
      method: "GET",
      path: "/account/entitlement",
      authentication_required: true,
      mutable: false
    },
    assistant_discovery: { method: "GET", path: "/.well-known/proofttl-assistant.json" },
    signing_keys: { method: "GET", path: "/.well-known/proofttl-keys.json" },
    openapi: { method: "GET", path: "/openapi.json" }
  },
  assistant: {
    interaction: "text_or_voice_input_text_output",
    scope: "proofttl_product_only",
    contextual_history: {
      enabled: true,
      max_messages: 6,
      max_chars_per_message: 600,
      allowed_roles: ["user", "assistant"]
    },
    free_daily_messages_default: 20,
    member_daily_messages_default: 200,
    quota_shared_between_text_and_voice: true,
    quota_reset: "daily_utc",
    durable_usage_accounting: "D1_with_keyed_pseudonymous_subject",
    account_entitlements: true,
    audio_retention: "none_by_default",
    navigation: "allowlisted_non_destructive_only",
    persistent_actions: "explicit_user_confirmation_required",
    capacity_behavior: "fail_closed_no_paid_fallback",
    paid_membership_enabled: false
  },
  payments: {
    protocol: "x402",
    version: 2,
    enabled: true,
    mode: "testnet",
    network: "eip155:84532",
    network_name: "Base Sepolia",
    production_network: "eip155:8453",
    asset: "USDC",
    price_per_verification: "$0.001",
    pay_to: "0x29949a066902bd329F74479c9AEBC448100955d8",
    facilitator: "https://api.cdp.coinbase.com/platform/v2/x402",
    facilitator_provider: "Coinbase Developer Platform",
    status: "testnet_paid_flow_proven"
  }
};

export const PRICING = {
  service: "ProofTTL",
  mode: "testnet",
  payment_protocol: "x402",
  verify: {
    price: "$0.001",
    payment_required: true,
    network: "eip155:84532",
    network_name: "Base Sepolia",
    asset: "USDC"
  },
  assistant: {
    price: "$0",
    payment_required: false,
    free_daily_messages_default: 20,
    member_daily_messages_default: 200,
    shared_between_text_and_voice: true,
    capacity: "free_allocation_only",
    account_entitlements_ready: true,
    paid_membership_enabled: false,
    paid_fallback: false
  },
  production_network: "eip155:8453",
  production_enabled: false
};

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "ProofTTL API",
    version: "0.3.1",
    description: "Issue and monitor expiring, source-backed fact leases. ProofTTL verifies whether a specified public source currently supports an exact claim; it does not claim universal truth. POST /verify is protected by an x402 v2 Base Sepolia test payment. Active leases are automatically reverified; public manual reverification is disabled. Stored leases expose issued_status and current_status so the original verdict is preserved without hiding later changes. When Ed25519 signing is configured, issued leases include an immutable issuance attestation and signature verifiable with public-key discovery. ProofTTL also exposes a bounded product-only AI assistant with text or voice input, bounded conversational history, a shared daily quota, allowlisted navigation, account-entitlement foundations, and no paid-model fallback."
  },
  servers: [{ url: BASE_URL }],
  paths: {
    "/health": {
      get: {
        summary: "Service health",
        responses: { "200": { description: "Health status" } }
      }
    },
    "/readiness": {
      get: {
        summary: "Deployment readiness",
        description: "Reports testnet subsystem readiness and intentionally separate production blockers without exposing secret values.",
        responses: { "200": { description: "Deployment readiness checks and score" } }
      }
    },
    "/verify": {
      post: {
        summary: "Issue a fact lease",
        description: "Requires an x402 v2 payment on Base Sepolia during testnet validation. Requests must be application/json and are limited to 16384 bytes. New leases return issued_status and current_status equal to the issued verdict. If signing is configured, the response also includes issued_attestation and an Ed25519 signature envelope.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["claim", "source_url"],
                properties: {
                  claim: { type: "string", maxLength: 1000 },
                  source_url: { type: "string", format: "uri" },
                  ttl_seconds: { type: "integer", minimum: 60, maximum: 604800, default: 3600 }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Fact lease or UNKNOWN source result after valid payment" },
          "400": { description: "Invalid request" },
          "402": { description: "x402 payment required" },
          "413": { description: "Verification request body exceeds 16384 bytes" },
          "415": { description: "Verification request body is not application/json" },
          "429": { description: "Verification request rate limit exceeded" }
        }
      }
    },
    "/assistant/voice": {
      post: {
        summary: "Ask the ProofTTL product assistant by voice",
        description: "Accepts a short audio recording and returns text. Voice and text share one daily assistant allowance. A valid audio request consumes quota immediately before transcription. Invalid/empty audio is rejected before quota is consumed. Navigation is restricted to allowlisted ProofTTL routes. Audio is not stored. The assistant fails closed when free AI capacity is unavailable.",
        requestBody: {
          required: true,
          content: {
            "audio/*": {
              schema: { type: "string", format: "binary", maxLength: 524288 }
            }
          }
        },
        responses: {
          "200": { description: "Transcript, text response, optional navigation action, and quota state" },
          "413": { description: "Audio body exceeds the configured maximum" },
          "415": { description: "Request body is not audio/*" },
          "422": { description: "Speech was not recognized" },
          "429": { description: "Assistant rate or daily quota exceeded" },
          "503": { description: "Assistant safety binding or free AI capacity unavailable" }
        }
      }
    },
    "/assistant/text": {
      post: {
        summary: "Ask the ProofTTL product assistant by text",
        description: "Accepts a ProofTTL product question. General-purpose chat is intentionally out of scope. Optional recent conversation history is bounded to six user/assistant messages of at most 600 characters each. Deterministic navigation commands do not invoke the text model or consume AI quota. Text and voice otherwise consume the same daily allowance.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message"],
                properties: {
                  message: { type: "string", maxLength: 1200 },
                  history: {
                    type: "array",
                    maxItems: 6,
                    items: {
                      type: "object",
                      required: ["role", "content"],
                      additionalProperties: false,
                      properties: {
                        role: { type: "string", enum: ["user", "assistant"] },
                        content: { type: "string", maxLength: 600 }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Text response, optional navigation action, context metadata, and quota state" },
          "400": { description: "Invalid or empty message" },
          "415": { description: "Request body is not application/json" },
          "429": { description: "Assistant rate or daily quota exceeded" },
          "503": { description: "Assistant safety binding or free AI capacity unavailable" }
        }
      }
    },
    "/assistant/usage": {
      get: {
        summary: "Read current assistant quota",
        description: "Returns current daily assistant usage without invoking AI inference. Anonymous requests use a keyed pseudonymous subject; credentialed clients may resolve an account entitlement.",
        responses: { "200": { description: "Assistant quota and plan state" } }
      }
    },
    "/account/entitlement": {
      get: {
        summary: "Read signed-in account entitlement",
        description: "Credentialed read-only endpoint for the signed-in account's server-controlled plan and assistant limit. This endpoint cannot grant or mutate membership.",
        responses: {
          "200": { description: "Account plan, membership status, assistant daily limit, and billing availability" },
          "401": { description: "Authentication required" }
        }
      }
    },
    "/lease/{lease_id}": {
      get: {
        summary: "Read a stored fact lease",
        description: "issued_status preserves the verdict at issuance. current_status is the latest observed verdict and should be preferred when evaluating the lease now. The legacy status field remains the original issued verdict for compatibility. Signed leases retain their immutable issuance attestation while monitoring state can evolve independently.",
        parameters: [{ name: "lease_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Stored fact lease including issued_status, current_status, lease_state, and signature fields when signing was enabled at issuance" }, "404": { description: "Lease not found" } }
      }
    },
    "/lease/{lease_id}/reverify": {
      post: {
        summary: "Manual reverification disabled on the public API",
        description: "Active leases are automatically reverified by ProofTTL. This public endpoint is disabled to prevent unmetered source-fetch and AI compute abuse.",
        parameters: [{ name: "lease_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "403": { description: "Manual reverification disabled" } }
      }
    },
    "/monitor/status": {
      get: {
        summary: "Automatic monitor status",
        responses: { "200": { description: "Last automatic monitor run" } }
      }
    },
    "/.well-known/proofttl.json": {
      get: {
        summary: "Machine-readable ProofTTL discovery document",
        responses: { "200": { description: "Discovery metadata including current capabilities and payment terms" } }
      }
    },
    "/.well-known/proofttl-assistant.json": {
      get: {
        summary: "Machine-readable ProofTTL Assistant contract",
        responses: { "200": { description: "Assistant interaction, context, quota, model, retention, and navigation metadata" } }
      }
    },
    "/.well-known/proofttl-keys.json": {
      get: {
        summary: "Public Fact Lease verification keys",
        description: "Returns the active public Ed25519 verification key when issuance signing is configured. Never exposes the private signing key.",
        responses: { "200": { description: "Public signing-key metadata" } }
      }
    },
    "/pricing": {
      get: {
        summary: "Machine-readable pricing status",
        responses: { "200": { description: "Current pricing and payment mode" } }
      }
    },
    "/openapi.json": {
      get: {
        summary: "OpenAPI document",
        responses: { "200": { description: "OpenAPI 3.1 schema" } }
      }
    }
  }
};
