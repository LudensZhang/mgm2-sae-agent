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
  references for evidence quality, alternative explanations, source identity and
  source-level verification. Our two short skills are newly written for microbial
  SAE interpretation. The upstream skill collection is not installed, bundled or
  loaded wholesale; systematic-review, diagram-generation and extra model calls
  are not part of this harness.

The retrieved literature itself is selected per feature and retained only in
private run archives. No source is considered supporting merely because its DOI
exists. A formal BioReason-Pro-inspired evaluation and independent judge remain
separate future work; the internal audit is not presented as that evaluation.
