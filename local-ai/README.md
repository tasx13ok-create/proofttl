# ProofTTL local workstation

A local assistant for evidence lookup, code proposals, project checks and customer development. No model subscription, embeddings service, hosted database or sending integration. The working engine on this PC is a portable **llama.cpp CPU server** with the downloaded **Qwen3 1.7B Q4_K_M** model. Ollama is installed but its inference executable was missing; its model download worked. We left that installation intact and use the portable server at `127.0.0.1:11435`.

## Start tomorrow

Double-click `Start-LocalAI.cmd`, or in PowerShell from this folder:

```powershell
.\Start-LocalAI.ps1
```

It starts the server hidden on localhost, waits for health, then opens the CLI in your terminal. `/quit` exits the CLI. The model server may remain loaded; its PID is in `data/runtime.pid` when started by the script. To stop it, verify that PID refers to `llama-server.exe`, then use `Stop-Process -Id THE_VERIFIED_PID`. Do not stop other model servers by name.

The PC has approximately 16 GiB RAM. CPU inference works but can take tens of seconds. Keep context at 4096 tokens; close memory-heavy applications if needed. The model cannot match the paid assistant and may produce incorrect code or weak drafts. It must not approve factual findings on its own.

For a new PC: install Node LTS and Ollama from their official websites; clone both repositories as siblings; run `npm ci` here, then `Setup-LocalAI.ps1`. Setup downloads the pinned official llama.cpp CPU archive with SHA-256 validation and the free model via `ollama pull qwen3:1.7b`. Initial download requires the internet (about 1.4 GB model plus 18 MB runtime). Subsequent local inference needs no network. Files remain on your PC; electricity and any metered internet charges are outside this software's control.

Official references: https://docs.ollama.com/api/chat ; https://ollama.com/library/qwen3:1.7b ; https://github.com/ggml-org/llama.cpp/releases/tag/b10809 ; https://github.com/ggml-org/llama.cpp/tree/master/tools/server . The archive digest is pinned in Setup-LocalAI.ps1. Runtime/model files are private local data and not pushed to GitHub.

## Useful commands

```
/index
/search Stripe scope price
/read README.md
/work web
/check check
/work backend
/check test:audit-intake
/find-customers
/lead frigade.com
/draft-outreach frigade.com
/export-leads
/research AI support companies public documentation
/research https://frigade.com/
/note A lead asked to revisit after their October release.
/task 1 check web:check
/task 1 draft frigade.com
/resume
/status
```

The search command offers free browser search links. A URL triggers a read-only public page fetch that checks robots rules, bounds bytes/time, pins public IPv4 DNS and does not retry blocked pages. It does not scrape search engines or find personal emails. Use official business channels and inspect site terms. Some sites require manual reading; there is no evasion fallback. An observed product statement is not proof the statement is true or that its company has a defect.

`/learn relative/path.pdf` extracts text from PDFs inside the selected repository (20 MB / 100 pages maximum, 45-second worker limit). Scanned PDFs need separate local OCR. `/learn` also accepts text/source/Markdown. Secret/config/key paths and symlinks are excluded. `/note` stores and indexes local notes. General chat retrieves relevant snippets with file paths; it is not a full semantic knowledge graph.

## Code changes and guards

```
/propose app/some-small-file.tsx Clarify the label without changing behavior
```

This creates a JSON proposal under `data/drafts/`. Open it and review its complete replacement text. Then `/apply TIMESTAMP-proposal.json` requires you to type `APPLY`; it checks the original hash, saves a backup, applies one permitted file, and runs the repository's full local check. A failed test stays failed and the change remains available for inspection. No model-generated shell commands run. Script files, secrets and the workstation itself cannot be targets through this wrapper. Use ordinary Git to inspect and commit reviewed changes.

`/code task` creates a plan only; `/propose` and `/apply` implement the explicit change workflow. The autonomous queue performs index/check/research/brief/draft tasks; code tasks produce reviewable plans, not silently applied edits. Defaults: 4 tasks, at most 2 failures, 2 total attempts per task, no automatic failed-task retry. No new task starts after ten minutes; an already-running check is bounded to five minutes and a model request to three minutes. `/retry ID` is deliberate and works only below the attempt cap. Drafts/plans are `needs_review`, never falsely marked implemented.

The local scripts can execute the selected repositories' approved npm test/build scripts. Review repository changes before running them: this is a constrained personal tool, **not an OS sandbox for hostile code**. It cannot send email, push Git, deploy, buy anything or call arbitrary shell commands.

## Lead history and follow-ups

Leads are deduplicated by normalized domain. Reimporting research preserves outreach dates and suppression states. Imported seeds begin `research_ready` because earlier outreach history is unknown. Check sent mail and historical records manually; then record `/lead-state DOMAIN ready`. Only after you actually send a reviewed message, use `/lead-state DOMAIN sent YYYY-MM-DD`. The tool records it; it does not send it. It suggests a four-day follow-up, then a seven-day final follow-up. Declined/opt-out leads must not be contacted again. `/status` shows due follow-ups and interested leads.

## Data and recovery

`data/workstation.sqlite` holds indexed snippets, leads, tasks and event logs. `data/memory`, `projects`, `skills`, `research`, `leads`, `tasks`, `logs`, and `drafts` hold related artifacts. This folder and `config.local.json` are ignored by Git. They may contain customer/business material; back them up privately, never in public Git.

If the process crashes during `/resume`, a `data/tasks/run.lock` remains. Read its PID; use `Get-Process -Id PID` to check whether that exact process is still active. Only after confirming it has stopped, remove that one lock file with `Remove-Item -LiteralPath .\data\tasks\run.lock`. The next run marks interrupted tasks for review; use `/retry` deliberately. Do not delete the database to resolve a lock.

For model troubleshooting, inspect `data/logs/runtime-error.log`, and test `http://127.0.0.1:11435/health`. A broken model does not prevent `/search`, `/tasks`, `/lead` or `/check`. Reindex after editing docs. Keep both repo folders as siblings; update `DEFAULT_PROJECTS` only if you intentionally move them.

## Optional provider adapters

`config.example.json` demonstrates the Ollama adapter. The launch script creates `config.local.json` for the working llama.cpp OpenAI-compatible adapter. To use a repaired Ollama later, set `provider=ollama`, `baseUrl=http://127.0.0.1:11434`, and `model=qwen3:1.7b` in that local JSON file.

Remote adapters require **all** of: intentional `allowRemote: true`, an HTTPS endpoint, and `LOCAL_AI_REMOTE_KEY`. They are off by default and never selected as a fallback. Enabling one can disclose supplied context and incur provider charges; keep it off under the $0 budget. No credit or free-tier assumption is encoded.

Validate with `npm test`. Test results use a fake model for policy checks; see OPERATIONS/STATUS.md for the separate real CPU inference verification.
