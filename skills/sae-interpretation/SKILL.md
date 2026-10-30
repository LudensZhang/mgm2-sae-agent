---
name: sae-interpretation
description: Explain and critically assess microbial OTU-in-community SAE activation patterns using population evidence, community context, matched comparisons, and biological literature. Use for discovery interpretation and independent review, not clinical diagnosis or causal validation.
license: MIT
metadata:
  version: "0.4.0"
  adapted-from: K-Dense scientific-critical-thinking 1.5
---

# Interpreting a microbial SAE feature

## Purpose and operating context

Produce the most informative explanation supported by the **whole feature**, not
an expected label, a favorite organism, or a checklist score. The observation is
an OTU token in a microbial community. Activation is a learned representation;
it is not a measured pathway, species phenotype, or experimental intervention.
A descriptive or composite feature can be well interpreted without identifying
a mechanism. Conversely, avoid calling a feature unknown when a useful pattern
is established. The final name should communicate that pattern in plain biology.

This skill adapts K-Dense's question-first appraisal, evidence extraction,
design/bias assessment, scope-aware synthesis, and traceable critique to SAE
discovery. Use these methods proportionately; clinical GRADE/RoB scoring is not
an appropriate automatic grade for a learned feature. No supplementary skill,
shell command, or external model is needed to execute this workflow.

## 1. Establish what the evidence measures

Read the supplied population summary, codebook, evidence index, and partition.
Identify the activation threshold, token-selection rule, background population,
taxonomic assignment resolution, abundance transformation, and sampling unit
when documented. Distinguish sampled token events, distinct OTUs, communities,
and studies: repeated tokens from one study are not independent replication.
Do not infer clustering thresholds or preprocessing conventions from an OTU's
name or common practice. If a missing definition matters, check the relevant
record once, then state the specific unresolved definition and continue.

The packet is discovery evidence, not an independent confirmatory test. Top
examples are selected illustrations, not a random sample for prevalence claims.
Use population records to establish coverage and examples to understand it.
Read records selectively with `evidence_list` and `evidence_read`; paginate an
important truncated record instead of inferring its omitted fields. These tools
retrieve existing results; they do not run statistical analyses.

The `A.*` index exposes precomputed study rates, continuous abundance, within-OTU
comparisons and matched-pair differences. Read the sections that distinguish your
explanations, not the entire inventory. `X.case_groups` preserves how examples were
selected. Public study accessions are identifiers for research context, not secret
labels or proof of a technical artifact. Metadata coverage and source scope determine
whether a study-level description can be applied to an individual sample.

## 2. Build an integrated account before naming the feature

Inspect the available evidence across taxonomy, habitat, focal abundance,
community diversity/composition, study concentration, and technical metadata.
Use the joint pattern to formulate a leading explanation and a material
alternative, rather than forcing one of these axes to win in advance.

- **Taxonomy:** distinguish the highly enriched core from the fraction of all
  active events it covers. A narrowly enriched genus can explain a minority
  subpattern without describing the entire feature. Respect source namespaces,
  rank-specific unknowns, and the codebook's category definitions. In this exporter
  each OTU uses one selected taxonomy source, so source-prefixed categories at a
  single rank count disjoint events. Whether names from different systems denote
  the same biological lineage is a separate nomenclature question, not independent
  replication or automatic double-counting.
- **Environment:** establish both active-event composition and enrichment over
  the sampled background. A common environment can cover most activations with
  modest fold enrichment; its maximum possible enrichment is 1/background share.
  Raw fold enrichments at different category sizes or taxonomic resolutions do
  not by themselves rank explanatory importance.
- **Abundance:** use the five exported labels, from low through high relative
  abundance. State the within-community scale; a nonzero low bin is not absence,
  and bin labels are not universal percentage thresholds. Record bin prevalence
  and activation rate separately. Distinguish whether a correlation includes
  zeros, only active events, or a selected subset.
- **Community:** distinguish properties of the focal OTU from its surrounding
  community. Read focal-OTU-excluded summaries when available to assess whether
  diversity or composition associations are driven by the focal organism itself.
  Retained-token diversity need not equal diversity of the unfiltered sample.
- **Study and technical context:** distinguish absolute active counts from
  study-specific rates with their denominators. Concentration in one study may
  reflect sampling, population biology, or protocol; call it a study association
  unless evidence separates those explanations. Breadth across studies supports
  replication of a pattern, not absence of all batch effects.

Separate whole-population firing from strong-activation tails and activation mass.
The exported thresholds and denominators define these different views; a striking
top tail should not silently replace the whole-feature interpretation.

Keep four quantities separate: P(group | active), P(active | group), enrichment
P(group | active)/P(group), and activation magnitude. Quote the denominator with
any consequential percentage. Consider coverage and strength together; do not
select a name solely for the largest fold, smallest p-value, or top activation.

## 3. Test the explanation against informative contrasts

Choose a comparison that would distinguish the leading explanations, not simply
confirm the most memorable positive case. Useful questions include whether the
same OTU varies between communities, whether similarly abundant taxa differ,
and whether the pattern persists across studies or within the same habitat.
Use precomputed matched controls or conditional analyses when actually exported.
Check what was matched, sample size, residual imbalance, and comparison scope.

For sparse features, a small set of inactive random controls may be expected
from the base rate; it is not automatically strong specificity evidence. For a
context claim, within-OTU contrasts are more discriminating than unrelated taxa.
Matching on abundance does not automatically match taxonomy, environment, and
study. A representative case cannot establish an adjusted population effect.
The joint control group matches OTU, coarse habitat, technology and nearby raw
abundance; same-study and same-bin membership are separately reported. Use strict
and relaxed subsets at their actual coverage. A context-increment comparison tests
its named added variables, not all possible community information.

Distinguish an analysis that is unavailable from an analysis showing no effect.
Do not invent adjusted coefficients, uncertainty, significance, or replication.
If p-values are supplied, inspect effect size, dependence and multiplicity
before describing significance. Do not demand a causal experiment for a modest
descriptive claim; do require stronger evidence for causal or mechanistic names.

## 4. Integrate biology without transferring unsupported properties

Use the source-grounding skill when an external knowledge question can materially
improve an interpretation. Local taxonomy, habitat, abundance and study associations
do not require publications to be legitimate findings. A coherent ecological
relationship across taxa, meaningful subgroup, unresolved nomenclature, or missing
study background may warrant targeted research. Explain which claim the answer
could change; do not invent a question to justify a fixed literature stage.
Keep local evidence, external findings, and the inference connecting them
distinct. Literature can make a pattern biologically intelligible, but cannot
assign a strain's function to every OTU in a genus or establish an unmeasured
substrate from co-occurrence. Decide which portion of the activation pattern a
biological interpretation explains, and retain contrary or unexplained portions.

Prefer the best-supported level of explanation: a replicated broad association,
a taxon/context conjunction, or a bounded subgroup hypothesis can each be useful.
Use specific uncertainty attached to the affected claim, not repeated generic
warnings throughout the report. Do not invent precision to make a name sound
more biological, or discard a valid association because its mechanism is open.

## 5. Make the multi-agent collaboration consequential

- **Interpreter:** own the explanation and final candidate. Investigate local
  statistics and contrasts, request research only for a material knowledge
  question, integrate its answer, and address substantive review findings.
  Keep supported content when a proposed mechanism fails. The continuing
  interpreter performs synthesis; no separate summarizer is needed.
- **Researcher, when requested:** answer the specific biological or metadata
  question, challenge as well as support the proposed connection, and return
  findings with source scope and their consequence for the interpretation.
  Do not write another complete feature report or require a mechanism.
- **Independent reviewer:** assess the candidate against local evidence and
  original cached sources without inheriting the interpreter's deliberation.
  Judge coherence, coverage, quantitative fidelity and biological applicability,
  not an expected feature class. An objection is itself a claim requiring evidence.
  Return concise checks and material issues with `supported`, `revise` or
  `insufficient`; do not silently rewrite the candidate or invent objections.

For a revision, change affected claims and check new assertions; do not repeat an
entire investigation when the earlier checks remain valid. Persistent disagreements
or missing evidence stay visible rather than triggering an indefinite conversation.
The legacy five-stage comparator retains its assigned role contracts; these three
responsibilities describe the adaptive workflow.

Use the supplied role-specific submission fields. Lead with a concise English result;
put traceable supporting claims in `claims`, competing explanations in
`alternatives`, and only consequential gaps in `limitations`. A useful follow-up
should discriminate unresolved explanations, not prescribe an entire new study.

## 6. Write the result, not a disclaimer inventory

Put the principal finding first: what activates, in which contexts, and what makes
this feature distinctive. A well-supported association does not need to be preceded
by "merely descriptive", "marginal" or "unvalidated". Broad and mixed features can
have useful names; lack of a single taxon or mechanism is not itself failure.

Keep common sampling/confirmation information in the shared methods scope. Mention
it in the main statement only when essential to the feature's interpretation.
Use `claims` for quantitative support and scoped subgroup biology, `changes` for
responses to criticism, and `limitations` for unresolved issues that could change
the main name, explanation or applicability. Do not restate the same limitation in
all three places. Empty alternatives or limitations are appropriate when no material
issue remains. Preserve genuine contradictions and meaningful uncertainty; the aim
is informative specificity, not confidence for its own sake.
