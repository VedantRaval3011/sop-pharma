import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ComplianceReport from '@/models/ComplianceReport';

/**
 * POST /api/compliance/check-existing
 *
 * Pre-flight check for bulk compliance analysis.
 * Accepts a list of SOP IDs and returns which ones already have a compliance
 * report, along with their cached score / status / date so the UI can decide
 * whether to skip or re-run each SOP.
 *
 * Input:  { sopIds: string[] }
 * Output: { results: Record<sopId, ExistingReportSummary> }
 */

interface ExistingReportSummary {
  hasReport: boolean;
  reportId?: string;
  overallScore?: number | null;
  complianceStatus?: string;
  analyzedAt?: string;
  compliancePercentage?: number | null;
}

export async function POST(request: NextRequest) {
  try {
    await dbConnect();

    const body = await request.json();
    const sopIds: string[] = Array.isArray(body.sopIds) ? body.sopIds : [];

    if (sopIds.length === 0) {
      return NextResponse.json({ success: true, results: {} });
    }

    // Fetch the latest report per SOP (one per SOP after the upsert model)
    const reports = await ComplianceReport.find(
      { sopId: { $in: sopIds }, analysisStatus: 'completed' },
      {
        sopId: 1,
        overallScore: 1,
        complianceStatus: 1,
        compliancePercentage: 1,
        analyzedAt: 1,
      }
    ).lean();

    // Build a lookup map: sopId → summary
    const results: Record<string, ExistingReportSummary> = {};

    // Initialise all requested IDs as "no report"
    for (const id of sopIds) {
      results[id] = { hasReport: false };
    }

    // Fill in found reports
    for (const r of reports) {
      const id = String((r as any).sopId);
      results[id] = {
        hasReport: true,
        reportId: String((r as any)._id),
        overallScore: (r as any).overallScore ?? null,
        complianceStatus: (r as any).complianceStatus || 'Unknown',
        compliancePercentage: (r as any).compliancePercentage ?? null,
        analyzedAt: (r as any).analyzedAt
          ? new Date((r as any).analyzedAt).toISOString()
          : undefined,
      };
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('check-existing error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check existing reports' },
      { status: 500 }
    );
  }
}
