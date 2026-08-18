# ProofTTL Voice Assistant

ProofTTL includes a bounded voice-input / text-output product assistant designed to help users understand and navigate ProofTTL without adding a paid AI dependency to launch.

## Interaction contract

- Endpoint: `POST /assistant/voice`
- Request body: a short `audio/*` recording
- Response: `application/json`
- User input: microphone only in the intended frontend
- Assistant output: text only
- v1 does not synthesize speech
- v1 does not persist the uploaded audio

Machine-readable runtime metadata is exposed at:

`GET /.well-known/proofttl-assistant.json`

The OpenAPI document at `/openapi.json` also describes the endpoint.

## Inference path

1. The Worker validates method, content type, body size, AI binding, and assistant rate limiter.
2. The request is rate-limited before any AI inference.
3. `@cf/openai/whisper` transcribes the bounded audio body.
4. A deterministic, allowlisted navigation router handles obvious product-navigation requests without calling a text model.
5. Other ProofTTL product questions use `@cf/ibm-granite/granite-4.0-h-micro` with a short fixed system prompt and a small output cap.
6. The Worker returns the transcript, a text response, and an optional structured navigation action.

## Cost containment

The assistant must remain compatible with ProofTTL's zero-upfront-cost launch policy.

Current controls:

- maximum audio request body: 524288 bytes by default
- `ASSISTANT_RATE_LIMITER`: 12 requests per 60 seconds per client/IP bucket
- navigation requests skip text-model inference when deterministically recognized
- text generation is capped at 120 tokens
- prompts are intentionally small and ProofTTL-specific
- there is no paid-provider fallback
- when free Workers AI capacity or the configured model is unavailable, the endpoint returns HTTP 503

Do not add a paid fallback, automatic billing path, or alternate paid inference provider without an explicit product decision.

## Privacy

v1 processes the audio request in memory for transcription. The assistant does not write audio or transcripts to KV, D1, R2, logs, analytics, or another persistence layer.

Operational logs must not include raw audio or transcript contents. Current failure logs record only a high-level event and error name.

If transcript or audio retention is ever added, it must be opt-in where appropriate, documented, bounded by a retention policy, and reviewed before deployment.

## Navigation safety

The assistant may return non-destructive navigation instructions only from a fixed allowlist. It must not generate arbitrary URLs, selectors, script URLs, or user-provided navigation targets.

Current destinations include:

- Console / Payments
- Console / Security
- Console / Fact Leases
- Console / Usage
- Console / API
- Console / Account
- Support
- Get Started / pricing
- Solutions
- Sign in
- Home

The frontend may navigate or focus these destinations automatically.

Any action that changes persistent state must remain outside this automatic navigation path. Account changes, security changes, session actions, payments, support submissions, billing actions, and similar mutations require a real authenticated backend capability and explicit user action/confirmation.

## Response example

A deterministic navigation request can return:

```json
{
  "transcript": "Take me to payments",
  "response": "Opening Payments.",
  "action": {
    "type": "navigate",
    "route": "/console/",
    "section": "payments"
  },
  "inference": {
    "transcription_model": "@cf/openai/whisper",
    "response_model": null,
    "deterministic_route": true
  }
}
```

A normal ProofTTL question returns `action: null` and uses the configured lightweight response model after transcription.

## Deployment verification

After deploying the Worker, verify all of the following before treating the assistant as live:

1. `GET /.well-known/proofttl-assistant.json` returns HTTP 200 and `configured: true`.
2. Browser preflight to `/assistant/voice` succeeds through the outer CORS wrapper.
3. A short supported microphone recording returns a transcript and text response.
4. “Take me to payments” returns the allowlisted Payments navigation action without a response-model call.
5. Unsupported content types return HTTP 415.
6. Oversized audio returns HTTP 413 before inference.
7. Rate-limit exhaustion returns HTTP 429 with `Retry-After`.
8. AI capacity/model failure returns HTTP 503 and never switches providers.
9. No request path writes audio/transcript content to persistent storage.

The backend implementation being present in Git is not proof that the live Worker has been redeployed. Verify the deployed endpoint before advertising it as live.
