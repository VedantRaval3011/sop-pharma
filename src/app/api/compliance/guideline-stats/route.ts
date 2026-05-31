import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ComplianceReport from '@/models/ComplianceReport';

/**
 * GET /api/compliance/guideline-stats
 *
 * Returns per-guideline compliance point counts aggregated across all
 * compliance reports. Used to display finding totals on the Guidelines
 * dashboard in the compliance page.
 *
 * Response shape:
 * {
 *   success: true,
 *   stats: {
 *     [guidelineName: string]: {
 *       totalFindings: number,
 *       compliantCount: number,
 *       partialCount: number,
 *       nonCompliantCount: number,
 *       notApplicableCount: number,
 *       sopCount: number,          // how many distinct SOPs were checked against this guideline
 *     }
 *   }
 * }
 */
export async function GET(_req: NextRequest) {
  try {
    await dbConnect();

    const pipeline = [
      // Only look at completed reports
      { $match: { analysisStatus: 'completed' } },
      // Unwind findings array
      { $unwind: { path: '$findings', preserveNullAndEmptyArrays: false } },
      // Group by guideline name
      {
        $group: {
          _id: '$findings.guidelineName',
          folderName: { $first: '$findings.folderName' },
          totalFindings: { $sum: 1 },
          compliantCount: {
            $sum: { $cond: [{ $eq: ['$findings.complianceLevel', 'compliant'] }, 1, 0] },
          },
          partialCount: {
            $sum: { $cond: [{ $eq: ['$findings.complianceLevel', 'partial'] }, 1, 0] },
          },
          nonCompliantCount: {
            $sum: {
              $cond: [
                { $in: ['$findings.complianceLevel', ['non-compliant', 'analysis-failed']] },
                1,
                0,
              ],
            },
          },
          notApplicableCount: {
            $sum: { $cond: [{ $eq: ['$findings.complianceLevel', 'not-applicable'] }, 1, 0] },
          },
          sopIds: { $addToSet: '$sopId' },
        },
      },
      {
        $project: {
          _id: 0,
          guidelineName: '$_id',
          folderName: 1,
          totalFindings: 1,
          compliantCount: 1,
          partialCount: 1,
          nonCompliantCount: 1,
          notApplicableCount: 1,
          sopCount: { $size: '$sopIds' },
        },
      },
    ];

    const rows = await ComplianceReport.aggregate(pipeline as any[]);

    // Convert to a map keyed by guidelineName for O(1) lookup in the UI
    const stats: Record<string, any> = {};
    for (const row of rows) {
      stats[row.guidelineName] = {
        folderName: row.folderName,
        totalFindings: row.totalFindings,
        compliantCount: row.compliantCount,
        partialCount: row.partialCount,
        nonCompliantCount: row.nonCompliantCount,
        notApplicableCount: row.notApplicableCount,
        sopCount: row.sopCount,
      };
    }

    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error('Guideline stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch guideline stats' },
      { status: 500 }
    );
  }
}
