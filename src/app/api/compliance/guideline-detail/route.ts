import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ComplianceReport from '@/models/ComplianceReport';

/**
 * GET /api/compliance/guideline-detail?name=<guidelineName>
 *
 * Returns detailed compliance data for a specific guideline across all analyzed SOPs.
 *
 * Response:
 * {
 *   success: true,
 *   guidelineName: string,
 *   folderName: string,
 *   overview: { totalFindings, compliantCount, partialCount, nonCompliantCount, notApplicableCount, avgScore, rating, sopCount },
 *   clauseSummary: [{ clauseNumber, clauseTitle, compliantSOPs, partialSOPs, nonCompliantSOPs, observations, recommendations, sopRefs }],
 *   sopSummary: [{ sopIdentifier, sopName, overallScore, complianceStatus, findingsCount, compliantCount, nonCompliantCount }],
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get('name');
    if (!name) {
      return NextResponse.json({ success: false, error: 'name parameter required' }, { status: 400 });
    }

    await dbConnect();

    // Fetch all completed reports that have findings for this guideline
    const reports = await ComplianceReport.find(
      { analysisStatus: 'completed', 'findings.guidelineName': name },
      {
        sopIdentifier: 1,
        sopName: 1,
        overallScore: 1,
        complianceStatus: 1,
        findings: { $elemMatch: { guidelineName: name } },
      },
    ).lean();

    // Re-fetch full findings for this guideline (elemMatch only returns first match)
    const fullReports = await ComplianceReport.find(
      { analysisStatus: 'completed', 'findings.guidelineName': name },
      { sopIdentifier: 1, sopName: 1, overallScore: 1, complianceStatus: 1, findings: 1 },
    ).lean();

    // Per-SOP summary
    let folderName = '';
    let totalFindings = 0;
    let compliantCount = 0;
    let partialCount = 0;
    let nonCompliantCount = 0;
    let notApplicableCount = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    const clauseMap: Record<string, {
      clauseNumber: string;
      clauseTitle: string;
      clauseText: string;
      compliantSOPs: number;
      partialSOPs: number;
      nonCompliantSOPs: number;
      notApplicableSOPs: number;
      observations: string[];
      recommendations: string[];
      sopRefs: { sopIdentifier: string; sopName: string; complianceLevel: string; confidence: number }[];
    }> = {};

    const sopSummary: {
      sopIdentifier: string;
      sopName: string;
      overallScore: number;
      complianceStatus: string;
      findingsCount: number;
      compliantCount: number;
      nonCompliantCount: number;
      partialCount: number;
    }[] = [];

    for (const report of fullReports as any[]) {
      const guidelineFindings = (report.findings || []).filter(
        (f: any) => f.guidelineName === name,
      );
      if (guidelineFindings.length === 0) continue;

      if (!folderName && guidelineFindings[0]?.folderName) {
        folderName = guidelineFindings[0].folderName;
      }

      let sopCompliant = 0;
      let sopNonCompliant = 0;
      let sopPartial = 0;

      for (const f of guidelineFindings) {
        totalFindings++;
        const level = f.complianceLevel;
        if (level === 'compliant') { compliantCount++; sopCompliant++; }
        else if (level === 'partial') { partialCount++; sopPartial++; }
        else if (level === 'non-compliant' || level === 'analysis-failed') { nonCompliantCount++; sopNonCompliant++; }
        else { notApplicableCount++; }

        // Build clause summary
        const key = `${f.clauseNumber}||${f.guidelineName}`;
        if (!clauseMap[key]) {
          clauseMap[key] = {
            clauseNumber: f.clauseNumber || '',
            clauseTitle: f.clauseTitle || '',
            clauseText: f.clauseText || '',
            compliantSOPs: 0,
            partialSOPs: 0,
            nonCompliantSOPs: 0,
            notApplicableSOPs: 0,
            observations: [],
            recommendations: [],
            sopRefs: [],
          };
        }
        const entry = clauseMap[key];
        if (level === 'compliant') entry.compliantSOPs++;
        else if (level === 'partial') entry.partialSOPs++;
        else if (level === 'non-compliant' || level === 'analysis-failed') entry.nonCompliantSOPs++;
        else entry.notApplicableSOPs++;

        if (f.mismatchExplanation && !entry.observations.includes(f.mismatchExplanation)) {
          entry.observations.push(f.mismatchExplanation);
        }
        if (f.suggestedAction && !entry.recommendations.includes(f.suggestedAction)) {
          entry.recommendations.push(f.suggestedAction);
        }
        entry.sopRefs.push({
          sopIdentifier: report.sopIdentifier || '',
          sopName: report.sopName || '',
          complianceLevel: level,
          confidence: f.matchConfidence || 0,
        });
      }

      if (typeof report.overallScore === 'number') {
        scoreSum += report.overallScore;
        scoreCount++;
      }

      sopSummary.push({
        sopIdentifier: report.sopIdentifier || '',
        sopName: report.sopName || '',
        overallScore: report.overallScore ?? 0,
        complianceStatus: report.complianceStatus || '',
        findingsCount: guidelineFindings.length,
        compliantCount: sopCompliant,
        nonCompliantCount: sopNonCompliant,
        partialCount: sopPartial,
      });
    }

    const avgScore = scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : 0;
    const rating =
      avgScore >= 8 ? 'Fully Compliant' :
      avgScore >= 5 ? 'Partially Compliant' :
      avgScore > 0  ? 'Non-Compliant' : 'Not Analyzed';

    // Sort clause summary: non-compliant first, then partial, then compliant
    const clauseSummary = Object.values(clauseMap).sort((a, b) => {
      const scoreA = a.nonCompliantSOPs * 3 + a.partialSOPs;
      const scoreB = b.nonCompliantSOPs * 3 + b.partialSOPs;
      return scoreB - scoreA;
    });

    // Limit observations/recommendations per clause to 3 each
    for (const c of clauseSummary) {
      c.observations = c.observations.slice(0, 3);
      c.recommendations = c.recommendations.slice(0, 3);
      c.sopRefs = c.sopRefs.slice(0, 10);
    }

    return NextResponse.json({
      success: true,
      guidelineName: name,
      folderName,
      overview: {
        totalFindings,
        compliantCount,
        partialCount,
        nonCompliantCount,
        notApplicableCount,
        avgScore,
        rating,
        sopCount: fullReports.length,
      },
      clauseSummary,
      sopSummary: sopSummary.sort((a, b) => b.overallScore - a.overallScore),
    });
  } catch (error) {
    console.error('Guideline detail error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch guideline detail' }, { status: 500 });
  }
}
