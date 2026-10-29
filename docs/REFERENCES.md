# Design references

These references inform the design; they are not runtime dependencies or claims
that this system reproduces a published benchmark.

- [Pi](https://github.com/earendil-works/pi): provider-independent session/tool
  runtime. The development harness pins the installed SDK to 1.4.0 and supplies
  an explicit resource loader and tool allowlist.
- [DeepSeek official API documentation](https://api-docs.deepseek.com/quick_start/pricing):
  current alias routing for `deepseek-flash` to DeepSeek-V4.1-Flash-1017. This is
  documentation of the service alias, not independent verification of weights.
- [K-Dense scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills),
  particularly [scientific-critical-thinking](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/scientific-critical-thinking/SKILL.md)
  and [literature-review](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/literature-review/SKILL.md):
  adapted into `sae-interpretation` and `source-grounding` version 0.2.0, using
  upstream skill versions 1.5 and 1.11 and the latter's `core_workflow.md`, read
  2026-10-29. These are substantive domain adaptations, not summaries intended
  to minimize skill length. They preserve appraisal and retrieval methodology
  while replacing clinical/review deliverables with microbial feature evidence
  and role handoffs. The selected skill bodies are loaded in full; there are no
  inaccessible supporting references. The collection is not installed wholesale.
  See [attribution and MIT permission](KDENSE_LICENSE.txt).
- Kassis, T., Agarwal, V., He, Y., Patel, D., & Brueckner, A. M. (2026).
  [Scientific Agent Skills: A Library of Procedural Knowledge for Research Agents](https://doi.org/10.48550/arXiv.2609.00065).
  arXiv metadata checked 2026-10-29 (latest record v2); no task-level evaluation
  is implied by adopting its procedural guidance.
- [OpenAI GPT-6 Sol model documentation](https://developers.openai.com/api/docs/models/gpt-6-sol)
  and [Sign in with ChatGPT inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference):
  exact Sol/high profile through Pi, separate from the historical Codex CLI.

The retrieved literature itself is selected per feature and retained only in
private run archives. No source is considered supporting merely because its DOI
exists. A formal BioReason-Pro-inspired evaluation and independent judge remain
separate future work; the internal audit is not presented as that evaluation.
