# MGM2 SAE interpretation agent

A lightweight, evidence-first microbial SAE interpreter built on **Pi**, separate
from personal Pi configuration and from the historical Codex harness. All role
prompts and reports are English. This is a development harness, not a validated
biological annotation system or a completed model-comparison benchmark.

## Workflow

`observe → literature → critic → synthesis → audit`

Each role is a fresh Pi SDK session with a small, explicit handoff. The observer
examines activation statistics and controls; the literature role tests biological
interpretations; the critic checks alternatives; the synthesis responds to the
critique; the auditor independently reads evidence and cached sources. There is
no prescribed feature class or expected interpretation. The final interpretation
and audit remain separate: `revise` is not silently promoted to accepted.

The prompt contains an overview and evidence index, **not the complete bundle**.
Agents retrieve exact, paginated records using IDs and JSON Pointers. Report
validation checks structure and citation existence, not scientific correctness.
Events, communities and studies retain their original denominators.

## Setup

Requires Node.js **22.19+** and Pi **1.4.0**. Either reuse an existing Pi install:

```sh
export SAE_PI_PACKAGE=/path/to/node_modules/@earendil-works/pi-coding-agent
```

or install the pinned project dependencies:

```sh
npm ci --ignore-scripts
```

For web-enabled runs, point to an existing, unchanged `pi-web-access` **0.45.0**:

```sh
export SAE_WEB_PACKAGE=/path/to/node_modules/pi-web-access
```

The default plugin location is `~/.pi/agent/npm/node_modules/pi-web-access`.
The original MCP entry point is used; this project does not patch the plugin.
`pi-subagents` remains installed and untouched, but is **not invoked** by this
batch harness: the five roles are explicit SDK sessions. No global extensions,
personal skills, personal model defaults, shell tools or arbitrary file tools are
exposed to the interpreting model.

Credentials: set `DEEPSEEK_API_KEY` in your environment, or let the runner read
only the `deepseek` API-key entry from `~/.pi/agent/auth.json`. A different private
credential-file location can be supplied with `--auth-path`. Do not put a key in
a command argument, packet, committed file or issue. Shell-command credentials,
OAuth, gateway routing and Bailian fallback are intentionally unsupported here.

## Run

Prepare a packet **offline**, without Pi credentials or network access:

```sh
node src/cli.mjs --packet /private/anonymized/bundle.json --out runs/preflight
```

Explicitly authorize a bounded live development run:

```sh
node src/cli.mjs --packet /private/anonymized/bundle.json \
  --out runs/feature-debug-01 --live --web
```

Use a new output directory for each attempt. Existing attempts are never
overwritten or automatically resumed. Omitting `--web` disables live retrieval;
it does **not** simulate successful literature validation.

Development is pinned to official `deepseek / deepseek-flash`, `max`, at
`https://api.deepseek.com`. DeepSeek documents this alias as
**DeepSeek-V4.1-Flash-1017**; an alias is not an immutable backend snapshot. The
runner verifies model/provider and the serialized reasoning-effort setting. No
Codex model or Bailian model is invoked by the runner.

Bounds per feature: 40 provider requests, 10 per role, 6 searches, 6 source
fetches, 12 cached-content slices, 15 minutes total and 5 minutes per role;
16,384 output tokens per provider request (including reasoning). Requests and wall time are bounded,
but this is **not a fixed dollar spending cap**. Automatic provider retries are
disabled. The CLI exits nonzero on failure and preserves partial results.

## Evidence and source contract

The input adapter accepts `core.facts` (or `evidence.facts`), anonymized cases,
matched controls and explicitly exported deterministic `analysis_results`.
Prior model interpretations, previous source claims and selection strata are
not handed to agents. Only discovery evidence is allowed when a partition is
declared. The adapter is **not an anonymizer or a complete DLP system**: prepare
and review exports upstream. A sibling `private_identifiers.json` containing
arrays of raw sample/study IDs is used as an additional local deny-list and is
never sent to the model.

Live retrieval uses a fixed Exa backend through the plugin, without a secondary
LLM summarizer, browser cookies, remote hosted fetch providers or a paid PDF
model. PDF extraction uses `unpdf`. Public search queries and selected excerpts
leave the machine. The archive stores the plugin's **exact returned text**, URL,
timestamp and hash; it does not claim to contain an entire paper or PDF. Failed
fetches and search snippets must not be promoted to full-text evidence.

Other roles read the archive locally. The auditor must read source IDs cited by
the candidate, including disputed claims. Reading an excerpt is a necessary
condition, not proof that an agent understood or adequately checked it.

## Outputs and reproducibility

- `manifest.json`: code/packet hashes, declared model route and budgets.
- `<role>/prompt.json`, `invocation.json`, `events.jsonl`, `report.json`,
  `completion.json`: private audit trail, wire metadata and usage per role.
- `sources/`: immutable retrieval snapshots reused across roles.
- `interpretation.json`, `audit.json`, `completion.json`: candidate, internal
  assessment and total runtime/usage. Inspect the audit verdict as well as status.

Token fields are the Pi/API-reported usage fields; cached input is separate.
Dollar amounts are **Pi model-catalog estimates**, not an invoice. Pro weekly
quota percentages cannot be inferred from them. The internal same-model auditor
is not the planned independent GPT-6-astra blinded judge.

`runs/`, caches, datasets, local credentials and `node_modules/` are ignored.
Keep scientific data and logs outside Git. Commit source, prompts, synthetic
tests and documentation only. See [design references](docs/REFERENCES.md).

## Tests and next steps

```sh
node tests/core.test.mjs
```

Tests are synthetic and offline. Live trials must be reviewed for evidence
coverage, denomination errors, unsupported mechanisms and source usefulness.
Next: review a small varied feature panel, freeze the final SAE/evidence set,
then add explicit model adapters and the independently blinded judge. Other
providers, batch recovery and formal benchmark scoring are not implemented in
this first version. Do not extrapolate quality or speed from one feature.
