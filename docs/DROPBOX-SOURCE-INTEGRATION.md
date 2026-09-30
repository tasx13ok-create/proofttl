# Dropbox customer evidence boundary

Assessment: 2026-09-29. DESIGN ONLY. Installed connector contracts were inspected without invoking Dropbox account, listing, fetching or download operations. No customer files accessed. Implementation waits for the first real OpenAI-host authenticated audit/lease PASS.

## Available connector contract

| Capability | Observed contract | ProofTTL boundary |
| --- | --- | --- |
| search / list_folder | File IDs and namespace paths, cursor pagination | User-authorized selection only; do not scan an account automatically. Preserve namespace prefix. |
| get_file_metadata | Nested metadata_type file/folder; file id, rev, size, MIME, read permissions | Verify actual file/readability and limits before content retrieval. Missing size may serialize an empty file as absent. |
| fetch | Extracted full text, title, URL, optional metadata; connector extraction backend; max5MiB | Can supply an explicitly labeled text snapshot, but cannot prove original raw bytes, original-file hash or extractor offsets. |
| download_link | Up to25 file identifiers; single-use temporary URL,60–900seconds/default600; ID,size,content_hash,MIME | Sensitive retrieval capability; any first request including HEAD/Range consumes it. Never store in source/audit/lease/logs or pass as canonical URL evidence. |
| file_preview | Thumbnail/open-in-Dropbox presentation | Not evidence bytes. |
| sharing/write operations | Share/copy/upload/move/delete available | Unneeded for audits; do not invoke or duplicate Dropbox storage. |

These are available tool contracts, not evidence that a selected account/file flow was executed. The account tier does not override consent, connector limits, ProofTTL limits or format gates.

## Conversion to immutable snapshots

The selected account owns the Dropbox OAuth grant. A host-mediated authorized extraction may send `{kind:"text",text,label}` after explicit user selection. Label it connector-extracted text; ProofTTL hashes only the received UTF8 snapshot and normalized text. Do not claim a raw Dropbox-file hash from fetch.text.

For original bytes, a future trusted connector bridge must retrieve the authorized chosen revision, stream with a hard byte limit and timeout, reject unsupported types and decode UTF8 strictly. For allowed plain text, send `{kind:"file",content_base64,mime_type:"text/plain",filename,label}` to the unchanged audit schema. The service computes its own raw SHA256 and normalized-text SHA256. Current limits remain100000bytes/source,500000corpus,20sources; connector5MiB is not ProofTTL acceptance.

Keep selected file ID/revision and retrieval time in a separately authorized provenance design, not ad hoc extra tool fields. Detect metadata/content revision races; an unpinned snapshot cannot claim a specific revision. Abort on incomplete download, invalid UTF8, oversized content or uncertain permission. Use immutable observations; Dropbox modifications do not silently mutate an existing lease or enable monitoring.

Dropbox content_hash is a different construction: SHA256 of concatenated binary SHA256 digests of4MiB chunks. Preserve it as provider metadata only after explicit provenance support and verify with its own algorithm; never substitute it for raw SHA256. [Official content-hash definition](https://www.dropbox.com/developers/reference/content-hash)

## Separate authorization boundaries

ChatGPT→ProofTTL OAuth authorizes tenant tools. ChatGPT→Dropbox authorizes that connector's files. Neither grant implies the other or grants ProofTTL direct Dropbox access. Never send a ProofTTL access token to Dropbox, or a Dropbox token to ProofTTL tools, leases, source objects or UI.

A future direct backend integration needs its own registered Dropbox application, least read scopes, exact redirect registration, authorization code/PKCE, protected server token vault, account/tenant binding, rotation/revocation and disconnect semantics. Existing connected Dropbox credentials cannot be extracted or reused by this project. Dropbox recommends code flow, minimal scopes and PKCE where secrets cannot be protected. [Official OAuth guide](https://docs.dropboxapi.com/dropbox-api/docs/oauth)

Temporary download URLs are bearer capabilities, not durable citations. They must be consumed only inside the authorized bridge, held ephemerally and discarded. No URL unfurling/HEAD preflight. No external CDN/log forwarding. Do not route them through the public source fetcher: the current public URL source contract intentionally refuses private credential-bearing references.

## PDF and other formats: separate gate

PDF is NOT SUPPORTED merely because Dropbox fetch extracts some text. A raw-file integration must first prove sandboxed extraction with byte/page/decompression limits; malformed/encrypted documents; embedded files; JavaScript/actions; image-only/OCR policy; reading order/tables/hidden text; raw-file and extracted-text hashes; deterministic extractor/version; provenance offsets; partial extraction refusal; and adversarial regressions. Extracted third-party text may be explicitly audited as supplied text, with original-file fidelity NOT PROVEN.

Future tests must cover wrong-account/tenant selection, revoked grants, private namespace preservation, revision races, single-use expiry/retry, redirect/token leakage, byte/hash mismatch and unsafe content. No Dropbox end-to-end or PDF PASS is recorded here.
