import * as z from "zod/v4";

const label = z.string().max(300).optional();
const consequence = z.enum(["low", "medium", "high", "critical"]);
const auditId = z.string().regex(/^aud_[a-f0-9]{32}$/);
const resultId = z.string().regex(/^acr_[a-f0-9]{32}$/);
export const SOURCE_POLICY_SCHEMA = z.enum(["customer_only", "customer_plus_public", "public_only"])
  .describe("customer_only uses supplied evidence exclusively. Other policies still use supplied evidence; automatic public discovery is not supported.");
export const SOURCE_SCHEMA = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(100000),
    label
  }).strict(),
  z.object({
    kind: z.literal("file"),
    content_base64: z.string().min(4).max(133336).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    mime_type: z.literal("text/plain"),
    filename: z.string().max(300).optional(),
    label
  }).strict(),
  z.object({
    kind: z.literal("url"),
    url: z.string().url().max(2048).startsWith("https://").regex(/^[^?#]+$/)
      .describe("Public HTTPS URL without credentials, query, fragment, redirects, or private-network destinations. Only text/plain is accepted."),
    label
  }).strict()
]);
const sources = z.array(SOURCE_SCHEMA).max(20)
  .describe("Explicit supplied corpus; [] yields UNKNOWN. Files are UTF-8 text/plain snapshots, not live monitored uploads.");
export const TOOL_INPUT_SCHEMAS = {
  audit_claim: z.object({
    claim: z.string().min(1).max(4000).regex(/\S/),
    sources,
    source_policy: SOURCE_POLICY_SCHEMA,
    as_of: z.iso.datetime({ offset: true }).optional(),
    consequence: consequence.optional()
  }).strict(),
  audit_output: z.object({
    output_text: z.string().min(1).max(50000).regex(/\S/),
    sources,
    source_policy: SOURCE_POLICY_SCHEMA,
    max_claims: z.number().int().min(1).max(100).optional(),
    consequence_threshold: consequence.optional()
  }).strict(),
  challenge_claim: z.object({ audit_id: auditId, claim_result_id: resultId }).strict(),
  compare_evidence: z.object({ audit_id: auditId, claim_result_id: resultId.optional() }).strict(),
  create_fact_lease: z.object({
    audit_id: auditId,
    claim_result_id: resultId,
    ttl_seconds: z.number().int().min(60).max(604800),
    idempotency_key: z.string().min(8).max(200).regex(/^[A-Za-z0-9_.:-]+$/)
  }).strict(),
  get_fact_lease: z.object({ lease_id: z.string().regex(/^ftl_[a-f0-9]{32}$/) }).strict()
};
export const MCP_TOOL_NAMES = Object.freeze(Object.keys(TOOL_INPUT_SCHEMAS));
