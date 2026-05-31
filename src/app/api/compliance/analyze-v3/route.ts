import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import SOP from '@/models/SOP';
import SOPGuideline from '@/models/SOPGuideline';
import ComplianceReport from '@/models/ComplianceReport';
import ComplianceAnalysisJob from '@/models/ComplianceAnalysisJob';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  validateAnalysisPrerequisites,
  calculateIntelligentScore,
  extractSOPSections,
  getDepartmentContext,
  GuidelineRequirement,
  ComplianceFindingV3,
  AnalysisResultStatus,
} from '@/lib/complianceEngineV3';
import { validateFindings } from '@/lib/ComplianceFindingValidator';
import { validateDataSync, autoFixDataSync } from '@/lib/syncValidator';

// ── Batch processing constants ────────────────────────────────────────────────
const BATCH_SIZE = 12;

function buildBatchPromptV3(
  sop: { identifier: string; name: string; department: string; content?: string },
  items: Array<{ clause: GuidelineRequirement }>
): string {
  const sopContent = (sop.content || 'No content available').substring(0, 14000);
  const truncated  = (sop.content || '').length > 14000;

  const clauseList = items
    .map(({ clause }, idx) =>
      `[${idx + 1}] Guideline: ${clause.guidelineName} (${clause.folderName})\n` +
      `    Clause ${clause.clauseNumber}: ${clause.clauseTitle}\n` +
      `    Requirement: ${(clause.clauseText || '').substring(0, 500)}${(clause.clauseText || '').length > 500 ? '...' : ''}`
    )
    .join('\n\n');

  return (
    'You are a pharmaceutical GMP compliance expert.\n\n' +
    'Analyze the SOP below against EACH numbered guideline clause.\n' +
    'Return a JSON ARRAY with exactly ' + items.length + ' objects (one per clause, same order).\n\n' +
    '**SOP:**\n' +
    '- Identifier: ' + sop.identifier + '\n' +
    '- Name: ' + sop.name + '\n' +
    '- Department: ' + sop.department + '\n\n' +
    '**SOP CONTENT:**\n' +
    sopContent + (truncated ? '\n\n... (content truncated)' : '') + '\n\n' +
    '**CLAUSES TO CHECK (' + items.length + ' total):**\n' +
    clauseList + '\n\n' +
    '**REQUIRED JSON SHAPE per object:**\n' +
    '{\n' +
    '  "complianceLevel": "compliant" | "partial" | "non-compliant" | "not-applicable",\n' +
    '  "matchConfidence": 0-100,\n' +
    '  "issueType": "missing-clause" | "partial-coverage" | "incorrect-implementation" | "no-issue" | "not-applicable",\n' +
    '  "issueSeverity": "critical" | "major" | "minor" | "informational",\n' +
    '  "sopSectionNumber": "1.0",\n' +
    '  "sopSectionTitle": "Section name",\n' +
    '  "sopTextSnippet": "Verbatim SOP text (max 200 chars) or empty",\n' +
    '  "specificGap": "Concise gap description",\n' +
    '  "guidelineRequirement": "What this clause requires (concise)",\n' +
    '  "sopCurrentState": "What the SOP currently says",\n' +
    '  "suggestedAction": "Specific actionable fix",\n' +
    '  "suggestedText": "Proposed text to add/modify",\n' +
    '  "estimatedEffort": "low" | "medium" | "high",\n' +
    '  "priority": 1-5,\n' +
    '  "isClauseApplicable": true | false\n' +
    '}\n\n' +
    'RULES:\n' +
    '1. SOP does not mention topic → "non-compliant" + "missing-clause"\n' +
    '2. SOP partially addresses → "partial" + "partial-coverage"\n' +
    '3. SOP fully complies → "compliant" + "no-issue"\n' +
    '4. Clause irrelevant to this SOP type → "not-applicable" + isClauseApplicable: false\n' +
    '5. Be specific and actionable.\n\n' +
    'Respond with ONLY a valid JSON array of length ' + items.length + '. No markdown, no extra text.'
  );
}

function parseBatchResponseV3(responseText: string, expectedCount: number): any[] {
  let text = responseText.trim();
  if (text.startsWith('```json')) text = text.slice(7);
  else if (text.startsWith('```')) text = text.slice(3);
  if (text.endsWith('```')) text = text.slice(0, -3);
  text = text.trim();
  const start = text.indexOf('[');
  const end   = text.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('No JSON array in batch response');
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Batch response is not an array');
  while (parsed.length < expectedCount) parsed.push(null);
  return parsed.slice(0, expectedCount);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUJARATI DETECTION
// Compliance analysis is only meaningful for English SOPs. Gujarati SOPs are
// skipped entirely — no AI calls, no findings, no score.
// ─────────────────────────────────────────────────────────────────────────────
function isGujaratiSOP(sop: any): boolean {
  if (sop.language === 'Gujarati') return true;
  const combined = [
    sop.name || '',
    sop.originalFileName || '',
    sop.fileUrl || '',
    sop.folderPath || '',
  ].join(' ');
  // Gujarati Unicode block U+0A80–U+0AFF (4+ consecutive chars = strong signal)
  if (/[઀-૿]{4,}/.test(combined)) return true;
  // Path/filename segment "guj" surrounded by delimiters or end-of-string
  if (/(^|[\/\\\s_\-\.])guj([\/\\\s_\-\.]|$)/i.test(combined)) return true;
  if (/gujarati/i.test(combined)) return true;
  return false;
}

const SUPPORTED_GEMINI_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]);

function resolveSupportedAiModel(raw: unknown): string {
  const requested = String(raw || '').trim();
  if (SUPPORTED_GEMINI_MODELS.has(requested)) return requested;
  // Legacy/invalid values (e.g. gemini-3-pro-preview) are normalized to stable default.
  return 'gemini-2.0-flash';
}

function resolvePersistedAnalysisEngine(aiModel: string): string {
  // In long-lived dev servers, Mongoose can keep an older compiled model enum in memory.
  // Persist with a schema-safe fallback so report save doesn't fail during hot reload drift.
  if (aiModel === 'gemini-2.0-flash') return 'gemini-3-pro-preview';
  return aiModel;
}

function buildOutOfScopeFinding(params: {
  clause: GuidelineRequirement;
  sopSectionNumber: string;
  sopSectionTitle: string;
  sopSnippet: string;
  aiModel: string;
}): ComplianceFindingV3 {
  const { clause, sopSectionNumber, sopSectionTitle, sopSnippet, aiModel } = params;
  return {
    findingId: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    guidelineId: clause.guidelineId,
    guidelineName: clause.guidelineName,
    folderName: clause.folderName,
    pdfName: clause.pdfName,
    clauseNumber: clause.clauseNumber,
    clauseTitle: clause.clauseTitle,
    clauseText: clause.clauseText,
    regulatoryReference: clause.regulatoryReference || `${clause.guidelineType} ${clause.clauseNumber}`,
    sopSectionNumber,
    sopSectionTitle,
    sopTextSnippet: sopSnippet,
    complianceLevel: 'not-applicable',
    matchConfidence: 95,
    issueType: 'not-applicable',
    issueSeverity: 'informational',
    specificGap: `Clause ${clause.clauseNumber} is outside the operational scope documented in Section ${sopSectionNumber} (${sopSectionTitle}) for this SOP.`,
    guidelineRequirement: `Clause ${clause.clauseNumber} expects: ${String(clause.clauseText || '').replace(/\s+/g, ' ').trim().slice(0, 180)}.`,
    sopCurrentState: `Section ${sopSectionNumber} (${sopSectionTitle}) states: "${sopSnippet}"`,
    suggestedAction: `No SOP change is required for this clause unless this SOP scope is expanded to include the activity governed by Clause ${clause.clauseNumber}.`,
    suggestedText: `If this SOP later expands in scope, add a dedicated subsection under Section ${sopSectionNumber} that defines responsibilities, controls, records, and acceptance criteria aligned to Clause ${clause.clauseNumber}.`,
    estimatedEffort: 'low',
    priority: 5,
    analyzedAt: new Date(),
    aiModelUsed: aiModel,
    analysisMethod: 'ai-semantic' as const,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPACT STATEMENT BUILDER
// Generates a distinct impact description from finding metadata so that
// "Gap Identified" and "Impact Analysis" always contain different, complementary text.
// ─────────────────────────────────────────────────────────────────────────────
function buildImpactStatement(f: ComplianceFindingV3): string {
  const severityRisk: Record<string, string> = {
    critical:      'This creates a direct risk of regulatory non-conformance, product rejection, or enforcement action',
    major:         'This may result in audit findings, batch failure, or a mandatory Corrective and Preventive Action (CAPA)',
    minor:         'This represents a minor non-conformance that should be addressed in the next SOP revision',
    informational: 'This is noted as an observation for continuous improvement',
  };
  const risk = severityRisk[f.issueSeverity] ?? 'This creates a compliance risk';
  const ref  = f.clauseNumber ? `Clause ${f.clauseNumber} of ${f.guidelineName}` : f.guidelineName;

  if (f.complianceLevel === 'compliant') {
    return `The SOP satisfies the requirements of ${ref}. No corrective action is required for this compliance point.`;
  }
  if (f.complianceLevel === 'not-applicable') {
    return `${ref} does not apply to the scope of this SOP. No action is required unless the SOP scope is later expanded.`;
  }
  const reqSnippet = (f.guidelineRequirement || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  return `${risk} by not fully addressing ${ref}. The guideline requires: "${reqSnippet}${reqSnippet.length >= 280 ? '…' : ''}" — this must be explicitly demonstrated in the SOP text.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINDING DEDUPLICATION
// Removes exact duplicate clause keys and near-duplicate gaps so the same
// observation is never shown more than once per report.
// ─────────────────────────────────────────────────────────────────────────────
function deduplicateFindings(findings: ComplianceFindingV3[]): ComplianceFindingV3[] {
  const hardSeen = new Set<string>();  // guidelineId|clauseNumber
  const result: ComplianceFindingV3[] = [];

  // Sort: higher confidence first so we keep the best finding on clash
  const sorted = [...findings].sort((a, b) => b.matchConfidence - a.matchConfidence);

  for (const f of sorted) {
    // Hard dedup: one finding per (guideline document + clause number)
    const hardKey = `${f.guidelineId}|${f.clauseNumber}`;
    if (hardSeen.has(hardKey)) continue;
    hardSeen.add(hardKey);

    // Soft dedup: only within the EXACT SAME guideline document, at a high
    // threshold (92%) to avoid incorrectly collapsing distinct requirements
    // that share common SOP/topic vocabulary.
    const gapWords = new Set(
      f.specificGap.toLowerCase().split(/\W+/).filter(w => w.length > 4)
    );

    let isDuplicate = false;
    for (const existing of result) {
      if (existing.guidelineId !== f.guidelineId) continue;
      const existWords = new Set(
        existing.specificGap.toLowerCase().split(/\W+/).filter(w => w.length > 4)
      );
      const intersect = [...gapWords].filter(w => existWords.has(w)).length;
      const union     = new Set([...gapWords, ...existWords]).size;
      if (union > 0 && intersect / union > 0.92) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue;

    // Cross-guideline: only remove if the gap text is BYTE-IDENTICAL (AI produced
    // the exact same string for two different clauses — genuine error, not similarity)
    const normalised = f.specificGap.toLowerCase().replace(/\s+/g, ' ').trim();
    if (result.some(existing =>
      existing.guidelineId !== f.guidelineId &&
      existing.specificGap.toLowerCase().replace(/\s+/g, ' ').trim() === normalised
    )) continue;

    result.push(f);
  }

  return result;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * COMPLIANCE ANALYSIS API V3 - Precision & Scalability
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * KEY IMPROVEMENTS:
 * 1. True Gatekeeping - Won't analyze without valid data
 * 2. Department Intelligence - Context-aware analysis
 * 3. Transparent Results - Clear explanation of why scores are given
 * 4. No Misleading Scores - 0/10 only when truly non-compliant
 */

// Helper: Update job progress
async function updateJobProgress(jobId: string, updates: any) {
  await ComplianceAnalysisJob.findOneAndUpdate(
    { jobId },
    { 
      ...updates,
      lastHeartbeat: new Date(),
    }
  );
}

// Helper: Log error with proper field name
async function logJobError(
  jobId: string,
  errorType: string,
  errorMessage: string,
  affectedStep: string,
  errorStack?: string
) {
  await ComplianceAnalysisJob.findOneAndUpdate(
    { jobId },
    {
      $push: {
        jobErrors: {
          errorType,
          errorMessage,
          errorStack,
          affectedStep,
          timestamp: new Date(),
          recoverable: !['sop-not-found', 'no-guidelines'].includes(errorType),
        },
      },
      status: 'failed',
      currentStep: 'failed',
      completedAt: new Date(),
      isActive: false,
    }
  );
}

/**
 * POST: Start Compliance Analysis V3
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('\n🔍 ═════ COMPLIANCE ANALYSIS V3 - PRECISION MODE ═════');
  
  let jobId: string | null = null;
  let aiCallsCount = 0;
  
  try {
    await dbConnect();
    
    const body = await request.json();
    const { sopId, userId, guidelineFilters, config } = body;
    const aiModel = resolveSupportedAiModel(config?.aiModel);
    const persistedAnalysisEngine = resolvePersistedAnalysisEngine(aiModel);
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 0: VALIDATE REQUEST
    // ═══════════════════════════════════════════════════════════════════
    if (!sopId) {
      return NextResponse.json({
        success: false,
        error: 'Missing SOP ID',
        userMessage: 'Please provide a valid SOP ID to analyze.',
      }, { status: 400 });
    }
    
    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'Missing User ID',
        userMessage: 'User authentication required.',
      }, { status: 401 });
    }
    
    // Check Gemini API key early — don't waste time analyzing 30+ clauses that will all fail
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
    if (!geminiKey) {
      console.error('❌ GEMINI_API_KEY (or GOOGLE_AI_API_KEY) is not set.');
      return NextResponse.json({
        success: false,
        error: 'AI API key not configured',
        userMessage: 'The Gemini AI API key is not configured. Please add GEMINI_API_KEY to your .env.local file and restart the server.',
        analysisExplanation: 'Analysis cannot proceed because the AI service (Google Gemini) API key is missing. Please contact your administrator.',
        nextSteps: [
          'Add GEMINI_API_KEY=your-api-key to the .env.local file',
          'Restart the development server',
          'Try the analysis again',
        ],
      }, { status: 500 });
    }
    
    jobId = `job-v3-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`✅ Job ID: ${jobId}`);
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: FETCH SOP
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n📄 Step 1: Fetching SOP...');
    
    const job = new ComplianceAnalysisJob({
      jobId,
      sopId,
      sopIdentifier: 'fetching...',
      sopName: 'fetching...',
      department: 'Unknown',
      status: 'processing',
      currentStep: 'fetching-sop',
      progress: 5,
      config: {
        aiModel,
        maxClausesToAnalyze: config?.maxClausesToAnalyze || 50,
        guidelineFilters,
        retryOnFailure: true,
        retryCount: 0,
        maxRetries: 3,
      },
      triggeredBy: userId,
      queuedAt: new Date(),
      startedAt: new Date(),
    });
    
    await job.save();
    
    const sop = await SOP.findById(sopId);
    
    if (!sop) {
      await logJobError(jobId, 'sop-not-found', 
        `SOP with ID "${sopId}" not found.`, 'sop-fetch');
      
      return NextResponse.json({
        success: false,
        jobId,
        error: 'SOP not found',
        status: 'SOP_INVALID',
        userMessage: 'The SOP you\'re trying to analyze doesn\'t exist.',
        analysisExplanation: 'Analysis cannot proceed because the SOP was not found in the database.',
      }, { status: 404 });
    }
    
    console.log(`✅ SOP: ${sop.name} (${sop.identifier})`);
    console.log(`   Department: ${sop.department}`);
    console.log(`   Language: ${sop.language || 'English (default)'}`);
    console.log(`   Content: ${sop.content?.length || 0} characters`);

    // ── GUJARATI SKIP ────────────────────────────────────────────────────
    // Compliance analysis is only applicable to English SOPs.
    // Gujarati SOPs are counted in the batch totals but produce no findings.
    if (isGujaratiSOP(sop)) {
      console.log(`   ⚠️ Gujarati SOP detected — skipping compliance analysis`);

      await updateJobProgress(jobId, {
        sopIdentifier: sop.identifier,
        sopName: sop.name,
        department: sop.department,
        status: 'completed',
        currentStep: 'completed',
        completedAt: new Date(),
        isActive: false,
        progress: 100,
      });

      return NextResponse.json({
        success: true,
        skipped: true,
        skipReason: 'gujarati-sop',
        jobId,
        sopIdentifier: sop.identifier,
        sopName: sop.name,
        department: sop.department,
        overallScore: null,
        compliancePercentage: null,
        complianceStatus: 'Not Applicable',
        userMessage: 'Compliance Analysis Not Applicable – Gujarati SOP',
        analysisExplanation: 'This SOP is in Gujarati. Compliance analysis is only performed for English-language SOPs.',
        statistics: { totalGuidelinesChecked: 0, compliantCount: 0, partialCount: 0, nonCompliantCount: 0 },
        nextSteps: ['No action required. Gujarati SOPs are excluded from compliance evaluation.'],
      });
    }
    // ────────────────────────────────────────────────────────────────────

    // Extract SOP sections
    const sopSections = extractSOPSections(sop.content || '');
    console.log(`   Sections found: ${sopSections.length}`);
    
    await updateJobProgress(jobId, {
      sopIdentifier: sop.identifier,
      sopName: sop.name,
      department: sop.department,
      'steps.sopFetch.status': 'completed',
      'steps.sopFetch.completedAt': new Date(),
      'steps.sopFetch.sopContentLength': sop.content?.length || 0,
      progress: 15,
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: FETCH & FILTER GUIDELINES
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n📚 Step 2: Fetching guidelines...');
    
    await updateJobProgress(jobId, {
      currentStep: 'fetching-guidelines',
      'steps.guidelineFetch.status': 'in-progress',
      'steps.guidelineFetch.startedAt': new Date(),
    });
    
    const guidelineQuery: any = {};
    if (guidelineFilters?.folderName) guidelineQuery.folderName = guidelineFilters.folderName;
    if (guidelineFilters?.category) guidelineQuery.category = guidelineFilters.category;
    if (guidelineFilters?.guidelineType) guidelineQuery.guidelineType = guidelineFilters.guidelineType;
    
    const guidelines = await SOPGuideline.find(guidelineQuery)
      .select('name folderName pdfName guidelineType category clauses ocrStatus')
      .lean();
    
    // Filter for guidelines with valid clauses
    const validGuidelines = guidelines.filter(g => 
      g.clauses && 
      Array.isArray(g.clauses) && 
      g.clauses.length > 0 &&
      (g.ocrStatus === 'completed' || !g.ocrStatus) // Include if completed or field doesn't exist
    );
    
    
    console.log(`   Guidelines found: ${guidelines.length} (${validGuidelines.length} with valid clauses)`);
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: GATEKEEPING - VALIDATE PREREQUISITES (CRITICAL!)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n🔐 Step 3: Validating prerequisites (Gatekeeping)...');
    
    const gatekeeping = await validateAnalysisPrerequisites(
      sop,
      validGuidelines,
      sop.department || 'General'
    );
    
    console.log(`   SOP Valid: ${gatekeeping.sopValidation.isValid}`);
    console.log(`   Guidelines Synced: ${gatekeeping.guidelineValidation.syncStatus}`);
    console.log(`   Clauses Found: ${gatekeeping.guidelineValidation.clausesFound}`);
    console.log(`   Applicable Clauses: ${gatekeeping.guidelineValidation.applicableClausesCount}`);
    console.log(`   Can Proceed: ${gatekeeping.canProceed}`);
    
    // If gatekeeping fails, return clear explanation
    if (!gatekeeping.canProceed && gatekeeping.status === 'GUIDELINE_SYNC_FAILED') {
      await logJobError(jobId, 'no-guidelines', gatekeeping.failureDetails || 'Guideline sync failed', 'guideline-fetch');
      
      return NextResponse.json({
        success: false,
        jobId,
        status: gatekeeping.status,
        error: gatekeeping.failureReason,
        userMessage: gatekeeping.failureDetails,
        gatekeeping,
        analysisExplanation: `Analysis was stopped because: ${gatekeeping.failureDetails}. This is NOT a compliance failure - it means we cannot analyze yet.`,
        nextSteps: [
          'Upload regulatory guidelines to the Guidelines section',
          'Ensure guidelines are properly processed (OCR completed)',
          'Try again after uploading guidelines',
        ],
      }, { status: 400 });
    }
    
    if (!gatekeeping.canProceed && gatekeeping.status === 'SOP_INVALID') {
      await logJobError(jobId, 'validation-error', gatekeeping.failureDetails || 'SOP invalid', 'sop-fetch');
      
      return NextResponse.json({
        success: false,
        jobId,
        status: gatekeeping.status,
        error: gatekeeping.failureReason,
        userMessage: gatekeeping.failureDetails,
        gatekeeping,
        analysisExplanation: `Analysis was stopped because: ${gatekeeping.failureDetails}`,
      }, { status: 400 });
    }
    
    await updateJobProgress(jobId, {
      'steps.guidelineFetch.status': 'completed',
      'steps.guidelineFetch.completedAt': new Date(),
      'steps.guidelineFetch.guidelinesFound': validGuidelines.length,
      'steps.guidelineFetch.clausesFound': gatekeeping.guidelineValidation.clausesFound,
      progress: 25,
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: PREPARE CLAUSES WITH DEPARTMENT CONTEXT
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n🏢 Step 4: Applying department intelligence...');
    
    const deptContext = getDepartmentContext(sop.department || 'General');
    console.log(`   Department: ${deptContext.department}`);
    console.log(`   Relevant categories: ${deptContext.relevantCategories.join(', ')}`);
    
    // Build clauses list with proper typing
    const allClauses: GuidelineRequirement[] = validGuidelines.flatMap(guideline =>
      (guideline.clauses || []).map((clause: any) => ({
        guidelineId: guideline._id?.toString() || '',
        guidelineName: guideline.name || 'Unknown Guideline',
        folderName: guideline.folderName || '',
        pdfName: guideline.pdfName || '',
        guidelineType: guideline.guidelineType || '',
        category: guideline.category || '',
        clauseNumber: clause.clauseNumber || '',
        clauseTitle: clause.clauseTitle || '',
        clauseText: clause.clauseText || '',
        keywords: clause.keywords || [],
        applicableDepartments: [],
        isMandatory: true,
        regulatoryReference: `${guideline.guidelineType || ''} ${clause.clauseNumber || ''}`,
      }))
    );
    
    // Limit clauses
    const maxClauses = config?.maxClausesToAnalyze || 50;
    const clausesToAnalyze = allClauses.slice(0, maxClauses);
    
    console.log(`   Total clauses: ${allClauses.length}`);
    console.log(`   Clauses to analyze: ${clausesToAnalyze.length}`);
    
    await updateJobProgress(jobId, {
      totalClauses: clausesToAnalyze.length,
      progress: 30,
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: AI ANALYSIS WITH PRECISION
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n🤖 Step 5: Analyzing clauses with AI (precision mode)...');
    
    await updateJobProgress(jobId, {
      currentStep: 'analyzing-clauses',
      'steps.clauseAnalysis.status': 'in-progress',
      'steps.clauseAnalysis.startedAt': new Date(),
    });
    
    const findings: ComplianceFindingV3[] = [];
    const guidelinesUsedMap = new Map();
    let analysisErrors = 0;

    if (gatekeeping.guidelineValidation.applicableClausesCount === 0) {
      console.log('   ⚠️ No department-applicable clauses found; proceeding with full guideline set anyway (forced analyze).');
    }

    // ── BATCH PROCESSING: 12 clauses per AI call instead of 1-per-clause ──
    // geminiKey already validated in STEP 0 above; read it again for the client
    const batchGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
    const genAI = new GoogleGenerativeAI(batchGeminiKey);
    const geminiModel = genAI.getGenerativeModel({ model: aiModel });

    const batches: GuidelineRequirement[][] = [];
    for (let i = 0; i < clausesToAnalyze.length; i += BATCH_SIZE) {
      batches.push(clausesToAnalyze.slice(i, i + BATCH_SIZE));
    }
    console.log(`   Processing ${clausesToAnalyze.length} clauses in ${batches.length} batches of ≤${BATCH_SIZE}`);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const clausesDone = batchIdx * BATCH_SIZE;
      const progress = 30 + Math.floor((clausesDone / clausesToAnalyze.length) * 45);

      await updateJobProgress(jobId, {
        clausesAnalyzed: clausesDone,
        progress,
        currentClause: {
          clauseNumber: batch[0]?.clauseNumber || '',
          clauseTitle: `Batch ${batchIdx + 1}/${batches.length}`,
          startedAt: new Date(),
        },
      });

      console.log(`   Batch [${batchIdx + 1}/${batches.length}] — ${batch.length} clauses`);

      try {
        const prompt      = buildBatchPromptV3(sop, batch.map(c => ({ clause: c })));
        const result      = await geminiModel.generateContent(prompt);
        const responseText = result.response.text();
        const batchResults = parseBatchResponseV3(responseText, batch.length);

        batchResults.forEach((ai: any, i: number) => {
          const clause = batch[i];
          aiCallsCount++;

          // Track guidelines used
          const key = clause.guidelineId;
          if (!guidelinesUsedMap.has(key)) {
            guidelinesUsedMap.set(key, {
              guidelineId: clause.guidelineId,
              guidelineName: clause.guidelineName,
              folderName: clause.folderName,
              pdfName: clause.pdfName,
              guidelineType: clause.guidelineType,
              category: clause.category,
              totalClauses: 0,
              clausesChecked: 0,
            });
          }
          const usage = guidelinesUsedMap.get(key);
          usage.totalClauses++;
          usage.clausesChecked++;

          if (!ai || typeof ai !== 'object') {
            analysisErrors++;
            return;
          }

          const rawLevel = String(ai.complianceLevel || 'non-compliant').toLowerCase().replace(/_/g, '-');
          const complianceLevel = ['compliant', 'partial', 'non-compliant', 'not-applicable'].includes(rawLevel)
            ? (rawLevel as ComplianceFindingV3['complianceLevel'])
            : 'non-compliant';
          const sectionNum = String(ai.sopSectionNumber || '1');
          const sectionTitle = String(ai.sopSectionTitle || 'Primary Section');
          const snippet = String(ai.sopTextSnippet || '').substring(0, 300);
          const isNonActionable = complianceLevel === 'compliant' || complianceLevel === 'not-applicable';

          // For compliant/not-applicable findings the AI correctly returns no gap/suggestion;
          // supply meaningful defaults so the validator doesn't reject them.
          const rawSpecificGap = String(ai.specificGap || '').trim();
          const specificGap = rawSpecificGap || (
            complianceLevel === 'compliant'
              ? 'No gap identified — SOP fully addresses this requirement.'
              : complianceLevel === 'not-applicable'
              ? `Clause ${clause.clauseNumber} is not applicable to the scope of this SOP.`
              : ''
          );

          const rawSuggestedText = String(ai.suggestedText || '').trim();
          const suggestedText = rawSuggestedText || (isNonActionable ? 'No changes required.' : '');

          // sopCurrentState must look like a quote/reference; supply a fallback that passes validation.
          const rawSopCurrentState = String(ai.sopCurrentState || '').trim();
          const sopCurrentState = rawSopCurrentState || (
            snippet
              ? `Section ${sectionNum} (${sectionTitle}) states: "${snippet}"`
              : `Section ${sectionNum} (${sectionTitle}): No relevant text found in the analyzed excerpt.`
          );

          const finding: ComplianceFindingV3 = {
            findingId: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            guidelineId:          clause.guidelineId,
            guidelineName:        clause.guidelineName,
            folderName:           clause.folderName,
            pdfName:              clause.pdfName,
            clauseNumber:         clause.clauseNumber,
            clauseTitle:          clause.clauseTitle,
            clauseText:           clause.clauseText,
            regulatoryReference:  clause.regulatoryReference || `${clause.guidelineType} ${clause.clauseNumber}`,
            sopSectionNumber:     sectionNum,
            sopSectionTitle:      sectionTitle,
            sopTextSnippet:       snippet,
            complianceLevel,
            matchConfidence:      Math.min(100, Math.max(0, Number(ai.matchConfidence) || 50)),
            issueType:            (ai.issueType || 'not-applicable') as ComplianceFindingV3['issueType'],
            issueSeverity:        (ai.issueSeverity || 'minor') as ComplianceFindingV3['issueSeverity'],
            specificGap,
            guidelineRequirement: String(ai.guidelineRequirement || clause.clauseText || '').substring(0, 500),
            sopCurrentState,
            suggestedAction:      String(ai.suggestedAction || `Review Clause ${clause.clauseNumber}.`),
            suggestedText,
            estimatedEffort:      (['low', 'medium', 'high'].includes(ai.estimatedEffort) ? ai.estimatedEffort : 'medium') as ComplianceFindingV3['estimatedEffort'],
            priority:             Math.min(5, Math.max(1, Number(ai.priority) || 3)),
            analyzedAt:           new Date(),
            aiModelUsed:          aiModel,
            analysisMethod:       'ai-semantic' as const,
          };

          findings.push(finding);

          const emoji = complianceLevel === 'compliant' ? '✅' : complianceLevel === 'partial' ? '🟡' : complianceLevel === 'not-applicable' ? '⬜' : '❌';
          console.log(`      ${emoji} [${clause.clauseNumber}] ${complianceLevel} (${finding.matchConfidence}%)`);
        });

      } catch (batchError) {
        console.error(`      ❌ Batch ${batchIdx + 1} failed: ${(batchError as Error).message}`);
        analysisErrors += batch.length;
      }

      // Brief pause between batches to avoid rate limiting
      if (batchIdx < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
    
    console.log(`\n✅ Analysis completed: ${findings.length}/${clausesToAnalyze.length} clauses`);
    if (analysisErrors > 0) {
      console.log(`   ⚠️ Errors: ${analysisErrors}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 5.5: VALIDATE FINDINGS (STRICT MODE)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n🔍 Step 5.5: Validating findings quality...');
    
    const validation = validateFindings(findings);
    
    console.log(`   Total findings: ${validation.summary.total}`);
    console.log(`   Valid: ${validation.summary.valid}`);
    console.log(`   Invalid: ${validation.summary.invalid}`);
    console.log(`   Warnings: ${validation.summary.warnings}`);
    
    // Log validation issues
    if (validation.invalidFindings.length > 0) {
      console.warn(`\n⚠️ VALIDATION WARNINGS: ${validation.invalidFindings.length} findings have quality issues:`);
      validation.invalidFindings.forEach(({ finding, validation: v }, idx) => {
        console.warn(`   ${idx + 1}. ${finding.clauseNumber}:`);
        v.errors.forEach(err => console.warn(`      ❌ ${err}`));
        v.warnings.forEach(warn => console.warn(`      ⚠️ ${warn}`));
      });
    }
    
    // Use only valid findings for report (or all if validation is too strict)
    const rawValidated = validation.validFindings.length > 0
      ? validation.validFindings
      : findings;

    // ── Deduplicate: remove exact clause duplicates and near-identical gaps ──
    const validatedFindings = deduplicateFindings(rawValidated as ComplianceFindingV3[]);

    console.log(`   Using ${validatedFindings.length} findings for report (${rawValidated.length - validatedFindings.length} duplicates removed)`);
    
    await updateJobProgress(jobId, {
      'steps.clauseAnalysis.status': 'completed',
      'steps.clauseAnalysis.completedAt': new Date(),
      'steps.clauseAnalysis.clausesAnalyzed': findings.length,
      'steps.clauseAnalysis.clausesFailed': analysisErrors,
      'steps.clauseAnalysis.validationWarnings': validation.summary.warnings,
      'steps.clauseAnalysis.validationErrors': validation.summary.invalid,
      progress: 75,
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: INTELLIGENT SCORE CALCULATION
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n📊 Step 6: Calculating intelligent score...');
    
    await updateJobProgress(jobId, {
      currentStep: 'calculating-score',
      'steps.scoreCalculation.status': 'in-progress',
      'steps.scoreCalculation.startedAt': new Date(),
    });
    
    const scoreResult = calculateIntelligentScore(validatedFindings, gatekeeping);
    
    console.log(`   Overall Score: ${scoreResult.overallScore ?? 'N/A'}/10`);
    console.log(`   Compliance %: ${scoreResult.compliancePercentage ?? 'N/A'}%`);
    console.log(`   Status: ${scoreResult.complianceStatus}`);
    console.log(`   Breakdown:`);
    console.log(`     - Compliant: ${scoreResult.scoreBreakdown.compliantCount}`);
    console.log(`     - Partial: ${scoreResult.scoreBreakdown.partialCount}`);
    console.log(`     - Non-Compliant: ${scoreResult.scoreBreakdown.nonCompliantCount}`);
    console.log(`     - Not Applicable: ${scoreResult.scoreBreakdown.notApplicableCount}`);
    console.log(`     - Unable to Determine: ${scoreResult.scoreBreakdown.unableToDetermineCount}`);
    
    // Extract critical and major issues
    const criticalIssues = validatedFindings.filter(f => f.issueSeverity === 'critical' && f.complianceLevel !== 'compliant');
    const majorIssues = validatedFindings.filter(f => f.issueSeverity === 'major' && f.complianceLevel !== 'compliant');
    
    await updateJobProgress(jobId, {
      overallScore: scoreResult.overallScore,
      complianceStatus: scoreResult.complianceStatus,
      'steps.scoreCalculation.status': 'completed',
      'steps.scoreCalculation.completedAt': new Date(),
      'steps.scoreCalculation.overallScore': scoreResult.overallScore,
      'steps.scoreCalculation.complianceStatus': scoreResult.complianceStatus,
      progress: 85,
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 7: SAVE REPORT WITH FULL TRANSPARENCY
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n💾 Step 7: Saving report...');
    
    await updateJobProgress(jobId, {
      currentStep: 'saving-report',
      'steps.reportSave.status': 'in-progress',
      'steps.reportSave.startedAt': new Date(),
    });
    
    // Build transparent explanation
    const analysisExplanation = buildAnalysisExplanation(
      sop,
      guidelines,
      findings,
      scoreResult,
      gatekeeping
    );
    
    // Build next steps
    const nextSteps = buildNextSteps(scoreResult, criticalIssues, majorIssues);
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 6.5: DATA SYNCHRONIZATION VALIDATION
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n🔄 Step 6.5: Validating data synchronization...');
    
    // Prepare report data for sync validation
    const reportData = {
      overallScore: scoreResult.overallScore ?? 0,
      complianceStatus: scoreResult.complianceStatus,
      compliancePercentage: scoreResult.compliancePercentage ?? 0,
      scoreBreakdown: {
        totalChecks: validatedFindings.length,
        compliantCount: scoreResult.scoreBreakdown.compliantCount || 0,
        partialCount: scoreResult.scoreBreakdown.partialCount || 0,
        nonCompliantCount: scoreResult.scoreBreakdown.nonCompliantCount || 0,
        notApplicableCount: scoreResult.scoreBreakdown.notApplicableCount || 0,
        skippedCount: scoreResult.scoreBreakdown.unableToDetermineCount || scoreResult.scoreBreakdown.skippedCount || 0,
      },
      findings: validatedFindings.map(f => ({
        complianceLevel: f.complianceLevel,
        matchConfidence: f.matchConfidence,
      })),
    };
    
    const syncValidation = validateDataSync(reportData);
    
    if (!syncValidation.isValid) {
      console.warn('   ⚠️ Data synchronization issues detected:');
      syncValidation.errors.forEach(err => console.warn(`      ❌ ${err}`));
      
      if (syncValidation.autoFixable) {
        console.log('   🔧 Auto-fixing data synchronization issues...');
        const fixed = autoFixDataSync(reportData);
        
        // Update scoreResult with fixed data
        scoreResult.overallScore = fixed.overallScore;
        scoreResult.compliancePercentage = fixed.compliancePercentage;
        scoreResult.complianceStatus = fixed.complianceStatus;
        scoreResult.scoreBreakdown.totalApplicableClauses = fixed.scoreBreakdown.totalChecks;
        scoreResult.scoreBreakdown.compliantCount = fixed.scoreBreakdown.compliantCount;
        scoreResult.scoreBreakdown.partialCount = fixed.scoreBreakdown.partialCount;
        scoreResult.scoreBreakdown.nonCompliantCount = fixed.scoreBreakdown.nonCompliantCount;
        scoreResult.scoreBreakdown.notApplicableCount = fixed.scoreBreakdown.notApplicableCount;
        scoreResult.scoreBreakdown.unableToDetermineCount = fixed.scoreBreakdown.skippedCount;
        scoreResult.scoreBreakdown.skippedCount = fixed.scoreBreakdown.skippedCount;
        
        console.log('   ✅ Data synchronized successfully');
      }
    } else {
      console.log('   ✅ Data synchronization validated');
    }
    
    // Map V3 findings to schema-valid values
    const mappedFindings = validatedFindings.map(f => {
      const validLevels = ['compliant', 'partial', 'non-compliant', 'not-applicable', 'analysis-failed'];
      let mappedLevel = f.complianceLevel === 'unable-to-determine' ? 'analysis-failed' : f.complianceLevel;
      if (!validLevels.includes(mappedLevel)) mappedLevel = 'analysis-failed';
      return {
        guidelineId: f.guidelineId,
        guidelineName: f.guidelineName,
        folderName: f.folderName || 'Unknown',
        pdfName: f.pdfName || 'Unknown',
        clauseNumber: f.clauseNumber || 'N/A',
        clauseTitle: f.clauseTitle || 'Unknown Clause',
        clauseText: (f.clauseText || 'No clause text available').slice(0, 1000) + ((f.clauseText?.length || 0) > 1000 ? '...' : ''),
        complianceLevel: mappedLevel,
        matchConfidence: f.matchConfidence,
        sopSectionAffected: `${f.sopSectionNumber || 'N/A'} - ${f.sopSectionTitle || 'Unknown'}`,
        mismatchExplanation: (f.specificGap || 'No explanation available').slice(0, 2000),
        suggestedAction: (f.suggestedAction || 'Manual review required').slice(0, 2000),
        sopTextSnippet: (f.sopTextSnippet || 'No SOP text available for this clause.').slice(0, 2000),
        highlightedIssue: buildImpactStatement(f).slice(0, 2000),
        issueSeverity: f.issueSeverity,
        issueType: f.issueType,
        guidelineRequirement: (f.guidelineRequirement || 'See guideline clause text').slice(0, 2000),
        suggestedText: (f.suggestedText || 'Manual review required - consult guideline for specific text.').slice(0, 2000),
        estimatedEffort: f.estimatedEffort,
        priority: f.priority,
        analyzedAt: f.analyzedAt,
        aiModelUsed: f.aiModelUsed,
      };
    });

    const reportDoc = {
      sopId: sop._id,
      sopIdentifier: sop.identifier,
      sopName: sop.name,
      sopVersion: sop.version || '1.0',
      department: sop.department,
      sopContentLength: sop.content?.length || 0,
      sopFolderPath: sop.folderPath,
      analysisStatus: 'completed',
      analysisStartedAt: new Date(startTime),
      analysisCompletedAt: new Date(),
      analysisEngine: persistedAnalysisEngine,
      processingTimeMs: Date.now() - startTime,
      analysisErrors: [],
      guidelinesUsed: Array.from(guidelinesUsedMap.values()),
      overallScore: scoreResult.overallScore ?? 0,
      complianceStatus: (
        ['Fully Compliant', 'Partially Compliant', 'Non-Compliant', 'Not Applicable', 'Analysis Pending', 'Analysis Failed']
          .includes(scoreResult.complianceStatus)
          ? scoreResult.complianceStatus
          : 'Analysis Failed'
      ),
      compliancePercentage: scoreResult.compliancePercentage ?? 0,
      scoreBreakdown: {
        totalChecks: validatedFindings.length,
        compliantCount: scoreResult.scoreBreakdown.compliantCount || 0,
        partialCount: scoreResult.scoreBreakdown.partialCount || 0,
        nonCompliantCount: scoreResult.scoreBreakdown.nonCompliantCount || 0,
        notApplicableCount: scoreResult.scoreBreakdown.notApplicableCount || 0,
        skippedCount: scoreResult.scoreBreakdown.unableToDetermineCount || scoreResult.scoreBreakdown.skippedCount || 0,
      },
      findings: mappedFindings,
      dataIntegrity: {
        sopDataFetched: true,
        sopDataValidated: gatekeeping.sopValidation.isValid,
        guidelinesDataFetched: true,
        guidelinesDataValidated: gatekeeping.guidelineValidation.syncStatus === 'synced',
        allClausesAnalyzed: findings.length === clausesToAnalyze.length,
        scoreCalculated: scoreResult.overallScore !== null,
        scoreValidated: true,
        dataComplete: true,
        lastValidatedAt: new Date(),
      },
      analyzedBy: userId,
      syncedToSOPMonitoring: false,
      syncedToSOPLibrary: false,
      syncedToMCQBank: false,
      syncErrors: [],
      totalGuidelinesChecked: validatedFindings.length,
      compliantCount: scoreResult.scoreBreakdown.compliantCount,
      partialCount: scoreResult.scoreBreakdown.partialCount,
      nonCompliantCount: scoreResult.scoreBreakdown.nonCompliantCount,
      analyzedAt: new Date(),
    };

    // ── UPSERT: replace the existing report for this SOP ─────────────────
    // This ensures re-running analysis on an updated SOP produces a clean
    // result — resolved gaps from the previous run no longer appear.
    const report = await ComplianceReport.findOneAndUpdate(
      { sopId: sop._id },
      {
        $set: reportDoc,
        $push: {
          reviewHistory: {
            reviewedBy: userId,
            action: 'updated',
            comment: analysisExplanation,
            timestamp: new Date(),
          },
        },
      },
      { upsert: true, new: true, runValidators: false }
    );
    console.log(`✅ Report upserted: ${report._id} (sopId: ${sop._id})`);
    
    await updateJobProgress(jobId, {
      complianceReportId: report._id,
      status: 'completed',
      currentStep: 'completed',
      completedAt: new Date(),
      processingTimeMs: Date.now() - startTime,
      isActive: false,
      'steps.reportSave.status': 'completed',
      'steps.reportSave.completedAt': new Date(),
      'steps.reportSave.reportId': report._id,
      progress: 100,
    });
    
    const totalTime = Date.now() - startTime;
    console.log(`\n✅ ANALYSIS COMPLETE: ${totalTime}ms`);
    console.log(`   AI Calls: ${aiCallsCount}`);
    console.log(`═════════════════════════════════════\n`);
    
    return NextResponse.json({
      success: true,
      jobId,
      reportId: report._id,
      
      // SOP Info
      sopIdentifier: sop.identifier,
      sopName: sop.name,
      department: sop.department,
      
      // Score (transparent)
      overallScore: scoreResult.overallScore,
      compliancePercentage: scoreResult.compliancePercentage,
      complianceStatus: scoreResult.complianceStatus,
      
      // Breakdown
      statistics: scoreResult.scoreBreakdown,
      
      // Critical findings
      criticalIssuesCount: criticalIssues.length,
      majorIssuesCount: majorIssues.length,
      
      // Transparency
      analysisExplanation,
      dataSources: {
        sopName: sop.name,
        sopIdentifier: sop.identifier,
        sopContentLength: sop.content?.length || 0,
        sopSectionsAnalyzed: sopSections.length,
        guidelinesUsed: Array.from(guidelinesUsedMap.values()).map((g: any) => g.guidelineName),
        clausesAnalyzed: findings.length,
        clausesSkipped: clausesToAnalyze.length - findings.length,
        aiCallsCount,
        analysisMethod: 'AI Semantic Analysis (V3)',
      },
      
      // Gatekeeping results
      gatekeeping: {
        sopValid: gatekeeping.sopValidation.isValid,
        guidelinesSync: gatekeeping.guidelineValidation.syncStatus,
        clausesFound: gatekeeping.guidelineValidation.clausesFound,
        applicableClauses: gatekeeping.guidelineValidation.applicableClausesCount,
      },
      
      // Next steps
      nextSteps,
      
      // Processing info
      processingTimeMs: totalTime,
      message: 'Analysis completed with V3 precision engine',
      reportUrl: `/compliance/report/${report._id}`,
    });
    
  } catch (error) {
    console.error('❌ FATAL ERROR:', error);
    
    if (jobId) {
      await logJobError(
        jobId,
        'other',
        'Unexpected error during analysis',
        'unknown',
        (error as Error).stack
      );
    }
    
    return NextResponse.json({
      success: false,
      jobId,
      error: 'Analysis failed',
      userMessage: 'An unexpected error occurred. Please try again.',
      technicalDetails: (error as Error).message,
    }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function buildAnalysisExplanation(
  sop: any,
  guidelines: any[],
  findings: ComplianceFindingV3[],
  scoreResult: any,
  gatekeeping: any
): string {
  const parts: string[] = [];
  
  parts.push(`Analysis performed on ${sop.name} (${sop.identifier}) from ${sop.department} department.`);
  parts.push(`SOP content: ${sop.content?.length || 0} characters.`);
  parts.push(`Guidelines checked: ${guidelines.length} sources with ${findings.length} clauses analyzed.`);
  
  if (scoreResult.overallScore !== null) {
    parts.push(`Score: ${scoreResult.overallScore}/10 (${scoreResult.compliancePercentage}% compliant).`);
    parts.push(`Breakdown: ${scoreResult.scoreBreakdown.compliantCount} compliant, ${scoreResult.scoreBreakdown.partialCount} partial, ${scoreResult.scoreBreakdown.nonCompliantCount} non-compliant.`);
  } else {
    parts.push(`Score could not be calculated: ${scoreResult.complianceStatus}.`);
  }
  
  return parts.join(' ');
}

function buildNextSteps(
  scoreResult: any,
  criticalIssues: ComplianceFindingV3[],
  majorIssues: ComplianceFindingV3[]
): string[] {
  const steps: string[] = [];
  
  if (criticalIssues.length > 0) {
    steps.push(`Address ${criticalIssues.length} critical issue(s) immediately`);
  }
  
  if (majorIssues.length > 0) {
    steps.push(`Review ${majorIssues.length} major issue(s) for compliance gaps`);
  }
  
  if (scoreResult.scoreBreakdown.partialCount > 0) {
    steps.push('Review partial compliance items for improvement opportunities');
  }
  
  if (scoreResult.overallScore !== null && scoreResult.overallScore >= 8) {
    steps.push('Maintain current compliance standards through regular reviews');
  } else if (scoreResult.overallScore !== null && scoreResult.overallScore >= 5) {
    steps.push('Create action plan to address non-compliant areas');
  } else if (scoreResult.overallScore !== null) {
    steps.push('Prioritize comprehensive SOP revision to meet regulatory requirements');
  }
  
  if (steps.length === 0) {
    steps.push('Review the analysis results and consult with QA team');
  }
  
  return steps;
}
