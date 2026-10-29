# Efficiency work: 2026-10-29

## Scope and invariants

This development task pauses further SAE layer-selection interpretation. It does
not change the SAE, select a layer, lower model reasoning, remove literature
grounding, or introduce an external judge. Development uses the explicitly
authorized official DeepSeek Flash/max route, not Bailian. After the first pilot,
the user separately authorized one matched GPT-6.1 Sol/high run through Pi and
ChatGPT subscription OAuth to distinguish model capability from harness effects.
This authorization does not resume the layer-selection batch or permit 6 Sol.

All five independent sessions and both complete adapted skills remain. Existing
records, scientific denominators, discovery-only boundaries, privacy gates,
source provenance, and the independent candidate audit are unchanged.
`pi-web-access` and `pi-subagents` are not modified.

## Research informing the design

The papers motivate hypotheses, not promises of equivalent gains on microbial
SAE interpretation. Their tasks, models, cost accounting and correctness tests
differ from ours.

| Primary source | Relevant finding or design | Decision here |
| --- | --- | --- |
| [ReWOO (2023)](https://arxiv.org/abs/2305.18323) | Separates planning from observations to avoid repeated reasoning/tool context. | Batch independent evidence reads; do not introduce a rigid up-front literature plan when later evidence may change the question. |
| [AgentDiet, FSE 2026](https://arxiv.org/html/2509.23586v2) | Identifies redundant, useless and expired trajectory information; evaluates reduction against task performance and cost. | Measure actual trajectories first. Remove a completed-role acknowledgement; avoid LLM-based deletion of scientific evidence in the first experiment. |
| [AgentFold (2025)](https://arxiv.org/html/2510.24699) | Trained web agents manage history with granular folding while retaining recent interactions. | Artifact references and bounded context are useful principles. Its learned policy is not a drop-in plugin or validated result for this agent. |
| [ACE, ICLR 2026](https://arxiv.org/html/2510.04618) | Warns about brevity bias and context collapse; uses structured, incremental updates rather than repeated monolithic rewrites. | Preserve the full domain skills. Consider role-specific delta reports only after transport-level changes are evaluated. |
| [PaperQA2 (2024)](https://arxiv.org/html/2409.13740v2) | Separates search, evidence gathering and answer generation; ranks and summarizes source passages with provenance. | Keep cached originals and source verification. Query-focused source excerpts are a possible next step, not a reason to trust summaries instead of sources. Its extra summarizer also costs tokens. |
| [Anthropic context engineering (2025)](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | Just-in-time retrieval and progressive disclosure balance relevance with navigation overhead. | Keep on-demand detail, but expose all summary records in a single lossless view instead of forcing dozens of tiny reads. |
| [Anthropic multi-agent research (2025)](https://www.anthropic.com/research/multi-agent-research-system) | Reports high token use and limitations when agents must share heavily dependent context. | Five roles are not automatically optimal. Retain them for this controlled change; later test marginal value of roles without confusing fewer agents with equal quality. |

## Implemented changes

### Lossless evidence transport

`evidence_brief` exposes every exported `E.*` summary record, excluding selected
case records. `evidence_read_many` accepts explicit IDs. Identical flat value
schemas share column names and interpretation text in a table; rows retain their
original evidence IDs. Nested records remain unchanged. No rounding, enrichment
calculation, data imputation, taxonomy merging, inferred label or LLM summary is
performed. `unpackRecords(packRecords(records))` must equal the original object.

The evidence body (including category annotations, excluding pagination metadata)
is capped at 18,000 serialized characters and 64 IDs. Records are
never clipped to fit. `remaining_ids` explicitly lists data not returned and
not counted as read; the agent can request another batch or use existing JSON
Pointer/pagination. Full evidence is still available through `evidence_read`.
This is a transport-size bound, not a token or spending cap.

The observer starts with this summary. Other roles read the records relevant to
their independent checks. Merely receiving a record does not establish that a
model understood it; scientific fidelity still requires review.

The first live pilot exposed a semantic hazard already present in the raw packet:
an evidence ID suffix is a sorted record ordinal, not a category value. The next
revision attaches the abundance label resolved directly from
`codebook.abundance_bins[record.value.category]` to both single and bulk reads.
It never infers a label from an ID suffix or chooses a desired feature class.
The original records and IDs remain unchanged, and missing mappings stay missing.

### Terminal submission

A structurally accepted `submit_report` now returns Pi's native
`terminate: true`. The prompt requests submission in its own final tool batch.
The pinned SDK ends when all results in that batch are terminal. Validation
failures do not terminate and may be corrected within the existing request cap.
No fake assistant response, zero-token API call or swallowed provider failure
is used. A synthetic pinned-SDK test checks both success and rejection paths.

This removes the request that previously re-read the entire completed session
only to acknowledge an already saved role report. It does not bypass the
separate critic or audit.

## Why not just remove literature search?

Role-level usage is not causal attribution to web retrieval. The literature
role also reads local evidence, reasons and submits a report; other roles read
its sources. Repeated context, per-record tool wrappers, report handoffs,
reasoning output and acknowledgement requests all contribute. Cached input is
still recorded input; its price or subscription weight is not the same as
uncached input. Compare these separately.

The original MGM2 task renderer requested seven staged output files but
instructed the interpreter to use only deterministic local evidence. That
source code alone does not prove seven independently executed agents, actual
historical token consumption, or equivalent scientific grounding. Do not
attribute its apparent economy solely to a more efficient literature system.

## Measurement and acceptance

Use `scripts/profile_runs.mjs --run DIR [--run DIR] --out NEW_JSON` to collect
actual usage per role, post-submission usage, tool counts, tool errors and
payload character sizes. Character counts are diagnostics, not exact token
attribution. Reasoning is a subset of output, not an additional token total.
Catalogue dollar estimates are not invoices; Pro weekly quota is unobservable.

For live development, use an identical hashed packet and exact provider/model/
reasoning settings, preserve attempts and failures, and record mutable model
alias and live-search variability. A historical baseline plus one or two new
runs is a pilot, not a randomized quality benchmark.

Review numerical claims against the original packet, distinguish conditional
probabilities, check abundance labels, audit source entailment and organism/
setting scope, inspect control limitations, and confirm that material criticism
is actually addressed. An internal `supported` verdict is not independent
evidence of correctness; `revise` must remain visible. No gold feature label is
required or supplied.

Only after a varied, held-out development panel confirms fidelity and efficiency
should the harness be frozen and layer-selection work resumed. Candidate future
changes include exact source-span retrieval, bounded delta handoffs and role
ablations. Avoid adding another model solely to compress these short sessions
until its own cost and information loss are justified.

## Offline checks

```sh
node tests/core.test.mjs
node tests/terminal_sdk.test.mjs
```

The latter loads the pinned Pi installation but uses synthetic messages and no
credentials, network calls or scientific exports. All live artifacts remain
under ignored `runs/`; source data and reports must not be committed.
