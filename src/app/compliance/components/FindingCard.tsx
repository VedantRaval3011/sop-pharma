'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen, FileText, Hash, AlignLeft, Copy, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

export interface FindingCardProps {
  id: string;
  requirement: string;
  gap: string;
  impact: string;
  suggestion: string;
  reference: string;
  severity: 'critical' | 'major' | 'minor' | 'informational';
  status: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable' | 'analysis-failed';
  confidence: number;
  sopSection?: string;
  sopTextSnippet?: string;
  suggestedText?: string;
  clauseNumber?: string;
  clauseTitle?: string;
  clauseText?: string;
  guidelineName?: string;
  folderName?: string;
  pdfName?: string;
  onToggleApplicable?: (findingId: string, isChecked: boolean) => void;
  isApplicable?: boolean;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const severityConfig = {
  critical: {
    accent:  'border-l-rose-500',
    badge:   'bg-rose-50 text-rose-700 border-rose-200',
    icon:    <XCircle className="h-3 w-3" />,
    label:   'Critical',
  },
  major: {
    accent:  'border-l-orange-500',
    badge:   'bg-orange-50 text-orange-700 border-orange-200',
    icon:    <AlertTriangle className="h-3 w-3" />,
    label:   'Major',
  },
  minor: {
    accent:  'border-l-amber-400',
    badge:   'bg-amber-50 text-amber-700 border-amber-200',
    icon:    <AlertTriangle className="h-3 w-3" />,
    label:   'Minor',
  },
  informational: {
    accent:  'border-l-blue-400',
    badge:   'bg-blue-50 text-blue-700 border-blue-200',
    icon:    <Info className="h-3 w-3" />,
    label:   'Info',
  },
} as const;

const statusConfig = {
  compliant: {
    badge:       'bg-emerald-50 text-emerald-700 border-emerald-200',
    sectionBg:   'bg-emerald-50 border-emerald-200',
    headingText: 'text-emerald-700',
    icon:        <CheckCircle2 className="h-3.5 w-3.5" />,
    label:       'Compliant',
    dot:         'bg-emerald-500',
  },
  partial: {
    badge:       'bg-amber-50 text-amber-700 border-amber-200',
    sectionBg:   'bg-amber-50 border-amber-200',
    headingText: 'text-amber-700',
    icon:        <AlertTriangle className="h-3.5 w-3.5" />,
    label:       'Partially Compliant',
    dot:         'bg-amber-500',
  },
  'non-compliant': {
    badge:       'bg-rose-50 text-rose-700 border-rose-200',
    sectionBg:   'bg-rose-50 border-rose-200',
    headingText: 'text-rose-700',
    icon:        <XCircle className="h-3.5 w-3.5" />,
    label:       'Non-Compliant',
    dot:         'bg-rose-500',
  },
  'not-applicable': {
    badge:       'bg-slate-100 text-slate-600 border-slate-200',
    sectionBg:   'bg-slate-50 border-slate-200',
    headingText: 'text-slate-600',
    icon:        <Info className="h-3.5 w-3.5" />,
    label:       'Not Applicable',
    dot:         'bg-slate-400',
  },
  'analysis-failed': {
    badge:       'bg-gray-100 text-gray-600 border-gray-200',
    sectionBg:   'bg-gray-50 border-gray-200',
    headingText: 'text-gray-600',
    icon:        <Info className="h-3.5 w-3.5" />,
    label:       'Inconclusive',
    dot:         'bg-gray-400',
  },
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function FindingCard({
  id,
  requirement,
  gap,
  impact,
  suggestion,
  reference,
  severity,
  status,
  confidence,
  sopSection,
  sopTextSnippet,
  suggestedText,
  clauseNumber,
  clauseTitle,
  clauseText,
  guidelineName,
  folderName,
  pdfName,
  onToggleApplicable,
  isApplicable = false,
}: FindingCardProps) {
  const [guidelineExpanded, setGuidelineExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const normStatus = (status || '')
    .toLowerCase()
    .replace(/_/g, '-') as keyof typeof statusConfig;
  const sevStyle    = severityConfig[severity as keyof typeof severityConfig] ?? severityConfig.informational;
  const statStyle   = statusConfig[normStatus] ?? statusConfig['analysis-failed'];
  const breadcrumb  = reference.split(' → ');

  const resolvedGuidelineName = guidelineName || breadcrumb[breadcrumb.length - 1] || 'Unknown Guideline';
  const resolvedFolderName    = folderName || breadcrumb[0] || '';

  const pageNumber = React.useMemo(() => {
    if (!clauseNumber) return null;
    if (/^\d{3,}$/.test(clauseNumber)) return clauseNumber;
    return clauseNumber.match(/\[p\.?\s*(\d+)\]/i)?.[1] ?? null;
  }, [clauseNumber]);

  const realClauseNumber = React.useMemo(() => {
    if (!clauseNumber) return null;
    if (/^\d{3,}$/.test(clauseNumber)) return null;
    return clauseNumber;
  }, [clauseNumber]);

  const cleanSuggestion = suggestion.replace(/```[\s\S]*?```/g, '').trim();
  const inlineSuggestedText = suggestedText || suggestion.match(/```([\s\S]*?)```/)?.[1] || '';

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm border-l-4 ${sevStyle.accent} overflow-hidden transition-shadow hover:shadow-md`}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100">

        {/* Left: status dot + badges + breadcrumb */}
        <div className="flex items-start gap-3 min-w-0">
          {/* Status dot */}
          <div className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${statStyle.dot}`} />

          <div className="min-w-0">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${statStyle.badge}`}>
                {statStyle.icon}
                {statStyle.label}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${sevStyle.badge}`}>
                {sevStyle.icon}
                {sevStyle.label}
              </span>
            </div>

            {/* Guideline breadcrumb */}
            <div className="flex flex-wrap items-center gap-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              {breadcrumb.map((item, idx) => (
                <React.Fragment key={idx}>
                  <span className={idx === breadcrumb.length - 1 ? 'text-gray-500' : 'text-gray-400'}>
                    {item}
                  </span>
                  {idx < breadcrumb.length - 1 && <span className="text-gray-300">›</span>}
                </React.Fragment>
              ))}
              {(realClauseNumber || pageNumber) && (
                <>
                  <span className="text-gray-300">›</span>
                  <span className="text-purple-500 font-bold">
                    {realClauseNumber ?? `p.${pageNumber}`}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: guideline source toggle + applicable checkbox + confidence */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Source toggle */}
          <button
            onClick={() => setGuidelineExpanded(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${
              guidelineExpanded
                ? 'bg-purple-50 border-purple-300 text-purple-700'
                : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50'
            }`}
          >
            <BookOpen className="h-3 w-3" />
            Source
            {guidelineExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {/* Applicable checkbox */}
          {onToggleApplicable && normStatus !== 'compliant' && (
            <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer select-none transition-all text-xs font-semibold ${
              isApplicable
                ? 'bg-purple-50 border-purple-300 text-purple-700'
                : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-purple-300 hover:text-purple-600'
            }`}>
              <input
                type="checkbox"
                id={`applicable-${id}`}
                checked={isApplicable}
                onChange={(e) => onToggleApplicable(id, e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-purple-600 cursor-pointer"
              />
              Applicable
            </label>
          )}

          {/* Confidence */}
          <div className="text-right">
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-0.5">Confidence</p>
            <p className={`text-lg font-black tabular-nums leading-none ${
              confidence >= 80 ? 'text-emerald-600' :
              confidence >= 50 ? 'text-amber-600' :
              'text-rose-500'
            }`}>
              {confidence}%
            </p>
          </div>
        </div>
      </div>

      {/* ── Guideline Source Panel ──────────────────────────────────────────── */}
      {guidelineExpanded && (
        <div className="border-b border-purple-100 bg-purple-50/50 animate-in slide-in-from-top-1 duration-150">
          <div className="px-5 py-4 space-y-3">
            <p className="text-[9px] font-black text-purple-600 uppercase tracking-[0.2em] flex items-center gap-1.5">
              <BookOpen className="h-3 w-3" /> Guideline Source Reference
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {/* Guideline name */}
              <div className="bg-white border border-purple-200 rounded-xl p-3">
                <p className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <BookOpen className="h-2.5 w-2.5" /> Guideline
                </p>
                <p className="text-sm font-bold text-gray-800 leading-tight">{resolvedGuidelineName}</p>
                {resolvedFolderName && resolvedFolderName !== resolvedGuidelineName && (
                  <p className="text-[10px] text-gray-400 mt-0.5">{resolvedFolderName}</p>
                )}
              </div>

              {/* PDF */}
              {pdfName && (
                <div className="bg-white border border-gray-200 rounded-xl p-3">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <FileText className="h-2.5 w-2.5" /> Document
                  </p>
                  <p className="text-sm font-semibold text-gray-700 leading-tight break-all">{pdfName}</p>
                </div>
              )}

              {/* Page reference */}
              {pageNumber && (
                <div className="bg-white border border-purple-200 rounded-xl p-3">
                  <p className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <Hash className="h-2.5 w-2.5" /> Page Reference
                  </p>
                  <p className="text-xl font-black text-purple-700">p.{pageNumber}</p>
                </div>
              )}

              {/* Clause number */}
              {realClauseNumber && (
                <div className="bg-white border border-gray-200 rounded-xl p-3">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <Hash className="h-2.5 w-2.5" /> Clause
                  </p>
                  <p className="text-sm font-black text-gray-800 font-mono">{realClauseNumber}</p>
                  {clauseTitle && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{clauseTitle}</p>}
                </div>
              )}

              {/* Clause title standalone */}
              {clauseTitle && !realClauseNumber && (
                <div className="bg-white border border-gray-200 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <AlignLeft className="h-2.5 w-2.5" /> Clause Title
                  </p>
                  <p className="text-sm font-semibold text-gray-700 leading-tight">{clauseTitle}</p>
                </div>
              )}
            </div>

            {/* Full clause text */}
            {(clauseText || requirement) && (
              <div className="bg-white border border-purple-100 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
                  <span className="text-[9px] font-black text-purple-600 uppercase tracking-widest flex items-center gap-1.5">
                    <AlignLeft className="h-2.5 w-2.5" />
                    Guideline Text
                    {realClauseNumber && <span className="text-purple-400">— Clause {realClauseNumber}</span>}
                    {pageNumber && <span className="text-purple-400">— Page {pageNumber}</span>}
                  </span>
                  <button
                    onClick={() => copyText(clauseText || requirement)}
                    className="text-[9px] text-gray-400 hover:text-purple-600 font-bold uppercase tracking-wider transition-colors flex items-center gap-1"
                  >
                    <Copy className="h-2.5 w-2.5" /> Copy
                  </button>
                </div>
                <div className="p-4">
                  <p className="text-gray-600 text-xs leading-relaxed border-l-2 border-purple-300 pl-3">
                    {clauseText || requirement}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="p-5 space-y-5">

        {/* 1. Guideline Requirement */}
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.18em] mb-2 flex items-center gap-1.5">
            <BookOpen className="h-3 w-3 text-purple-400" />
            Guideline Requirement
          </p>
          <p className="text-gray-800 text-sm font-semibold leading-relaxed">
            {requirement}
          </p>
        </div>

        {/* 2. Current SOP Content */}
        {sopTextSnippet && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <p className="text-[9px] font-black text-purple-600 uppercase tracking-[0.18em] mb-2.5 flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Current SOP Content
            </p>
            <p className="text-gray-700 text-sm italic leading-relaxed border-l-2 border-purple-400 pl-3">
              "{sopTextSnippet}"
            </p>
            {sopSection && (
              <p className="text-[10px] text-purple-500 font-bold mt-2 uppercase tracking-wider">
                Section: {sopSection}
              </p>
            )}
          </div>
        )}

        {/* 3. Gap + Impact grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Gap */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-[9px] font-black text-amber-700 uppercase tracking-[0.18em] mb-2 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Gap Identified
            </p>
            <p className="text-gray-700 text-sm leading-relaxed">
              {gap}
            </p>
          </div>

          {/* Impact */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <p className="text-[9px] font-black text-orange-700 uppercase tracking-[0.18em] mb-2 flex items-center gap-1.5">
              <XCircle className="h-3 w-3" />
              Impact Analysis
            </p>
            <p className="text-gray-700 text-sm leading-relaxed">
              {impact}
            </p>
          </div>
        </div>

        {/* 4. Suggested Action */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-emerald-200 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-[0.18em]">
              Suggested Action
            </p>
          </div>

          <div className="p-4 space-y-4">
            <p className="text-gray-700 text-sm font-medium leading-relaxed">
              {cleanSuggestion}
            </p>

            {/* Proposed Verbiage */}
            {inlineSuggestedText && (
              <div className="bg-white border border-emerald-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
                  <span className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">
                    Proposed Verbiage
                  </span>
                  <button
                    onClick={() => copyText(inlineSuggestedText)}
                    className="flex items-center gap-1 text-[9px] font-bold text-gray-400 hover:text-emerald-700 uppercase tracking-wider transition-colors"
                  >
                    {copied ? (
                      <><CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" /> Copied</>
                    ) : (
                      <><Copy className="h-2.5 w-2.5" /> Copy</>
                    )}
                  </button>
                </div>
                <div className="p-4">
                  <pre className="text-gray-700 font-mono text-xs whitespace-pre-wrap leading-relaxed">
                    {inlineSuggestedText}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
