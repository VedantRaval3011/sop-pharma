import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Caches AI clause-level analysis responses keyed by a SHA-256 hash of
 * (sopContent + clauseText + clauseNumber + guidelineName + aiModel).
 *
 * Purpose:
 *  - Guarantees deterministic results: identical inputs always return the same finding.
 *  - Eliminates redundant AI API calls when the same SOP+clause pair is re-analyzed.
 *  - Cache is automatically invalidated when SOP content or guideline content changes
 *    (because the hash changes).
 */

export interface IComplianceAnalysisCache extends Document {
  contentHash: string;
  sopIdentifier: string;
  clauseIdentifier: string;   // guidelineName + '|' + clauseNumber
  aiModel: string;
  parsedResponse: Record<string, unknown>;
  createdAt: Date;
  lastAccessedAt: Date;
  hitCount: number;
  expiresAt: Date;
}

const ComplianceAnalysisCacheSchema = new Schema<IComplianceAnalysisCache>(
  {
    contentHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sopIdentifier: { type: String, required: true, index: true },
    clauseIdentifier: { type: String, required: true },
    aiModel: { type: String, required: true },
    parsedResponse: { type: Schema.Types.Mixed, required: true },
    lastAccessedAt: { type: Date, default: Date.now },
    hitCount: { type: Number, default: 0 },
    // TTL index — MongoDB auto-deletes documents after 30 days of no access
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true }
);

const ComplianceAnalysisCache: Model<IComplianceAnalysisCache> =
  mongoose.models.ComplianceAnalysisCache ||
  mongoose.model<IComplianceAnalysisCache>('ComplianceAnalysisCache', ComplianceAnalysisCacheSchema);

export default ComplianceAnalysisCache;
