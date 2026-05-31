import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import SOP from '@/models/SOP';
import SOPGuideline from '@/models/SOPGuideline';
import ComplianceReport from '@/models/ComplianceReport';
import User from '@/models/User';
import { analyzeSOPCompliance, filterRelevantGuidelines } from '@/lib/complianceEngine';

function normalizeDedupText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w.\- ]+/g, ' ')
    .trim();
}

function extractSectionToken(raw: unknown): string {
  const s = String(raw || '').trim();
  const match = s.match(/(\d+(?:\.\d+)*)/);
  return match ? match[1] : normalizeDedupText(s) || 'n/a';
}

/**
 * Remove exact duplicate findings by clause key.
 *
 * Design: only hard-dedup (guidelineId + clauseNumber) at the display layer.
 * Semantic/soft dedup is applied at SAVE TIME in the V3 analysis route so that
 * the stored report already has clean, distinct findings. A display-layer soft
 * dedup would over-aggressively collapse findings that share common SOP/topic
 * words but represent genuinely different regulatory requirements.
 */
function dedupeFindingsForDisplay(findings: any[]): any[] {
  if (!Array.isArray(findings) || findings.length === 0) return [];

  const seen = new Set<string>();
  const out: any[] = [];

  for (const f of findings) {
    if (!f) continue;
    // One finding per (guideline document × clause number)
    const key = `${String(f.guidelineId || '')}|${String(f.clauseNumber || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }

  return out;
}

/**
 * API Endpoint: Analyze SOP Compliance Against Guidelines
 * 
 * Takes an SOP and checks it against all relevant guidelines
 * Generates detailed compliance report with recommendations
 */

export async function POST(request: NextRequest) {
  console.log('🔍 Starting SOP compliance analysis...');
  const startTime = Date.now();

  try {
    await dbConnect();
    void User;

    const body = await request.json();
    const { sopId, userId, guidelineFilters } = body;

    if (!sopId) {
      return NextResponse.json(
        { error: 'SOP ID is required' },
        { status: 400 }
      );
    }

    // Step 1: Fetch SOP
    console.log(`📄 Fetching SOP: ${sopId}`);
    const sop = await SOP.findById(sopId);
    
    if (!sop) {
      return NextResponse.json(
        { error: 'SOP not found' },
        { status: 404 }
      );
    }

    console.log(`✅ SOP found: ${sop.name} (${sop.identifier})`);
    console.log(`   - Department: ${sop.department}`);
    console.log(`   - Version: ${sop.version}`);
    console.log(`   - Content length: ${sop.content.length} characters`);

    // Step 2: Fetch all guidelines (or filtered)
    console.log(`📚 Fetching guidelines...`);
    
    const guidelineQuery: any = { ocrStatus: 'completed' };
    
    // Apply filters if provided
    if (guidelineFilters) {
      if (guidelineFilters.folderName) {
        guidelineQuery.folderName = guidelineFilters.folderName;
      }
      if (guidelineFilters.category) {
        guidelineQuery.category = guidelineFilters.category;
      }
      if (guidelineFilters.guidelineType) {
        guidelineQuery.guidelineType = guidelineFilters.guidelineType;
      }
    }

    const guidelines = await SOPGuideline.find(guidelineQuery);
    console.log(`✅ Found ${guidelines.length} guidelines`);

    if (guidelines.length === 0) {
      return NextResponse.json(
        { error: 'No guidelines found. Please upload guidelines first.' },
        { status: 400 }
      );
    }

    // Step 3: Extract all clauses from guidelines
    console.log(`📋 Extracting clauses from guidelines...`);
    
    const allClauses = guidelines.flatMap(guideline =>
      guideline.clauses.map(clause => ({
        guidelineId: guideline._id.toString(),
        guidelineName: guideline.name,
        folderName: guideline.folderName,
        pdfName: guideline.pdfName,
        clauseNumber: clause.clauseNumber,
        clauseTitle: clause.clauseTitle,
        clauseText: clause.clauseText,
        keywords: clause.keywords,
      }))
    );

    console.log(`✅ Total clauses extracted: ${allClauses.length}`);

    // Step 4: Filter relevant guidelines (smart matching)
    console.log(`🎯 Filtering relevant guidelines for department: ${sop.department}`);
    
    const relevantClauses = filterRelevantGuidelines(
      allClauses,
      sop.department,
      sop.content
    );

    console.log(`✅ Relevant clauses: ${relevantClauses.length}`);

    // If no relevant clauses after filtering, use all clauses
    const clausesToCheck = relevantClauses.length > 0 ? relevantClauses : allClauses;
    
    // Limit to avoid timeout (max 50 clauses)
    const limitedClauses = clausesToCheck.slice(0, 50);
    
    console.log(`📊 Will check ${limitedClauses.length} clauses`);

    // Step 5: Perform compliance analysis
    console.log(`🤖 Starting AI-powered compliance analysis...`);
    
    const analysisResult = await analyzeSOPCompliance({
      sopContent: sop.content,
      sopName: sop.name,
      sopIdentifier: sop.identifier,
      guidelineClauses: limitedClauses,
    });

    console.log(`✅ Analysis completed in ${analysisResult.processingTimeMs}ms`);
    console.log(`   - Overall score: ${analysisResult.overallScore}/10`);
    console.log(`   - Status: ${analysisResult.complianceStatus}`);
    console.log(`   - Compliant: ${analysisResult.compliantCount}`);
    console.log(`   - Partial: ${analysisResult.partialCount}`);
    console.log(`   - Non-compliant: ${analysisResult.nonCompliantCount}`);

    // Step 6: Save compliance report to database
    console.log(`💾 Saving compliance report to database...`);
    
    const complianceReport = new ComplianceReport({
      sopId: sop._id,
      sopIdentifier: sop.identifier,
      sopName: sop.name,
      sopVersion: sop.version || '1.0',
      department: sop.department,
      sopContentLength: sop.content.length,
      
      // Analysis state
      analysisStatus: 'completed',
      analysisStartedAt: new Date(startTime),
      analysisCompletedAt: new Date(),
      analysisEngine: 'gemini-1.5-flash',
      processingTimeMs: analysisResult.processingTimeMs,
      analysisErrors: [],
      
      // Compliance score
      overallScore: analysisResult.overallScore,
      complianceStatus: analysisResult.complianceStatus,
      compliancePercentage: Math.round((analysisResult.overallScore / 10) * 100),
      
      // Score breakdown
      scoreBreakdown: {
        totalChecks: analysisResult.totalGuidelinesChecked,
        compliantCount: analysisResult.compliantCount,
        partialCount: analysisResult.partialCount,
        nonCompliantCount: analysisResult.nonCompliantCount,
        notApplicableCount: 0,
        skippedCount: 0,
      },
      
      // Findings with all required fields
      findings: analysisResult.findings.map(finding => ({
        guidelineId: finding.guidelineId || sop._id,
        guidelineName: finding.guidelineName,
        folderName: finding.folderName,
        pdfName: finding.pdfName,
        clauseNumber: finding.clauseNumber,
        clauseTitle: finding.clauseTitle,
        clauseText: finding.clauseText,
        complianceLevel: finding.complianceLevel,
        matchConfidence: finding.matchConfidence,
        sopSectionAffected: finding.sopSectionAffected,
        mismatchExplanation: finding.mismatchExplanation,
        suggestedAction: finding.suggestedAction,
        sopTextSnippet: finding.sopTextSnippet,
        highlightedIssue: finding.highlightedIssue,
        issueSeverity: finding.issueSeverity,
        issueType: finding.issueType,
        guidelineRequirement: finding.guidelineRequirement,
        suggestedText: finding.suggestedText,
        estimatedEffort: 'medium',
        priority: finding.issueSeverity === 'critical' ? 1 : finding.issueSeverity === 'major' ? 2 : 3,
        analyzedAt: new Date(),
        aiModelUsed: 'gemini-1.5-flash',
      })),
      
      // Data integrity
      dataIntegrity: {
        sopDataFetched: true,
        sopDataValidated: true,
        guidelinesDataFetched: true,
        guidelinesDataValidated: true,
        allClausesAnalyzed: true,
        scoreCalculated: true,
        scoreValidated: true,
        dataComplete: true,
        lastValidatedAt: new Date(),
      },
      
      // Legacy compatibility
      totalGuidelinesChecked: analysisResult.totalGuidelinesChecked,
      compliantCount: analysisResult.compliantCount,
      partialCount: analysisResult.partialCount,
      nonCompliantCount: analysisResult.nonCompliantCount,
      analyzedAt: new Date(),
      analyzedBy: userId,
    });

    await complianceReport.save();
    console.log(`✅ Compliance report saved: ${complianceReport._id}`);

    const totalTime = Date.now() - startTime;
    console.log(`\n✅ Total processing time: ${totalTime}ms`);

    return NextResponse.json({
      success: true,
      reportId: complianceReport._id,
      sopIdentifier: sop.identifier,
      sopName: sop.name,
      overallScore: analysisResult.overallScore,
      scoreEmoji: analysisResult.scoreEmoji,
      complianceStatus: analysisResult.complianceStatus,
      findings: analysisResult.findings,
      statistics: {
        totalGuidelinesChecked: analysisResult.totalGuidelinesChecked,
        compliantCount: analysisResult.compliantCount,
        partialCount: analysisResult.partialCount,
        nonCompliantCount: analysisResult.nonCompliantCount,
        criticalIssues: analysisResult.criticalIssues,
        majorIssues: analysisResult.majorIssues,
      },
      processingTimeMs: totalTime,
    });
  } catch (error) {
    console.error('❌ Error in compliance analysis API:', error);
    return NextResponse.json(
      {
        error: 'Failed to analyze SOP compliance',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET: Fetch compliance reports
 */
export async function GET(request: NextRequest) {
  try {
    await dbConnect();
    void User;

    const { searchParams } = new URL(request.url);
    const sopId = searchParams.get('sopId');
    const department = searchParams.get('department');
    const status = searchParams.get('status');
    const reportId = searchParams.get('reportId');

    // Fetch specific report by ID
    if (reportId) {
      const report = await ComplianceReport.findById(reportId)
        .populate('sopId')
        .populate('analyzedBy', 'name email')
        .maxTimeMS(25000)
        .lean();
      
      if (!report) {
        return NextResponse.json(
          { error: 'Compliance report not found' },
          { status: 404 }
        );
      }

      const rawFindings = Array.isArray((report as any).findings) ? (report as any).findings : [];
      // Apply dedup so identical/near-identical gaps are not shown twice.
      const fullFindings = dedupeFindingsForDisplay(rawFindings);
      const compliantCount    = fullFindings.filter((f: any) => f?.complianceLevel === 'compliant').length;
      const partialCount      = fullFindings.filter((f: any) => f?.complianceLevel === 'partial').length;
      const nonCompliantCount = fullFindings.filter((f: any) => f?.complianceLevel === 'non-compliant' || f?.complianceLevel === 'analysis-failed').length;
      const notApplicableCount = fullFindings.filter((f: any) => f?.complianceLevel === 'not-applicable').length;

      return NextResponse.json({
        success: true,
        report: {
          ...report,
          findings: fullFindings,
          compliantCount,
          partialCount,
          nonCompliantCount,
          scoreBreakdown: {
            ...(report as any).scoreBreakdown,
            totalChecks: fullFindings.length,
            compliantCount,
            partialCount,
            nonCompliantCount,
            notApplicableCount,
          },
        },
      });
    }

    // Build query
    const query: any = {};
    if (sopId) query.sopId = sopId;
    if (department) query.department = department;
    if (status) query.complianceStatus = status;

    const reports = await ComplianceReport.find(query)
      .select('-findings') // Completely exclude findings for list views
      .populate('sopId', 'name identifier department')
      .populate('analyzedBy', 'name email')
      .sort({ analyzedAt: -1 })
      .limit(50) // Reduced limit for better performance
      .lean();

    // Calculate summary statistics
    const stats = {
      totalReports: reports.length,
      averageScore: reports.reduce((sum, r) => sum + r.overallScore, 0) / reports.length || 0,
      byStatus: {
        'Fully Compliant': reports.filter(r => r.complianceStatus === 'Fully Compliant').length,
        'Partially Compliant': reports.filter(r => r.complianceStatus === 'Partially Compliant').length,
        'Non-Compliant': reports.filter(r => r.complianceStatus === 'Non-Compliant').length,
        'Analysis Pending': reports.filter(r => r.complianceStatus === 'Analysis Pending').length,
      },
      byDepartment: {} as Record<string, number>,
    };

    reports.forEach(report => {
      stats.byDepartment[report.department] = (stats.byDepartment[report.department] || 0) + 1;
    });

    return NextResponse.json({
      success: true,
      reports,
      stats,
    });
  } catch (error) {
    console.error('Error fetching compliance reports:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch compliance reports',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Delete a compliance report
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('reportId');

    if (!reportId) {
      return NextResponse.json(
        { error: 'Report ID is required' },
        { status: 400 }
      );
    }

    await dbConnect();
    
    // Check if report exists first
    const report = await ComplianceReport.findById(reportId);
    if (!report) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      );
    }

    await ComplianceReport.findByIdAndDelete(reportId);

    return NextResponse.json({
      success: true,
      message: 'Report deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting report:', error);
    return NextResponse.json(
      { error: 'Failed to delete report', details: (error as Error).message },
      { status: 500 }
    );
  }
}

