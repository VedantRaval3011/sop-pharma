'use client';
import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, XCircle, MinusCircle, FileText, Building2, Star, BookOpen, Loader2 } from 'lucide-react';

interface GuidelineDetailProps {
  guidelineName: string;
  onClose: () => void;
}

function ratingColor(rating: string) {
  if (rating === 'Fully Compliant') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (rating === 'Partially Compliant') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (rating === 'Non-Compliant') return 'text-red-700 bg-red-50 border-red-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

function levelColor(level: string) {
  if (level === 'compliant') return 'text-emerald-700 bg-emerald-50';
  if (level === 'partial') return 'text-amber-700 bg-amber-50';
  if (level === 'non-compliant' || level === 'analysis-failed') return 'text-red-700 bg-red-50';
  return 'text-gray-500 bg-gray-50';
}

function levelLabel(level: string) {
  if (level === 'compliant') return 'Compliant';
  if (level === 'partial') return 'Partial';
  if (level === 'non-compliant' || level === 'analysis-failed') return 'Gap';
  return 'N/A';
}

function LevelIcon({ level }: { level: string }) {
  if (level === 'compliant') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (level === 'partial') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (level === 'non-compliant' || level === 'analysis-failed') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return <MinusCircle className="h-3.5 w-3.5 text-gray-400" />;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 8 ? 'bg-emerald-600' : score >= 5 ? 'bg-amber-500' : score > 0 ? 'bg-red-500' : 'bg-gray-400';
  return (
    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-white font-black text-base shadow-sm ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

export default function GuidelineComplianceDetailModal({ guidelineName, onClose }: GuidelineDetailProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'clauses' | 'sops'>('clauses');
  const [expandedClause, setExpandedClause] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/compliance/guideline-detail?name=${encodeURIComponent(guidelineName)}`)
      .then(r => r.json())
      .then(j => {
        if (j.success) setData(j);
        else setError(j.error || 'Failed to load data');
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [guidelineName]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 shadow-sm">
              <BookOpen className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-0.5">Compliance Detail</p>
              <h2 className="text-base font-bold text-gray-900 leading-tight truncate">{guidelineName}</h2>
              {data?.folderName && (
                <span className="text-[10px] text-gray-500 font-medium">{data.folderName}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 ml-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <p className="text-sm text-gray-500">Loading compliance data…</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : !data || data.overview.totalFindings === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
            <BookOpen className="h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500 font-medium">No compliance analysis found for this guideline.</p>
            <p className="text-xs text-gray-400">Run a compliance check from the SOP table to generate data.</p>
          </div>
        ) : (
          <>
            {/* Overview strip */}
            <div className="shrink-0 px-6 py-4 border-b border-gray-100 bg-white">
              <div className="flex flex-wrap items-center gap-4">
                {/* Score */}
                <div className="flex items-center gap-3">
                  <ScoreBadge score={data.overview.avgScore} />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Avg Score</p>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${ratingColor(data.overview.rating)}`}>
                      {data.overview.rating}
                    </span>
                  </div>
                </div>

                <div className="w-px h-10 bg-gray-200" />

                {/* Stat pills */}
                <div className="flex flex-wrap gap-2">
                  <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 min-w-[60px]">
                    <span className="text-lg font-black tabular-nums text-gray-800">{data.overview.totalFindings}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Points</span>
                  </div>
                  <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 min-w-[60px]">
                    <span className="text-lg font-black tabular-nums text-emerald-700">{data.overview.compliantCount}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500">Compliant</span>
                  </div>
                  <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 min-w-[60px]">
                    <span className="text-lg font-black tabular-nums text-amber-700">{data.overview.partialCount}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500">Partial</span>
                  </div>
                  <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 min-w-[60px]">
                    <span className="text-lg font-black tabular-nums text-red-700">{data.overview.nonCompliantCount}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-red-500">Gaps</span>
                  </div>
                  <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 min-w-[60px]">
                    <span className="text-lg font-black tabular-nums text-indigo-700">{data.overview.sopCount}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-500">SOPs</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="flex-1 min-w-[160px]">
                  <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                    {data.overview.compliantCount > 0 && (
                      <div
                        className="bg-emerald-500 transition-all"
                        style={{ width: `${(data.overview.compliantCount / data.overview.totalFindings) * 100}%` }}
                      />
                    )}
                    {data.overview.partialCount > 0 && (
                      <div
                        className="bg-amber-400 transition-all"
                        style={{ width: `${(data.overview.partialCount / data.overview.totalFindings) * 100}%` }}
                      />
                    )}
                    {data.overview.nonCompliantCount > 0 && (
                      <div
                        className="bg-red-500 transition-all"
                        style={{ width: `${(data.overview.nonCompliantCount / data.overview.totalFindings) * 100}%` }}
                      />
                    )}
                  </div>
                  <div className="flex justify-between mt-1 text-[9px] text-gray-400 font-medium">
                    <span>0%</span>
                    <span>{Math.round((data.overview.compliantCount / data.overview.totalFindings) * 100)}% compliant</span>
                    <span>100%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="shrink-0 flex border-b border-gray-100 px-6">
              <button
                onClick={() => setActiveTab('clauses')}
                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${activeTab === 'clauses' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                Compliance Points ({data.clauseSummary?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('sops')}
                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${activeTab === 'sops' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                SOP References ({data.sopSummary?.length || 0})
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {activeTab === 'clauses' && (
                <div className="divide-y divide-gray-100">
                  {(data.clauseSummary || []).map((clause: any, i: number) => {
                    const key = `${clause.clauseNumber}-${i}`;
                    const isOpen = expandedClause === key;
                    const total = clause.compliantSOPs + clause.partialSOPs + clause.nonCompliantSOPs + clause.notApplicableSOPs;
                    const dominant =
                      clause.nonCompliantSOPs > 0 ? 'non-compliant' :
                      clause.partialSOPs > 0 ? 'partial' : 'compliant';

                    return (
                      <div key={key} className="px-6">
                        <button
                          onClick={() => setExpandedClause(isOpen ? null : key)}
                          className="w-full flex items-start gap-3 py-3 text-left hover:bg-gray-50 -mx-6 px-6 transition-colors"
                        >
                          <LevelIcon level={dominant} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-mono">
                                {clause.clauseNumber || '—'}
                              </span>
                              <span className="text-xs font-semibold text-gray-800 truncate">{clause.clauseTitle || 'Clause'}</span>
                            </div>
                            {clause.clauseText && (
                              <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1 italic">{clause.clauseText}</p>
                            )}
                            {/* Mini bar showing SOP-level stats */}
                            <div className="flex items-center gap-3 mt-1">
                              {clause.compliantSOPs > 0 && (
                                <span className="text-[9px] font-bold text-emerald-600">✓ {clause.compliantSOPs}</span>
                              )}
                              {clause.partialSOPs > 0 && (
                                <span className="text-[9px] font-bold text-amber-600">~ {clause.partialSOPs}</span>
                              )}
                              {clause.nonCompliantSOPs > 0 && (
                                <span className="text-[9px] font-bold text-red-600">✗ {clause.nonCompliantSOPs}</span>
                              )}
                              <span className="text-[9px] text-gray-400">across {total} SOP{total !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                          {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />}
                        </button>

                        {isOpen && (
                          <div className="pb-4 space-y-3">
                            {/* Clause text */}
                            {clause.clauseText && (
                              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 mb-1">Guideline Requirement</p>
                                <p className="text-xs text-indigo-900 italic leading-relaxed">{clause.clauseText}</p>
                              </div>
                            )}

                            {/* Observations */}
                            {clause.observations?.length > 0 && (
                              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-2">Compliance Gaps & Observations</p>
                                <ul className="space-y-1">
                                  {clause.observations.map((obs: string, j: number) => (
                                    <li key={j} className="text-xs text-amber-900 flex gap-2">
                                      <span className="shrink-0 text-amber-400 mt-0.5">⚠</span>
                                      <span>{obs}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Recommendations */}
                            {clause.recommendations?.length > 0 && (
                              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-2">Recommendations & Corrective Actions</p>
                                <ul className="space-y-1">
                                  {clause.recommendations.map((rec: string, j: number) => (
                                    <li key={j} className="text-xs text-emerald-900 flex gap-2">
                                      <span className="shrink-0 text-emerald-500 mt-0.5">✓</span>
                                      <span>{rec}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* SOP refs for this clause */}
                            {clause.sopRefs?.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Related SOP Evidence</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {clause.sopRefs.map((ref: any, j: number) => (
                                    <span
                                      key={j}
                                      className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-full ${levelColor(ref.complianceLevel)}`}
                                    >
                                      <LevelIcon level={ref.complianceLevel} />
                                      {ref.sopIdentifier}
                                      {ref.confidence > 0 && (
                                        <span className="opacity-60">({ref.confidence}%)</span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {activeTab === 'sops' && (
                <div className="divide-y divide-gray-100">
                  {(data.sopSummary || []).map((sop: any, i: number) => {
                    const score = sop.overallScore ?? 0;
                    const scoreColor = score >= 8 ? 'text-emerald-700 bg-emerald-50' : score >= 5 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50';
                    const total = sop.findingsCount || 0;
                    return (
                      <div key={i} className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-mono">
                              {sop.sopIdentifier}
                            </span>
                            <span className="text-xs font-semibold text-gray-800 truncate">{sop.sopName}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            {sop.compliantCount > 0 && <span className="text-[9px] font-bold text-emerald-600">✓ {sop.compliantCount}</span>}
                            {sop.partialCount > 0 && <span className="text-[9px] font-bold text-amber-600">~ {sop.partialCount}</span>}
                            {sop.nonCompliantCount > 0 && <span className="text-[9px] font-bold text-red-600">✗ {sop.nonCompliantCount}</span>}
                            <span className="text-[9px] text-gray-400">{total} finding{total !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-black tabular-nums px-2 py-1 rounded-lg ${scoreColor}`}>
                            {score.toFixed(1)}
                          </span>
                          <span className="text-[9px] text-gray-400 font-medium max-w-[80px] text-right leading-tight">{sop.complianceStatus}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
