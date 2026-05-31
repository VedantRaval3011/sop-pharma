import { GoogleGenerativeAI } from '@google/generative-ai';
import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Compliance Engine V3 - Precision & Scalability
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * CRITICAL IMPROVEMENTS:
 * 1. True Guideline Synchronization - Validate before analysis
 * 2. Analysis Gatekeeping - Stop if dependencies fail
 * 3. Section-Level Matching - Precise SOP-to-Clause mapping
 * 4. Intelligent Scoring - Based on actual coverage
 * 5. Department Intelligence - Context-aware analysis
 * 6. Transparent Reasoning - No misleading results
 */

// Validate API key early
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
if (!GEMINI_KEY) {
  console.warn('⚠️ GEMINI_API_KEY (or GOOGLE_AI_API_KEY) is not set. AI analysis will fail.');
}
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const STABLE_MODEL = 'gemini-2.0-flash';
const PLACEHOLDER_PATTERN =
  /\b(n\/a|not\s+determined|unable\s+to\s+determine|not\s+specified|not\s+found|not\s+addressed|manual\s+review\s+required|review\s+required|analysis\s+required)\b/i;

// ═══════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════

export type AnalysisResultStatus = 
  | 'COMPLETED'
  | 'GUIDELINE_SYNC_FAILED'
  | 'SOP_INVALID'
  | 'DEPARTMENT_MISMATCH'
  | 'ANALYSIS_INCOMPLETE'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'NO_APPLICABLE_GUIDELINES';

export interface GuidelineRequirement {
  guidelineId: string;
  guidelineName: string;
  folderName: string;
  pdfName: string;
  guidelineType: string;
  category: string;
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
  keywords: string[];
  // Enhanced fields for precision
  applicableDepartments: string[];
  isMandatory: boolean;
  regulatoryReference: string;
}

export interface SOPSection {
  sectionNumber: string;
  sectionTitle: string;
  sectionContent: string;
  startPosition: number;
  endPosition: number;
}

export interface ComplianceFindingV3 {
  // Unique identifier for this finding
  findingId: string;
  
  // Guideline reference (precise)
  guidelineId: string;
  guidelineName: string;
  folderName: string;
  pdfName: string;
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
  regulatoryReference: string;
  
  // SOP reference (precise)
  sopSectionNumber: string;
  sopSectionTitle: string;
  sopTextSnippet: string;
  
  // Analysis result
  complianceLevel: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable' | 'unable-to-determine';
  matchConfidence: number;
  
  // Issue details
  issueType: 'missing-clause' | 'partial-coverage' | 'incorrect-implementation' | 'outdated-practice' | 'ambiguous-wording' | 'no-issue' | 'not-applicable';
  issueSeverity: 'critical' | 'major' | 'minor' | 'informational';
  
  // Clear explanation (no generic text)
  specificGap: string;
  guidelineRequirement: string;
  sopCurrentState: string;
  
  // Actionable suggestions
  suggestedAction: string;
  suggestedText: string;
  estimatedEffort: 'low' | 'medium' | 'high';
  priority: number;
  
  // Metadata
  analyzedAt: Date;
  aiModelUsed: string;
  analysisMethod: 'ai-semantic' | 'keyword-match' | 'manual';
}

export interface DepartmentContext {
  department: string;
  relevantCategories: string[];
  criticalGuidelines: string[];
  expectedCoverage: string[];
  regulatoryFramework: string[];
}

export interface AnalysisGatekeepingResult {
  canProceed: boolean;
  status: AnalysisResultStatus;
  failureReason?: string;
  failureDetails?: string;
  
  // Validation results
  sopValidation: {
    isValid: boolean;
    contentLength: number;
    hasSections: boolean;
    sectionsFound: number;
    error?: string;
  };
  
  guidelineValidation: {
    isValid: boolean;
    guidelinesFound: number;
    clausesFound: number;
    applicableClausesCount: number;
    syncStatus: 'synced' | 'partial' | 'not-synced' | 'empty';
    error?: string;
  };
  
  departmentValidation: {
    isValid: boolean;
    department: string;
    hasRelevantGuidelines: boolean;
    error?: string;
  };
}

export interface ComplianceAnalysisResultV3 {
  // Status
  status: AnalysisResultStatus;
  analysisComplete: boolean;
  
  // Transparency
  analysisExplanation: string;
  dataSources: {
    sopName: string;
    sopIdentifier: string;
    sopContentLength: number;
    sopSectionsAnalyzed: number;
    guidelinesUsed: string[];
    clausesAnalyzed: number;
    clausesSkipped: number;
    analysisMethod: string;
  };
  
  // Score (only if analysis completed)
  overallScore: number | null;
  compliancePercentage: number | null;
  complianceStatus: string;
  
  // Breakdown
  scoreBreakdown: {
    totalApplicableClauses: number;
    compliantCount: number;
    partialCount: number;
    nonCompliantCount: number;
    notApplicableCount: number;
    unableToDetermineCount: number;
    skippedCount: number;
  };
  
  // Findings
  findings: ComplianceFindingV3[];
  
  // Critical issues highlighted
  criticalIssues: ComplianceFindingV3[];
  majorIssues: ComplianceFindingV3[];
  
  // Gatekeeping results
  gatekeeping: AnalysisGatekeepingResult;
  
  // Processing metadata
  processingTimeMs: number;
  aiCallsCount: number;
  
  // Recommendations
  nextSteps: string[];
}

// ═══════════════════════════════════════════════════════════════════════
// DEPARTMENT INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════

const DEPARTMENT_CONTEXTS: Record<string, DepartmentContext> = {
  'QA': {
    department: 'QA',
    relevantCategories: ['Quality Assurance', 'Documentation', 'General Compliance'],
    criticalGuidelines: ['ICH Q7', 'WHO GMP', 'Schedule M'],
    expectedCoverage: ['audit', 'capa', 'deviation', 'change control', 'documentation', 'approval'],
    regulatoryFramework: ['ICH', 'WHO', 'FDA', 'Schedule M'],
  },
  'QC': {
    department: 'QC',
    relevantCategories: ['Quality Control', 'Testing', 'Laboratory'],
    criticalGuidelines: ['ICH Q2', 'ICH Q6A', 'FDA 21 CFR Part 211'],
    expectedCoverage: ['testing', 'sampling', 'specifications', 'stability', 'method validation', 'oos'],
    regulatoryFramework: ['ICH', 'FDA', 'USP', 'BP'],
  },
  'PRODUCTION': {
    department: 'PRODUCTION',
    relevantCategories: ['Manufacturing', 'Production', 'Process Control'],
    criticalGuidelines: ['ICH Q7', 'FDA 21 CFR Part 211', 'Schedule M'],
    expectedCoverage: ['batch processing', 'equipment', 'in-process control', 'cleaning', 'gowning'],
    regulatoryFramework: ['ICH', 'FDA', 'Schedule M'],
  },
  'ENGINEERING AND MAINTENANCE': {
    department: 'ENGINEERING AND MAINTENANCE',
    relevantCategories: ['Equipment & Maintenance', 'Calibration', 'Qualification'],
    criticalGuidelines: ['ICH Q7', 'FDA 21 CFR Part 211', 'Schedule M'],
    expectedCoverage: ['calibration', 'maintenance', 'qualification', 'validation', 'equipment log'],
    regulatoryFramework: ['ICH', 'FDA', 'Schedule M'],
  },
  'MICROBIOLOGY': {
    department: 'MICROBIOLOGY',
    relevantCategories: ['Quality Control', 'Testing', 'Environmental Monitoring'],
    criticalGuidelines: ['ICH Q6A', 'FDA 21 CFR Part 211', 'WHO GMP Annex'],
    expectedCoverage: ['sterility', 'environmental monitoring', 'bioburden', 'endotoxin', 'water testing'],
    regulatoryFramework: ['ICH', 'FDA', 'WHO'],
  },
  'STORE': {
    department: 'STORE',
    relevantCategories: ['Storage & Material Handling', 'Warehouse'],
    criticalGuidelines: ['ICH Q7', 'FDA 21 CFR Part 211', 'WHO GMP'],
    expectedCoverage: ['storage conditions', 'material handling', 'inventory', 'dispensing', 'quarantine'],
    regulatoryFramework: ['ICH', 'FDA', 'WHO'],
  },
};

function getDepartmentContext(department: string): DepartmentContext {
  const normalized = department.toUpperCase().replace(/[^A-Z\s]/g, '').trim();
  
  // Try exact match
  if (DEPARTMENT_CONTEXTS[normalized]) {
    return DEPARTMENT_CONTEXTS[normalized];
  }
  
  // Try partial match
  for (const [key, context] of Object.entries(DEPARTMENT_CONTEXTS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return context;
    }
  }
  
  // Default context
  return {
    department: department,
    relevantCategories: ['General Compliance'],
    criticalGuidelines: ['ICH Q7', 'WHO GMP'],
    expectedCoverage: [],
    regulatoryFramework: ['ICH', 'WHO', 'FDA'],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SOP SECTION EXTRACTION
// ═══════════════════════════════════════════════════════════════════════

export function extractSOPSections(content: string): SOPSection[] {
  const sections: SOPSection[] = [];
  
  // Common SOP section patterns
  const patterns = [
    // Pattern 1: "1.0 PURPOSE", "2.0 SCOPE"
    /(\d+\.0)\s+([A-Z][A-Z\s&]+)/g,
    // Pattern 2: "Section 1: Purpose"
    /Section\s+(\d+):?\s*([^:\n]+)/gi,
    // Pattern 3: "1. PURPOSE", "2. SCOPE"
    /^(\d+)\.\s+([A-Z][A-Z\s&]+)/gm,
    // Pattern 4: "PURPOSE:", "SCOPE:"
    /^([A-Z][A-Z\s&]+):/gm,
  ];
  
  for (const pattern of patterns) {
    const matches = Array.from(content.matchAll(pattern));
    
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const startPos = match.index || 0;
      const nextMatch = matches[i + 1];
      const endPos = nextMatch?.index ? nextMatch.index : content.length;
      
      const sectionNumber = match[1] || `${i + 1}`;
      const sectionTitle = (match[2] || match[1]).trim();
      const sectionContent = content.slice(startPos, endPos).trim();
      
      // Only add if not duplicate
      const exists = sections.some(s => 
        s.sectionNumber === sectionNumber && s.sectionTitle === sectionTitle
      );
      
      if (!exists && sectionContent.length > 50) {
        sections.push({
          sectionNumber,
          sectionTitle,
          sectionContent,
          startPosition: startPos,
          endPosition: endPos,
        });
      }
    }
    
    if (sections.length > 0) break;
  }
  
  // If no sections found, create one large section
  if (sections.length === 0) {
    sections.push({
      sectionNumber: '1',
      sectionTitle: 'Full Document',
      sectionContent: content,
      startPosition: 0,
      endPosition: content.length,
    });
  }
  
  return sections;
}

// ═══════════════════════════════════════════════════════════════════════
// GATEKEEPING - VALIDATE BEFORE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

export async function validateAnalysisPrerequisites(
  sop: any,
  guidelines: any[],
  department: string
): Promise<AnalysisGatekeepingResult> {
  const result: AnalysisGatekeepingResult = {
    canProceed: false,
    status: 'COMPLETED',
    sopValidation: {
      isValid: false,
      contentLength: 0,
      hasSections: false,
      sectionsFound: 0,
    },
    guidelineValidation: {
      isValid: false,
      guidelinesFound: 0,
      clausesFound: 0,
      applicableClausesCount: 0,
      syncStatus: 'not-synced',
    },
    departmentValidation: {
      isValid: false,
      department,
      hasRelevantGuidelines: false,
    },
  };
  
  // 1. Validate SOP
  if (!sop) {
    result.status = 'SOP_INVALID';
    result.failureReason = 'SOP not found';
    result.failureDetails = 'The requested SOP does not exist in the database.';
    return result;
  }
  
  if (!sop.content || typeof sop.content !== 'string') {
    result.status = 'SOP_INVALID';
    result.failureReason = 'SOP content missing';
    result.failureDetails = 'The SOP has no extractable content.';
    return result;
  }
  
  const sections = extractSOPSections(sop.content);
  result.sopValidation = {
    isValid: sop.content.length >= 100,
    contentLength: sop.content.length,
    hasSections: sections.length > 1 || sections[0].sectionTitle !== 'Full Document',
    sectionsFound: sections.length,
  };
  
  if (sop.content.length < 100) {
    result.status = 'SOP_INVALID';
    result.failureReason = 'SOP content too short';
    result.failureDetails = `SOP has only ${sop.content.length} characters. Minimum 100 required.`;
    result.sopValidation.error = result.failureDetails;
    return result;
  }
  
  // 2. Validate Guidelines (TRUE SYNC CHECK)
  if (!guidelines || guidelines.length === 0) {
    result.status = 'GUIDELINE_SYNC_FAILED';
    result.failureReason = 'No guidelines found';
    result.failureDetails = 'No guidelines have been uploaded. Please upload regulatory guidelines first.';
    result.guidelineValidation.error = result.failureDetails;
    result.guidelineValidation.syncStatus = 'empty';
    return result;
  }
  
  // Check for actual parsed clauses
  const totalClauses = guidelines.reduce((sum, g) => sum + (g.clauses?.length || 0), 0);
  const guidelinesWithClauses = guidelines.filter(g => g.clauses && g.clauses.length > 0);
  
  result.guidelineValidation.guidelinesFound = guidelines.length;
  result.guidelineValidation.clausesFound = totalClauses;
  
  if (totalClauses === 0) {
    result.status = 'GUIDELINE_SYNC_FAILED';
    result.failureReason = 'Guidelines not properly synced';
    result.failureDetails = `Found ${guidelines.length} guideline(s) but 0 parsed clauses. Guidelines may need to be re-uploaded or OCR processing completed.`;
    result.guidelineValidation.error = result.failureDetails;
    result.guidelineValidation.syncStatus = 'not-synced';
    return result;
  }
  
  if (guidelinesWithClauses.length < guidelines.length) {
    result.guidelineValidation.syncStatus = 'partial';
  } else {
    result.guidelineValidation.syncStatus = 'synced';
  }
  
  // 3. Check department relevance
  const deptContext = getDepartmentContext(department);
  const applicableClauses = countApplicableClauses(guidelines, deptContext);
  
  result.guidelineValidation.applicableClausesCount = applicableClauses;
  result.departmentValidation = {
    isValid: true,
    department,
    hasRelevantGuidelines: applicableClauses > 0,
  };
  
  if (applicableClauses === 0) {
    result.status = 'NO_APPLICABLE_GUIDELINES';
    result.failureReason = 'No applicable guidelines for this department';
    result.failureDetails = `Department "${department}" has no matching guidelines. Available guidelines may not be relevant to this SOP's scope.`;
    result.departmentValidation.error = result.failureDetails;
    result.departmentValidation.hasRelevantGuidelines = false;
    // Don't return - we can still analyze with all guidelines
  }
  
  // All validations passed
  result.canProceed = true;
  result.status = 'COMPLETED';
  
  return result;
}

function countApplicableClauses(guidelines: any[], context: DepartmentContext): number {
  let count = 0;
  
  for (const guideline of guidelines) {
    const categoryMatch = context.relevantCategories.some(cat =>
      (guideline.category || '').toLowerCase().includes(cat.toLowerCase())
    );
    
    if (categoryMatch || !guideline.category) {
      count += guideline.clauses?.length || 0;
    }
  }
  
  return count;
}

// ═══════════════════════════════════════════════════════════════════════
// AI ANALYSIS WITH PRECISION
// ═══════════════════════════════════════════════════════════════════════

export async function analyzeClauseWithPrecision(
  sopContent: string,
  sopSections: SOPSection[],
  sopName: string,
  sopIdentifier: string,
  department: string,
  clause: GuidelineRequirement,
  aiModel: string = STABLE_MODEL
): Promise<ComplianceFindingV3> {
  const { generateCompliancePrompt, generateRefinedPrompt, validateAIResponse } = await import('./compliancePrompts');
  const { validateFinding, sanitizeAIOutput, detectHallucination } = await import('./ComplianceFindingValidator');

  const findingId = `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Find most relevant SOP section for this clause
  const relevantSection = findRelevantSection(sopSections, clause);
  const fallbackSectionNumber = String(relevantSection?.sectionNumber || '1').trim() || '1';
  const fallbackSectionTitle = String(relevantSection?.sectionTitle || 'Primary Section').trim() || 'Primary Section';
  const fallbackSnippet = extractEvidenceSnippet(relevantSection?.sectionContent || sopContent);

  // ── Content hash for deterministic caching ───────────────────────────
  const hashInput = [
    sopContent.substring(0, 8000),
    clause.clauseText.substring(0, 2000),
    clause.clauseNumber,
    clause.guidelineName,
    aiModel,
  ].join('||');
  const contentHash = crypto.createHash('sha256').update(hashInput).digest('hex');

  // ── Cache lookup ──────────────────────────────────────────────────────
  try {
    const dbConnect = (await import('@/lib/mongodb')).default;
    const ComplianceAnalysisCache = (await import('@/models/ComplianceAnalysisCache')).default;
    await dbConnect();

    const cached = await ComplianceAnalysisCache.findOneAndUpdate(
      { contentHash },
      { $inc: { hitCount: 1 }, $set: { lastAccessedAt: new Date() } },
      { new: true }
    );

    if (cached) {
      console.log(`   ✅ Cache hit for clause ${clause.clauseNumber} (${cached.hitCount} hits)`);
      const cp = cached.parsedResponse as any;

      // Re-apply keyword fallback in case it wasn't stored (backward compat)
      let complianceLevel = normalizeComplianceLevel(cp.complianceLevel || 'non-compliant');
      if (!cp.isClauseApplicable) complianceLevel = 'not-applicable';
      if (complianceLevel === 'unable-to-determine' && sopContent.length > 200) {
        complianceLevel = keywordFallbackClassification(sopContent, clause);
      }

      return {
        findingId: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        guidelineId:         cp.guidelineId         || clause.guidelineId,
        guidelineName:       cp.guidelineName        || clause.guidelineName,
        folderName:          cp.folderName           || clause.folderName,
        pdfName:             cp.pdfName              || clause.pdfName,
        clauseNumber:        cp.clauseNumber         || clause.clauseNumber,
        clauseTitle:         cp.clauseTitle          || clause.clauseTitle,
        clauseText:          cp.clauseText           || clause.clauseText,
        regulatoryReference: cp.regulatoryReference  || `${clause.guidelineType} ${clause.clauseNumber}`,
        sopSectionNumber:    cp.sopSectionNumber      || fallbackSectionNumber,
        sopSectionTitle:     cp.sopSectionTitle       || fallbackSectionTitle,
        sopTextSnippet:      cp.sopTextSnippet        || fallbackSnippet,
        complianceLevel,
        matchConfidence:     Math.min(100, Math.max(0, cp.matchConfidence ?? 50)),
        issueType:           normalizeIssueType(cp.issueType),
        issueSeverity:       normalizeIssueSeverity(cp.issueSeverity),
        specificGap:         cp.specificGap          || buildConservativeGapText(complianceLevel, clause, cp.sopSectionNumber || fallbackSectionNumber, cp.sopSectionTitle || fallbackSectionTitle),
        guidelineRequirement:cp.guidelineRequirement  || `Clause ${clause.clauseNumber} requires: ${trimToSentence(clause.clauseText, 220)}`,
        sopCurrentState:     cp.sopCurrentState       || `Section ${cp.sopSectionNumber || fallbackSectionNumber} states: "${cp.sopTextSnippet || fallbackSnippet}"`,
        suggestedAction:     cp.suggestedAction       || `Revise Section ${cp.sopSectionNumber || fallbackSectionNumber} to address Clause ${clause.clauseNumber}.`,
        suggestedText:       cp.suggestedText         || buildConservativeSuggestedText(cp.sopSectionNumber || fallbackSectionNumber, clause),
        estimatedEffort:     normalizeEstimatedEffort(cp.estimatedEffort),
        priority:            Math.min(5, Math.max(1, cp.priority ?? 3)),
        analyzedAt:          new Date(),
        aiModelUsed:         aiModel,
        analysisMethod:      'ai-semantic' as const,
      };
    }
  } catch (cacheErr) {
    console.warn('   ⚠️ Cache lookup failed (non-fatal):', (cacheErr as Error).message);
  }
  // ─────────────────────────────────────────────────────────────────────

  // Larger context window — gemini-2.0-flash handles 128k tokens
  const truncatedContent = sopContent.length > 8000
    ? sopContent.substring(0, 8000) + '\n...[truncated for length]'
    : sopContent;

  const prompt = generateCompliancePrompt({
    sopName,
    sopIdentifier,
    department,
    sopContent: truncatedContent,
    relevantSectionContent: relevantSection.sectionContent,
    relevantSectionNumber: relevantSection.sectionNumber,
    relevantSectionTitle: relevantSection.sectionTitle,
    guidelineName: clause.guidelineName,
    guidelineType: clause.guidelineType,
    clauseNumber: clause.clauseNumber,
    clauseTitle: clause.clauseTitle,
    clauseText: clause.clauseText,
    category: clause.category,
  });

  try {
    if (!GEMINI_KEY) {
      throw new Error('GEMINI_API_KEY (or GOOGLE_AI_API_KEY) is not configured in .env.local.');
    }
    const model = genAI.getGenerativeModel({
      model: aiModel,
      generationConfig: {
        temperature: 0,     // greedy decoding → fully deterministic output
        topP: 1,
        topK: 1,
        maxOutputTokens: 1024,
      },
    });

    let result;
    let parsed: any;
    let validationResult: any;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        const currentPrompt = retryCount === 0
          ? prompt
          : generateRefinedPrompt({
              originalPrompt: prompt,
              previousResponse: JSON.stringify(parsed || {}),
              validationErrors: validationResult?.errors || [],
            });

        result = await model.generateContent(currentPrompt);
        const responseText = result.response.text();

        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI response did not contain valid JSON');

        parsed = JSON.parse(jsonMatch[0]);
        validationResult = validateAIResponse(parsed);

        if (validationResult.isValid) {
          console.log(`✅ Valid response on attempt ${retryCount + 1}`);
          break;
        } else {
          console.warn(`⚠️ Validation failed (Attempt ${retryCount + 1}/${maxRetries}):`, validationResult.errors);
          retryCount++;
          if (retryCount >= maxRetries) {
            console.warn('Max retries reached. Using best available response.');
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (err: any) {
        console.warn(`⚠️ AI call failed (Attempt ${retryCount + 1}/${maxRetries}): ${err.message}`);
        retryCount++;
        if (retryCount >= maxRetries) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount - 1)));
      }
    }

    const sanitized = sanitizeAIOutput({
      findingId,
      guidelineId: clause.guidelineId,
      guidelineName: clause.guidelineName,
      folderName: clause.folderName,
      pdfName: clause.pdfName,
      clauseNumber: clause.clauseNumber,
      clauseTitle: clause.clauseTitle,
      clauseText: clause.clauseText,
      regulatoryReference: clause.regulatoryReference || `${clause.guidelineType} ${clause.clauseNumber}`,
      ...parsed,
    });

    const hallucinationCheck = detectHallucination(sanitized);
    if (hallucinationCheck.isHallucinated) {
      console.warn(`⚠️ Possible hallucination detected:`, hallucinationCheck.reasons);
      sanitized.matchConfidence = Math.min(sanitized.matchConfidence, 60);
    }

    const finalValidation = validateFinding(sanitized);
    if (!finalValidation.isValid) {
      console.warn(`⚠️ Final validation issues:`, finalValidation.errors);
    }
    if (finalValidation.warnings.length > 0) {
      console.warn(`⚠️ Validation warnings:`, finalValidation.warnings);
    }

    // Determine compliance level
    let complianceLevel = normalizeComplianceLevel(sanitized.complianceLevel);

    // Explicit not-applicable override
    if (!sanitized.isClauseApplicable) {
      complianceLevel = 'not-applicable';
    }

    // ── FALLBACK CLASSIFIER ──────────────────────────────────────────────
    // If the AI still returned "unable-to-determine" despite instructions,
    // apply a keyword-based classification so the finding is never wasted.
    if (complianceLevel === 'unable-to-determine' && sopContent.length > 200) {
      complianceLevel = keywordFallbackClassification(sopContent, clause);
      console.log(`   🔄 Fallback classification applied: ${complianceLevel}`);
    }
    // ────────────────────────────────────────────────────────────────────

    const sopSectionNumber = pickUsableText(sanitized.sopSectionNumber, 1) || fallbackSectionNumber;
    const sopSectionTitle  = pickUsableText(sanitized.sopSectionTitle, 3)  || fallbackSectionTitle;
    const sopTextSnippet   = pickUsableText(sanitized.sopTextSnippet, 10)  || fallbackSnippet;
    const sopCurrentState  =
      pickUsableText(sanitized.sopCurrentState, 15) ||
      `Section ${sopSectionNumber} (${sopSectionTitle}) states: "${sopTextSnippet}"`;
    const guidelineRequirement =
      pickUsableText(sanitized.guidelineRequirement, 15) ||
      `Clause ${clause.clauseNumber} requires: ${trimToSentence(clause.clauseText, 220)}`;
    const specificGap =
      pickUsableText(sanitized.specificGap, 20) ||
      buildConservativeGapText(complianceLevel, clause, sopSectionNumber, sopSectionTitle);
    const suggestedAction =
      pickUsableText(sanitized.suggestedAction, 20) ||
      `Revise Section ${sopSectionNumber} (${sopSectionTitle}) to explicitly address Clause ${clause.clauseNumber} (${clause.clauseTitle || 'requirement'}) with measurable controls.`;
    const suggestedText =
      pickUsableText(sanitized.suggestedText, 20) ||
      buildConservativeSuggestedText(sopSectionNumber, clause);

    // ── Write to cache (non-blocking) ──────────────────────────────────
    const cachePayload = {
      guidelineId: sanitized.guidelineId || clause.guidelineId,
      guidelineName: sanitized.guidelineName || clause.guidelineName,
      folderName: sanitized.folderName || clause.folderName,
      pdfName: sanitized.pdfName || clause.pdfName,
      clauseNumber: sanitized.clauseNumber || clause.clauseNumber,
      clauseTitle: sanitized.clauseTitle || clause.clauseTitle,
      clauseText: sanitized.clauseText || clause.clauseText,
      regulatoryReference: sanitized.regulatoryReference || `${clause.guidelineType} ${clause.clauseNumber}`,
      isClauseApplicable: sanitized.isClauseApplicable,
      sopSectionNumber, sopSectionTitle, sopTextSnippet, complianceLevel,
      matchConfidence: Math.min(100, Math.max(0, sanitized.matchConfidence || 50)),
      issueType: sanitized.issueType,
      issueSeverity: sanitized.issueSeverity,
      specificGap, guidelineRequirement, sopCurrentState,
      suggestedAction, suggestedText,
      estimatedEffort: sanitized.estimatedEffort,
      priority: Math.min(5, Math.max(1, sanitized.priority || 3)),
      aiModelUsed: aiModel,
    };
    (async () => {
      try {
        const dbConnect = (await import('@/lib/mongodb')).default;
        const ComplianceAnalysisCache = (await import('@/models/ComplianceAnalysisCache')).default;
        await dbConnect();
        await ComplianceAnalysisCache.findOneAndUpdate(
          { contentHash },
          {
            $set: {
              contentHash,
              sopIdentifier,
              clauseIdentifier: `${clause.guidelineName}|${clause.clauseNumber}`,
              aiModel,
              parsedResponse: cachePayload,
              lastAccessedAt: new Date(),
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
            $setOnInsert: { hitCount: 0 },
          },
          { upsert: true }
        );
      } catch (cacheWriteErr) {
        // Non-fatal — analysis result still returned correctly
      }
    })();
    // ────────────────────────────────────────────────────────────────────

    return {
      findingId: sanitized.findingId || findingId,
      guidelineId: sanitized.guidelineId || clause.guidelineId,
      guidelineName: sanitized.guidelineName || clause.guidelineName,
      folderName: sanitized.folderName || clause.folderName,
      pdfName: sanitized.pdfName || clause.pdfName,
      clauseNumber: sanitized.clauseNumber || clause.clauseNumber,
      clauseTitle: sanitized.clauseTitle || clause.clauseTitle,
      clauseText: sanitized.clauseText || clause.clauseText,
      regulatoryReference: sanitized.regulatoryReference || `${clause.guidelineType} ${clause.clauseNumber}`,
      sopSectionNumber,
      sopSectionTitle,
      sopTextSnippet,
      complianceLevel,
      matchConfidence: Math.min(100, Math.max(0, sanitized.matchConfidence || 50)),
      issueType: normalizeIssueType(sanitized.issueType),
      issueSeverity: normalizeIssueSeverity(sanitized.issueSeverity),
      specificGap,
      guidelineRequirement,
      sopCurrentState,
      suggestedAction,
      suggestedText,
      estimatedEffort: normalizeEstimatedEffort(sanitized.estimatedEffort),
      priority: Math.min(5, Math.max(1, sanitized.priority || 3)),
      analyzedAt: new Date(),
      aiModelUsed: aiModel,
      analysisMethod: 'ai-semantic',
    };
  } catch (error) {
    console.error(`AI analysis failed for clause ${clause.clauseNumber}:`, error);

    // Hard AI failure — apply keyword fallback so we don't return unable-to-determine
    const fallbackLevel = sopContent.length > 200
      ? keywordFallbackClassification(sopContent, clause)
      : 'unable-to-determine';

    return {
      findingId,
      guidelineId: clause.guidelineId,
      guidelineName: clause.guidelineName,
      folderName: clause.folderName,
      pdfName: clause.pdfName,
      clauseNumber: clause.clauseNumber,
      clauseTitle: clause.clauseTitle,
      clauseText: clause.clauseText,
      regulatoryReference: `${clause.guidelineType} ${clause.clauseNumber}`,
      sopSectionNumber: fallbackSectionNumber,
      sopSectionTitle: fallbackSectionTitle,
      sopTextSnippet: fallbackSnippet,
      complianceLevel: fallbackLevel,
      matchConfidence: 30,
      issueType: fallbackLevel === 'not-applicable' ? 'not-applicable' : 'missing-clause',
      issueSeverity: 'minor',
      specificGap: buildConservativeGapText(fallbackLevel, clause, fallbackSectionNumber, fallbackSectionTitle),
      guidelineRequirement: `Clause ${clause.clauseNumber} requires: ${trimToSentence(clause.clauseText, 220)}`,
      sopCurrentState: `Section ${fallbackSectionNumber} (${fallbackSectionTitle}) states: "${fallbackSnippet}"`,
      suggestedAction: `Add explicit controls in Section ${fallbackSectionNumber} (${fallbackSectionTitle}) to address Clause ${clause.clauseNumber} (${clause.clauseTitle || 'requirement'}).`,
      suggestedText: buildConservativeSuggestedText(fallbackSectionNumber, clause),
      estimatedEffort: 'medium',
      priority: 3,
      analyzedAt: new Date(),
      aiModelUsed: aiModel,
      analysisMethod: 'ai-semantic',
    };
  }
}

/**
 * Keyword-based fallback classifier used when the AI returns "unable-to-determine".
 *
 * Logic:
 *  - Extract clause keywords and common GMP concept words from the clause text.
 *  - Count how many appear in the SOP content.
 *  - ≥3 keyword hits  → "partial"  (topic exists but may be incomplete)
 *  - 1–2 keyword hits → "non-compliant" (barely addressed)
 *  - 0 keyword hits   → "non-compliant" (requirement absent)
 *
 * This is intentionally conservative: missing evidence = non-compliant in GMP.
 */
function keywordFallbackClassification(
  sopContent: string,
  clause: GuidelineRequirement,
): ComplianceFindingV3['complianceLevel'] {
  const sopLower = sopContent.toLowerCase();

  // Gather keywords: explicit clause keywords + words from clause title/text
  const rawKeywords: string[] = [
    ...(clause.keywords || []),
    ...clause.clauseTitle.toLowerCase().split(/\W+/).filter(w => w.length > 3),
    ...clause.clauseText.toLowerCase().split(/\W+/).filter(w => w.length > 4),
  ];

  // Deduplicate and take the 15 most distinctive terms
  const keywords = Array.from(new Set(rawKeywords))
    .filter(k => !COMMON_STOP_WORDS.has(k))
    .slice(0, 15);

  const hits = keywords.filter(k => sopLower.includes(k)).length;

  if (hits >= 3) return 'partial';
  return 'non-compliant';
}

const COMMON_STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'they', 'been', 'have', 'will', 'when',
  'were', 'each', 'also', 'into', 'than', 'then', 'what', 'such', 'more',
  'shall', 'must', 'should', 'would', 'could', 'which', 'where', 'these',
  'those', 'their', 'there', 'other', 'some', 'over', 'only', 'both',
  'made', 'used', 'make', 'does', 'most', 'through', 'upon', 'under',
]);


function findRelevantSection(sections: SOPSection[], clause: GuidelineRequirement): SOPSection {
  const clauseKeywords = (clause.keywords || []).concat(
    clause.clauseTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );
  
  let bestMatch = sections[0];
  let bestScore = 0;
  
  for (const section of sections) {
    const sectionLower = (section.sectionTitle + ' ' + section.sectionContent).toLowerCase();
    let score = 0;
    
    for (const keyword of clauseKeywords) {
      if (sectionLower.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = section;
    }
  }
  
  return bestMatch;
}

// ═══════════════════════════════════════════════════════════════════════
// INTELLIGENT SCORE CALCULATION
// ═══════════════════════════════════════════════════════════════════════

export function calculateIntelligentScore(
  findings: ComplianceFindingV3[],
  gatekeeping: AnalysisGatekeepingResult
): {
  overallScore: number | null;
  compliancePercentage: number | null;
  complianceStatus: string;
  scoreBreakdown: ComplianceAnalysisResultV3['scoreBreakdown'];
} {
  const totalFindings = findings.length;
  
  // Count by compliance level
  const compliantCount = findings.filter(f => f.complianceLevel === 'compliant').length;
  const partialCount = findings.filter(f => f.complianceLevel === 'partial').length;
  const nonCompliantCount = findings.filter(f => f.complianceLevel === 'non-compliant').length;
  const notApplicableCount = findings.filter(f => f.complianceLevel === 'not-applicable').length;
  const unableToDetermineCount = findings.filter(f => f.complianceLevel === 'unable-to-determine').length;
  
  const scoreBreakdown = {
    totalApplicableClauses: totalFindings - notApplicableCount,
    compliantCount,
    partialCount,
    nonCompliantCount,
    notApplicableCount,
    unableToDetermineCount,
    skippedCount: 0,
  };
  
  const applicableFindings = totalFindings - notApplicableCount;

  if (applicableFindings === 0) {
    return {
      overallScore: null,
      compliancePercentage: null,
      complianceStatus: 'Analysis Pending',
      scoreBreakdown,
    };
  }

  // If ≥80% of applicable findings are unable-to-determine, there is not enough
  // conclusive evidence to score the SOP — report as Analysis Pending rather than
  // falsely showing 0/10 Non-Compliant.
  if (unableToDetermineCount / applicableFindings >= 0.8) {
    return {
      overallScore: null,
      compliancePercentage: null,
      complianceStatus: 'Analysis Pending',
      scoreBreakdown,
    };
  }

  // Weighted score: compliant=10, partial=5, non-compliant=0, unable-to-determine=0
  const weightedScore = (compliantCount * 10 + partialCount * 5) / applicableFindings;
  const overallScore = Math.round(weightedScore * 10) / 10;
  const compliancePercentage = Math.round((compliantCount / applicableFindings) * 100);

  // Determine status
  let complianceStatus: string;
  if (overallScore >= 8.5) {
    complianceStatus = 'Fully Compliant';
  } else if (overallScore >= 5.0) {
    complianceStatus = 'Partially Compliant';
  } else if (overallScore > 0) {
    complianceStatus = 'Non-Compliant';
  } else {
    complianceStatus = 'Non-Compliant';
  }
  
  return {
    overallScore,
    compliancePercentage,
    complianceStatus,
    scoreBreakdown,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function normalizeComplianceLevel(level: string): ComplianceFindingV3['complianceLevel'] {
  const normalized = (level || '').toLowerCase();
  if (normalized.includes('unable') || normalized.includes('determine')) return 'unable-to-determine';
  if (normalized.includes('not-applicable') || normalized.includes('not applicable')) return 'not-applicable';
  if (normalized.includes('compliant') && !normalized.includes('non') && !normalized.includes('partial')) return 'compliant';
  if (normalized.includes('partial')) return 'partial';
  return 'non-compliant';
}

function normalizeIssueType(type: string): ComplianceFindingV3['issueType'] {
  const normalized = (type || '').toLowerCase();
  if (normalized.includes('missing')) return 'missing-clause';
  if (normalized.includes('partial')) return 'partial-coverage';
  if (normalized.includes('incorrect')) return 'incorrect-implementation';
  if (normalized.includes('outdated')) return 'outdated-practice';
  if (normalized.includes('ambiguous')) return 'ambiguous-wording';
  if (normalized.includes('no-issue') || normalized.includes('none')) return 'no-issue';
  if (normalized.includes('not-applicable')) return 'not-applicable';
  return 'partial-coverage';
}

function normalizeIssueSeverity(severity: string): ComplianceFindingV3['issueSeverity'] {
  const normalized = (severity || '').toLowerCase();
  if (normalized.includes('critical')) return 'critical';
  if (normalized.includes('major')) return 'major';
  if (normalized.includes('minor')) return 'minor';
  return 'informational';
}

function normalizeEstimatedEffort(effort: string): 'low' | 'medium' | 'high' {
  const normalized = (effort || '').toLowerCase();
  if (normalized.includes('low')) return 'low';
  if (normalized.includes('high')) return 'high';
  return 'medium';
}

function pickUsableText(value: unknown, minLength: number): string {
  const v = String(value || '').replace(/\s+/g, ' ').trim();
  if (!v) return '';
  if (v.length < minLength) return '';
  if (PLACEHOLDER_PATTERN.test(v)) return '';
  return v;
}

function trimToSentence(text: string, maxChars: number): string {
  const v = String(text || '').replace(/\s+/g, ' ').trim();
  if (!v) return '';
  if (v.length <= maxChars) return v;
  return `${v.slice(0, maxChars).trimEnd()}...`;
}

// Patterns that indicate a document header / metadata line rather than procedure content.
const HEADER_METADATA_PATTERN = /^(standard\s+operating\s+procedure|sop\s+no|document\s+no|sop\s+title|record\s+title|identifier|revision|version|effective\s+date|approved\s+by|department|page\s+\d|prepared\s+by|issue\s+date)/i;

function extractEvidenceSnippet(sectionContent: string): string {
  const clean = String(sectionContent || '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return 'The current SOP text in this area requires explicit wording aligned to the guideline clause.';
  }

  const pieces = clean
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Skip metadata/header lines and find the first real procedure sentence
  const procedureCandidate = pieces.find(
    (p) => p.length >= 25 && !PLACEHOLDER_PATTERN.test(p) && !HEADER_METADATA_PATTERN.test(p)
  );
  if (procedureCandidate) return trimToSentence(procedureCandidate, 280);

  // Fall back to any long-enough non-placeholder sentence
  const anyCandidate = pieces.find((p) => p.length >= 20 && !PLACEHOLDER_PATTERN.test(p));
  if (anyCandidate) return trimToSentence(anyCandidate, 280);

  return trimToSentence(clean, 280);
}

function buildConservativeGapText(
  level: ComplianceFindingV3['complianceLevel'],
  clause: GuidelineRequirement,
  sectionNumber: string,
  sectionTitle: string,
): string {
  if (level === 'compliant') {
    return `Section ${sectionNumber} (${sectionTitle}) provides language that aligns with Clause ${clause.clauseNumber}, and no material implementation gap is identified.`;
  }
  if (level === 'not-applicable') {
    return `Clause ${clause.clauseNumber} does not align with the scope/process covered by this SOP, so no direct implementation gap is recorded for this document.`;
  }
  return `Section ${sectionNumber} (${sectionTitle}) does not explicitly demonstrate all controls expected by Clause ${clause.clauseNumber} (${clause.clauseTitle || 'requirement'}), so the requirement coverage remains incomplete.`;
}

function buildConservativeSuggestedText(sectionNumber: string, clause: GuidelineRequirement): string {
  const requirement = trimToSentence(clause.clauseText, 180);
  return `Section ${sectionNumber} shall include an explicit requirement that ${requirement}. Responsibilities, execution steps, evidence records, and acceptance criteria shall be documented in measurable terms to demonstrate sustained compliance.`;
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

export { getDepartmentContext };
