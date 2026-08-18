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
    id: "contradicted_scope_overclaim",
    claim: "All regions support IPv6.",
    source: "IPv6 support is currently available only in US-East and EU-West regions. Other regions are still being evaluated.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_scope_unspecified_region",
    claim: "AP-South supports IPv6.",
    source: "IPv6 is confirmed for US-East and EU-West. This document does not provide the IPv6 status of AP-South.",
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
  },
  {
    id: "supported_equivalent_units",
    claim: "The upload timeout is two minutes.",
    source: "Uploads are terminated after 120 seconds if no completion response has been received.",
    expected: "SUPPORTED"
  },
  {
    id: "contradicted_unit_value",
    claim: "The maximum payload size is 2 MB.",
    source: "Requests are rejected when the payload exceeds the configured 1 MB maximum.",
    expected: "CONTRADICTED"
  },
  {
    id: "supported_value_inside_range",
    claim: "A retry delay of 5 seconds is allowed.",
    source: "Clients may configure retry delays anywhere from 3 through 10 seconds, inclusive.",
    expected: "SUPPORTED"
  },
  {
    id: "unknown_typical_not_hard_limit",
    claim: "The retry delay has a hard maximum of 10 seconds.",
    source: "Retry delays are typically between 3 and 10 seconds, but deployments may use different values.",
    expected: "UNKNOWN"
  },
  {
    id: "contradicted_minimum_requirement",
    claim: "The minimum memory requirement is 16 GB.",
    source: "The documented minimum memory requirement for this service is 8 GB.",
    expected: "CONTRADICTED"
  },
  {
    id: "supported_exception",
    claim: "Enterprise accounts are exempt from the export cap.",
    source: "A monthly export cap applies to Starter and Pro customers; Enterprise customers are not subject to that cap.",
    expected: "SUPPORTED"
  },
  {
    id: "contradicted_universal_with_exception",
    claim: "Every plan is limited to 100 exports per month.",
    source: "Starter and Pro plans are capped at 100 exports monthly, while Enterprise exports are unlimited.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_target_date_not_commitment",
    claim: "Feature Nova launches on September 1, 2026.",
    source: "The team is targeting an early September 2026 launch for Nova, but the release date has not been committed.",
    expected: "UNKNOWN"
  },
  {
    id: "contradicted_negation",
    claim: "Request logs do not store client IP addresses.",
    source: "For abuse prevention, request logs retain the originating client IP address for seven days.",
    expected: "CONTRADICTED"
  },
  {
    id: "supported_negation",
    claim: "Anonymous telemetry excludes IP addresses.",
    source: "The anonymous telemetry stream does not collect or retain any client IP address information.",
    expected: "SUPPORTED"
  },
  {
    id: "contradicted_current_version",
    claim: "The current stable release is version 8.4.",
    source: "Version 8.5 is the current stable release. Version 8.4 remains available in the archived downloads section.",
    expected: "CONTRADICTED"
  },
  {
    id: "supported_list_membership",
    claim: "PNG images are accepted for upload.",
    source: "Accepted image formats include JPEG, PNG, and WebP files.",
    expected: "SUPPORTED"
  },
  {
    id: "contradicted_list_exclusion",
    claim: "TIFF images are accepted for upload.",
    source: "Only JPEG, PNG, and WebP images are accepted; TIFF files are rejected.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_open_ended_format_list",
    claim: "CSV import is supported.",
    source: "Built-in import supports JSON and XML. Additional formats may be available through optional plugins, but they are not listed here.",
    expected: "UNKNOWN"
  },
  {
    id: "supported_time_comparison",
    claim: "Maintenance finished before 11:00 UTC.",
    source: "The maintenance operation completed successfully at 10:45 UTC.",
    expected: "SUPPORTED"
  },
  {
    id: "contradicted_expiration_date",
    claim: "The certificate remains valid through June 30, 2027.",
    source: "The certificate expires on June 15, 2027 and must be renewed before that date.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_approximate_count",
    claim: "The cluster contains exactly 200 nodes.",
    source: "The cluster currently contains roughly 200 active nodes, with the total fluctuating during autoscaling.",
    expected: "UNKNOWN"
  },
  {
    id: "supported_inclusive_maximum",
    claim: "A batch may contain 1,000 records.",
    source: "The batch endpoint accepts up to and including 1,000 records per request.",
    expected: "SUPPORTED"
  },
  {
    id: "contradicted_above_maximum",
    claim: "A batch may contain more than 1,000 records.",
    source: "The endpoint enforces a hard maximum of 1,000 records in each batch.",
    expected: "CONTRADICTED"
  },
  {
    id: "unknown_outdated_beta_status",
    claim: "The Beta program is currently open to every user.",
    source: "This six-month-old enrollment notice describes an earlier Beta phase. The present enrollment status is not stated in this document.",
    expected: "UNKNOWN"
  }
]);
