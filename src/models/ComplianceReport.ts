import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * REDESIGNED ComplianceReport Model - Data & UI Fix
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Store complete compliance analysis results with full traceability,
 * clear data flow, and UI transparency
 * 
 * DATA FLOW:
 * 1. Fetch SOP data → Validate → Store reference
 * 2. Fetch Guidelines → Validate → Store sources  
 * 3. Analyze each clause → AI → Store findings
 * 4. Calculate score → Validate → Store result
 * 5. Sync to UI → SOP Library, Monitoring, Reports
 * 
 * KEY IMPROVEMENTS:
 * - Clear analysis state tracking (pending/in-progress/completed/failed)
 * - Explicit error logging (no hidden failures)
 * - Data integrity checks (validate at each step)
 * - Full guideline source tracking (what was checked)
 * - Enhanced findings with issue types and severity
 * - Integration status tracking (synced to which modules)
 */

export interface IComplianceReport extends Document {
  // ═════════════════════════════════════════════════════════════════════
  // 1. SOP REFERENCE (Source Data - What is being analyzed)
  // ═════════════════════════════════════════════════════════════════════
  sopId: mongoose.Types.ObjectId;
  sopIdentifier: string;  // e.g., "QA-SOP-001"
  sopName: string;
  sopVersion: string;
  department: string;
  sopContentLength: number;  // Character count (validates SOP was fetched)
  sopFolderPath?: string;    // Where SOP is located
  
  // ═════════════════════════════════════════════════════════════════════
  // 2. ANALYSIS STATE (Process Tracking - What is happening)
  // ═════════════════════════════════════════════════════════════════════
  analysisStatus: 'pending' | 'in-progress' | 'completed' | 'failed' | 'partial-failure';
  analysisStartedAt: Date;
  analysisCompletedAt?: Date;
  analysisEngine:
    | 'gemini-2.0-flash'
    | 'gemini-1.5-flash'
    | 'gemini-1.5-pro'
    | 'manual'
    | 'hybrid'
    | 'gemini-3-pro-preview';
  processingTimeMs: number;
  
  // Error Tracking (Clear failure reasons)
  analysisErrors: {
    errorType: 'sop-not-found' | 'no-guidelines' | 'ai-timeout' | 'api-error' | 'validation-error' | 'other';
    errorMessage: string;      // Human-readable message
    errorDetails?: string;     // Technical details
    affectedStep: 'sop-fetch' | 'guideline-fetch' | 'ai-analysis' | 'score-calculation' | 'data-storage';
    timestamp: Date;
  }[];
  
  // ═════════════════════════════════════════════════════════════════════
  // 3. GUIDELINE SOURCES (What was checked against)
  // ═════════════════════════════════════════════════════════════════════
  guidelinesUsed: {
    guidelineId: mongoose.Types.ObjectId;
    guidelineName: string;
    folderName: string;        // "Folder 1", "Folder 2", etc.
    pdfName: string;
    guidelineType: string;     // "ICH Q7", "FDA 21 CFR Part 211"
    category: string;          // "Quality Control", "Manufacturing"
    totalClauses: number;      // How many clauses from this guideline
    clausesChecked: number;    // How many were actually analyzed
    relevanceScore?: number;   // 0-100% how relevant to this SOP
  }[];
  
  // ═════════════════════════════════════════════════════════════════════
  // 4. COMPLIANCE SCORE (Calculated Result - The answer)
  // ═════════════════════════════════════════════════════════════════════
  overallScore: number;  // 0-10 scale (null if analysis failed)
  complianceStatus:
    | 'Fully Compliant'
    | 'Partially Compliant'
    | 'Non-Compliant'
    | 'Not Applicable'
    | 'Analysis Pending'
    | 'Analysis Failed';
  compliancePercentage: number;  // 0-100% for easier visualization
  
  // Score Breakdown (Clear calculation)
  scoreBreakdown: {
    totalChecks: number;
    compliantCount: number;
    partialCount: number;
    nonCompliantCount: number;
    notApplicableCount: number;  // Guidelines that don't apply
    skippedCount: number;         // Failed to analyze
  };
  
  // ═════════════════════════════════════════════════════════════════════
  // 5. DETAILED FINDINGS (Core Results - What was found)
  // ═════════════════════════════════════════════════════════════════════
  findings: {
    // Reference Data (WHERE)
    guidelineId: mongoose.Types.ObjectId;
    guidelineName: string;
    folderName: string;
    pdfName: string;
    clauseNumber: string;      // e.g., "5.2.1"
    clauseTitle: string;       // e.g., "Documentation Requirements"
    clauseText: string;        // Full guideline text
    
    // Compliance Result (WHAT)
    complianceLevel: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable' | 'analysis-failed';
    matchConfidence: number;   // 0-100% (AI confidence)
    
    // Issue Categorization (TYPE)
    issueType: 'missing-clause' | 'partial-coverage' | 'incorrect-implementation' | 'outdated-practice' | 'ambiguous-wording' | 'no-issue' | 'not-applicable';
    issueSeverity: 'critical' | 'major' | 'minor' | 'informational';  // Impact level
    
    // Explanation (WHY)
    sopSectionAffected: string;       // "Section 4.3 - Record Retention"
    mismatchExplanation: string;      // Clear explanation of the gap
    highlightedIssue: string;         // Specific problem identified
    
    // Evidence (PROOF)
    sopTextSnippet: string;           // Actual SOP text analyzed
    guidelineRequirement: string;     // What the guideline requires
    
    // Action (HOW TO FIX)
    suggestedAction: string;          // Specific, actionable fix
    suggestedText: string;            // Exact text to add/modify
    estimatedEffort: 'low' | 'medium' | 'high';  // Implementation difficulty
    priority: number;                 // 1-5 (1 = highest)
    
    // Metadata
    analyzedAt: Date;
    aiModelUsed: string;              // Which AI model analyzed this
    reviewedBy?: mongoose.Types.ObjectId;  // If manually reviewed
    reviewStatus?: 'pending' | 'accepted' | 'disputed' | 'implemented';
    reviewNotes?: string;
  }[];
  
  // ═════════════════════════════════════════════════════════════════════
  // 6. DATA INTEGRITY CHECKS (Validation - Is data complete?)
  // ═════════════════════════════════════════════════════════════════════
  dataIntegrity: {
    sopDataFetched: boolean;
    sopDataValidated: boolean;
    guidelinesDataFetched: boolean;
    guidelinesDataValidated: boolean;
    allClausesAnalyzed: boolean;
    scoreCalculated: boolean;
    scoreValidated: boolean;
    dataComplete: boolean;  // Overall integrity flag
    lastValidatedAt?: Date;
  };
  
  // ═════════════════════════════════════════════════════════════════════
  // 7. AUDIT TRAIL (Who did what when)
  // ═════════════════════════════════════════════════════════════════════
  analyzedBy?: mongoose.Types.ObjectId;  // User who triggered analysis
  lastModifiedBy?: mongoose.Types.ObjectId;
  reviewHistory: {
    reviewedBy: mongoose.Types.ObjectId;
    action: 'created' | 'approved' | 'disputed' | 'corrected' | 'archived' | 're-analyzed';
    comment?: string;
    timestamp: Date;
  }[];
  
  // ═════════════════════════════════════════════════════════════════════
  // 8. INTEGRATION STATUS (Where is this data shown?)
  // ═════════════════════════════════════════════════════════════════════
  syncedToSOPMonitoring: boolean;
  syncedToSOPLibrary: boolean;
  syncedToMCQBank: boolean;
  lastSyncedAt?: Date;
  syncErrors: string[];  // Any sync failures
  
  // ═════════════════════════════════════════════════════════════════════
  // 9. LEGACY COMPATIBILITY (Backward compatibility)
  // ═════════════════════════════════════════════════════════════════════
  totalGuidelinesChecked: number;  // For old queries
  compliantCount: number;
  partialCount: number;
  nonCompliantCount: number;
  analyzedAt: Date;
  
  // ═════════════════════════════════════════════════════════════════════
  // 10. TIMESTAMPS (When)
  // ═════════════════════════════════════════════════════════════════════
  createdAt: Date;
  updatedAt: Date;
}

const ComplianceReportSchema = new Schema<IComplianceReport>({
  // 1. SOP REFERENCE
  sopId: {
    type: Schema.Types.ObjectId,
    ref: 'SOP',
    required: true,
    index: true,
  },
  sopIdentifier: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  sopName: {
    type: String,
    required: true,
    trim: true,
  },
  sopVersion: {
    type: String,
    required: true,
    trim: true,
  },
  department: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  sopContentLength: {
    type: Number,
    required: true,
    default: 0,
  },
  sopFolderPath: {
    type: String,
    trim: true,
  },
  
  // 2. ANALYSIS STATE
  analysisStatus: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'failed', 'partial-failure'],
    default: 'pending',
    required: true,
    index: true,
  },
  analysisStartedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  analysisCompletedAt: {
    type: Date,
  },
  analysisEngine: {
    type: String,
    enum: [
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'manual',
      'hybrid',
      'gemini-3-pro-preview',
    ],
    default: 'gemini-3-pro-preview',
  },
  processingTimeMs: {
    type: Number,
    default: 0,
  },
  analysisErrors: [{
    errorType: {
      type: String,
      enum: ['sop-not-found', 'no-guidelines', 'ai-timeout', 'api-error', 'validation-error', 'other'],
      required: true,
    },
    errorMessage: { type: String, required: true },
    errorDetails: { type: String },
    affectedStep: {
      type: String,
      enum: ['sop-fetch', 'guideline-fetch', 'ai-analysis', 'score-calculation', 'data-storage'],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
  }],
  
  // 3. GUIDELINE SOURCES
  guidelinesUsed: [{
    guidelineId: { type: Schema.Types.ObjectId, ref: 'SOPGuideline', required: true },
    guidelineName: { type: String, required: true },
    folderName: { type: String, required: true },
    pdfName: { type: String, required: true },
    guidelineType: { type: String, required: true },
    category: { type: String, required: true },
    totalClauses: { type: Number, required: true },
    clausesChecked: { type: Number, required: true },
    relevanceScore: { type: Number, min: 0, max: 100 },
  }],
  
  // 4. COMPLIANCE SCORE
  overallScore: {
    type: Number,
    min: 0,
    max: 10,
    default: null,  // null until calculated
  },
  complianceStatus: {
    type: String,
    enum: ['Fully Compliant', 'Partially Compliant', 'Non-Compliant', 'Not Applicable', 'Analysis Pending', 'Analysis Failed'],
    default: 'Analysis Pending',
    required: true,
    index: true,
  },
  compliancePercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  scoreBreakdown: {
    totalChecks: { type: Number, default: 0 },
    compliantCount: { type: Number, default: 0 },
    partialCount: { type: Number, default: 0 },
    nonCompliantCount: { type: Number, default: 0 },
    notApplicableCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
  },
  
  // 5. DETAILED FINDINGS
  findings: [{
    // Reference
    guidelineId: { type: Schema.Types.ObjectId, ref: 'SOPGuideline', required: true },
    guidelineName: { type: String, required: true },
    folderName: { type: String, required: true },
    pdfName: { type: String, required: true },
    clauseNumber: { type: String, required: true },
    clauseTitle: { type: String, required: true },
    clauseText: { type: String, required: true },
    
    // Result
    complianceLevel: {
      type: String,
      enum: ['compliant', 'partial', 'non-compliant', 'not-applicable', 'analysis-failed'],
      required: true,
    },
    matchConfidence: { type: Number, min: 0, max: 100, required: true },
    
    // Categorization
    issueType: {
      type: String,
      enum: ['missing-clause', 'partial-coverage', 'incorrect-implementation', 'outdated-practice', 'ambiguous-wording', 'no-issue', 'not-applicable'],
      required: true,
    },
    issueSeverity: {
      type: String,
      enum: ['critical', 'major', 'minor', 'informational'],
      default: 'minor',
    },
    
    // Explanation
    sopSectionAffected: { type: String, required: true },
    mismatchExplanation: { type: String, required: true },
    highlightedIssue: { type: String, required: true },
    
    // Evidence
    sopTextSnippet: { type: String, required: true },
    guidelineRequirement: { type: String, required: true },
    
    // Action
    suggestedAction: { type: String, required: true },
    suggestedText: { type: String, required: true },
    estimatedEffort: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    priority: { type: Number, min: 1, max: 5, default: 3 },
    
    // Metadata
    analyzedAt: { type: Date, default: Date.now },
    aiModelUsed: { type: String, default: 'gemini-3-pro-preview' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewStatus: {
      type: String,
      enum: ['pending', 'accepted', 'disputed', 'implemented'],
      default: 'pending',
    },
    reviewNotes: { type: String },
  }],
  
  // 6. DATA INTEGRITY
  dataIntegrity: {
    sopDataFetched: { type: Boolean, default: false },
    sopDataValidated: { type: Boolean, default: false },
    guidelinesDataFetched: { type: Boolean, default: false },
    guidelinesDataValidated: { type: Boolean, default: false },
    allClausesAnalyzed: { type: Boolean, default: false },
    scoreCalculated: { type: Boolean, default: false },
    scoreValidated: { type: Boolean, default: false },
    dataComplete: { type: Boolean, default: false },
    lastValidatedAt: { type: Date },
  },
  
  // 7. AUDIT TRAIL
  analyzedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewHistory: [{
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: {
      type: String,
      enum: ['created', 'approved', 'disputed', 'corrected', 'archived', 're-analyzed'],
      required: true,
    },
    comment: { type: String },
    timestamp: { type: Date, default: Date.now },
  }],
  
  // 8. INTEGRATION STATUS
  syncedToSOPMonitoring: { type: Boolean, default: false },
  syncedToSOPLibrary: { type: Boolean, default: false },
  syncedToMCQBank: { type: Boolean, default: false },
  lastSyncedAt: { type: Date },
  syncErrors: [{ type: String }],
  
  // 9. LEGACY COMPATIBILITY
  totalGuidelinesChecked: { type: Number, default: 0 },
  compliantCount: { type: Number, default: 0 },
  partialCount: { type: Number, default: 0 },
  nonCompliantCount: { type: Number, default: 0 },
  analyzedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

// ═════════════════════════════════════════════════════════════════════
// INDEXES (For fast queries)
// ═════════════════════════════════════════════════════════════════════
ComplianceReportSchema.index({ sopId: 1, analyzedAt: -1 });
ComplianceReportSchema.index({ department: 1, complianceStatus: 1 });
ComplianceReportSchema.index({ overallScore: 1 });
// `complianceStatus` already has `index: true` on the field; avoid duplicate index warnings in dev.
ComplianceReportSchema.index({ analyzedAt: -1 });
ComplianceReportSchema.index({ 'dataIntegrity.dataComplete': 1 });  // NEW: Filter complete data
// Compound index for the sop-guideline-review GET route:
// .find({ analysisStatus: 'completed' }).sort({ analysisCompletedAt: -1 })
// Without this, Mongo tries in-memory sort and crashes at 32 MB on large collections.
ComplianceReportSchema.index({ analysisStatus: 1, analysisCompletedAt: -1 });
ComplianceReportSchema.index({ sopIdentifier: 1, analysisStatus: 1, analysisCompletedAt: -1 });

// In Next.js dev/hot-reload, an already-compiled model keeps the old schema (incl enums).
// Recompile in dev so enum changes like "Not Applicable" take effect without restart.
if (process.env.NODE_ENV !== 'production' && mongoose.models.ComplianceReport) {
  delete mongoose.models.ComplianceReport;
}

const ComplianceReport: Model<IComplianceReport> =
  mongoose.models.ComplianceReport || mongoose.model<IComplianceReport>('ComplianceReport', ComplianceReportSchema);

export default ComplianceReport;
