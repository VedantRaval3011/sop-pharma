'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import FindingCard from './components/FindingCard';
import { CheckSquare, Square, Sparkles, X, Copy, BookOpen, FileText, Layers, CheckCircle } from 'lucide-react';
import { cleanSOPName } from '@/lib/sopLibraryHelper';
import { filterPrimaryRegistryRowsUniqueByFamily } from '@/lib/registryPrimaryRows';


/**
 * SOP Compliance Engine - Redesigned with Step-by-Step Workflow
 * 
 * Workflow:
 * 1. Fetch & Review all SOPs
 * 2. Fetch & Review all Guidelines with clauses
 * 3. Run Analysis (with review option before execution)
 * 4. View Results with section references (like MCQ sopReference)
 */

interface Guideline {
  _id: string;
  name: string;
  folderName: string;
  pdfName: string;
  guidelineType: string;
  category: string;
  clauses?: {
    clauseNumber: string;
    clauseTitle: string;
    clauseText: string;
    keywords: string[];
  }[];
  clauseCount?: number;
  isScanned: boolean;
  createdAt: string;
}

interface GuidelineFolder {
  folderName: string;
  guidelineCount: number;
  totalClauses: number;
  lastUpdated?: string;
}

interface SOP {
  _id: string;
  identifier: string;
  name: string;
  department: string;
  version?: string;
  status?: string;
  content?: string;
  location?: string;
}

interface ComplianceFinding {
  guidelineName: string;
  folderName: string;
  pdfName: string;
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
  complianceLevel: 'compliant' | 'partial' | 'non-compliant';
  matchConfidence: number;
  sopSectionAffected: string;
  mismatchExplanation: string;
  suggestedAction: string;
  sopTextSnippet: string;
  highlightedIssue: string;
  criticality?: 'critical' | 'high' | 'medium' | 'low';
  issueSeverity?: 'critical' | 'major' | 'minor' | 'informational';
  issueType?: 'missing' | 'weak' | 'incomplete' | 'none';
  guidelineRequirement?: string;
  suggestedText?: string;
  // Section reference (like MCQ sopReference)
  guidelineReference?: string;
}

interface ComplianceReport {
  _id: string;
  sopIdentifier: string;
  sopName: string;
  department: string;
  overallScore: number;
  complianceStatus: string;
  totalGuidelinesChecked: number;
  compliantCount: number;
  partialCount: number;
  nonCompliantCount: number;
  findings: ComplianceFinding[];
  analyzedAt: string;
}

type WorkflowStep = 'fetch-sops' | 'fetch-guidelines' | 'review' | 'analyze' | 'results';

// ── Consolidated Section Card (needs own state for expand toggle) ────────────
function ConsolidatedSectionCard({ sec }: { sec: {
  sectionKey: string;
  isMulti: boolean;
  findings: ComplianceFinding[];
  sources: string[];
  clauses: string[];
  combinedAction: string;
  combinedSuggestion: string;
}}) {
  const [refExpanded, setRefExpanded] = useState(false);
  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        sec.isMulti ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'
      }`}
    >
      {/* Section header */}
      <div className={`px-5 py-3 flex items-center justify-between border-b ${
        sec.isMulti ? 'border-purple-200 bg-purple-100/60' : 'border-gray-100 bg-gray-50'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider ${
            sec.isMulti
              ? 'bg-purple-200 text-purple-800 border border-purple-300'
              : 'bg-gray-100 text-gray-600 border border-gray-200'
          }`}>
            Section {sec.sectionKey}
          </div>
          {sec.isMulti && (
            <span className="text-xs text-purple-600 font-semibold flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              {sec.findings.length} changes combined
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Guideline Refs expand toggle */}
          <button
            onClick={() => setRefExpanded(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
              refExpanded
                ? 'bg-blue-100 border-blue-300 text-blue-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            <BookOpen className="h-3 w-3" />
            Guideline Refs
            {refExpanded
              ? <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
              : <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            }
          </button>
          {/* Copy section */}
          <button
            onClick={() => navigator.clipboard.writeText([sec.combinedAction, sec.combinedSuggestion ? `\nPROPOSED VERBIAGE:\n${sec.combinedSuggestion}` : ''].filter(Boolean).join('\n'))}
            className="text-[10px] text-gray-500 hover:text-gray-800 transition-colors flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
      </div>

      {/* ── Guideline Reference Expand Panel ── */}
      {refExpanded && (
        <div className="border-b border-blue-100 bg-blue-50">
          <div className="px-5 py-4 space-y-3">
            <p className="text-[9px] font-black text-blue-600 uppercase tracking-[0.2em] flex items-center gap-1.5">
              <BookOpen className="h-3 w-3" /> Guideline Source References
            </p>
            {sec.findings.map((f, fi) => {
              const isPageId = f.clauseNumber && /^\d{3,}$/.test(f.clauseNumber);
              const pageNum = isPageId ? f.clauseNumber : null;
              const clauseNum = isPageId ? null : f.clauseNumber;
              return (
                <div key={fi} className="bg-white border border-blue-100 rounded-xl overflow-hidden">
                  {/* Finding ref header */}
                  <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-3 flex-wrap">
                    {fi > 0 && sec.isMulti && (
                      <span className="w-4 h-4 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-[9px] font-black flex-shrink-0">{fi + 1}</span>
                    )}
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 border border-blue-200 rounded text-[10px] font-bold text-blue-700">
                      <BookOpen className="h-2.5 w-2.5" />
                      {f.folderName || 'Guideline'}
                    </span>
                    {f.guidelineName && f.guidelineName !== f.folderName && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-100 rounded text-[10px] font-bold text-blue-600 max-w-[180px] truncate" title={f.guidelineName}>
                        {f.guidelineName}
                      </span>
                    )}
                    {f.pdfName && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-gray-50 border border-gray-200 rounded text-[10px] font-bold text-gray-600 max-w-[200px] truncate" title={f.pdfName}>
                        <FileText className="h-2.5 w-2.5 flex-shrink-0" />
                        {f.pdfName}
                      </span>
                    )}
                    {clauseNum && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-gray-50 border border-gray-200 rounded text-[10px] font-bold text-gray-600 font-mono">
                        Clause {clauseNum}
                      </span>
                    )}
                    {pageNum && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-50 border border-purple-200 rounded text-[10px] font-black text-purple-700">
                        p.{pageNum}
                      </span>
                    )}
                  </div>
                  {/* Clause title + text */}
                  <div className="px-4 py-3 space-y-2">
                    {f.clauseTitle && (
                      <p className="text-[10px] font-black text-gray-700 uppercase tracking-wider">{f.clauseTitle}</p>
                    )}
                    {(f.clauseText || f.guidelineRequirement) && (
                      <p className="text-xs text-gray-500 leading-relaxed border-l-2 border-blue-300 pl-3 font-mono">
                        {f.clauseText || f.guidelineRequirement}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-5 space-y-4">
        {/* Sources + clauses pills */}
        <div className="flex flex-wrap gap-2">
          {sec.sources.map(src => (
            <span key={src} className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg text-[10px] font-bold text-blue-700 uppercase tracking-wider">
              <BookOpen className="h-3 w-3" />{src}
            </span>
          ))}
          {sec.clauses.map(cl => (
            <span key={cl} className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 border border-gray-200 rounded-lg text-[10px] font-bold text-gray-600">
              <FileText className="h-3 w-3" />Clause {cl}
            </span>
          ))}
        </div>

        {/* Issues list (multi only) */}
        {sec.isMulti && (
          <div className="space-y-1">
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Issues being resolved:</p>
            {sec.findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                <span className="mt-0.5 w-4 h-4 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-[9px] font-black flex-shrink-0">{i + 1}</span>
                <span className="leading-relaxed">{f.mismatchExplanation || f.highlightedIssue || 'Gap identified'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Consolidated action */}
        <div>
          <p className="text-[10px] text-emerald-600 font-black uppercase tracking-wider mb-2 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            {sec.isMulti ? 'Consolidated Action' : 'Suggested Action'}
          </p>
          <p className="text-sm text-gray-800 font-medium leading-relaxed whitespace-pre-wrap">{sec.combinedAction}</p>
        </div>

        {/* Proposed verbiage */}
        {sec.combinedSuggestion && (
          <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2 bg-gray-100 border-b border-gray-200">
              <span className="text-[9px] text-emerald-700 font-black uppercase tracking-widest">
                {sec.isMulti ? 'Combined Proposed Verbiage' : 'Proposed Verbiage'}
              </span>
            </div>
            <div className="p-4">
              <pre className="text-gray-700 font-mono text-xs whitespace-pre-wrap leading-relaxed">{sec.combinedSuggestion}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComplianceEnginePage() {
  useAuthGuard();
  const router = useRouter();

  // Workflow State
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('fetch-sops');

  // Data State
  const [folders, setFolders] = useState<GuidelineFolder[]>([]);
  const [guidelines, setGuidelines] = useState<Guideline[]>([]);
  const [guidelineStats, setGuidelineStats] = useState<Record<string, { totalFindings: number; compliantCount: number; partialCount: number; nonCompliantCount: number; sopCount: number }>>({});
  const [sops, setSops] = useState<SOP[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [reports, setReports] = useState<ComplianceReport[]>([]);
  const [canonicalSopCount, setCanonicalSopCount] = useState<number | null>(null);
  
  // Loading States
  const [loadingSops, setLoadingSops] = useState(false);
  const [loadingGuidelines, setLoadingGuidelines] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  
  // Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [currentResult, setCurrentResult] = useState<any>(null);
  const [totalClausesFromAPI, setTotalClausesFromAPI] = useState(0);
  // Ref so the async loop reads the live pause value without stale closure
  const pauseRef = useRef(false);
  const [analysisStats, setAnalysisStats] = useState<{
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    currentIndex: number;
    currentSopName: string;
    currentSopIdentifier: string;
  }>({ total: 0, completed: 0, failed: 0, skipped: 0, currentIndex: 0, currentSopName: '', currentSopIdentifier: '' });

  // Per-category SOP lists for clickable chips
  const [sopLists, setSopLists] = useState<{
    completed: { identifier: string; name: string; score: number | null; status: string }[];
    cached:    { identifier: string; name: string; score: number | null; status: string; analyzedAt?: string }[];
    skipped:   { identifier: string; name: string }[];
    failed:    { identifier: string; name: string }[];
  }>({ completed: [], cached: [], skipped: [], failed: [] });
  const [activeChip, setActiveChip] = useState<'completed' | 'cached' | 'skipped' | 'failed' | null>(null);

  // Whether to skip SOPs that already have a valid compliance report
  const [skipExisting, setSkipExisting] = useState(true);
  // Pre-flight check state (populated when user reaches Review step)
  const [preflightData, setPreflightData] = useState<{
    checked: boolean;
    existingCount: number;
    newCount: number;
    gujaratiCount: number;
  }>({ checked: false, existingCount: 0, newCount: 0, gujaratiCount: 0 });
  
  // UI State
  const [selectedReport, setSelectedReport] = useState<ComplianceReport | null>(null);
  const [loadingFullReport, setLoadingFullReport] = useState(false);
  const [expandedGuideline, setExpandedGuideline] = useState<string | null>(null);
  const [loadingGuidelineId, setLoadingGuidelineId] = useState<string | null>(null);
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'compliant' | 'partial' | 'non-compliant'>('all');
  const [filterGuideline, setFilterGuideline] = useState<string>('all');
  const [selectedSopId, setSelectedSopId] = useState<string>('all');
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  // Applicable Findings State (Checkbox-based)
  const [applicableFindings, setApplicableFindings] = useState<Set<string>>(new Set());
  const [submittingApplicable, setSubmittingApplicable] = useState(false);

  // ── Selection for consolidated summary ──────────────────────────────────────
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<number>>(new Set());
  const [showConsolidatedSummary, setShowConsolidatedSummary] = useState(false);
  const [isSummaryFullScreen, setIsSummaryFullScreen] = useState(false);

  // Handle checkbox toggle for applicable findings
  const handleToggleApplicable = (findingId: string, isChecked: boolean) => {
    setApplicableFindings(prev => {
      const newSet = new Set(prev);
      if (isChecked) {
        newSet.add(findingId);
      } else {
        newSet.delete(findingId);
      }
      return newSet;
    });
  };

  // ── Helpers for consolidated summary ────────────────────────────────────────
  const normaliseSectionKey = (f: ComplianceFinding): string => {
    const raw = (f as any).sopSectionAffected || (f as any).sopSectionNumber || 'General';
    const m = String(raw).match(/(\d[\d.]*)/);
    return m ? m[1] : String(raw).trim() || 'General';
  };

  // Filtered findings currently visible
  const visibleFindings = useMemo(() => {
    if (!selectedReport?.findings) return [];
    return selectedReport.findings
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => (filterStatus === 'all' || f.complianceLevel === filterStatus) &&
                         (filterGuideline === 'all' || f.folderName === filterGuideline));
  }, [selectedReport, filterStatus, filterGuideline]);

  const allFindingsSelected = visibleFindings.length > 0 && visibleFindings.every(({ i }) => selectedFindingIds.has(i));
  const someFindingsSelected = visibleFindings.some(({ i }) => selectedFindingIds.has(i));

  const toggleSelectAllFindings = () => {
    if (allFindingsSelected) {
      const next = new Set(selectedFindingIds);
      visibleFindings.forEach(({ i }) => next.delete(i));
      setSelectedFindingIds(next);
    } else {
      const next = new Set(selectedFindingIds);
      visibleFindings.forEach(({ i }) => next.add(i));
      setSelectedFindingIds(next);
    }
  };

  const toggleFindingSelect = (idx: number) => {
    setSelectedFindingIds(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  // Build consolidated sections from selected findings
  const consolidatedSections = useMemo(() => {
    if (!selectedReport?.findings) return [];
    const selected = selectedReport.findings.filter((_, i) => selectedFindingIds.has(i));
    const map = new Map<string, ComplianceFinding[]>();
    for (const f of selected) {
      const key = normaliseSectionKey(f);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }
    return Array.from(map.entries())
      .map(([key, group]) => ({
        sectionKey: key,
        findings: group,
        isMulti: group.length > 1,
        sources: Array.from(new Set(group.map(f => f.folderName || f.guidelineName || 'Guideline').filter(Boolean))),
        clauses: Array.from(new Set(group.map(f => f.clauseNumber).filter(Boolean))),
        combinedAction: Array.from(new Set(group.map((f) => {
          let action = (f.suggestedAction || '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/\r?\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          // Clean prefixes (Action:, 1., and Section Key like "5.11")
          action = action
            .replace(/^(Action|Suggestion|Remediation):\s*/i, '')
            .replace(/^(\d+\.|-|\*)\s*/, '')
            .replace(new RegExp(`^${key.replace(/\./g, '\\.')}\\s*`, 'i'), '');
          
          if (!action) return '';
          if (!action.endsWith('.')) action += '.';
          
          return `${action}${f.clauseNumber ? ` [Clause ${f.clauseNumber}]` : ''}`;
        }).filter(Boolean))).join(' '),
        combinedSuggestion: (() => {
          // 1. Gather all raw texts
          const rawTexts = group.map(f => 
            f.suggestedText || (f.suggestedAction?.match(/```([\s\S]*?)```/)?.[1]) || ''
          ).filter(Boolean);

          // 2. Split into potential "section blocks" to detect mixed feedback (e.g. 5.11 inside 1.0)
          let blocks: string[] = [];
          rawTexts.forEach(text => {
             // Split by looking for "Number.Number" at start of lines or sentences
             const parts = text.split(/(?=(?:^|\s|\n)\d+\.\d+\b)/); 
             blocks.push(...parts);
          });

          // 3. Filter blocks belonging to current selection hierarchy
          const relevantBlocks = blocks.map(b => b.trim()).filter(b => {
              if (!b) return false;
              const match = b.match(/^(\d+(?:\.\d+)*)/);
              if (match) {
                  // Keep if it starts with current key (e.g. "5.11" matches "5.11.2")
                  return match[1].startsWith(key);
              }
              // If no number start, it's generic text for this section
              return true;
          });

          if (relevantBlocks.length === 0) return '';
          
          // 4. Clean and Merge
          const sentences = new Set<string>();
          relevantBlocks.forEach(block => {
              // Strip key prefix to avoid "5.11 Text... 5.11 More Text"
              let content = block.replace(new RegExp(`^${key.replace(/\./g, '\\.')}(\\.\\d+)*\\s*[:\\-]?\\s*`, 'i'), '');
              
              // Also strip generic headers if present immediately after number
              // e.g. "Frequency:" in "5.9 Frequency:"
              content = content.replace(/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*:/, '').trim();

              if (!content) return;

              // Split into sentences to allow clean merging
              // (Simple split by . ! ?)
              const sent = content.match(/[^.!?]+[.!?]+/g) || [content];
              sent.forEach(s => {
                  const c = s.trim();
                  if (c.length > 2) sentences.add(c);
              });
          });
          
          return `${key} ${Array.from(sentences).join(' ')}`;
        })(),
      }))
      .sort((a, b) => { const na = parseFloat(a.sectionKey), nb = parseFloat(b.sectionKey); return !isNaN(na) && !isNaN(nb) ? na - nb : !isNaN(na) ? -1 : !isNaN(nb) ? 1 : a.sectionKey.localeCompare(b.sectionKey); });
  }, [selectedReport, selectedFindingIds]);

  // Submit all selected applicable findings
  const submitApplicableFindings = async () => {
    if (!selectedReport || applicableFindings.size === 0) return;
    
    try {
      setSubmittingApplicable(true);
      const response = await fetch('/api/compliance/applicable-findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: selectedReport._id,
          findingIds: Array.from(applicableFindings),
          userId: 'demo-user-id', // Replace with actual user ID from session
        }),
      });
      
      const data = await response.json();
      if (data.success) {
        // Navigate to compiled view
        router.push(`/compliance/applicable?reportId=${selectedReport._id}`);
      } else {
        alert(`Failed to submit findings: ${data.error}`);
      }
    } catch (error) {
      console.error('Error submitting applicable findings:', error);
      alert('Failed to submit applicable findings');
    } finally {
      setSubmittingApplicable(false);
    }
  };

  // Handle selecting a report (fetch full data)
  const handleSelectReport = async (report: ComplianceReport) => {
    setSelectedReport(report); // Show summary info immediately
    setFilterGuideline('all'); // Reset guideline filter when selecting new report
    setLoadingFullReport(true);
    try {
      const response = await fetch(`/api/compliance/analyze?reportId=${report._id}`);
      const data = await response.json();
      if (data.success) {
        setSelectedReport(data.report);
      }
    } catch (error) {
      console.error('Error fetching full report:', error);
    } finally {
      setLoadingFullReport(false);
    }
  };

  // Handle expanding guideline (fetch clauses if missing)
  const handleToggleGuideline = async (guideline: Guideline) => {
    if (expandedGuideline === guideline._id) {
      setExpandedGuideline(null);
      return;
    }

    setExpandedGuideline(guideline._id);

    // If clauses are already loaded, don't fetch again
    if (guideline.clauses && guideline.clauses.length > 0) {
      return;
    }

    setLoadingGuidelineId(guideline._id);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s frontend timeout

      const response = await fetch(`/api/guidelines/upload?id=${guideline._id}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (data.success && data.guideline) {
        // Update guidelines array with full data
        setGuidelines(prev => (prev || []).map(g => 
          g._id === guideline._id ? { ...g, clauses: data.guideline.clauses } : g
        ));
      }
    } catch (error) {
      console.error('Error fetching full guideline:', error);
    } finally {
      setLoadingGuidelineId(null);
    }
  };
  
  // Upload State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadFolderName, setUploadFolderName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  
  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);

  // Helper Functions
  const getScoreEmoji = (score: number) => {
    if (score >= 9) return '🟢';
    if (score >= 6) return '🟡';
    return '🔴';
  };

  const getScoreColor = (score: number) => {
    if (score >= 9) return 'text-emerald-600';
    if (score >= 6) return 'text-amber-600';
    return 'text-rose-600';
  };

  // Step 1: Fetch all SOPs
  const fetchSops = async () => {
    setLoadingSops(true);
    try {
      // Source SOP inventory from the same dashboard endpoint/counting logic.
      const dashboardResponse = await fetch('/api/dashboard/sops', { cache: 'no-store' });
      const dashboardData = await dashboardResponse.json().catch(() => ({}));

      if (dashboardResponse.ok && dashboardData?.success && Array.isArray(dashboardData.data)) {
        const primaryRows = filterPrimaryRegistryRowsUniqueByFamily(dashboardData.data);
        const normalizedSops: SOP[] = primaryRows
          .map((row: any) => ({
            _id: String(row?._id || row?.sopId || '').trim(),
            identifier: String(row?.sopNo || row?.identifier || '').trim(),
            name: cleanSOPName(
              String(row?.englishName || row?.sopName || row?.name || '').trim(),
              String(row?.sopNo || row?.identifier || '').trim(),
            ),
            department: String(row?.department || 'Unknown').trim() || 'Unknown',
            version: row?.version != null ? String(row.version) : undefined,
            location: String(row?.location || '').trim(),
          }))
          .filter((s) => s._id && s.identifier);

        const dedupedDepartments = Array.from(
          new Set(normalizedSops.map((s) => s.department).filter(Boolean)),
        ).sort();

        setSops(normalizedSops);
        setDepartments(dedupedDepartments);
        setCanonicalSopCount(
          typeof dashboardData?.metadata?.primaryRegistryRowCount === 'number'
            ? dashboardData.metadata.primaryRegistryRowCount
            : normalizedSops.length,
        );
      } else {
        // Fallback: legacy compliance endpoint.
        const sopsResponse = await fetch('/api/compliance/sops?limit=500');
        const data = await sopsResponse.json().catch(() => ({}));
        if (data.success) {
          const fetchedSops = Array.isArray(data.sops) ? data.sops : [];
          setSops(fetchedSops);
          setDepartments(Array.isArray(data.departments) ? data.departments : []);
          setCanonicalSopCount(fetchedSops.length);
        } else {
          setSops([]);
          setDepartments([]);
          setCanonicalSopCount(0);
        }
      }
    } catch (error) {
      console.error('Error fetching SOPs:', error);
      setSops([]);
      setDepartments([]);
      setCanonicalSopCount(0);
    } finally {
      setLoadingSops(false);
    }
  };

  // Step 2: Fetch all Guidelines from all folders
  const fetchAllGuidelines = async () => {
    setLoadingGuidelines(true);
    try {
      // First get folders
      const foldersResponse = await fetch('/api/guidelines/folders');
      const foldersData = await foldersResponse.json();
      if (foldersData.success && Array.isArray(foldersData.folders)) {
        setFolders(foldersData.folders);
      } else {
        setFolders([]);
      }

      const guidelinesResponse = await fetch('/api/guidelines/upload?summary=true');
      const guidelinesData = await guidelinesResponse.json();
      console.log('DEBUG: Guidelines API Response:', {
        success: guidelinesData.success,
        count: guidelinesData.guidelines?.length,
        totalClauses: guidelinesData.totalClauses
      });
      if (guidelinesData.success && Array.isArray(guidelinesData.guidelines)) {
        setGuidelines(guidelinesData.guidelines);
        setTotalClausesFromAPI(guidelinesData.totalClauses || 0);
      } else {
        console.warn('DEBUG: Guidelines fetch returned success:false or non-array');
        setGuidelines([]);
        setTotalClausesFromAPI(0);
      }

      // Fetch compliance point stats per guideline (non-blocking)
      try {
        const statsRes = await fetch('/api/compliance/guideline-stats');
        const statsData = await statsRes.json();
        if (statsData.success) setGuidelineStats(statsData.stats || {});
      } catch { /* non-fatal */ }
    } catch (error) {
      console.error('Error fetching guidelines:', error);
    } finally {
      setLoadingGuidelines(false);
    }
  };

  // Fetch existing reports
  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const response = await fetch('/api/compliance/analyze');
      const data = await response.json();
      if (data.success && Array.isArray(data.reports)) {
        setReports(data.reports);
      } else {
        setReports([]);
      }
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setLoadingReports(false);
    }
  };

  // Upload guidelines
  const handleUploadGuidelines = async () => {
    if (!uploadFolderName.trim() || uploadFiles.length === 0) {
      alert('Please enter a folder name and select PDF files');
      return;
    }

    setIsUploading(true);
    setUploadProgress('Starting upload...');

    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        setUploadProgress(`Uploading ${i + 1}/${uploadFiles.length}: ${file.name}...`);

        const formData = new FormData();
        formData.append('files', file);
        formData.append('folderName', uploadFolderName.trim());
        formData.append('userId', '000000000000000000000001'); // Default/dummy user ID

        const response = await fetch('/api/guidelines/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        if (!data.success) {
          console.error('Upload failed for', file.name, data.error);
        }
      }

      setUploadProgress('✅ Upload complete!');
      setUploadFiles([]);
      setUploadFolderName('');
      setShowUploadModal(false);
      fetchAllGuidelines();
    } catch (error) {
      console.error('Upload error:', error);
      setUploadProgress('❌ Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  // Delete a single guideline
  const handleDeleteGuideline = async (guidelineId: string) => {
    if (!confirm('Are you sure you want to delete this guideline?')) return;

    setDeletingId(guidelineId);
    try {
      const response = await fetch(`/api/guidelines/upload?id=${guidelineId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        fetchAllGuidelines();
      } else {
        alert('Failed to delete guideline: ' + data.error);
      }
    } catch (error) {
      console.error('Delete error:', error);
    } finally {
      setDeletingId(null);
    }
  };

  // Delete an entire folder
  const handleDeleteFolder = async (folderName: string) => {
    if (!confirm(`Are you sure you want to delete the folder "${folderName}" and all its guidelines?`)) return;

    setDeletingFolder(folderName);
    try {
      const response = await fetch(`/api/guidelines/folders?folderName=${encodeURIComponent(folderName)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        fetchAllGuidelines();
      } else {
        alert('Failed to delete folder: ' + data.error);
      }
    } catch (error) {
      console.error('Delete folder error:', error);
    } finally {
      setDeletingFolder(null);
    }
  };

  // Delete a compliance report
  const handleDeleteReport = async (reportId: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    
    if (!confirm('Are you sure you want to delete this compliance report?')) return;

    try {
      const response = await fetch(`/api/compliance/analyze?reportId=${reportId}`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      
      if (data.success) {
        // If the deleted report was selected, clear selection
        if (selectedReport && selectedReport._id === reportId) {
          setSelectedReport(null);
        }
        await fetchReports();
      } else {
        alert('Failed to delete report: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error deleting report:', error);
      alert('Error deleting report');
    }
  };
  // Pre-flight: check which SOPs already have reports so the Review step can
  // show an accurate summary before the user clicks Start.
  const runPreflightCheck = useCallback(async () => {
    const target = selectedSopId === 'all' ? sops : sops.filter(s => s._id === selectedSopId);
    if (target.length === 0) return;

    const gujaratiCount = target.filter(clientIsGujarati).length;
    const nonGuj = target.filter(s => !clientIsGujarati(s));

    try {
      const res  = await fetch('/api/compliance/check-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopIds: nonGuj.map(s => s._id) }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const existingCount = nonGuj.filter(s => data.results?.[s._id]?.hasReport).length;
      const newCount      = nonGuj.length - existingCount;

      setPreflightData({ checked: true, existingCount, newCount, gujaratiCount });
    } catch {
      setPreflightData({ checked: false, existingCount: 0, newCount: target.length - gujaratiCount, gujaratiCount });
    }
  }, [sops, selectedSopId]);

  // Re-run preflight whenever scope or skipExisting changes on Review step
  useEffect(() => {
    if (currentStep === 'review') runPreflightCheck();
  }, [currentStep, selectedSopId, skipExisting]);

  // Run Analysis for all SOPs
  const runFullAnalysis = async () => {
    if (sops.length === 0) {
      alert('No SOPs available to analyze');
      return;
    }

    if (guidelines.length === 0) {
      alert('No guidelines available. Please upload guidelines first.');
      return;
    }

    // Reset pause state
    pauseRef.current = false;
    setIsPaused(false);
    setIsAnalyzing(true);
    setAnalysisComplete(false);
    setCurrentStep('analyze');

    const waitIfPaused = () =>
      new Promise<void>(resolve => {
        const check = () => (pauseRef.current ? setTimeout(check, 500) : resolve());
        check();
      });

    let successCount = 0;
    let failCount = 0;

    const allCandidates = selectedSopId === 'all'
      ? sops
      : sops.filter(s => s._id === selectedSopId);

    if (allCandidates.length === 0) {
      alert('No SOP selected for analysis');
      return;
    }

    // ── PRE-FLIGHT: check existing reports ─────────────────────────────
    setAnalysisProgress('Checking for existing compliance reports…');

    let existingMap: Record<string, { hasReport: boolean; overallScore?: number | null; complianceStatus?: string; analyzedAt?: string }> = {};
    try {
      const pfRes  = await fetch('/api/compliance/check-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopIds: allCandidates.map(s => s._id) }),
      });
      const pfData = await pfRes.json();
      if (pfData.success) existingMap = pfData.results || {};
    } catch { /* non-fatal — fall through and analyze all */ }

    // Partition: cached (skip if !forceRerun), needsAnalysis
    const cachedSops   = skipExisting ? allCandidates.filter(s => existingMap[s._id]?.hasReport) : [];
    const sopsToAnalyze = allCandidates.filter(s => !existingMap[s._id]?.hasReport || !skipExisting);

    // Pre-populate the cached list immediately
    const initialCached = cachedSops.map(s => ({
      identifier: s.identifier,
      name: s.name,
      score: existingMap[s._id]?.overallScore ?? null,
      status: existingMap[s._id]?.complianceStatus || 'Unknown',
      analyzedAt: existingMap[s._id]?.analyzedAt,
    }));

    // Total shown in progress = ALL candidates (cached + to-analyze)
    const totalForProgress = allCandidates.length;
    successCount = cachedSops.length; // cached counts as "processed"

    // Initialise progress tracker
    setAnalysisStats({
      total: totalForProgress,
      completed: cachedSops.length,
      failed: 0,
      skipped: 0,
      currentIndex: cachedSops.length,
      currentSopName: sopsToAnalyze[0]?.name || '',
      currentSopIdentifier: sopsToAnalyze[0]?.identifier || '',
    });
    setSopLists({ completed: [], cached: initialCached, skipped: [], failed: [] });
    setActiveChip(null);

    for (let i = 0; i < sopsToAnalyze.length; i++) {
      const sop = sopsToAnalyze[i];
      // Global progress index (cached SOPs already accounted for)
      const globalIdx = cachedSops.length + i;

      await waitIfPaused();

      setAnalysisStats(prev => ({
        ...prev,
        currentIndex: globalIdx,
        currentSopName: sop.name,
        currentSopIdentifier: sop.identifier,
      }));
      setAnalysisProgress(`Analyzing ${globalIdx + 1}/${totalForProgress}: ${sop.identifier} - ${sop.name}`);

      try {
        const response = await fetch('/api/compliance/analyze-v3', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sopId: sop._id,
            userId: '000000000000000000000001',
            config: {
              aiModel: 'gemini-2.0-flash',
              maxClausesToAnalyze: 200,
            },
          }),
        });

        const data = await response.json();
        if (data.success && data.skipped) {
          // Gujarati SOP — counted as processed, not failed
          successCount++;
          setAnalysisStats(prev => ({ ...prev, completed: successCount, skipped: prev.skipped + 1 }));
          setSopLists(prev => ({
            ...prev,
            skipped: [...prev.skipped, { identifier: sop.identifier, name: sop.name }],
          }));
          console.log(`⏭️ ${sop.identifier}: Skipped — ${data.userMessage}`);
        } else if (data.success) {
          successCount++;
          setCurrentResult(data);
          setAnalysisStats(prev => ({ ...prev, completed: successCount }));
          setSopLists(prev => ({
            ...prev,
            completed: [...prev.completed, {
              identifier: sop.identifier,
              name: sop.name,
              score: typeof data.overallScore === 'number' ? data.overallScore : null,
              status: data.complianceStatus || 'Unknown',
            }],
          }));
          console.log(`✅ ${sop.identifier}: Score ${data.overallScore}/10 - ${data.complianceStatus}`);
        } else {
          failCount++;
          setAnalysisStats(prev => ({ ...prev, failed: failCount }));
          setSopLists(prev => ({
            ...prev,
            failed: [...prev.failed, { identifier: sop.identifier, name: sop.name }],
          }));
          console.warn(`⚠️ ${sop.identifier}: ${data.error || data.userMessage}`);
        }
      } catch (error) {
        console.error('Analysis error for', sop.identifier, error);
        failCount++;
        setAnalysisStats(prev => ({ ...prev, failed: failCount }));
        setSopLists(prev => ({
          ...prev,
          failed: [...prev.failed, { identifier: sop.identifier, name: sop.name }],
        }));
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Final state — mark all done
    setAnalysisStats(prev => ({
      ...prev,
      completed: successCount,
      failed: failCount,
      currentIndex: totalForProgress,
    }));
    setAnalysisProgress(
      `✅ Analysis Complete: ${successCount - cachedSops.length} newly analyzed · ${cachedSops.length} cached · ${failCount} failed`
    );
    setIsAnalyzing(false);
    setIsPaused(false);
    pauseRef.current = false;
    setAnalysisComplete(true);
    fetchReports();
    fetch('/api/compliance/guideline-stats')
      .then(r => r.json())
      .then(d => { if (d.success) setGuidelineStats(d.stats || {}); })
      .catch(() => {});
  };

  // Initial load
  useEffect(() => {
    fetchSops();
    fetchAllGuidelines();
    fetchReports();
  }, []);

  // Calculate total clauses (use API provided count if in summary mode)
  const totalClauses = totalClausesFromAPI || (guidelines || []).reduce((sum, g) => sum + (g.clauseCount ?? (g.clauses?.length || 0)), 0);

  // Client-side Gujarati detection (mirrors server-side isGujaratiSOP)
  const clientIsGujarati = (sop: SOP): boolean => {
    const combined = [sop.identifier || '', sop.name || '', (sop as any).folderPath || ''].join(' ');
    if (/[઀-૿]{4,}/.test(combined)) return true;
    if (/(^|[\/\\\s_\-\.])guj([\/\\\s_\-\.]|$)/i.test(combined)) return true;
    if (/gujarati/i.test(combined)) return true;
    return false;
  };

  const getStepStyle = (stepId: string) => {
    const isActive = currentStep === stepId;
    return `flex-1 flex items-center justify-center gap-3 py-3 px-4 rounded-xl transition-all border ${
      isActive
        ? 'bg-purple-600 text-white shadow-lg border-purple-500'
        : 'bg-white text-gray-500 border-gray-200 hover:bg-purple-50 hover:border-purple-200'
    }`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Fully Compliant': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Partially Compliant': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Non-Compliant': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'Not Applicable': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'Analysis Pending': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Analysis Failed': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const sopCountDisplay = canonicalSopCount ?? sops.length;

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-700 to-purple-500">
                Compliance Intelligence Engine
              </h1>
              <p className="text-sm text-gray-500 font-medium">
                Automated Regulatory Compliance Validation
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all text-sm font-semibold shadow-sm"
            >
              ← Dashboard
            </button>
          </div>
        </div>
      </header>

      {/* Workflow Steps Navigation */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-10">
          {[
            { id: 'fetch-sops', label: '1. SOPs', icon: '📄', count: sopCountDisplay },
            { id: 'fetch-guidelines', label: '2. Guidelines', icon: '📚', count: guidelines?.length || 0 },
            { id: 'review', label: '3. Review', icon: '👁️', count: null },
            { id: 'analyze', label: '4. Analyze', icon: '🤖', count: null },
            { id: 'results', label: '5. Results', icon: '📊', count: reports?.length || 0 },
          ].map((step) => (
            <button
              key={step.id}
              onClick={() => setCurrentStep(step.id as WorkflowStep)}
              className={getStepStyle(step.id)}
            >
              <span className="text-xl opacity-90">{step.icon}</span>
              <span className="font-semibold text-sm hidden md:inline">{step.label}</span>
              {step.count !== null && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  currentStep === step.id ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' : 'bg-white/5 text-gray-400 border-white/10'
                }`}>
                  {step.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Step 1: Fetch SOPs */}
        {currentStep === 'fetch-sops' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">SOP Repository</h2>
                  <p className="text-gray-500 mt-1">
                    {sopCountDisplay} SOPs across {departments?.length || 0} departments available for analysis.
                  </p>
                </div>
                <button
                  onClick={fetchSops}
                  disabled={loadingSops}
                  className="px-5 py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl transition-all disabled:opacity-50 font-medium text-sm flex items-center gap-2 border border-purple-200"
                >
                  {loadingSops ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/>
                      Fetching...
                    </>
                  ) : '🔄 Refresh Data'}
                </button>
              </div>

              {/* Department filter */}
              <div className="mb-6 flex items-center gap-3">
                <span className="text-sm font-medium text-gray-600">Filter by Department:</span>
                <div className="relative">
                  <select
                    value={filterDepartment}
                    onChange={(e) => setFilterDepartment(e.target.value)}
                    className="pl-4 pr-10 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20 text-sm appearance-none cursor-pointer hover:border-purple-300 transition-all font-medium min-w-[240px]"
                  >
                    <option value="all">All Departments ({sopCountDisplay})</option>
                    {(departments || []).map(dept => (
                      <option key={dept} value={dept}>
                        {dept} ({(sops || []).filter(s => s.department === dept).length})
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 text-xs">▼</div>
                </div>
              </div>

              {/* SOP List */}
              {loadingSops ? (
                <div className="text-center py-20 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mx-auto mb-4"></div>
                  <p className="text-gray-500">Loading SOPs...</p>
                </div>
              ) : (
                <div className="max-h-[600px] overflow-y-auto space-y-3 pr-2 light-scrollbar">
                  {(sops || [])
                    .filter(sop => filterDepartment === 'all' || sop.department === filterDepartment)
                    .map((sop) => (
                    <div
                      key={sop._id}
                      className="p-5 bg-gray-50 border border-gray-100 rounded-xl hover:border-purple-200 hover:bg-purple-50/30 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-purple-700 font-bold text-sm bg-purple-50 px-2 py-0.5 rounded border border-purple-100">{sop.identifier}</span>
                            {sop.version && (
                              <span className="text-gray-400 text-xs">v{sop.version}</span>
                            )}
                          </div>
                          <h3 className="text-gray-800 font-medium group-hover:text-purple-700 transition-colors">
                            {cleanSOPName(sop.name, sop.identifier)}
                          </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="px-3 py-1.5 bg-white border border-gray-200 text-gray-500 rounded-lg text-xs font-bold shadow-sm">
                            📍 {sop.location || 'QA-DP-01'}
                          </span>
                          <span className="px-3 py-1.5 bg-white border border-gray-200 text-gray-500 rounded-lg text-xs font-medium shadow-sm">
                            🏢 {sop.department}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end mt-8 pt-6 border-t border-gray-100">
                <button
                  onClick={() => setCurrentStep('fetch-guidelines')}
                  className="px-8 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all shadow-lg shadow-purple-200"
                >
                  Next: Guidelines →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Fetch Guidelines */}
        {currentStep === 'fetch-guidelines' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">Compliance Guidelines</h2>
                  <p className="text-gray-500 mt-1">
                    Managing {guidelines?.length || 0} guidelines ({totalClauses} clauses) across {folders?.length || 0} categories.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all shadow-sm font-medium text-sm flex items-center gap-2"
                  >
                    <span>📤</span> Upload New
                  </button>
                  <button
                    onClick={fetchAllGuidelines}
                    disabled={loadingGuidelines}
                    className="px-5 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-all disabled:opacity-50 font-medium text-sm border border-gray-200"
                  >
                    {loadingGuidelines ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {/* Folder Summary with Delete Buttons */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {(folders || []).filter(folder => folder.guidelineCount > 0).map(folder => (
                  <div key={folder.folderName} className="p-5 bg-purple-50 rounded-xl border border-purple-100 relative group hover:border-purple-300 hover:shadow-md transition-all">
                    {/* Only show delete button for folders with guidelines */}
                    {folder.guidelineCount > 0 && (
                      <button
                        onClick={() => handleDeleteFolder(folder.folderName)}
                        disabled={deletingFolder === folder.folderName}
                        className="absolute top-2 right-2 p-1.5 bg-rose-50 border border-rose-200 text-rose-500 hover:bg-rose-100 rounded-lg transition-all text-xs z-10"
                        title={`Delete ${folder.folderName} folder and all ${folder.guidelineCount} guidelines`}
                      >
                        {deletingFolder === folder.folderName ? '⏳' : '🗑️'}
                      </button>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-purple-500 opacity-80">📁</span>
                        <p className="text-gray-800 font-semibold truncate" title={folder.folderName}>{folder.folderName}</p>
                    </div>

                    <div className="flex items-end justify-between">
                         <div>
                            <p className="text-2xl font-bold text-purple-700 leading-none">{folder.guidelineCount}</p>
                            <p className="text-xs text-gray-500 mt-1">Guidelines</p>
                         </div>
                         <div className="text-right">
                             <p className="text-sm font-medium text-gray-700">{folder.totalClauses}</p>
                             <p className="text-xs text-gray-400">Clauses</p>
                         </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Guidelines List with Expandable Clauses */}
              {loadingGuidelines ? (
                <div className="text-center py-20 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mx-auto mb-4"></div>
                  <p className="text-gray-500">Loading guidelines...</p>
                </div>
              ) : guidelines.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500">
                  <p className="text-4xl mb-4 grayscale opacity-50">📚</p>
                  <p className="text-lg font-medium text-gray-700">No guidelines found</p>
                  <p className="text-sm mb-6">Upload regulatory documents to get started.</p>
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-all"
                  >
                    Upload Documents
                  </button>
                </div>
              ) : (
                <div className="max-h-[600px] overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {(guidelines || []).map((guideline) => (
                    <div
                      key={guideline._id}
                      className="bg-gray-50 border border-gray-100 rounded-xl overflow-hidden relative group hover:bg-purple-50 hover:border-purple-200 transition-all"
                    >
                      <button
                        onClick={() => handleDeleteGuideline(guideline._id)}
                        disabled={deletingId === guideline._id}
                        className="absolute top-4 right-14 p-1.5 bg-white border border-rose-200 text-rose-500 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all text-xs z-10 shadow-sm"
                        title="Delete guideline"
                      >
                        {deletingId === guideline._id ? '⏳' : '🗑️'}
                      </button>

                      <button
                        onClick={() => handleToggleGuideline(guideline)}
                        className="w-full p-5 flex items-center justify-between text-left hover:bg-purple-50/50 transition-colors"
                      >
                        <div className="flex-1 pr-4 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold uppercase tracking-wider border border-purple-200">
                              {guideline.folderName}
                            </span>
                            <span className="text-gray-400 text-xs px-2 border-l border-gray-200">{guideline.guidelineType}</span>
                          </div>
                          <h3 className="text-gray-800 font-semibold text-base leading-tight">{guideline.name}</h3>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Clause count */}
                          <span className="px-2.5 py-1 bg-white text-gray-500 rounded-lg text-xs font-medium border border-gray-200">
                            {guideline.clauseCount ?? (guideline.clauses?.length || 0)} clauses
                          </span>

                          {/* Compliance points badge — shown once any reports exist */}
                          {(() => {
                            const stat = guidelineStats[guideline.name];
                            if (!stat || stat.totalFindings === 0) return null;
                            const hasFailed = stat.nonCompliantCount > 0;
                            const allGood   = stat.compliantCount === stat.totalFindings;
                            return (
                              <div className="flex items-center gap-1">
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                                  allGood  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                  hasFailed ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                             'bg-amber-50 text-amber-700 border-amber-200'
                                }`}>
                                  {stat.totalFindings} points
                                </span>
                                {stat.sopCount > 0 && (
                                  <span className="px-2 py-1 bg-purple-50 text-purple-600 rounded-lg text-[10px] font-bold border border-purple-200">
                                    {stat.sopCount} SOP{stat.sopCount !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                          <span className={`text-gray-400 transition-transform duration-300 ${expandedGuideline === guideline._id ? 'rotate-180' : ''}`}>
                            ▼
                          </span>
                        </div>
                      </button>

                      {/* Expanded Clause List */}
                      {expandedGuideline === guideline._id && (
                        <div className="px-5 pb-5 pt-2 bg-white border-t border-gray-100">
                          {/* Compliance points summary bar */}
                          {(() => {
                            const stat = guidelineStats[guideline.name];
                            if (!stat || stat.totalFindings === 0) return null;
                            return (
                              <div className="mb-3 p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-wrap items-center gap-3">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Compliance points:</span>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                                    ✓ {stat.compliantCount} compliant
                                  </span>
                                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                    ~ {stat.partialCount} partial
                                  </span>
                                  <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                                    ✗ {stat.nonCompliantCount} gaps
                                  </span>
                                  <span className="text-[10px] text-gray-400 font-semibold ml-1">
                                    across {stat.sopCount} SOP{stat.sopCount !== 1 ? 's' : ''}
                                  </span>
                                </div>
                                {/* Mini progress bar */}
                                <div className="flex-1 min-w-[80px] h-1.5 bg-gray-200 rounded-full overflow-hidden flex">
                                  <div className="bg-emerald-500 h-full" style={{ width: `${(stat.compliantCount / stat.totalFindings) * 100}%` }} />
                                  <div className="bg-amber-400 h-full" style={{ width: `${(stat.partialCount / stat.totalFindings) * 100}%` }} />
                                  <div className="bg-rose-500 h-full" style={{ width: `${(stat.nonCompliantCount / stat.totalFindings) * 100}%` }} />
                                </div>
                              </div>
                            );
                          })()}
                          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-2 custom-scrollbar mt-2">
                            {(!guideline.clauses || loadingGuidelineId === guideline._id) ? (
                              <div className="py-8 text-center bg-gray-50 rounded-lg border border-gray-100 shadow-sm">
                                <p className="text-gray-400 text-xs italic mb-2">
                                  {loadingGuidelineId === guideline._id ? '⏳ Fetching detailed clauses...' : '⏳ Waiting to load...'}
                                </p>
                              </div>
                            ) : guideline.clauses.length === 0 ? (
                              <p className="text-gray-400 text-xs italic py-4 text-center">No parsed clauses found.</p>
                            ) : (
                              guideline.clauses.map((clause, idx) => (
                              <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-100 shadow-sm flex gap-4">
                                <div className="flex-shrink-0">
                                    <span className="px-2.5 py-1 bg-purple-100 text-purple-700 rounded-md text-xs font-bold border border-purple-200 block text-center min-w-[3rem]">
                                        {clause.clauseNumber}
                                    </span>
                                </div>
                                <div>
                                    <h4 className="text-gray-800 font-semibold text-sm mb-1">{clause.clauseTitle}</h4>
                                    <p className="text-gray-500 text-xs leading-relaxed">{clause.clauseText}</p>
                                </div>
                              </div>
                                ))
                             )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
                <button
                  onClick={() => setCurrentStep('fetch-sops')}
                  className="px-6 py-3 bg-gray-50 border border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-100 transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setCurrentStep('review')}
                  className="px-8 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all shadow-lg shadow-purple-200"
                >
                  Next: Review Analysis →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-6 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl p-8 max-w-lg w-full shadow-2xl border border-gray-200 transform scale-100">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Upload Guidelines</h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Folder / Category Name</label>
                  <input
                    type="text"
                    value={uploadFolderName}
                    onChange={(e) => setUploadFolderName(e.target.value)}
                    placeholder="e.g., EU GMP Part 1"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                  />
                  <p className="text-xs text-gray-500 mt-1.5 ml-1">Existing folders will be updated.</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Select PDF Documents</label>
                  <div className="relative">
                      <input
                        type="file"
                        multiple
                        accept=".pdf"
                        onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 cursor-pointer"
                      />
                  </div>
                </div>

                {uploadProgress && (
                  <div className="p-3 bg-blue-50 text-blue-700 rounded-lg text-sm text-center border border-blue-100 font-medium">
                    {uploadProgress}
                  </div>
                )}
                
                <div className="flex gap-3 mt-8">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    disabled={isUploading}
                    className="flex-1 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl transition-all disabled:opacity-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUploadGuidelines}
                    disabled={isUploading}
                    className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-all disabled:opacity-50 shadow-md shadow-purple-200"
                  >
                    {isUploading ? 'Uploading...' : 'Confirm Upload'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Review Before Analysis */}
        {currentStep === 'review' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Review Configuration</h2>

              {/* Scope Selection */}
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-6 mb-4">
                <label className="block text-sm font-medium text-gray-600 mb-3">Select Analysis Scope</label>
                <div className="relative">
                  <select
                    value={selectedSopId}
                    onChange={(e) => setSelectedSopId(e.target.value)}
                    className="w-full pl-4 pr-10 py-3 bg-white border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500/30 appearance-none cursor-pointer"
                  >
                    <option value="all">Analyze All Available SOPs ({sopCountDisplay})</option>
                    <optgroup label="Individual SOPs">
                      {sops.map(sop => (
                        <option key={sop._id} value={sop._id}>
                          {sop.identifier} - {cleanSOPName(sop.name, sop.identifier)}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">▼</div>
                </div>
              </div>

              {/* Skip-existing toggle */}
              <div className={`rounded-xl border p-5 mb-8 transition-all ${skipExisting ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className={`text-sm font-bold mb-0.5 ${skipExisting ? 'text-blue-800' : 'text-amber-800'}`}>
                      {skipExisting ? '✅ Smart Mode — skip SOPs with existing results' : '⚠️ Force Mode — re-analyze all SOPs'}
                    </p>
                    <p className={`text-xs leading-relaxed ${skipExisting ? 'text-blue-600' : 'text-amber-600'}`}>
                      {skipExisting
                        ? 'SOPs that already have a compliance report will be skipped. Only new or unanalyzed SOPs will be processed.'
                        : 'All SOPs will be re-analyzed, overwriting any existing compliance results. This may take significantly longer.'}
                    </p>

                    {/* Pre-flight summary */}
                    {preflightData.checked && (
                      <div className="mt-3 flex flex-wrap gap-3">
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-white border border-emerald-200 px-2.5 py-1 rounded-lg">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          {skipExisting ? preflightData.newCount : preflightData.newCount + preflightData.existingCount} to analyze
                        </span>
                        {skipExisting && preflightData.existingCount > 0 && (
                          <span className="flex items-center gap-1.5 text-[10px] font-black text-blue-700 bg-white border border-blue-200 px-2.5 py-1 rounded-lg">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            {preflightData.existingCount} cached (will be skipped)
                          </span>
                        )}
                        {preflightData.gujaratiCount > 0 && (
                          <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
                            <span className="w-2 h-2 rounded-full bg-slate-400" />
                            {preflightData.gujaratiCount} Gujarati (N/A)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Toggle switch */}
                  <button
                    onClick={() => setSkipExisting(v => !v)}
                    className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors focus:outline-none ${skipExisting ? 'bg-blue-500' : 'bg-amber-400'}`}
                    title={skipExisting ? 'Switch to Force Re-run mode' : 'Switch to Smart mode'}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${skipExisting ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="p-6 bg-purple-50 rounded-2xl border border-purple-200">
                  <p className="text-purple-600 font-medium text-xs uppercase tracking-wider mb-2">Target SOPs</p>
                  <p className="text-4xl font-bold text-gray-800">
                    {selectedSopId === 'all' ? sopCountDisplay : 1}
                  </p>
                  <p className="text-gray-500 text-sm mt-1">
                    {selectedSopId === 'all' ? `across ${departments.length} departments` : 'Selected SOP'}
                  </p>
                </div>
                <div className="p-6 bg-rose-50 rounded-2xl border border-rose-200">
                  <p className="text-rose-600 font-medium text-xs uppercase tracking-wider mb-2">Reference Guidelines</p>
                  <p className="text-4xl font-bold text-gray-800">{guidelines.length}</p>
                  <p className="text-gray-500 text-sm mt-1">from {folders.length} categories</p>
                </div>
                <div className="p-6 bg-amber-50 rounded-2xl border border-amber-200">
                  <p className="text-amber-600 font-medium text-xs uppercase tracking-wider mb-2">Total Validation Points</p>
                  <p className="text-4xl font-bold text-gray-800">{totalClauses}</p>
                  <p className="text-gray-500 text-sm mt-1">clauses to verify</p>
                </div>
              </div>

              {/* Analysis Info */}
              <div className="p-6 bg-gray-50 rounded-xl border border-gray-100 mb-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4">Process Overview</h3>
                <ul className="space-y-3 text-gray-600">
                  <li className="flex items-start gap-3">
                    <span className="text-purple-700 bg-purple-100 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border border-purple-200 flex-shrink-0">1</span>
                    <span>Cross-referencing each SOP against all active guidelines</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-purple-700 bg-purple-100 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border border-purple-200 flex-shrink-0">2</span>
                    <span>AI-driven compliance scoring (Compliant, Partial, Non-Compliant)</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-purple-700 bg-purple-100 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border border-purple-200 flex-shrink-0">3</span>
                    <span>Generation of specific section references and remediation suggestions</span>
                  </li>
                </ul>
              </div>

              {/* Estimated Time */}
              <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl mb-8 text-blue-700">
                 <span className="text-xl">⏱️</span>
                 <div>
                    <p className="font-semibold text-sm">Estimated Duration</p>
                    <p className="text-xs text-blue-600">
                      ~{Math.ceil((selectedSopId === 'all' ? sopCountDisplay : 1) * 0.5)} minutes ({(selectedSopId === 'all' ? sopCountDisplay : 1)} SOPs × 30s)
                    </p>
                 </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setCurrentStep('fetch-guidelines')}
                  className="px-6 py-3 bg-gray-50 border border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-100 transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={runFullAnalysis}
                  disabled={sops.length === 0 || guidelines.length === 0}
                  className="px-10 py-4 bg-purple-600 text-white rounded-xl font-bold text-lg hover:bg-purple-700 transition-all disabled:opacity-50 shadow-lg shadow-purple-200"
                >
                  Start Analysis
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Analysis in Progress */}
        {currentStep === 'analyze' && (() => {
          const { total, completed, failed, skipped, currentIndex, currentSopName, currentSopIdentifier } = analysisStats;
          const remaining  = Math.max(0, total - completed - failed - (isAnalyzing ? 1 : 0));
          const pctDone    = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
          const estMinLeft = isAnalyzing ? Math.ceil(remaining * 0.5) : 0;

          return (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

              {/* ── Header card ─────────────────────────────────────────── */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">
                      {!isAnalyzing   ? 'Analysis Complete' :
                       isPaused       ? 'Analysis Paused' :
                                        'Processing Compliance Checks…'}
                    </h2>
                    {isAnalyzing && total > 0 && (
                      <p className={`text-sm mt-0.5 ${isPaused ? 'text-amber-500 font-semibold' : 'text-gray-400'}`}>
                        {isPaused
                          ? 'Click Resume to continue'
                          : estMinLeft > 0 ? `~${estMinLeft} min remaining` : 'Finishing up…'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Pause / Resume button */}
                    {isAnalyzing && (
                      <button
                        onClick={() => {
                          const next = !pauseRef.current;
                          pauseRef.current = next;
                          setIsPaused(next);
                        }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all shadow-sm ${
                          isPaused
                            ? 'bg-purple-600 border-purple-600 text-white hover:bg-purple-700 shadow-purple-200'
                            : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                        }`}
                      >
                        {isPaused ? (
                          <>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                            </svg>
                            Resume
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            Pause
                          </>
                        )}
                      </button>
                    )}

                    {/* Percentage badge */}
                    <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center border-2 ${
                      analysisComplete ? 'bg-emerald-50 border-emerald-300' :
                      isPaused         ? 'bg-amber-50 border-amber-300' :
                                         'bg-purple-50 border-purple-300'
                    }`}>
                      <span className={`text-lg font-black leading-none ${
                        analysisComplete ? 'text-emerald-600' :
                        isPaused         ? 'text-amber-600' :
                                           'text-purple-600'
                      }`}>
                        {pctDone}%
                      </span>
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">done</span>
                    </div>
                  </div>
                </div>

                {/* ── Segmented progress bar ─────────────────────────── */}
                {total > 0 && (
                  <div className="space-y-2 mb-6">
                    <div className="relative h-5 w-full bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                      {/* Completed (green) */}
                      <div
                        className="absolute left-0 top-0 h-full bg-emerald-500 transition-all duration-500 rounded-l-full"
                        style={{ width: `${(completed / total) * 100}%` }}
                      />
                      {/* Failed (red) */}
                      <div
                        className="absolute top-0 h-full bg-rose-400 transition-all duration-500"
                        style={{
                          left: `${(completed / total) * 100}%`,
                          width: `${(failed / total) * 100}%`,
                        }}
                      />
                      {/* Current / in-progress (animated purple) */}
                      {isAnalyzing && (
                        <div
                          className="absolute top-0 h-full bg-purple-500 transition-all duration-500"
                          style={{
                            left: `${((completed + failed) / total) * 100}%`,
                            width: `${(1 / total) * 100}%`,
                          }}
                        >
                          {/* shimmer */}
                          <div className="h-full w-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse" />
                        </div>
                      )}
                      {/* Remaining (already gray from parent) */}

                      {/* Percentage label centred */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[10px] font-black text-white drop-shadow">
                          {completed + failed} / {total}
                        </span>
                      </div>
                    </div>

                    {/* ── Five clickable stat chips ─────────────────── */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                      {/* Completed */}
                      <button
                        onClick={() => setActiveChip(activeChip === 'completed' ? null : 'completed')}
                        disabled={sopLists.completed.length === 0}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                          activeChip === 'completed'
                            ? 'bg-emerald-100 border-emerald-400 ring-2 ring-emerald-200'
                            : sopLists.completed.length > 0
                              ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-400 hover:bg-emerald-100 cursor-pointer'
                              : 'bg-emerald-50 border-emerald-200 opacity-60 cursor-default'
                        }`}
                      >
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wider">Completed</p>
                          <p className="text-xl font-black text-emerald-700 leading-none">{completed - skipped}</p>
                        </div>
                        {sopLists.completed.length > 0 && (
                          <svg className={`w-3 h-3 text-emerald-500 flex-shrink-0 transition-transform ${activeChip === 'completed' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        )}
                      </button>

                      {/* Cached (existing reports) */}
                      <button
                        onClick={() => setActiveChip(activeChip === 'cached' ? null : 'cached')}
                        disabled={sopLists.cached.length === 0}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                          activeChip === 'cached'
                            ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-200'
                            : sopLists.cached.length > 0
                              ? 'bg-blue-50 border-blue-200 hover:border-blue-400 hover:bg-blue-100 cursor-pointer'
                              : 'bg-blue-50 border-blue-200 opacity-60 cursor-default'
                        }`}
                      >
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-blue-600 uppercase tracking-wider">Cached</p>
                          <p className="text-xl font-black text-blue-700 leading-none">{sopLists.cached.length}</p>
                        </div>
                        {sopLists.cached.length > 0 && (
                          <svg className={`w-3 h-3 text-blue-400 flex-shrink-0 transition-transform ${activeChip === 'cached' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        )}
                      </button>

                      {/* Remaining — not clickable (no list yet) */}
                      <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isAnalyzing ? 'bg-purple-500 animate-pulse' : 'bg-gray-300'}`} />
                        <div>
                          <p className="text-[10px] font-black text-purple-600 uppercase tracking-wider">Remaining</p>
                          <p className="text-xl font-black text-purple-700 leading-none">{remaining + (isAnalyzing ? 1 : 0)}</p>
                        </div>
                      </div>

                      {/* Skipped (Gujarati) */}
                      <button
                        onClick={() => setActiveChip(activeChip === 'skipped' ? null : 'skipped')}
                        disabled={sopLists.skipped.length === 0}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                          activeChip === 'skipped'
                            ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-200'
                            : sopLists.skipped.length > 0
                              ? 'bg-slate-50 border-slate-200 hover:border-slate-400 hover:bg-slate-100 cursor-pointer'
                              : 'bg-slate-50 border-slate-200 opacity-60 cursor-default'
                        }`}
                      >
                        <div className="w-2.5 h-2.5 rounded-full bg-slate-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Skipped (GUJ)</p>
                          <p className="text-xl font-black text-slate-600 leading-none">{skipped}</p>
                        </div>
                        {sopLists.skipped.length > 0 && (
                          <svg className={`w-3 h-3 text-slate-400 flex-shrink-0 transition-transform ${activeChip === 'skipped' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        )}
                      </button>

                      {/* Failed */}
                      <button
                        onClick={() => setActiveChip(activeChip === 'failed' ? null : 'failed')}
                        disabled={sopLists.failed.length === 0}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                          activeChip === 'failed'
                            ? 'bg-rose-100 border-rose-400 ring-2 ring-rose-200'
                            : sopLists.failed.length > 0
                              ? 'bg-rose-50 border-rose-200 hover:border-rose-400 hover:bg-rose-100 cursor-pointer'
                              : 'bg-rose-50 border-rose-200 opacity-60 cursor-default'
                        }`}
                      >
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-rose-600 uppercase tracking-wider">Failed</p>
                          <p className="text-xl font-black text-rose-600 leading-none">{failed}</p>
                        </div>
                        {sopLists.failed.length > 0 && (
                          <svg className={`w-3 h-3 text-rose-400 flex-shrink-0 transition-transform ${activeChip === 'failed' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        )}
                      </button>
                    </div>

                    {/* ── Dropdown panel ────────────────────────────── */}
                    {activeChip && (
                      <div className="mt-2 rounded-xl border bg-white shadow-md overflow-hidden animate-in slide-in-from-top-1 duration-150">
                        {/* Panel header */}
                        <div className={`px-4 py-2.5 border-b flex items-center justify-between ${
                          activeChip === 'completed' ? 'bg-emerald-50 border-emerald-100' :
                          activeChip === 'cached'    ? 'bg-blue-50 border-blue-100' :
                          activeChip === 'skipped'   ? 'bg-slate-50 border-slate-100' :
                                                       'bg-rose-50 border-rose-100'
                        }`}>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${
                            activeChip === 'completed' ? 'text-emerald-600' :
                            activeChip === 'cached'    ? 'text-blue-600' :
                            activeChip === 'skipped'   ? 'text-slate-500' :
                                                         'text-rose-600'
                          }`}>
                            {activeChip === 'completed' ? `${sopLists.completed.length} Newly Analyzed` :
                             activeChip === 'cached'    ? `${sopLists.cached.length} Existing Results Used` :
                             activeChip === 'skipped'   ? `${sopLists.skipped.length} Gujarati SOPs Skipped` :
                                                          `${sopLists.failed.length} Failed SOPs`}
                          </span>
                          <button onClick={() => setActiveChip(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* SOP list */}
                        <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
                          {activeChip === 'completed' && sopLists.completed.map((s, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-gray-700 truncate">{s.name}</p>
                                <p className="text-[10px] text-gray-400 font-mono">{s.identifier}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                {s.score !== null && (
                                  <span className={`text-sm font-black ${s.score >= 7 ? 'text-emerald-600' : s.score >= 4 ? 'text-amber-600' : 'text-rose-600'}`}>
                                    {s.score}/10
                                  </span>
                                )}
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(s.status)}`}>
                                  {s.status}
                                </span>
                              </div>
                            </div>
                          ))}

                          {activeChip === 'cached' && sopLists.cached.map((s, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-gray-700 truncate">{s.name}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <p className="text-[10px] text-gray-400 font-mono">{s.identifier}</p>
                                  {s.analyzedAt && (
                                    <p className="text-[9px] text-gray-300 font-medium">
                                      · {new Date(s.analyzedAt).toLocaleDateString()} {new Date(s.analyzedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                {s.score !== null && s.score !== undefined && (
                                  <span className={`text-sm font-black ${s.score >= 7 ? 'text-emerald-600' : s.score >= 4 ? 'text-amber-600' : 'text-rose-600'}`}>
                                    {s.score}/10
                                  </span>
                                )}
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(s.status)}`}>
                                  {s.status}
                                </span>
                              </div>
                            </div>
                          ))}

                          {activeChip === 'skipped' && sopLists.skipped.map((s, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-gray-700 truncate">{s.name}</p>
                                <p className="text-[10px] text-gray-400 font-mono">{s.identifier}</p>
                              </div>
                              <span className="px-2 py-0.5 rounded text-[9px] font-bold border bg-slate-100 text-slate-600 border-slate-200 flex-shrink-0 ml-3">
                                GUJ – N/A
                              </span>
                            </div>
                          ))}

                          {activeChip === 'failed' && sopLists.failed.map((s, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-gray-700 truncate">{s.name}</p>
                                <p className="text-[10px] text-gray-400 font-mono">{s.identifier}</p>
                              </div>
                              <span className="px-2 py-0.5 rounded text-[9px] font-bold border bg-rose-50 text-rose-600 border-rose-200 flex-shrink-0 ml-3">
                                Error
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Current SOP being processed / paused ───────────── */}
                {isAnalyzing && currentSopIdentifier && (
                  <div className={`flex items-center gap-3 p-4 rounded-xl border transition-colors ${
                    isPaused
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-purple-50 border-purple-200'
                  }`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      isPaused ? 'bg-amber-400' : 'bg-purple-600'
                    }`}>
                      {isPaused ? (
                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[10px] font-black uppercase tracking-wider mb-0.5 ${
                        isPaused ? 'text-amber-600' : 'text-purple-500'
                      }`}>
                        {isPaused
                          ? `⏸ Paused at SOP ${currentIndex + 1} of ${total}`
                          : `Analyzing SOP ${currentIndex + 1} of ${total}`}
                      </p>
                      <p className="text-sm font-bold text-gray-800 truncate">{currentSopName}</p>
                      <p className={`text-xs font-mono ${isPaused ? 'text-amber-500' : 'text-purple-500'}`}>
                        {currentSopIdentifier}
                      </p>
                    </div>
                    {isPaused && (
                      <span className="px-2.5 py-1 bg-amber-100 border border-amber-300 text-amber-700 text-[10px] font-black rounded-lg uppercase tracking-wider flex-shrink-0">
                        Paused
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* ── SOP dot-grid ─────────────────────────────────────── */}
              {total > 0 && total <= 100 && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">SOP Progress Map</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: total }).map((_, idx) => {
                      const cachedCount  = sopLists.cached.length;
                      const isCached     = idx < cachedCount;
                      const isNewDone    = idx >= cachedCount && idx < cachedCount + (completed - skipped - cachedCount);
                      const isSkipped    = idx >= cachedCount + (completed - skipped - cachedCount) && idx < completed;
                      const isFailed     = idx >= completed && idx < completed + failed;
                      const isCurrent    = isAnalyzing && idx === completed + failed;
                      return (
                        <div
                          key={idx}
                          title={
                            isCached   ? 'Existing result used' :
                            isNewDone  ? 'Newly analyzed' :
                            isSkipped  ? 'Skipped – Gujarati SOP' :
                            isFailed   ? 'Failed' :
                            isCurrent  ? 'In progress' : 'Pending'
                          }
                          className={`w-4 h-4 rounded transition-all duration-300 ${
                            isCached   ? 'bg-blue-400' :
                            isNewDone  ? 'bg-emerald-500' :
                            isSkipped  ? 'bg-slate-300' :
                            isFailed   ? 'bg-rose-400' :
                            isCurrent  ? 'bg-purple-500 ring-2 ring-purple-300 animate-pulse' :
                                         'bg-gray-200'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-3">
                    {[
                      { color: 'bg-blue-400',    label: 'Existing (Cached)' },
                      { color: 'bg-emerald-500', label: 'Newly Analyzed' },
                      { color: 'bg-slate-300',   label: 'Skipped (GUJ)' },
                      { color: 'bg-purple-500',  label: 'In Progress' },
                      { color: 'bg-rose-400',    label: 'Failed' },
                      { color: 'bg-gray-200',    label: 'Pending' },
                    ].map(l => (
                      <div key={l.label} className="flex items-center gap-1.5 text-[10px] text-gray-500 font-semibold">
                        <div className={`w-3 h-3 rounded ${l.color}`} />
                        {l.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Latest result card ─────────────────────────────── */}
              {currentResult && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Latest Result</span>
                    {currentResult.complianceStatus && (
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${getStatusColor(currentResult.complianceStatus)}`}>
                        {currentResult.complianceStatus}
                      </span>
                    )}
                  </div>
                  <p className="text-base font-bold text-gray-800 leading-tight mb-0.5">{currentResult.sopName}</p>
                  <p className="text-xs text-gray-400 font-mono mb-3">{currentResult.sopIdentifier}</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm text-gray-500 font-medium">Score</span>
                    <span className={`text-2xl font-black ${getScoreColor(currentResult.overallScore)}`}>
                      {typeof currentResult.overallScore === 'number' ? currentResult.overallScore : 'N/A'}
                    </span>
                    {typeof currentResult.overallScore === 'number' && (
                      <span className="text-sm text-gray-400 font-bold">/10</span>
                    )}
                  </div>
                </div>
              )}

              {/* ── Completion actions ─────────────────────────────── */}
              {analysisComplete && (
                <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-xl">✅</div>
                    <div>
                      <p className="font-bold text-gray-800">Analysis complete</p>
                      <p className="text-xs text-gray-500">
                        {completed - skipped - sopLists.cached.length} new
                        {sopLists.cached.length > 0 ? ` · ${sopLists.cached.length} cached` : ''}
                        {skipped > 0 ? ` · ${skipped} GUJ skipped` : ''}
                        {failed > 0 ? ` · ${failed} failed` : ''}
                        {' · '}{total} total
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={runFullAnalysis}
                      disabled={isAnalyzing || sops.length === 0 || guidelines.length === 0}
                      className="flex-1 px-5 py-2.5 bg-white border border-purple-200 text-purple-700 rounded-xl font-bold hover:bg-purple-50 transition-all disabled:opacity-50 text-sm"
                    >
                      ↻ Re-run Analysis
                    </button>
                    <button
                      onClick={() => setCurrentStep('results')}
                      className="flex-1 px-5 py-2.5 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-all shadow-md shadow-purple-200 text-sm"
                    >
                      View Full Report →
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Step 5: Results */}
        {currentStep === 'results' && (
          <div className={`${isFullScreen ? 'fixed inset-0 z-50 bg-[#f8f9fa] p-6 overflow-hidden' : 'grid grid-cols-1 xl:grid-cols-12 gap-8 h-[calc(100vh-180px)]'}`}>

            {/* Reports Sidebar */}
            {!isFullScreen && (
            <div className={`${selectedReport ? 'xl:col-span-4' : 'xl:col-span-12'} bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden transition-all duration-500`}>
              <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  Generated Reports
                  <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-bold">
                    {reports?.length || 0}
                  </span>
                </h2>
                <button
                  onClick={fetchReports}
                  className="p-2 hover:bg-gray-100 text-gray-400 hover:text-purple-600 rounded-lg transition-all"
                  title="Refresh"
                >
                  <span className={loadingReports ? "animate-spin block" : ""}>🔄</span>
                </button>
              </div>

              {loadingReports ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-3"></div>
                  <p className="text-gray-400 text-sm">Loading...</p>
                </div>
              ) : (reports?.length || 0) === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-gray-400">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-2xl grayscale opacity-50">📊</span>
                  </div>
                  <p className="font-medium text-gray-500">No reports generated</p>
                  <button
                    onClick={() => setCurrentStep('review')}
                    className="mt-4 text-purple-600 text-sm font-medium hover:underline"
                  >
                    Start New Analysis
                  </button>
                </div>
              ) : (
                <div className={`overflow-y-auto p-3 space-y-2 light-scrollbar ${selectedReport ? 'flex-1' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 space-y-0 w-full'}`}>
                  {(reports || []).map(report => (
                    <div
                      key={report._id}
                      onClick={() => {
                        handleSelectReport(report);
                        setFilterStatus('all');
                      }}
                      className={`relative group p-5 rounded-2xl text-left transition-all duration-300 cursor-pointer border-2 ${
                        selectedReport?._id === report._id
                          ? 'bg-purple-50 border-purple-400 shadow-md shadow-purple-100'
                          : 'bg-gray-50 border-gray-100 hover:border-purple-300 hover:bg-purple-50/50'
                      }`}
                    >
                      <button
                         onClick={(e) => handleDeleteReport(report._id, e)}
                         className="absolute top-2 right-2 p-1.5 hover:bg-rose-50 text-gray-300 hover:text-rose-500 rounded-md opacity-0 group-hover:opacity-100 transition-all z-10"
                         title="Delete Report"
                       >
                        🗑️
                      </button>

                      <div className="flex justify-between items-start mb-3">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            {report.sopIdentifier}
                        </span>
                        <div className="flex items-center gap-2">
                           <div className={`w-3 h-3 rounded-full ${
                             (report.complianceStatus === 'Analysis Pending' || report.complianceStatus === 'Analysis Failed') ? 'bg-blue-400' :
                             report.overallScore >= 7 ? 'bg-emerald-500' :
                             report.overallScore >= 4 ? 'bg-amber-500' :
                             'bg-rose-500'
                           }`} />
                           <div className="text-lg font-black text-gray-800">
                             {(report.complianceStatus === 'Analysis Pending' || report.complianceStatus === 'Analysis Failed') ? (
                               <span className="text-blue-500">N/A</span>
                             ) : (
                               <>
                                 <span className={getScoreColor(report.overallScore)}>{report.overallScore}</span>
                                 <span className="text-gray-400 text-xs">/10</span>
                               </>
                             )}
                           </div>
                        </div>
                      </div>

                      <h3 className={`font-bold text-xs leading-tight mb-4 line-clamp-2 uppercase tracking-tight ${selectedReport?._id === report._id ? 'text-purple-700' : 'text-gray-700'}`} title={report.sopName}>
                        {report.sopName}
                      </h3>

                      <div className="flex items-center justify-between mt-auto">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border ${getStatusColor(report.complianceStatus)}`}>
                            {report.complianceStatus}
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium font-mono">
                          {new Date(report.analyzedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Main Content Area - Report Detail */}
            {selectedReport && (
              <div className={`${isFullScreen ? 'h-full' : 'xl:col-span-8'} flex flex-col gap-6 overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300`}>
                
                {/* 1. Header Card */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex-shrink-0 overflow-hidden">
                  {/* Thin status accent bar at top */}
                  <div className={`h-1 w-full ${
                    (selectedReport.complianceStatus === 'Analysis Pending' || selectedReport.complianceStatus === 'Analysis Failed') ? 'bg-blue-400' :
                    selectedReport.overallScore >= 7 ? 'bg-emerald-500' :
                    selectedReport.overallScore >= 4 ? 'bg-amber-400' :
                    'bg-rose-500'
                  }`} />
                  <div className="p-5 flex flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-5">
                      {/* Score circle */}
                      <div className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center flex-shrink-0 ${
                        (selectedReport.complianceStatus === 'Analysis Pending' || selectedReport.complianceStatus === 'Analysis Failed') ? 'bg-blue-50 border border-blue-200' :
                        selectedReport.overallScore >= 7 ? 'bg-emerald-50 border border-emerald-200' :
                        selectedReport.overallScore >= 4 ? 'bg-amber-50 border border-amber-200' :
                        'bg-rose-50 border border-rose-200'
                      }`}>
                        {(selectedReport.complianceStatus === 'Analysis Pending' || selectedReport.complianceStatus === 'Analysis Failed') ? (
                          <span className="text-xl font-black text-blue-600">N/A</span>
                        ) : (
                          <>
                            <span className={`text-2xl font-black leading-none ${getScoreColor(selectedReport.overallScore)}`}>
                              {selectedReport.overallScore}
                            </span>
                            <span className="text-[10px] font-bold text-gray-400">/10</span>
                          </>
                        )}
                      </div>

                      <div>
                        <p className="text-[10px] font-black text-purple-600 uppercase tracking-[0.2em] mb-0.5">{selectedReport.department}</p>
                        <p className="text-gray-800 font-bold text-sm leading-tight mb-1 max-w-xs truncate" title={selectedReport.sopName}>
                          {selectedReport.sopName}
                        </p>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${getStatusColor(selectedReport.complianceStatus)}`}>
                          {selectedReport.complianceStatus}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setIsFullScreen(!isFullScreen)}
                      className="p-2.5 bg-gray-50 hover:bg-purple-50 text-gray-500 hover:text-purple-600 rounded-xl transition-all border border-gray-200 hover:border-purple-300 flex-shrink-0"
                      title={isFullScreen ? 'Exit fullscreen' : 'Fullscreen'}
                    >
                      {isFullScreen ? '↙️' : '↗️'}
                    </button>
                  </div>
                </div>

                {/* 2. Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto pr-2 space-y-6 light-scrollbar pb-10">
                  
                  {/* Guideline Filter Dropdown */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-600 mb-2">Filter by Guideline Folder</label>
                    <select
                      value={filterGuideline}
                      onChange={(e) => setFilterGuideline(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500/30 text-sm font-medium"
                    >
                      <option value="all">All Guidelines ({selectedReport.findings?.length || 0})</option>
                      {folders.filter(f => f.guidelineCount > 0).map(folder => {
                        const folderFindings = (selectedReport.findings || []).filter(f => f.folderName === folder.folderName);
                        return (
                          <option key={folder.folderName} value={folder.folderName}>
                            {folder.folderName} ({folderFindings.length})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Filterable Summary Stats */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Total Checked */}
                    <div className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col justify-between">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Checked</p>
                        <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center">
                          <span className="text-sm">📋</span>
                        </div>
                      </div>
                      <p className="text-3xl font-black text-gray-800">{selectedReport.findings?.length || 0}</p>
                      <p className="text-[10px] text-gray-400 mt-1">clauses analyzed</p>
                    </div>

                    {/* Compliant Filter */}
                    <button
                      onClick={() => setFilterStatus(filterStatus === 'compliant' ? 'all' : 'compliant')}
                      className={`p-5 rounded-2xl border transition-all text-left flex flex-col justify-between shadow-sm ${
                        filterStatus === 'compliant'
                          ? 'bg-emerald-600 border-emerald-600 shadow-emerald-200 shadow-md'
                          : 'bg-white border-gray-200 hover:border-emerald-300 hover:shadow-emerald-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className={`text-[10px] font-black uppercase tracking-widest ${filterStatus === 'compliant' ? 'text-emerald-100' : 'text-emerald-600'}`}>
                          Compliant
                        </p>
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${filterStatus === 'compliant' ? 'bg-emerald-500' : 'bg-emerald-50'}`}>
                          <span className="text-sm">✅</span>
                        </div>
                      </div>
                      <p className={`text-3xl font-black ${filterStatus === 'compliant' ? 'text-white' : 'text-emerald-700'}`}>
                        {selectedReport.compliantCount}
                      </p>
                      <p className={`text-[10px] mt-1 ${filterStatus === 'compliant' ? 'text-emerald-200' : 'text-gray-400'}`}>
                        {Math.round((selectedReport.compliantCount / (selectedReport.findings?.length || 1)) * 100)}% of total
                      </p>
                    </button>

                    {/* Partial Filter */}
                    <button
                      onClick={() => setFilterStatus(filterStatus === 'partial' ? 'all' : 'partial')}
                      className={`p-5 rounded-2xl border transition-all text-left flex flex-col justify-between shadow-sm ${
                        filterStatus === 'partial'
                          ? 'bg-amber-500 border-amber-500 shadow-amber-200 shadow-md'
                          : 'bg-white border-gray-200 hover:border-amber-300 hover:shadow-amber-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className={`text-[10px] font-black uppercase tracking-widest ${filterStatus === 'partial' ? 'text-amber-100' : 'text-amber-600'}`}>
                          Partial
                        </p>
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${filterStatus === 'partial' ? 'bg-amber-400' : 'bg-amber-50'}`}>
                          <span className="text-sm">⚠️</span>
                        </div>
                      </div>
                      <p className={`text-3xl font-black ${filterStatus === 'partial' ? 'text-white' : 'text-amber-700'}`}>
                        {selectedReport.partialCount}
                      </p>
                      <p className={`text-[10px] mt-1 ${filterStatus === 'partial' ? 'text-amber-100' : 'text-gray-400'}`}>
                        {Math.round((selectedReport.partialCount / (selectedReport.findings?.length || 1)) * 100)}% of total
                      </p>
                    </button>

                    {/* Non-Compliant Filter */}
                    <button
                      onClick={() => setFilterStatus(filterStatus === 'non-compliant' ? 'all' : 'non-compliant')}
                      className={`p-5 rounded-2xl border transition-all text-left flex flex-col justify-between shadow-sm ${
                        filterStatus === 'non-compliant'
                          ? 'bg-rose-600 border-rose-600 shadow-rose-200 shadow-md'
                          : 'bg-white border-gray-200 hover:border-rose-300 hover:shadow-rose-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className={`text-[10px] font-black uppercase tracking-widest ${filterStatus === 'non-compliant' ? 'text-rose-100' : 'text-rose-600'}`}>
                          Non-Compliant
                        </p>
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${filterStatus === 'non-compliant' ? 'bg-rose-500' : 'bg-rose-50'}`}>
                          <span className="text-sm">❌</span>
                        </div>
                      </div>
                      <p className={`text-3xl font-black ${filterStatus === 'non-compliant' ? 'text-white' : 'text-rose-700'}`}>
                        {selectedReport.nonCompliantCount}
                      </p>
                      <p className={`text-[10px] mt-1 ${filterStatus === 'non-compliant' ? 'text-rose-200' : 'text-gray-400'}`}>
                        {Math.round((selectedReport.nonCompliantCount / (selectedReport.findings?.length || 1)) * 100)}% of total
                      </p>
                    </button>
                  </div>

                  {/* 3. Compliance Distribution */}
                  <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                      <p className="text-xs font-bold text-gray-700 flex items-center gap-2">
                        Compliance Distribution
                      </p>
                      <p className="text-[10px] text-gray-400 font-semibold">{selectedReport.findings?.length || 0} clauses analyzed</p>
                    </div>
                    {/* Progress bar */}
                    <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden flex border border-gray-200">
                      {selectedReport.compliantCount > 0 && (
                        <div
                          className="bg-emerald-500 h-full transition-all duration-700"
                          style={{ width: `${(selectedReport.compliantCount / (selectedReport.findings?.length || 1)) * 100}%` }}
                        />
                      )}
                      {selectedReport.partialCount > 0 && (
                        <div
                          className="bg-amber-400 h-full transition-all duration-700"
                          style={{ width: `${(selectedReport.partialCount / (selectedReport.findings?.length || 1)) * 100}%` }}
                        />
                      )}
                      {selectedReport.nonCompliantCount > 0 && (
                        <div
                          className="bg-rose-500 h-full transition-all duration-700"
                          style={{ width: `${(selectedReport.nonCompliantCount / (selectedReport.findings?.length || 1)) * 100}%` }}
                        />
                      )}
                    </div>
                    {/* Legend */}
                    <div className="flex flex-wrap gap-4 mt-3">
                      {[
                        { label: 'Compliant', count: selectedReport.compliantCount, color: 'bg-emerald-500' },
                        { label: 'Partial', count: selectedReport.partialCount, color: 'bg-amber-400' },
                        { label: 'Non-Compliant', count: selectedReport.nonCompliantCount, color: 'bg-rose-500' },
                      ].map(item => (
                        <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-gray-500 font-semibold">
                          <div className={`w-2 h-2 rounded-full ${item.color}`} />
                          {item.label} <span className="text-gray-700 font-black">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Selection Summary Bar */}
                  {applicableFindings.size > 0 && (
                    <div className="bg-purple-50 border-2 border-purple-300 rounded-2xl p-5 flex justify-between items-center shadow-md animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center text-white font-black text-lg shadow-md">
                          {applicableFindings.size}
                        </div>
                        <div>
                          <p className="text-purple-700 font-bold text-sm">
                            {applicableFindings.size} finding{applicableFindings.size !== 1 ? 's' : ''} selected
                          </p>
                          <p className="text-purple-600 text-xs">
                            Ready to generate compiled SOP text
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setApplicableFindings(new Set())}
                          className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-all border border-gray-200"
                        >
                          Clear Selection
                        </button>
                        <button
                          onClick={submitApplicableFindings}
                          disabled={submittingApplicable}
                          className="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-sm font-bold uppercase tracking-wider shadow-lg hover:shadow-purple-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {submittingApplicable ? (
                            <>
                              <span className="animate-spin">⏳</span>
                              <span>Processing...</span>
                            </>
                          ) : (
                            <>
                              <span>📝</span>
                              <span>Generate Compiled SOP Text</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Detailed Findings Header */}
                  <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-gray-100 bg-white flex flex-col gap-3 sticky top-0 z-10">
                      {/* Row 1: title + clear filter */}
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-3">
                          <span className="text-xl">📔</span>
                          Findings with Guideline References
                          {filterStatus !== 'all' && (
                            <span className="text-[10px] font-black text-white px-2.5 py-1 bg-purple-600 rounded-md uppercase tracking-[0.2em]">
                              {filterStatus}
                            </span>
                          )}
                        </h3>
                        {filterStatus !== 'all' && (
                          <button
                            onClick={() => setFilterStatus('all')}
                            className="text-xs font-medium text-purple-600 hover:text-purple-700 hover:underline"
                          >
                            Clear Filters
                          </button>
                        )}
                      </div>

                      {/* Row 2: Select All + Generate Summary */}
                      <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
                        <button
                          onClick={toggleSelectAllFindings}
                          className="flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors"
                        >
                          {allFindingsSelected ? (
                            <CheckSquare className="h-5 w-5 text-purple-600" />
                          ) : someFindingsSelected ? (
                            <div className="h-5 w-5 rounded border-2 border-purple-500 bg-purple-100 flex items-center justify-center">
                              <div className="h-2 w-2 bg-purple-600 rounded-sm" />
                            </div>
                          ) : (
                            <Square className="h-5 w-5 text-gray-400" />
                          )}
                          {allFindingsSelected ? 'Deselect All' : 'Select All Results'}
                          {someFindingsSelected && (
                            <span className="ml-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-bold rounded-full border border-purple-200">
                              {selectedFindingIds.size} selected
                            </span>
                          )}
                        </button>

                        <button
                          onClick={() => setShowConsolidatedSummary(true)}
                          disabled={selectedFindingIds.size === 0}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                            selectedFindingIds.size > 0
                              ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-md shadow-purple-200'
                              : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                          }`}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Generate Consolidated Summary
                          {selectedFindingIds.size > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 bg-white/30 rounded text-[10px]">{selectedFindingIds.size}</span>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="p-5 space-y-4 bg-gray-50/50 min-h-[400px]">
                      {selectedReport.findings && selectedReport.findings.length > 0
                        ? visibleFindings.map(({ f: finding, i: globalIdx }) => {
                            const isSelected = selectedFindingIds.has(globalIdx);
                            return (
                              <div key={globalIdx} className="relative transition-all duration-300">
                                {/* Selection checkbox */}
                                <div className="absolute -left-2 top-5 z-10">
                                  <button
                                    onClick={() => toggleFindingSelect(globalIdx)}
                                    className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all shadow-sm ${
                                      isSelected
                                        ? 'bg-purple-600 border-purple-500'
                                        : 'bg-white border-gray-300 hover:border-purple-400'
                                    }`}
                                    title={isSelected ? 'Deselect' : 'Select for summary'}
                                  >
                                    {isSelected && <CheckSquare className="h-3.5 w-3.5 text-white" />}
                                  </button>
                                </div>
                                {/* Highlight ring when selected */}
                                <div className={`transition-all duration-200 rounded-2xl ${
                                  isSelected ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-gray-50' : ''
                                }`}>
                                  <FindingCard
                                    id={`finding-${globalIdx}`}
                                    requirement={finding.guidelineRequirement || finding.clauseText || ''}
                                    gap={finding.mismatchExplanation || finding.highlightedIssue || ''}
                                    impact={finding.highlightedIssue || 'Impact not specified'}
                                    suggestion={finding.suggestedAction || ''}
                                    reference={`${finding.folderName} → ${finding.guidelineName}`}
                                    clauseNumber={finding.clauseNumber}
                                    clauseTitle={finding.clauseTitle || ''}
                                    clauseText={finding.clauseText || ''}
                                    guidelineName={finding.guidelineName || ''}
                                    folderName={finding.folderName || ''}
                                    pdfName={finding.pdfName || ''}
                                    severity={finding.issueSeverity || (finding.criticality === 'critical' || finding.criticality === 'high' ? 'major' : 'minor')}
                                    status={finding.complianceLevel}
                                    confidence={finding.matchConfidence || 0}
                                    sopSection={finding.sopSectionAffected?.split(' - ')[0] || 'N/A'}
                                    sopTextSnippet={finding.sopTextSnippet || ''}
                                    suggestedText={finding.suggestedText || ''}
                                    onToggleApplicable={handleToggleApplicable}
                                    isApplicable={applicableFindings.has(`finding-${globalIdx}`)}
                                  />
                                </div>
                              </div>
                            );
                          })
                        : (
                          <div className="text-center py-20 text-gray-400">
                            <p>No findings found.</p>
                          </div>
                        )
                      }

                      {visibleFindings.length === 0 && selectedReport.findings && selectedReport.findings.length > 0 && (
                        <div className="text-center py-20">
                          <p className="text-gray-400 mb-2">No findings match the current filters</p>
                          <div className="flex gap-2 justify-center mt-3">
                            {filterStatus !== 'all' && (
                              <button
                                onClick={() => setFilterStatus('all')}
                                className="text-purple-400 font-medium hover:text-purple-300 hover:underline text-sm"
                              >
                                Clear Status Filter
                              </button>
                            )}
                            {filterGuideline !== 'all' && (
                              <button
                                onClick={() => setFilterGuideline('all')}
                                className="text-purple-400 font-medium hover:text-purple-300 hover:underline text-sm"
                              >
                                Clear Guideline Filter
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Consolidated Summary Modal ─────────────────────────────────────── */}
      {showConsolidatedSummary && (
        <div className={`fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-all duration-300 ${isSummaryFullScreen ? 'p-0' : 'p-4 pt-12'}`}>
          <div className={`bg-white border border-gray-200 shadow-2xl flex flex-col transition-all duration-300 ${
            isSummaryFullScreen
              ? 'fixed inset-0 w-screen h-screen rounded-none'
              : 'w-full max-w-4xl max-h-[85vh] rounded-2xl'
          }`}>
            {/* Header */}
            <div className={`flex flex-shrink-0 items-center justify-between px-6 py-4 border-b border-gray-100 bg-purple-50 ${isSummaryFullScreen ? '' : 'rounded-t-2xl'}`}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-xl">
                  <Sparkles className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">Consolidated Compliance Summary</h2>
                  <p className="text-xs text-gray-500">
                    {consolidatedSections.length} section{consolidatedSections.length !== 1 ? 's' : ''} • {selectedFindingIds.size} findings merged
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsSummaryFullScreen(!isSummaryFullScreen)}
                  className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition-all mr-2"
                  title={isSummaryFullScreen ? "Exit Full Screen" : "Full Screen"}
                >
                  {isSummaryFullScreen
                    ? <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    : <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                  }
                </button>

                <button
                  onClick={() => {
                    const lines: string[] = [
                      `CONSOLIDATED COMPLIANCE SUMMARY — ${selectedReport?.sopName || ''}`,
                      `Generated: ${new Date().toLocaleString()}`,
                      `Sections: ${consolidatedSections.length} | Findings: ${selectedFindingIds.size}`,
                      '', '═'.repeat(60), ''
                    ];
                    consolidatedSections.forEach((sec, i) => {
                      lines.push(`SECTION ${sec.sectionKey}${sec.isMulti ? ` (${sec.findings.length} changes combined)` : ''}`);
                      lines.push(`Sources: ${sec.sources.join(', ')}`);
                      if (sec.clauses.length) lines.push(`Clauses: ${sec.clauses.join(', ')}`);
                      lines.push(''); lines.push(sec.combinedAction);
                      if (sec.combinedSuggestion) { lines.push(''); lines.push('PROPOSED VERBIAGE:'); lines.push(sec.combinedSuggestion); }
                      if (i < consolidatedSections.length - 1) { lines.push(''); lines.push('─'.repeat(60)); lines.push(''); }
                    });
                    navigator.clipboard.writeText(lines.join('\n'));
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-all"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy All
                </button>
                <button
                  onClick={() => setShowConsolidatedSummary(false)}
                  className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Sections */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1 bg-gray-50">
              {consolidatedSections.map((sec) => (
                <ConsolidatedSectionCard key={sec.sectionKey} sec={sec} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
