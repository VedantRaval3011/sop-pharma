import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import SOP from '@/models/SOP';
import SOPGuideline from '@/models/SOPGuideline';
import SOPGuidelineResult from '@/models/SOPGuidelineResult';
import ComplianceReport from '@/models/ComplianceReport';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { normalizeSopIdentifierKey } from '@/lib/sopIdentifierNormalize';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — same as compliance engine

const BATCH_SIZE = 12;
const SMALL_BATCH_SIZE = 5; // used when clause texts are very long
const CLAUSE_TEXT_LIMIT = 400; // chars per clause in the prompt

function isLikelyObjectId(id: string): boolean {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalise complianceLevel — AI sometimes uses underscores or wrong case */
function normLevel(raw: string): string {
  const v = String(raw || '').toLowerCase().replace(/_/g, '-');
  const valid = ['compliant', 'partial', 'non-compliant', 'not-applicable'];
  return valid.includes(v) ? v : 'non-compliant';
}

/**
 * Build a batch prompt — same logic as analyze-v4.
 * Sends up to BATCH_SIZE clauses per AI call; expects a JSON array back.
 */
function buildBatchPrompt(
  sopData: { identifier: string; name: string; department: string; content: string },
  items: Array<{ guideline: { name: string; folderName: string }; clause: { clauseNumber: string; clauseTitle: string; clauseText: string } }>
): string {
  const clauseList = items
    .map(({ guideline, clause }, idx) =>
      '[' + (idx + 1) + '] Guideline: ' + guideline.name + ' (' + guideline.folderName + ')\n' +
      '    Clause ' + clause.clauseNumber + ': ' + clause.clauseTitle + '\n' +
      '    Requirement: ' + (clause.clauseText || '').substring(0, CLAUSE_TEXT_LIMIT) +
      ((clause.clauseText || '').length > CLAUSE_TEXT_LIMIT ? '...' : '')
    )
    .join('\n\n');

  const sopContent = (sopData.content || 'No content available').substring(0, 14000);
  const truncated  = (sopData.content || '').length > 14000;

  return (
    'You are a pharmaceutical GMP compliance expert.\n\n' +
    'Analyze the SOP below against EACH numbered guideline clause.\n' +
    'Return a JSON ARRAY containing exactly ' + items.length + ' objects (one per clause, same order).\n\n' +
    '**SOP:**\n' +
    '- Identifier: ' + sopData.identifier + '\n' +
    '- Name: ' + sopData.name + '\n' +
    '- Department: ' + sopData.department + '\n\n' +
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
    '  "sopSectionAffected": "Section X.Y - Title or N/A",\n' +
    '  "mismatchExplanation": "Concise explanation of gap or compliance",\n' +
    '  "highlightedIssue": "Specific issue or empty string",\n' +
    '  "sopTextSnippet": "Relevant verbatim SOP text (max 200 chars) or empty",\n' +
    '  "guidelineRequirement": "What this clause requires (concise)",\n' +
    '  "suggestedAction": "Specific actionable fix",\n' +
    '  "suggestedText": "Exact proposed text to add/modify",\n' +
    '  "estimatedEffort": "low" | "medium" | "high",\n' +
    '  "priority": 1-5\n' +
    '}\n\n' +
    'RULES:\n' +
    '1. SOP does not mention topic → "non-compliant" + "missing-clause"\n' +
    '2. SOP partially addresses → "partial" + "partial-coverage"\n' +
    '3. SOP fully complies → "compliant" + "no-issue"\n' +
    '4. Clause irrelevant to this SOP → "not-applicable"\n' +
    '5. Be specific and actionable.\n\n' +
    'Respond with ONLY a valid JSON array of length ' + items.length + '. No markdown, no extra text.'
  );
}

function parseBatchResponse(text: string, expectedCount: number): any[] {
  let t = text.trim();
  if (t.startsWith('```json')) t = t.slice(7);
  else if (t.startsWith('```')) t = t.slice(3);
  if (t.endsWith('```')) t = t.slice(0, -3);
  t = t.trim();
  const start = t.indexOf('[');
  const end   = t.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('No JSON array in batch response');
  const parsed = JSON.parse(t.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Response is not array');
  while (parsed.length < expectedCount) parsed.push(null);
  return parsed.slice(0, expectedCount);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sopId         = typeof body.sopId         === 'string' ? body.sopId.trim()         : '';
    const sopIdentifier = typeof body.sopIdentifier === 'string' ? body.sopIdentifier.trim() : '';
    const sopNo         = typeof body.sopNo         === 'string' ? body.sopNo.trim()         : '';
    const rawIds        = body.guidelineIds;
    const guidelineIds: string[] = Array.isArray(rawIds)
      ? rawIds.map((x: unknown) => String(x).trim()).filter(isLikelyObjectId)
      : [];

    if (!sopId && !sopIdentifier && !sopNo) {
      return NextResponse.json({ success: false, error: 'sopId, sopIdentifier, or sopNo is required' }, { status: 400 });
    }
    if (guidelineIds.length === 0) {
      return NextResponse.json({
        success: false, error: 'No guidelines selected',
        userMessage: 'Choose at least one guideline document from your stored library to run the check.',
      }, { status: 400 });
    }

    await connectDB();

    // ── Resolve SOP (same 4-step cascade as before) ──────────────────
    let sop: any = null;
    if (sopId && isLikelyObjectId(sopId))  sop = await SOP.findById(sopId);
    if (!sop && sopIdentifier)             sop = await SOP.findOne({ identifier: new RegExp('^' + escapeRegex(sopIdentifier) + '$', 'i') });
    if (!sop && sopNo)                     sop = await SOP.findOne({ identifier: new RegExp('^' + escapeRegex(sopNo)         + '$', 'i') });
    if (!sop && sopNo) {
      const loose = sopNo.replace(/[-\s]/g, '').toUpperCase();
      const candidates = await SOP.find({
        identifier: { $regex: new RegExp(loose.substring(0, Math.min(loose.length, 8)), 'i') },
      }).select('_id identifier content name department').lean();
      const match = candidates.find((c: any) => (c.identifier || '').replace(/[-\s]/g, '').toUpperCase() === loose);
      if (match) sop = await SOP.findById(match._id);
    }

    if (!sop) {
      return NextResponse.json({
        success: false, error: 'SOP not found',
        userMessage: 'Could not find SOP "' + (sopNo || sopIdentifier || sopId) + '" in the database. Only uploaded SOPs can be reviewed.',
      }, { status: 404 });
    }

    const content = (sop.content || '').trim();
    if (content.length < 80) {
      return NextResponse.json({
        success: false, error: 'SOP has insufficient text',
        userMessage: 'This SOP has little or no extracted text. Re-upload or OCR the document before running a guideline review.',
      }, { status: 400 });
    }

    // ── Fetch selected guidelines + their clauses ─────────────────────
    const objectIds  = guidelineIds.map(id => new mongoose.Types.ObjectId(id));
    const guidelines = await SOPGuideline.find({ _id: { $in: objectIds }, ocrStatus: 'completed' })
      .select('name folderName pdfName guidelineType category clauses')
      .lean();

    if (guidelines.length === 0) {
      return NextResponse.json({
        success: false, error: 'No matching guidelines',
        userMessage: 'None of the selected guidelines are available or finished processing (OCR). Choose other documents or wait.',
      }, { status: 400 });
    }

    // Flatten all clauses across selected guidelines
    const allClauses: Array<{ guideline: any; clause: any }> = [];
    for (const g of guidelines) {
      const clauses = Array.isArray(g.clauses) ? g.clauses : [];
      for (const c of clauses) {
        allClauses.push({ guideline: g, clause: c });
      }
    }

    if (allClauses.length === 0) {
      return NextResponse.json({
        success: false, error: 'No clauses found',
        userMessage: 'The selected guideline documents have no clause structure. Try documents that completed OCR processing.',
      }, { status: 400 });
    }

    // ── AI init ───────────────────────────────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
    if (!geminiKey) {
      return NextResponse.json({
        success: false, error: 'AI not configured',
        userMessage: 'Set GEMINI_API_KEY in the environment to run guideline review.',
      }, { status: 503 });
    }

    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // ── Batch analysis (same as analyze-v4) ──────────────────────────
    const findings: any[] = [];

    const batches: Array<typeof allClauses> = [];
    for (let i = 0; i < allClauses.length; i += BATCH_SIZE) {
      batches.push(allClauses.slice(i, i + BATCH_SIZE));
    }

    const sopData = { identifier: sop.identifier, name: sop.name, department: sop.department || 'General', content };

    console.log('[sop-guideline-review POST] Analysis starting:', {
      sopIdentifier: sop.identifier,
      sopName: sop.name,
      totalClauses: allClauses.length,
      totalBatches: batches.length,
      guidelineCount: guidelines.length,
    });

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];

      // Dynamically split oversized batches — if avg clause text > 300 chars, use SMALL_BATCH_SIZE
      const avgClauseLen = batch.reduce((acc, { clause }) => acc + (clause.clauseText || '').length, 0) / batch.length;
      const effectiveBatchSize = avgClauseLen > 300 ? SMALL_BATCH_SIZE : BATCH_SIZE;

      const subBatches: Array<typeof batch> = [];
      for (let j = 0; j < batch.length; j += effectiveBatchSize) {
        subBatches.push(batch.slice(j, j + effectiveBatchSize));
      }

      for (const subBatch of subBatches) {
        let batchResult: any[] | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const prompt = buildBatchPrompt(sopData, subBatch);
            const result = await model.generateContent(prompt);
            batchResult  = parseBatchResponse(result.response.text(), subBatch.length);
            break;
          } catch (batchErr) {
            console.error(`[sop-guideline-review] batch error (attempt ${attempt + 1}):`, batchErr);
            if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
          }
        }

        subBatch.forEach(({ guideline, clause }, i) => {
          const ai = batchResult?.[i];
          if (!ai || typeof ai !== 'object') {
            findings.push(failedFinding(guideline, clause));
            return;
          }
          findings.push({
            guidelineId:        guideline._id?.toString() ?? '',
            guidelineName:      guideline.name,
            folderName:         guideline.folderName,
            pdfName:            guideline.pdfName || '',
            clauseNumber:       clause.clauseNumber,
            clauseTitle:        clause.clauseTitle,
            clauseText:         clause.clauseText,
            complianceLevel:    normLevel(ai.complianceLevel),
            matchConfidence:    Number(ai.matchConfidence) || 0,
            issueType:          ai.issueType          || 'not-applicable',
            issueSeverity:      ai.issueSeverity      || 'minor',
            sopSectionAffected: String(ai.sopSectionAffected || 'N/A'),
            mismatchExplanation:String(ai.mismatchExplanation || ''),
            highlightedIssue:   String(ai.highlightedIssue   || ''),
            sopTextSnippet:     String(ai.sopTextSnippet      || ''),
            guidelineRequirement:String(ai.guidelineRequirement || clause.clauseTitle || ''),
            suggestedAction:    String(ai.suggestedAction    || ''),
            suggestedText:      String(ai.suggestedText      || ''),
            estimatedEffort:    ai.estimatedEffort || 'medium',
            priority:           Number(ai.priority) || 3,
          });
        });
        if (subBatches.indexOf(subBatch) < subBatches.length - 1) await new Promise(r => setTimeout(r, 200));
      }

      if (bIdx < batches.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    // ── Compute summary counts ────────────────────────────────────────
    const compliantCount    = findings.filter(f => f.complianceLevel === 'compliant').length;
    const partialCount      = findings.filter(f => f.complianceLevel === 'partial').length;
    const nonCompliantCount = findings.filter(f => f.complianceLevel === 'non-compliant').length;
    const notApplicable     = findings.filter(f => f.complianceLevel === 'not-applicable').length;
    const applicable        = findings.length - notApplicable;
    const overallScore      = applicable > 0
      ? Math.round(((compliantCount * 10 + partialCount * 5) / applicable) * 10) / 10
      : 10;

    console.log('[sop-guideline-review POST] Analysis completed:', {
      findingsCount: findings.length,
      compliant: compliantCount,
      partial: partialCount,
      nonCompliant: nonCompliantCount,
      notApplicable,
      overallScore,
    });

    // ── Persist result (shuttle system) ─────────────────────────────
    try {
      await SOPGuidelineResult.findOneAndUpdate(
        { sopNo: sop.identifier },
        {
          sopId: sop._id,
          sopNo: sop.identifier,
          sopName: sop.name,
          overallScore,
          clausesAnalyzed: findings.length,
          guidelineDocumentsUsed: guidelines.length,
          guidelineIds,
          // Note: findings array not stored to avoid BSON 16MB limit exceeded
          // Detailed findings are returned to client; summary stats are stored for caching
          runAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (saveErr) {
      console.warn('sop-guideline-review: could not persist result:', saveErr);
      // non-fatal – still return the result to the client
    }

    return NextResponse.json({
      success: true,
      sopIdentifier:        sop.identifier,
      sopName:              sop.name,
      guidelineDocumentsUsed: guidelines.length,
      guidelineIdsRequested:  guidelineIds.length,
      clausesAnalyzed:      findings.length,
      batchesUsed:          batches.length,
      overallScore,
      counts: { compliantCount, partialCount, nonCompliantCount, notApplicable },
      findings,
    });

  } catch (e) {
    console.error('sop-guideline-review:', e);
    return NextResponse.json({
      success: false,
      error: (e as Error).message || 'Review failed',
      userMessage: 'Guideline review failed. Try again or check server logs.',
    }, { status: 500 });
  }
}

/**
 * GET /api/dashboard/sop-guideline-review
 *   ?listAll=true  → returns all stored results merged from both sources (dashboard wizard + compliance section)
 *   ?sopNo=QA-SOP-001 → returns result for one SOP (checks both sources)
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const listAll = searchParams.get('listAll') === 'true';
    const sopNo   = searchParams.get('sopNo')?.trim();

    if (listAll) {
      // ── Source 1: Dashboard wizard results (SOPGuidelineResult)
      const wizardResults = await SOPGuidelineResult
        .find({})
        .select('sopNo sopName overallScore clausesAnalyzed guidelineDocumentsUsed guidelineIds runAt findings')
        .sort({ runAt: -1 })
        .lean();

      // Build a map keyed by sopNo so we can merge
      const cache: Record<string, any> = {};
      for (const r of wizardResults) {
        const nk = normalizeSopIdentifierKey(r.sopNo || '');
        cache[nk] = {
          sopNo: nk,
          sopName: r.sopName || '',
          overallScore: r.overallScore ?? 0,
          clausesAnalyzed: r.clausesAnalyzed ?? 0,
          guidelineDocumentsUsed: r.guidelineDocumentsUsed ?? 0,
          guidelineIds: Array.isArray(r.guidelineIds) ? r.guidelineIds : [],
          runAt: r.runAt,
          findings: Array.isArray(r.findings) ? r.findings : [],
          source: 'dashboard-wizard',
        };
      }

      // ── Source 2: Compliance section results (ComplianceReport)
      // Use compliance reports to: (a) fill in findings for wizard results that have none,
      // (b) add entries for SOPs that have no wizard result at all.
      try {
        // Force a single batch round-trip so the server-side cursor is closed
        // immediately. Without this the driver opens a cursor that's drained
        // in chunks (default 101 docs); if downstream awaits delay the next
        // getMore by >10 min the server reaps the cursor → CursorNotFound (43).
        const complianceReports = await ComplianceReport
          .find({ analysisStatus: 'completed' })
          .select('sopIdentifier sopName overallScore compliancePercentage scoreBreakdown guidelinesUsed findings analysisCompletedAt')
          .sort({ analysisCompletedAt: -1 })
          .limit(500)
          .batchSize(1000)
          .allowDiskUse(true)
          .lean();

        for (const r of complianceReports) {
          if (!r.sopIdentifier) continue;
          const key = normalizeSopIdentifierKey(r.sopIdentifier);

          const normalizedFindings = normalizeComplianceFindings(r.findings || []);

          if (!cache[key]) {
            // No wizard result — add from compliance report
            cache[key] = {
              sopNo: key,
              sopName: r.sopName || '',
              overallScore: r.overallScore ?? 0,
              clausesAnalyzed: r.scoreBreakdown?.totalChecks ?? normalizedFindings.length,
              guidelineDocumentsUsed: (r.guidelinesUsed || []).length,
              runAt: r.analysisCompletedAt || new Date(),
              findings: normalizedFindings,
              source: 'compliance-section',
            };
          } else if (cache[key].findings.length === 0 && normalizedFindings.length > 0) {
            // Wizard result exists but findings weren't persisted — backfill from compliance report
            cache[key].findings = normalizedFindings;
            cache[key].overallScore = cache[key].overallScore || (r.overallScore ?? 0);
            cache[key].clausesAnalyzed = cache[key].clausesAnalyzed || (r.scoreBreakdown?.totalChecks ?? normalizedFindings.length);
            cache[key].guidelineDocumentsUsed = cache[key].guidelineDocumentsUsed || (r.guidelinesUsed || []).length;
          }
        }
      } catch (compErr) {
        console.warn('sop-guideline-review GET: could not load ComplianceReport:', compErr);
        // non-fatal — still return wizard results
      }

      return NextResponse.json({ success: true, results: Object.values(cache) });
    }

    if (sopNo) {
      const normalizedSopNo = normalizeSopIdentifierKey(sopNo);
      // Check wizard results first (try both normalized and raw form)
      const wizardResult: any = await SOPGuidelineResult.findOne({
        sopNo: { $in: [normalizedSopNo, sopNo] },
      }).lean();

      // Always also fetch the latest compliance report so we can backfill findings.
      // Query by both normalized and raw identifier to handle legacy records.
      let complianceFindings: any[] = [];
      let complianceReport: any = null;
      try {
        complianceReport = await ComplianceReport
          .findOne({ sopIdentifier: { $in: [normalizedSopNo, sopNo] }, analysisStatus: 'completed' })
          .sort({ analysisCompletedAt: -1 })
          .allowDiskUse(true)
          .lean();
        if (complianceReport) {
          complianceFindings = normalizeComplianceFindings(complianceReport.findings || []);
        }
      } catch (_) { /* ignore */ }

      if (wizardResult) {
        // Wizard result found — backfill findings if they weren't persisted
        const findings = Array.isArray(wizardResult.findings) && wizardResult.findings.length > 0
          ? wizardResult.findings
          : complianceFindings;
        return NextResponse.json({
          success: true,
          source: 'dashboard-wizard',
          result: { ...wizardResult, sopNo: normalizedSopNo, findings },
        });
      }

      if (complianceReport) {
        return NextResponse.json({
          success: true,
          source: 'compliance-section',
          result: {
            sopNo: normalizedSopNo,
            sopName: complianceReport.sopName || '',
            overallScore: complianceReport.overallScore ?? 0,
            clausesAnalyzed: complianceReport.scoreBreakdown?.totalChecks ?? 0,
            guidelineDocumentsUsed: (complianceReport.guidelinesUsed || []).length,
            runAt: complianceReport.analysisCompletedAt || new Date(),
            findings: complianceFindings,
          },
        });
      }

      return NextResponse.json({ success: false, error: 'No stored result for this SOP' }, { status: 404 });
    }

    return NextResponse.json({ success: false, error: 'Provide listAll=true or sopNo param' }, { status: 400 });
  } catch (e) {
    console.error('sop-guideline-review GET:', e);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}

/**
 * Normalize ComplianceReport findings (from /compliance page) into the same
 * field shape as SOPGuidelineResult findings (from dashboard wizard).
 * Both schemas are already very similar — just ensuring consistent names.
 */
function normalizeComplianceFindings(findings: any[]): any[] {
  return findings.map(f => ({
    guidelineId:          f.guidelineId?.toString() ?? '',
    guidelineName:        f.guidelineName        || '',
    folderName:           f.folderName           || '',
    pdfName:              f.pdfName              || '',
    clauseNumber:         f.clauseNumber         || '',
    clauseTitle:          f.clauseTitle          || '',
    clauseText:           f.clauseText           || '',
    // Compliance fields
    complianceLevel:      f.complianceLevel      || 'not-applicable',
    matchConfidence:      f.matchConfidence       ?? 0,
    issueType:            f.issueType            || 'not-applicable',
    issueSeverity:        f.issueSeverity        || 'informational',
    // Location / explanation  
    sopSectionAffected:   f.sopSectionAffected   || f.sopSectionNumber  || 'N/A',
    mismatchExplanation:  f.mismatchExplanation  || f.specificGap       || '',
    highlightedIssue:     f.highlightedIssue     || '',
    sopTextSnippet:       f.sopTextSnippet       || '',
    guidelineRequirement: f.guidelineRequirement || f.clauseTitle       || '',
    // Actions
    suggestedAction:      f.suggestedAction      || '',
    suggestedText:        f.suggestedText        || '',
    estimatedEffort:      f.estimatedEffort      || 'medium',
    priority:             f.priority             ?? 3,
  }));
}

function failedFinding(guideline: any, clause: any) {
  return {
    guidelineId: guideline._id?.toString() ?? '',
    guidelineName: guideline.name, folderName: guideline.folderName, pdfName: guideline.pdfName || '',
    clauseNumber: clause.clauseNumber, clauseTitle: clause.clauseTitle, clauseText: clause.clauseText,
    complianceLevel: 'non-compliant', matchConfidence: 0, issueType: 'missing-clause',
    issueSeverity: 'informational', sopSectionAffected: 'N/A',
    mismatchExplanation: 'Analysis failed — could not evaluate this clause. Please re-run.', highlightedIssue: '',
    sopTextSnippet: '',
    // Use title (not full clause text) so the UI shows a concise label
    guidelineRequirement: clause.clauseTitle || clause.clauseNumber || 'Unknown clause',
    suggestedAction: 'Re-run analysis', suggestedText: '', estimatedEffort: 'low', priority: 5,
  };
}
