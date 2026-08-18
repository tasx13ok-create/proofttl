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
    "x402_payments"
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
    automatic_checks_per_monitor_run: 10
  },
  endpoints: {
    health: { method: "GET", path: "/health" },
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
    openapi: { method: "GET", path: "/openapi.json" }
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
  production_network: "eip155:8453",
  production_enabled: false
};

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "ProofTTL API",
    version: "0.3.1",
    description: "Issue and monitor expiring, source-backed fact leases. ProofTTL verifies whether a specified public source currently supports an exact claim; it does not claim universal truth. POST /verify is currently protected by an x402 v2 Base Sepolia test payment. Active leases are automatically reverified; public manual reverification is disabled. Stored leases expose issued_status and current_status so the original verdict is preserved without hiding later changes."
  },
  servers: [{ url: BASE_URL }],
  paths: {
    "/health": {
      get: {
        summary: "Service health",
        responses: { "200": { description: "Health status" } }
      }
    },
    "/verify": {
      post: {
        summary: "Issue a fact lease",
        description: "Requires an x402 v2 payment on Base Sepolia during testnet validation. Requests must be application/json and are limited to 16384 bytes. New leases return issued_status and current_status equal to the issued verdict.",
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
    "/lease/{lease_id}": {
      get: {
        summary: "Read a stored fact lease",
        description: "issued_status preserves the verdict at issuance. current_status is the latest observed verdict and should be preferred when evaluating the lease now. The legacy status field remains the original issued verdict for compatibility.",
        parameters: [{ name: "lease_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Stored fact lease including issued_status, current_status, and lease_state" }, "404": { description: "Lease not found" } }
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
        responses: { "200": { description: "Discovery metadata" } }
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
