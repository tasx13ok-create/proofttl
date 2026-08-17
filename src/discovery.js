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
    "source_fingerprinting"
  ],
  verdicts: ["SUPPORTED", "CONTRADICTED", "UNKNOWN"],
  lease_states: ["ACTIVE", "REVOKED", "EXPIRED"],
  endpoints: {
    health: { method: "GET", path: "/health" },
    verify: { method: "POST", path: "/verify" },
    lease: { method: "GET", path: "/lease/{lease_id}" },
    reverify: { method: "POST", path: "/lease/{lease_id}/reverify" },
    monitor: { method: "GET", path: "/monitor/status" },
    pricing: { method: "GET", path: "/pricing" },
    openapi: { method: "GET", path: "/openapi.json" }
  },
  payments: {
    protocol: "x402",
    enabled: false,
    mode: "free_beta",
    target_network: "eip155:84532",
    production_network: "eip155:8453",
    asset: "USDC",
    price_per_verification: null,
    status: "awaiting_recipient_wallet"
  }
};

export const PRICING = {
  service: "ProofTTL",
  mode: "free_beta",
  verify: {
    current_price_usd: 0,
    payment_required: false
  },
  planned_payment_protocol: "x402",
  test_network: "eip155:84532",
  production_network: "eip155:8453",
  asset: "USDC"
};

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "ProofTTL API",
    version: "0.3.1",
    description: "Issue and monitor expiring, source-backed fact leases. ProofTTL verifies whether a specified public source currently supports an exact claim; it does not claim universal truth."
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
          "200": { description: "Fact lease or UNKNOWN source result" },
          "400": { description: "Invalid request" },
          "402": { description: "Payment required when x402 billing is enabled" }
        }
      }
    },
    "/lease/{lease_id}": {
      get: {
        summary: "Read a stored fact lease",
        parameters: [{ name: "lease_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Stored fact lease" }, "404": { description: "Lease not found" } }
      }
    },
    "/lease/{lease_id}/reverify": {
      post: {
        summary: "Manually reverify a lease",
        parameters: [{ name: "lease_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Updated lease and check result" }, "404": { description: "Lease not found" } }
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
