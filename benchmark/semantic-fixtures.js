export const SEMANTIC_FIXTURES = Object.freeze([
  {
    id: "supported_numeric_paraphrase",
    claim: "Acme API timeout is 30 seconds.",
    source: "For Acme API requests, the timeout is currently set to 30 seconds for all standard clients.",
    expected: "SUPPORTED"
  },
  {
    id: "contradicted_numeric_value",
    claim: "Acme API timeout is 30 seconds.",
    source: "For Acme API requests, the timeout is currently set to 45 seconds for all standard clients.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_missing_value",
    claim: "Acme API timeout is 30 seconds.",
    source: "Acme API timeout settings are configurable by administrators and are documented in the dashboard.",
    expected: "UNKNOWN"
  },
  {
    id: "supported_boolean_paraphrase",
    claim: "Feature Orion is enabled.",
    source: "Current feature flags show Orion with status ON for production accounts.",
    expected: "SUPPORTED"
  },
  {
    id: "contradicted_boolean",
    claim: "Feature Orion is enabled.",
    source: "Current feature flags show Orion as disabled for production accounts.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_scope_overclaim",
    claim: "All regions support IPv6.",
    source: "IPv6 support is currently available in US-East and EU-West regions. Other regions are being evaluated.",
    expected: "UNKNOWN"
  },
  {
    id: "contradicted_date",
    claim: "Scheduled maintenance starts on August 18, 2026.",
    source: "The scheduled maintenance window begins on August 19, 2026 at 02:00 UTC and lasts two hours.",
    expected: "CONTRADICTED"
  },
  {
    id: "contradicted_qualifier",
    claim: "The Pro plan includes unlimited exports.",
    source: "The Pro plan includes up to 100 exports per month. Additional exports require an Enterprise plan.",
    expected: "CONTRADICTED"
  },
  {
    id: "contradicted_reversibility",
    claim: "Account deletion is irreversible.",
    source: "Deleted accounts can be restored by an administrator for up to 30 days after deletion.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_entity_mismatch",
    claim: "Project Atlas is publicly available.",
    source: "Project Apollo is publicly available today. Documentation for Project Atlas is still being prepared.",
    expected: "UNKNOWN"
  },
  {
    id: "supported_percentage",
    claim: "The service uptime target is 99.9%.",
    source: "Our published service-level objective sets the monthly uptime target at 99.9%, measured across the full service.",
    expected: "SUPPORTED"
  },
  {
    id: "unknown_conditional",
    claim: "Backups are retained for 30 days.",
    source: "Backups may be retained for 30 days when extended retention is enabled; otherwise retention depends on plan settings.",
    expected: "UNKNOWN"
  },
  {
    id: "contradicted_direction",
    claim: "Latency decreased by 20%.",
    source: "The latest measurement shows latency increased by 20% compared with the previous release.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_stale_looking",
    claim: "The current release is version 8.4.",
    source: "Archived release notes from 2024 describe version 8.4. Refer to the current release page for the latest version.",
    expected: "UNKNOWN"
  }
]);
