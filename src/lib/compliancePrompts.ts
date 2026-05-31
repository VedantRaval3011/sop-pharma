/**
 * ═══════════════════════════════════════════════════════════════════════
 * Compliance Analysis Prompts
 * ═══════════════════════════════════════════════════════════════════════
 */

export const COMPLIANCE_OUTPUT_SCHEMA = {
  type: 'object',
  required: [
    'isClauseApplicable',
    'applicabilityReason',
    'sopSectionNumber',
    'sopSectionTitle',
    'complianceLevel',
    'matchConfidence',
    'issueType',
    'issueSeverity',
    'specificGap',
    'guidelineRequirement',
    'sopCurrentState',
    'sopTextSnippet',
    'suggestedAction',
    'suggestedText',
    'estimatedEffort',
    'priority',
  ],
  properties: {
    isClauseApplicable: { type: 'boolean' },
    applicabilityReason: { type: 'string', minLength: 20 },
    sopSectionNumber: { type: 'string' },
    sopSectionTitle: { type: 'string' },
    complianceLevel: {
      type: 'string',
      enum: ['compliant', 'partial', 'non-compliant', 'not-applicable', 'unable-to-determine'],
    },
    matchConfidence: { type: 'number', minimum: 0, maximum: 100 },
    issueType: {
      type: 'string',
      enum: ['missing-clause', 'partial-coverage', 'incorrect-implementation', 'outdated-practice', 'ambiguous-wording', 'no-issue', 'not-applicable'],
    },
    issueSeverity: {
      type: 'string',
      enum: ['critical', 'major', 'minor', 'informational'],
    },
    specificGap: { type: 'string', minLength: 20 },
    guidelineRequirement: { type: 'string', minLength: 15 },
    sopCurrentState: { type: 'string', minLength: 15 },
    sopTextSnippet: { type: 'string', minLength: 10 },
    suggestedAction: { type: 'string', minLength: 20 },
    suggestedText: { type: 'string', minLength: 20 },
    estimatedEffort: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
    priority: { type: 'number', minimum: 1, maximum: 5 },
  },
};

/**
 * Phrases that indicate the AI gave up rather than analyzing.
 * Only applied to TEXT fields (not complianceLevel enum value).
 */
export const PROHIBITED_OUTPUT_PHRASES = [
  'No regulatory requirement found',
  'Not specified',
  'Not found',
  'General compliance',
  'Review required',
  'Manual review required',
  'Unable to determine',
  'Analysis required',
  'Not determined',
  'No information',
  'Not mentioned',
  'Not clear',
  'Unclear',
  'N/A',
  'Not addressed',
];

export const COMPLIANCE_EXAMPLES = [
  {
    input: {
      clauseText: 'All equipment must be calibrated annually and records maintained for 5 years.',
      sopSection: 'Section 4.2 discusses equipment maintenance but does not specify calibration frequency.',
    },
    output: {
      isClauseApplicable: true,
      applicabilityReason: 'This clause applies as the SOP covers equipment maintenance procedures.',
      sopSectionNumber: '4.2',
      sopSectionTitle: 'Equipment Maintenance',
      complianceLevel: 'partial',
      matchConfidence: 85,
      issueType: 'partial-coverage',
      issueSeverity: 'major',
      specificGap: 'SOP mentions equipment maintenance but does not specify annual calibration requirement or 5-year record retention period.',
      guidelineRequirement: 'Equipment must be calibrated annually with records maintained for 5 years.',
      sopCurrentState: 'Section 4.2 states "Equipment shall be maintained according to manufacturer specifications" but does not mention calibration frequency or record retention.',
      sopTextSnippet: 'Equipment shall be maintained according to manufacturer specifications and documented in the equipment log.',
      suggestedAction: 'Add specific calibration frequency requirement and record retention period to Section 4.2.',
      suggestedText: 'All equipment shall be calibrated annually as per approved calibration procedures. Calibration records shall be maintained for a minimum of 5 years.',
      estimatedEffort: 'low',
      priority: 2,
    },
  },
  {
    input: {
      clauseText: 'Change control procedures must include risk assessment and approval by Quality Assurance.',
      sopSection: 'Section 7.1 describes change control with QA approval and risk evaluation steps.',
    },
    output: {
      isClauseApplicable: true,
      applicabilityReason: 'This clause directly applies to the change control SOP.',
      sopSectionNumber: '7.1',
      sopSectionTitle: 'Change Control Process',
      complianceLevel: 'compliant',
      matchConfidence: 95,
      issueType: 'no-issue',
      issueSeverity: 'informational',
      specificGap: 'No gap identified. SOP adequately addresses risk assessment and QA approval requirements.',
      guidelineRequirement: 'Change control must include risk assessment and QA approval.',
      sopCurrentState: 'Section 7.1 states "All changes must undergo risk assessment and receive QA Head approval before implementation."',
      sopTextSnippet: 'All proposed changes shall be evaluated for risk impact and submitted to QA Head for review and approval.',
      suggestedAction: 'No action required. Current SOP text is compliant.',
      suggestedText: 'No changes needed. Current procedure meets the guideline requirement.',
      estimatedEffort: 'low',
      priority: 5,
    },
  },
];

/**
 * Generate the main compliance analysis prompt.
 *
 * KEY DESIGN PRINCIPLE: "unable-to-determine" is forbidden for SOPs with readable
 * content. The AI must always make a definitive call:
 *   compliant | partial | non-compliant | not-applicable
 */
export function generateCompliancePrompt(params: {
  sopName: string;
  sopIdentifier: string;
  department: string;
  sopContent: string;
  relevantSectionContent: string;
  relevantSectionNumber: string;
  relevantSectionTitle: string;
  guidelineName: string;
  guidelineType: string;
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
  category: string;
}): string {
  return `You are a pharmaceutical GMP regulatory compliance auditor performing a formal SOP audit.
Your job is to compare a specific SOP section against one regulatory clause and produce a structured compliance finding.

════════════════════════════════════════════════════════════════
SOP UNDER AUDIT
════════════════════════════════════════════════════════════════
SOP ID   : ${params.sopIdentifier}
SOP Name : ${params.sopName}
Department: ${params.department}

MOST RELEVANT SOP SECTION (primary evidence):
Section ${params.relevantSectionNumber} — ${params.relevantSectionTitle}
---
${params.relevantSectionContent.substring(0, 2000)}${params.relevantSectionContent.length > 2000 ? '\n...[truncated]' : ''}
---

FULL SOP CONTENT (supporting context):
---
${params.sopContent.substring(0, 5000)}${params.sopContent.length > 5000 ? '\n...[truncated]' : ''}
---

════════════════════════════════════════════════════════════════
REGULATORY CLAUSE TO VERIFY
════════════════════════════════════════════════════════════════
Source  : ${params.guidelineName} (${params.guidelineType})
Clause  : ${params.clauseNumber} — ${params.clauseTitle}
Category: ${params.category}

Clause Text:
---
${params.clauseText.substring(0, 2000)}${params.clauseText.length > 2000 ? '...[truncated]' : ''}
---

════════════════════════════════════════════════════════════════
AUDIT INSTRUCTIONS
════════════════════════════════════════════════════════════════

STEP 1 — APPLICABILITY CHECK
Decide whether this regulatory clause is relevant to this SOP.
• "not-applicable" = the clause governs a fundamentally different process
  (e.g., drug labeling requirements for an equipment-cleaning SOP).
• If the clause covers ANY principle that this SOP should follow
  (documentation, safety, cleanliness, records, training, etc.),
  it IS applicable — proceed to Step 2.

STEP 2 — LOCATE SOP EVIDENCE
Find the best matching text in the SOP provided above.
• Quote verbatim text or paraphrase closely if no exact quote exists.
• If the topic is completely absent, note which section SHOULD contain it.
• sopTextSnippet MUST be at least one sentence from the SOP content above.

STEP 3 — SIDE-BY-SIDE COMPARISON
State in one sentence what the GUIDELINE requires.
State what the SOP CURRENTLY says (quote or close paraphrase).
Identify the EXACT gap (what is present vs. what is required).

STEP 4 — COMPLIANCE DETERMINATION (MANDATORY — CHOOSE ONE)
⚠️ "unable-to-determine" is ONLY allowed if the SOP content is completely
   empty or unreadable. For all other cases you MUST choose:

   • "compliant"       — SOP fully addresses the clause principle
   • "partial"         — SOP partially addresses it; some elements missing
   • "non-compliant"   — SOP does not address the clause at all
   • "not-applicable"  — Clause is completely out of scope for this SOP

DECISION RULES:
• If the clause principle is MISSING from the SOP → "non-compliant"
• If the SOP has SOME related content but lacks specifics → "partial"
• If clause addresses general GMP principles (documentation, records,
  procedures, responsibilities) → it applies to ALL pharmaceutical SOPs
• When uncertain between "non-compliant" and "partial" → choose "partial"
  if ANY related wording exists in the SOP
• Conservative assessment is preferred over "unable-to-determine"

STEP 5 — REMEDIATION (if gap exists)
Provide an exact action to fix the gap.
Provide exact replacement/addition text (not "update this section").

════════════════════════════════════════════════════════════════
OUTPUT — VALID JSON ONLY (no markdown, no commentary)
════════════════════════════════════════════════════════════════

{
  "isClauseApplicable": true,
  "applicabilityReason": "Why this clause does or does not apply to this SOP (min 20 chars)",
  "sopSectionNumber": "5.2",
  "sopSectionTitle": "Equipment Maintenance",
  "complianceLevel": "compliant | partial | non-compliant | not-applicable",
  "matchConfidence": 75,
  "issueType": "missing-clause | partial-coverage | incorrect-implementation | outdated-practice | ambiguous-wording | no-issue | not-applicable",
  "issueSeverity": "critical | major | minor | informational",
  "specificGap": "Exact measurable gap — what the guideline requires vs. what the SOP states",
  "guidelineRequirement": "One-sentence statement of what this clause requires",
  "sopCurrentState": "Section 5.2 states: 'Equipment shall be maintained every 3 months' — no frequency justification provided",
  "sopTextSnippet": "Equipment shall be maintained every 3 months as per fixed schedule",
  "suggestedAction": "Update Section 5.2 to include risk-based frequency justification aligned to Clause ${params.clauseNumber}",
  "suggestedText": "Equipment maintenance frequency shall be determined based on risk assessment considering equipment criticality and process impact. Maintenance intervals shall be documented and justified.",
  "estimatedEffort": "low | medium | high",
  "priority": 3
}

OUTPUT ONLY VALID JSON:`;
}

/**
 * Refined retry prompt — gives the AI explicit guidance to fix specific errors.
 */
export function generateRefinedPrompt(params: {
  originalPrompt: string;
  previousResponse: string;
  validationErrors: string[];
}): string {
  return `${params.originalPrompt}

════════════════════════════════════════════════════════════════
RETRY — PREVIOUS RESPONSE FAILED VALIDATION
════════════════════════════════════════════════════════════════
Errors to fix: ${params.validationErrors.join(' | ')}

MANDATORY CORRECTIONS:
1. Fix every error listed above before responding.
2. sopTextSnippet MUST contain at least one sentence copied from the SOP text provided.
3. sopCurrentState MUST describe what the SOP currently says (reference section + content).
4. suggestedText MUST be concrete replacement wording — not "update this section".
5. specificGap MUST name the exact missing element (not a generic description).
6. complianceLevel MUST be one of: compliant / partial / non-compliant / not-applicable.
   "unable-to-determine" is forbidden when SOP text has been provided above.
7. Remove all placeholder phrases: "N/A", "Not determined", "Unable to determine",
   "Not specified", "Review required".
8. If the clause clearly does not apply to this SOP's scope → use "not-applicable".
9. If the requirement is simply absent from the SOP → use "non-compliant".

YOUR CORRECTED ANALYSIS (JSON ONLY):`;
}

/**
 * Validate the raw AI JSON response.
 * Errors → trigger retry. Warnings → logged but not blocking.
 */
export function validateAIResponse(response: any): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  const requiredFields = COMPLIANCE_OUTPUT_SCHEMA.required;
  for (const field of requiredFields) {
    if (!(field in response)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Prohibited phrases in text fields — ERRORS (cause retry)
  const strictTextFields = [
    'specificGap',
    'sopCurrentState',
    'suggestedAction',
    'suggestedText',
  ];

  for (const field of strictTextFields) {
    const value = (response[field] || '').toLowerCase();
    for (const phrase of PROHIBITED_OUTPUT_PHRASES) {
      if (value.includes(phrase.toLowerCase())) {
        errors.push(`Prohibited phrase in ${field}: "${phrase}"`);
      }
    }
  }

  // sopTextSnippet — prohibited phrases are WARNINGS only (snippet may be short but honest)
  const snippetValue = (response['sopTextSnippet'] || '').toLowerCase();
  for (const phrase of PROHIBITED_OUTPUT_PHRASES) {
    if (snippetValue.includes(phrase.toLowerCase())) {
      warnings.push(`Placeholder phrase in sopTextSnippet: "${phrase}"`);
    }
  }

  // Minimum lengths — ERRORS
  const minLengths: Record<string, number> = {
    applicabilityReason: 20,
    specificGap: 20,
    guidelineRequirement: 15,
    sopCurrentState: 15,
    suggestedAction: 20,
    suggestedText: 20,
  };

  for (const [field, minLength] of Object.entries(minLengths)) {
    const value = response[field] || '';
    if (value.length < minLength) {
      errors.push(`${field} too short (${value.length} chars, min ${minLength})`);
    }
  }

  // sopTextSnippet length is a WARNING only (fallback will fill it in)
  const snippetLen = (response['sopTextSnippet'] || '').length;
  if (snippetLen < 10) {
    warnings.push(`sopTextSnippet too short (${snippetLen} chars, min 10) — fallback will be used`);
  }

  // Confidence score
  if (typeof response.matchConfidence === 'number' &&
      (response.matchConfidence < 0 || response.matchConfidence > 100)) {
    errors.push(`Invalid confidence score: ${response.matchConfidence}`);
  }

  // Priority
  if (typeof response.priority === 'number' &&
      (response.priority < 1 || response.priority > 5)) {
    errors.push(`Invalid priority: ${response.priority}`);
  }

  // "unable-to-determine" — push to warning, not error (the engine handles fallback)
  if (response.complianceLevel === 'unable-to-determine') {
    warnings.push('complianceLevel is "unable-to-determine" — engine will apply fallback classification if SOP content exists');
  }

  // Soft quality warnings
  if (response.sopCurrentState &&
      !response.sopCurrentState.includes('"') &&
      !response.sopCurrentState.includes("'") &&
      !response.sopCurrentState.toLowerCase().includes('states') &&
      !response.sopCurrentState.toLowerCase().includes('specif')) {
    warnings.push('sopCurrentState should be an exact quote or clearly reference SOP text');
  }

  if (response.suggestedAction &&
      !response.suggestedAction.toLowerCase().includes('section') &&
      !response.suggestedAction.toLowerCase().includes('clause')) {
    warnings.push('Suggestion does not reference specific SOP section');
  }

  return { isValid: errors.length === 0, errors, warnings };
}
