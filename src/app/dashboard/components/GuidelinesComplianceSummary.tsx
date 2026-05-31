'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  ChevronDown,
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  RefreshCw,
  FileText,
  TrendingUp,
  Shield,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuidelineStat {
  folderName?: string;
  totalFindings: number;
  compliantCount: number;
  partialCount: number;
  nonCompliantCount: number;
  notApplicableCount: number;
  sopCount: number;
}

interface ClauseSummary {
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
}

interface SopSummary {
  sopIdentifier: string;
  sopName: string;
  overallScore: number;
  complianceStatus: string;
  findingsCount: number;
  compliantCount: number;
  nonCompliantCount: number;
  partialCount: number;
}

interface GuidelineDetailResponse {
  guidelineName: string;
  folderName: string;
  overview: {
    totalFindings: number;
    compliantCount: number;
    partialCount: number;
    nonCompliantCount: number;
    notApplicableCount: number;
    avgScore: number;
    rating: string;
    sopCount: number;
  };
  clauseSummary: ClauseSummary[];
  sopSummary: SopSummary[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeScore(stat: GuidelineStat): number {
  const assessed = stat.totalFindings - stat.notApplicableCount;
  if (assessed === 0) return 0;
  const weighted = stat.compliantCount + stat.partialCount * 0.5;
  return Math.round((weighted / assessed) * 100) / 10;
}

function getRatingConfig(score: number) {
  if (score >= 8)
    return { label: 'Good', badgeBg: 'bg-emerald-100 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', text: 'text-emerald-700' };
  if (score >= 5)
    return { label: 'Partial', badgeBg: 'bg-amber-100 text-amber-700 border-amber-200', bar: 'bg-amber-400', text: 'text-amber-700' };
  return { label: 'Poor', badgeBg: 'bg-rose-100 text-rose-700 border-rose-200', bar: 'bg-rose-500', text: 'text-rose-700' };
}

const LEVEL_CONFIG: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  compliant:        { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500', label: 'Compliant' },
  partial:          { bg: 'bg-amber-100',   text: 'text-amber-800',   dot: 'bg-amber-400',   label: 'Partial' },
  'non-compliant':  { bg: 'bg-red-100',     text: 'text-red-800',     dot: 'bg-red-500',     label: 'Non-Compliant' },
  'not-applicable': { bg: 'bg-gray-100',    text: 'text-gray-600',    dot: 'bg-gray-400',    label: 'N/A' },
};

// ─── ClauseCard (one compliance point in the detail modal) ───────────────────

function ClauseCard({ clause }: { clause: ClauseSummary }) {
  const [expanded, setExpanded] = useState(false);

  const total = clause.compliantSOPs + clause.partialSOPs + clause.nonCompliantSOPs + clause.notApplicableSOPs;
  const topLevel =
    clause.nonCompliantSOPs > 0 ? 'non-compliant' :
    clause.partialSOPs > 0 ? 'partial' :
    clause.compliantSOPs > 0 ? 'compliant' : 'not-applicable';
  const lvlCfg = LEVEL_CONFIG[topLevel] ?? LEVEL_CONFIG['not-applicable'];

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${lvlCfg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-[10px] font-bold text-gray-500 font-mono">{clause.clauseNumber}</span>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${lvlCfg.bg} ${lvlCfg.text}`}>
              {lvlCfg.label}
            </span>
            {clause.nonCompliantSOPs > 0 && (
              <span className="text-[9px] text-rose-600 font-bold">{clause.nonCompliantSOPs} non-compliant SOP{clause.nonCompliantSOPs !== 1 ? 's' : ''}</span>
            )}
          </div>
          <p className="text-xs font-semibold text-gray-800 leading-snug">
            {(() => {
              const t = clause.clauseTitle || clause.clauseText || '';
              return t.length > 180 ? t.slice(0, 180) + '…' : t;
            })()}
          </p>
        </div>
        {/* Mini breakdown */}
        <div className="flex items-center gap-1 text-[10px] font-bold shrink-0">
          {clause.compliantSOPs > 0 && <span className="text-emerald-600">{clause.compliantSOPs}✓</span>}
          {clause.partialSOPs > 0 && <span className="text-amber-600">{clause.partialSOPs}~</span>}
          {clause.nonCompliantSOPs > 0 && <span className="text-rose-600">{clause.nonCompliantSOPs}✗</span>}
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50">
          {/* Compliance breakdown per SOP */}
          <div>
            <p className="text-[10px] font-bold uppercase text-gray-500 mb-1.5">SOP Compliance Status</p>
            <div className="flex flex-wrap gap-1.5">
              {clause.sopRefs.map((ref, i) => {
                const cfg = LEVEL_CONFIG[ref.complianceLevel] ?? LEVEL_CONFIG['not-applicable'];
                return (
                  <span key={i} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                    <FileText className="h-3 w-3" />
                    {ref.sopIdentifier}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Gaps / Observations */}
          {clause.observations.length > 0 && (
            <div className="rounded bg-amber-50 border border-amber-100 p-2">
              <p className="text-[10px] font-bold uppercase text-amber-700 mb-1.5">⚠ Compliance Gaps &amp; Observations</p>
              <ul className="space-y-1">
                {clause.observations.map((obs, i) => (
                  <li key={i} className="text-xs text-amber-900 leading-relaxed flex items-start gap-1.5">
                    <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                    <span>{obs}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {clause.recommendations.length > 0 && (
            <div className="rounded bg-emerald-50 border border-emerald-100 p-2">
              <p className="text-[10px] font-bold uppercase text-emerald-700 mb-1.5">✓ Recommendations &amp; Corrective Actions</p>
              <ul className="space-y-1">
                {clause.recommendations.map((rec, i) => (
                  <li key={i} className="text-xs text-emerald-900 leading-relaxed flex items-start gap-1.5">
                    <span className="text-emerald-600 mt-0.5 shrink-0">→</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── GuidelineDetailModal ─────────────────────────────────────────────────────

function GuidelineDetailModal({
  guidelineName,
  stat,
  onClose,
}: {
  guidelineName: string;
  stat: GuidelineStat;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<GuidelineDetailResponse | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'clauses' | 'sops'>('clauses');

  const score = computeScore(stat);
  const rating = getRatingConfig(score);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/compliance/guideline-detail?name=${encodeURIComponent(guidelineName)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          setDetail(j as GuidelineDetailResponse);
        } else {
          setError(j.error || 'Failed to load details');
        }
      })
      .catch(() => setError('Network error — could not load guideline details'))
      .finally(() => setLoading(false));
  }, [guidelineName]);

  const overview = detail?.overview;
  const clauseSummary = detail?.clauseSummary ?? [];
  const sopSummary = detail?.sopSummary ?? [];

  const filteredClauses = filterLevel === 'all'
    ? clauseSummary
    : clauseSummary.filter((c) => {
        if (filterLevel === 'non-compliant') return c.nonCompliantSOPs > 0;
        if (filterLevel === 'partial') return c.partialSOPs > 0 && c.nonCompliantSOPs === 0;
        if (filterLevel === 'compliant') return c.compliantSOPs > 0 && c.nonCompliantSOPs === 0 && c.partialSOPs === 0;
        return true;
      });

  // SOP refs across all clauses (deduplicated)
  const sopRefs = [...new Set(clauseSummary.flatMap((c) => c.sopRefs.map((r) => r.sopIdentifier)))];

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/50 p-4 pt-10 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-xl border border-gray-200 bg-white shadow-2xl flex flex-col"
        style={{ maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 bg-gradient-to-r from-slate-900 via-blue-900 to-slate-800 px-5 py-4 rounded-t-xl">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="h-4 w-4 text-blue-300 shrink-0" />
              <h2 className="text-sm font-bold text-white">{guidelineName}</h2>
            </div>
            {(detail?.folderName || stat.folderName) && (
              <p className="text-[11px] text-blue-200">Folder: {detail?.folderName || stat.folderName}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Score + Stats */}
        <div className="border-b border-gray-200 bg-white px-5 py-3">
          <div className="flex flex-wrap items-center gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-[9px] font-bold uppercase text-gray-500 tracking-wider">Compliance Score</p>
                <div className="flex items-baseline gap-1">
                  <span className={`text-3xl font-black tabular-nums ${rating.text}`}>{score}</span>
                  <span className={`text-[11px] font-semibold ${rating.text}`}>/10</span>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${rating.badgeBg}`}>
                {overview?.rating || rating.label}
              </span>
            </div>
            <div className="flex-1 min-w-[120px]">
              <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${rating.bar}`} style={{ width: `${Math.min(100, score * 10)}%` }} />
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">
                <span className="font-bold text-gray-700">{Math.round(score * 10)}%</span> compliance achieved
              </p>
            </div>
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase text-gray-500">Total Findings</p>
              <p className="text-xl font-black text-indigo-700 tabular-nums">{stat.totalFindings}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase text-gray-500">SOPs Checked</p>
              <p className="text-xl font-black text-gray-700 tabular-nums">{overview?.sopCount ?? stat.sopCount}</p>
            </div>
          </div>

          {/* Status breakdown — clickable filters */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { key: 'compliant',       count: stat.compliantCount,       label: 'Compliant',       cls: 'bg-emerald-50 border-emerald-100 text-emerald-700', ring: 'ring-emerald-400' },
              { key: 'partial',         count: stat.partialCount,         label: 'Partial',         cls: 'bg-amber-50 border-amber-100 text-amber-700',       ring: 'ring-amber-400' },
              { key: 'non-compliant',   count: stat.nonCompliantCount,    label: 'Non-Compliant',   cls: 'bg-rose-50 border-rose-100 text-rose-700',          ring: 'ring-rose-400' },
              { key: 'all',             count: stat.totalFindings,        label: 'All Points',      cls: 'bg-gray-50 border-gray-100 text-gray-700',          ring: 'ring-gray-400' },
            ].map(({ key, count, label, cls, ring }) => (
              <button
                key={key}
                type="button"
                onClick={() => { setFilterLevel(key); setActiveTab('clauses'); }}
                className={`rounded-lg p-2 text-center border transition-all ${cls} ${filterLevel === key ? `ring-2 ${ring}` : 'hover:ring-1 hover:ring-gray-300'}`}
              >
                <p className="text-lg font-black tabular-nums">{count}</p>
                <p className="text-[9px] font-bold uppercase">{label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* SOP references */}
        {sopRefs.length > 0 && (
          <div className="border-b border-gray-100 bg-slate-50 px-5 py-2">
            <p className="text-[10px] font-bold uppercase text-slate-600 mb-1.5">Related SOP References &amp; Evidence</p>
            <div className="flex flex-wrap gap-1.5">
              {sopRefs.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                  <FileText className="h-3 w-3" />
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-white px-5">
          {[
            { id: 'clauses', label: `Compliance Points (${filteredClauses.length})` },
            { id: 'sops',    label: `SOP Overview (${sopSummary.length})` },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id as 'clauses' | 'sops')}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${activeTab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 bg-gray-50">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <p className="text-sm text-gray-500 font-medium">Loading compliance details…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <AlertCircle className="h-8 w-8 text-rose-400" />
              <p className="text-sm text-rose-600 font-semibold">{error}</p>
            </div>
          ) : activeTab === 'clauses' ? (
            clauseSummary.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-gray-400">
                <Shield className="h-10 w-10 opacity-30" />
                <p className="text-sm font-semibold text-gray-500">No compliance point details available</p>
                <p className="text-xs text-center max-w-xs">Re-run analysis to populate detailed compliance points for this guideline.</p>
              </div>
            ) : (
              <div className="space-y-2 max-w-3xl">
                {filterLevel !== 'all' && (
                  <div className="flex items-center justify-between text-[11px] font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                    <span>Showing: <span className="text-indigo-700">{filteredClauses.length}</span> of {clauseSummary.length} points</span>
                    <button type="button" onClick={() => setFilterLevel('all')} className="text-gray-400 hover:text-gray-700">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {filteredClauses.map((clause, i) => (
                  <ClauseCard key={i} clause={clause} />
                ))}
              </div>
            )
          ) : (
            /* SOPs tab */
            sopSummary.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-gray-400">
                <FileText className="h-10 w-10 opacity-30" />
                <p className="text-sm font-semibold text-gray-500">No SOP data</p>
              </div>
            ) : (
              <div className="space-y-2 max-w-3xl">
                {sopSummary.map((sop, i) => {
                  const sopScore = sop.overallScore ?? 0;
                  const cfg = getRatingConfig(sopScore);
                  return (
                    <div key={i} className="rounded-lg border border-gray-200 bg-white px-4 py-3 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900">{sop.sopIdentifier}</p>
                        {sop.sopName && <p className="text-[10px] text-gray-500 truncate">{sop.sopName}</p>}
                      </div>
                      <div className="text-center shrink-0">
                        <p className={`text-sm font-black ${cfg.text}`}>{sopScore}/10</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${cfg.badgeBg}`}>{cfg.label}</span>
                      </div>
                      <div className="flex gap-2 text-[10px] font-bold shrink-0">
                        <span className="text-emerald-600">{sop.compliantCount}✓</span>
                        <span className="text-amber-600">{sop.partialCount}~</span>
                        <span className="text-rose-600">{sop.nonCompliantCount}✗</span>
                      </div>
                      <div className="text-center shrink-0 w-10">
                        <p className="text-sm font-black text-indigo-700">{sop.findingsCount}</p>
                        <p className="text-[9px] text-gray-400">pts</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── GuidelineRow (one row in the summary table) ─────────────────────────────

function GuidelineRow({
  name,
  stat,
  onSelect,
}: {
  name: string;
  stat: GuidelineStat;
  onSelect: () => void;
}) {
  const score = computeScore(stat);
  const rating = getRatingConfig(score);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left shadow-sm hover:border-indigo-300 hover:shadow-md transition-all group"
    >
      {/* Guideline name */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-gray-900 truncate group-hover:text-indigo-800 transition-colors">{name}</p>
        {stat.folderName && stat.folderName !== name && (
          <p className="text-[10px] text-gray-400 truncate mt-0.5">{stat.folderName}</p>
        )}
      </div>

      {/* Score + rating */}
      <div className="text-center shrink-0">
        <p className={`text-base font-black tabular-nums ${rating.text}`}>{score}/10</p>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${rating.badgeBg}`}>{rating.label}</span>
      </div>

      {/* Mini bar + counts */}
      <div className="w-28 shrink-0">
        <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden mb-1">
          <div className={`h-full rounded-full ${rating.bar}`} style={{ width: `${Math.min(100, score * 10)}%` }} />
        </div>
        <div className="flex justify-between text-[9px] font-bold">
          <span className="text-emerald-600">{stat.compliantCount}✓</span>
          <span className="text-amber-600">{stat.partialCount}~</span>
          <span className="text-rose-600">{stat.nonCompliantCount}✗</span>
        </div>
      </div>

      {/* Total compliance points */}
      <div className="text-center shrink-0 w-16">
        <p className="text-base font-black text-indigo-700 tabular-nums">{stat.totalFindings}</p>
        <p className="text-[9px] font-semibold text-gray-500">Points</p>
      </div>

      {/* SOPs checked */}
      <div className="text-center shrink-0 w-14">
        <p className="text-base font-black text-gray-700 tabular-nums">{stat.sopCount}</p>
        <p className="text-[9px] font-semibold text-gray-500">SOPs</p>
      </div>

      <ChevronDown className="h-3.5 w-3.5 text-gray-300 group-hover:text-indigo-500 transition-colors shrink-0 -rotate-90" />
    </button>
  );
}

// ─── GuidelinesComplianceSummary (main export) ───────────────────────────────

export default function GuidelinesComplianceSummary() {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Record<string, GuidelineStat>>({});
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [selectedGuideline, setSelectedGuideline] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/compliance/guideline-stats', { cache: 'no-store' });
      const j = await res.json();
      if (j.success && j.stats) {
        setStats(j.stats);
        setFetchedAt(Date.now());
      } else {
        setError(j.error || 'Failed to load guideline stats');
      }
    } catch {
      setError('Network error — could not load guidelines');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on first open
  useEffect(() => {
    if (open && fetchedAt === null && !loading) {
      fetchStats();
    }
  }, [open, fetchedAt, loading, fetchStats]);

  // Sort by score ascending (most problematic first)
  const guidelineEntries = Object.entries(stats).sort(
    (a, b) => computeScore(a[1]) - computeScore(b[1]),
  );

  const totalFindings    = guidelineEntries.reduce((s, [, g]) => s + g.totalFindings, 0);
  const totalNonCompliant = guidelineEntries.reduce((s, [, g]) => s + g.nonCompliantCount, 0);
  const totalCompliant    = guidelineEntries.reduce((s, [, g]) => s + g.compliantCount, 0);

  return (
    <>
      <section className="border-b border-gray-200 bg-white">
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group"
        >
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shrink-0">
            <BookOpen className="h-4 w-4 text-white" />
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              Guidelines
              {guidelineEntries.length > 0 && (
                <span className="text-gray-500 font-medium">({guidelineEntries.length})</span>
              )}
              {totalNonCompliant > 0 && (
                <span className="rounded-full bg-rose-100 border border-rose-200 text-rose-700 text-[10px] font-bold px-2 py-0.5">
                  {totalNonCompliant} gaps
                </span>
              )}
              {totalCompliant > 0 && (
                <span className="rounded-full bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-bold px-2 py-0.5">
                  {totalCompliant} compliant
                </span>
              )}
            </span>
            <p className="text-xs text-gray-400 leading-none mt-0.5">
              Compliance points per regulatory guideline — click any row for full detail
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {totalFindings > 0 && (
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">
                {totalFindings} total points
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); fetchStats(); }}
              disabled={loading}
              className="rounded p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <span className="text-gray-400 group-hover:text-gray-600 transition-colors">
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
            </span>
          </div>
        </button>

        {/* Body */}
        {open && (
          <div className="border-t border-gray-100 bg-gray-50 px-3 py-3">
            {loading && guidelineEntries.length === 0 ? (
              <div className="flex items-center justify-center gap-3 py-8">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                <p className="text-sm text-gray-500 font-medium">Loading compliance data…</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 py-8 text-rose-500">
                <AlertCircle className="h-5 w-5" />
                <p className="text-sm font-semibold">{error}</p>
                <button type="button" onClick={fetchStats} className="text-xs text-indigo-600 underline">Retry</button>
              </div>
            ) : guidelineEntries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-gray-400">
                <TrendingUp className="h-8 w-8 opacity-30" />
                <p className="text-sm font-semibold text-gray-500">No compliance data yet</p>
                <p className="text-xs text-center max-w-xs text-gray-400">
                  Run a compliance analysis using the Guidelines wizard to see per-guideline results here.
                </p>
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div className="flex items-center gap-3 px-4 pb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                  <div className="flex-1">Guideline</div>
                  <div className="w-16 text-center">Score</div>
                  <div className="w-28 text-center">Breakdown</div>
                  <div className="w-16 text-center">Points</div>
                  <div className="w-14 text-center">SOPs</div>
                  <div className="w-4" />
                </div>
                <div className="space-y-1.5 max-w-5xl">
                  {guidelineEntries.map(([name, stat]) => (
                    <GuidelineRow
                      key={name}
                      name={name}
                      stat={stat}
                      onSelect={() => setSelectedGuideline(name)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* Detail popup */}
      {selectedGuideline && stats[selectedGuideline] && (
        <GuidelineDetailModal
          guidelineName={selectedGuideline}
          stat={stats[selectedGuideline]}
          onClose={() => setSelectedGuideline(null)}
        />
      )}
    </>
  );
}
