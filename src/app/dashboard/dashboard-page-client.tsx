"use client";
import {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
  type ChangeEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  User,
  LogOut,
  Shield,
  Search,
  Plus,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Upload,
  Languages,
  BookOpen,
  BarChart2,
  Download,
  Archive,
  X,
  Trash2,
  SlidersHorizontal,
  RefreshCw,
  CheckCircle2,
  Clock,
  Loader2,
  Film,
} from "lucide-react";


import DepartmentCapsules, {
  type CapsuleFilterMode,
  type CapsuleAvailMetric,
} from "./components/DepartmentCapsules";
import DashboardCharts from "./components/DashboardCharts";
import SOPTable from "./components/SOPTable";
import DepartmentStatsModal from "./components/DepartmentStatsModal";
import UploadSOPModal, {
  type UploadSOPModalTab,
  type UploadedSOPRef,
} from "./components/UploadSOPModal";
import UploadPDFModal from "./components/UploadPDFModal";
import SOPFolderUploadModal from "./components/SOPFolderUploadModal";
import VideoUploadModal from "@/app/training-content/components/VideoUploadModal";
import PipelineProgressDock from "./components/PipelineProgressDock";
import { usePipelineTracker } from "./hooks/usePipelineTracker";
import SupersededVersionsPanel from "./components/SupersededVersionsPanel";
import GuidelinesComplianceWizard from "./components/GuidelinesComplianceWizard";
import GuidelinesResultPanel, {
  type ComplianceResult,
} from "./components/GuidelinesResultPanel";
import ComplianceFullViewer from "./components/ComplianceFullViewer";
import Link from "next/link";
import {
  countRowDocxPdfAttached,
  countRowDocxPdfForCapsules,
  expectedDocxSlotsForRow,
  expectedPdfSlotsForRow,
  scanRowLanguageFileSlots,
} from "@/lib/registryRowDocCounts";
import { filterPrimaryRegistryRowsUniqueByFamily } from "@/lib/registryPrimaryRows";
import { resolveRowCapsuleDept } from "@/lib/capsuleDepartments";
import {
  classifySopVersionCapsule,
  classifySopVersionPerLangFormat,
  type SopVersionFilterSegment,
} from "@/lib/sopVersionCapsuleClassify";
import { countVersionDatesPerLang } from "@/lib/sopVersionDateClassify";
import { normalizeSopIdentifierKey } from "@/lib/sopIdentifierNormalize";
import { detectMissingCategory, buildMissingExportRows } from "@/lib/missingExportRows";

export default function DashboardPageClient() {
  const router = useRouter();

  // Data State
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingLatest, setRefreshingLatest] = useState(false);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadModalTab, setUploadModalTab] =
    useState<UploadSOPModalTab>("english");
  const [showPdfUploadModal, setShowPdfUploadModal] = useState(false);
  const [showSOPFolderUploadModal, setShowSOPFolderUploadModal] =
    useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showTrainingVideoModal, setShowTrainingVideoModal] = useState(false);
  const { tracked: trackedPipelines, trackUpload, trackMany, untrack } = usePipelineTracker();
  const [recheckingFiles, setRecheckingFiles] = useState(false);
  const [fileAvailability, setFileAvailability] = useState<Record<string, boolean> | null>(null);
  const [recheckSummary, setRecheckSummary] = useState<{ checked: number; found: number; notFound: number; dbCleared: number; notFoundPaths?: string[] } | null>(null);
  const [showRecheckPanel, setShowRecheckPanel] = useState(false);
  const [clearingFileLinks, setClearingFileLinks] = useState(false);
  const searchParams = useSearchParams();
  const [migrateBunnyState, setMigrateBunnyState] = useState<
    | { status: 'idle' }
    | { status: 'checking'; localCount: number | null }
    | { status: 'running' }
    | { status: 'done'; migrated: number; skipped: number; failed: number; total: number }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  /** API metadata from `/api/dashboard/sops` (not shown in UI; avoids stale `setDashboardMeta` reference errors). */
  const [, setDashboardMeta] = useState<Record<string, unknown> | null>(null);
  // Global SOP video stats
  const [sopsWithVideos, setSopsWithVideos] = useState(0);
  const [sopsWithoutVideos, setSopsWithoutVideos] = useState(0);
  const [sopsWithBrief, setSopsWithBrief] = useState(0);
  const [sopsWithoutBrief, setSopsWithoutBrief] = useState(0);
  const [sopsWithExplainer, setSopsWithExplainer] = useState(0);
  const [sopsWithoutExplainer, setSopsWithoutExplainer] = useState(0);
  // User State
  const [user, setUser] = useState<any>(null);

  // Filters State
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<
    "all" | "sopNo" | "sopName" | "department" | "location"
  >("all");
  const [filterDept, setFilterDept] = useState("All");
  const [filterMedia, setFilterMedia] = useState<string>("all");
  const [filterExpiry, setFilterExpiry] = useState("all");
  const [filterDualLang, setFilterDualLang] = useState(false);
  const [filterFileType, setFilterFileType] = useState<
    "all" | "DOCX" | "NO_DOCX" | "PDF" | "NO_PDF"
  >("all");
  const [filterLanguage, setFilterLanguage] = useState<"all" | "ENG" | "GUJ" | "BOTH">(
    "all",
  );
  const [filterAbsoluteSop, setFilterAbsoluteSop] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterVersionStatus, setFilterVersionStatus] = useState<
    "all" | SopVersionFilterSegment
  >("all");
  const [filterVersionDateStatus, setFilterVersionDateStatus] = useState<
    "all" | "dateFoundv" | "dateNotFoundv"
  >("all");
  const [sortConfig, setSortConfig] = useState({
    key: "sopNo",
    direction: "asc",
  });
  // When true, show charts full-width; when false, show capsules full-width
  const [showCharts, setShowCharts] = useState(false);
  const [showCapsules, setShowCapsules] = useState(true);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [showGuidelinesLibrary, setShowGuidelinesLibrary] = useState(false);
  const [wizardMinimized, setWizardMinimized] = useState(false);
  const [guidelinesWizardPreset, setGuidelinesWizardPreset] = useState<{
    _id: string;
    sopNo: string;
  } | null>(null);
  // keyed by sopNo — stores the last compliance result per SOP row
  const [complianceCache, setComplianceCache] = useState<
    Record<string, ComplianceResult>
  >({});
  // sopNos currently being analyzed in background
  const [reviewingInBackground, setReviewingInBackground] = useState<
    Set<string>
  >(new Set());
  // start timestamps keyed by sopNo
  const [analysisStartTimes, setAnalysisStartTimes] = useState<Record<string, number>>({});
  // elapsed seconds keyed by sopNo (updated by interval)
  const [analysisElapsedMap, setAnalysisElapsedMap] = useState<Record<string, number>>({});
  // completion toasts: { sopNo, findingsCount, at }
  const [completionToasts, setCompletionToasts] = useState<{ sopNo: string; findingsCount: number; at: number }[]>([]);

  // Pre-fetched guidelines list (loaded once on mount so wizard opens instantly)
  const [prefetchedGuidelines, setPrefetchedGuidelines] = useState<any[] | null>(null);


  // Obsolete SOPs filter (shows in main registry table)
  const [filterObsolete, setFilterObsolete] = useState(false);
  const [registrySearchOpen, setRegistrySearchOpen] = useState(false);
  const [obsoleteList, setObsoleteList] = useState<any[]>([]);
  const [obsoleteListLoading, setObsoleteListLoading] = useState(false);
  const [removingObsoleteId, setRemovingObsoleteId] = useState<string | null>(null);
  const [showObsoleteDetails, setShowObsoleteDetails] = useState(false);

  // Filter panel state
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [panelFilterLocation, setPanelFilterLocation] = useState<string[]>([]);
  const [panelFilterVersion, setPanelFilterVersion] = useState<string[]>([]);
  const [panelFilterLanguage, setPanelFilterLanguage] = useState<string[]>([]);
  const [panelFilterDateFrom, setPanelFilterDateFrom] = useState("");
  const [panelFilterDateTo, setPanelFilterDateTo] = useState("");
  const [panelOpenSections, setPanelOpenSections] = useState<Record<string, boolean>>({
    location: false,
    version: false,
    language: false,
    date: false,
  });
  // which sopNo result panel is currently open (old side-panel)
  const [viewingComplianceSopNo, setViewingComplianceSopNo] = useState<
    string | null
  >(null);
  // which sopNo is open in the new full-screen viewer
  const [viewingComplianceFullSopNo, setViewingComplianceFullSopNo] = useState<
    string | null
  >(null);
  const [viewingComplianceFilter, setViewingComplianceFilter] = useState<{
    status: 'all' | 'compliant' | 'partial' | 'non-compliant' | 'not-applicable';
    severity: 'all' | 'critical' | 'major' | 'minor' | 'informational';
  }>({ status: 'all', severity: 'all' });
  const [resetFiltersTrigger, setResetFiltersTrigger] = useState(0);

  const handleComplianceResult = useCallback(
    (sopNo: string, sopName: string, result: any) => {
      const entry = {
        sopNo,
        sopName,
        findings: Array.isArray(result.findings) ? result.findings : [],
        overallScore: result.overallScore ?? 0,
        clausesAnalyzed: result.clausesAnalyzed ?? 0,
        guidelineDocumentsUsed: result.guidelineDocumentsUsed ?? 0,
        runAt: new Date().toISOString(),
      };
      setComplianceCache((prev) => {
        const next = { ...prev, [sopNo]: entry };
        // Persist to sessionStorage so refresh keeps the result
        try {
          sessionStorage.setItem('dashboard_compliance_cache', JSON.stringify({ data: next, cachedAt: Date.now() }));
        } catch { /* ignore */ }
        return next;
      });
      // Remove from background tracking
      setReviewingInBackground((prev) => {
        const next = new Set(prev);
        next.delete(sopNo);
        return next;
      });
      // Show completion toast
      const findingsCount = Array.isArray(result.findings) ? result.findings.length : 0;
      setCompletionToasts((prev) => [...prev, { sopNo, findingsCount, at: Date.now() }]);
      // Auto-dismiss toast after 8 seconds
      setTimeout(() => {
        setCompletionToasts((prev) => prev.filter((t) => t.sopNo !== sopNo));
      }, 8000);
      // Auto-open the full viewer after a new run
      setShowGuidelinesLibrary(false);
      setWizardMinimized(false);
      setViewingComplianceFilter({ status: 'all', severity: 'all' });
      setViewingComplianceFullSopNo(sopNo);
    },
    [],
  );

  const sopRegistryRef = useRef<HTMLDivElement | null>(null);

  // ── Tick elapsed timers for background analyses ──────────────────────────
  useEffect(() => {
    if (reviewingInBackground.size === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setAnalysisElapsedMap((prev) => {
        const next = { ...prev };
        for (const sopNo of reviewingInBackground) {
          const start = analysisStartTimes[sopNo];
          if (start) next[sopNo] = Math.floor((now - start) / 1000);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [reviewingInBackground, analysisStartTimes]);

  // ── Pre-fetch guidelines on mount so wizard opens instantly ─────────────
  useEffect(() => {
    const CACHE_KEY = 'guidelines_list_cache';
    // Serve from localStorage first (5 min TTL)
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { data, timestamp } = JSON.parse(raw);
        if (Date.now() - timestamp < 5 * 60 * 1000 && Array.isArray(data)) {
          setPrefetchedGuidelines(data);
          return; // still refresh in background below
        }
      }
    } catch { /* ignore */ }

    // Fetch from server
    fetch('/api/guidelines/upload?summary=true')
      .then((r) => r.json())
      .then((j) => {
        if (j.success && Array.isArray(j.guidelines)) {
          setPrefetchedGuidelines(j.guidelines);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ data: j.guidelines, timestamp: Date.now() }));
          } catch { /* quota */ }
        }
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  // ── Fetch global SOP video stats ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then((r) => r.json())
      .then((j) => {
        if (j.success && j.stats) {
          setSopsWithVideos(j.stats.sopsWithVideos ?? 0);
          setSopsWithoutVideos(j.stats.sopsWithoutVideos ?? 0);
          setSopsWithBrief(j.stats.sopsWithBrief ?? 0);
          setSopsWithoutBrief(j.stats.sopsWithoutBrief ?? 0);
          setSopsWithExplainer(j.stats.sopsWithExplainer ?? 0);
          setSopsWithoutExplainer(j.stats.sopsWithoutExplainer ?? 0);
        }
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  // ── Load persisted compliance results on mount (shuttle pre-load) ────────────
  const COMPLIANCE_CACHE_KEY = 'dashboard_compliance_cache_v2';
  const COMPLIANCE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  useEffect(() => {
    let cancelled = false;

    // Try sessionStorage first to avoid re-fetching on every navigation
    try {
      const raw = sessionStorage.getItem(COMPLIANCE_CACHE_KEY);
      if (raw) {
        const { data: cachedData, cachedAt } = JSON.parse(raw);
        // Invalidate cache if all entries have empty findings (stale pre-fix data)
        const hasAnyFindings = cachedData && Object.values(cachedData).some(
          (r: any) => Array.isArray(r?.findings) && r.findings.length > 0
        );
        if (cachedData && !hasAnyFindings) {
          sessionStorage.removeItem(COMPLIANCE_CACHE_KEY);
        }
        if (Date.now() - cachedAt < COMPLIANCE_CACHE_TTL && cachedData && hasAnyFindings) {
          setComplianceCache(cachedData);
          // If cache is very fresh (< 2 min), skip background refresh (avoids refetch on navigation)
          const SKIP_REFRESH_TTL = 2 * 60 * 1000;
          if (Date.now() - cachedAt < SKIP_REFRESH_TTL) {
            console.log('📦 Dashboard compliance: fresh cache — skipping background refresh');
            setLoading(false);
            return () => { cancelled = true; };
          }
          // Cache is valid but not super fresh — refresh in background after 1s
          setTimeout(() => {
            if (cancelled) return;
            fetch('/api/dashboard/sop-guideline-review?listAll=true', { cache: 'no-store' })
              .then(res => res.json())
              .catch(() => ({ success: false }))
              .then((json) => {
                if (cancelled || !json.success || !Array.isArray(json.results)) return;
                const cache: Record<string, ComplianceResult> = {};
                for (const r of json.results) {
                  cache[r.sopNo] = {
                    sopNo: r.sopNo, sopName: r.sopName || '',
                    findings: Array.isArray(r.findings) ? r.findings : [],
                    overallScore: r.overallScore ?? 0,
                    clausesAnalyzed: r.clausesAnalyzed ?? 0,
                    guidelineDocumentsUsed: r.guidelineDocumentsUsed ?? 0,
                    runAt: r.runAt,
                    ...(r.source ? { source: r.source } : {}),
                  } as any;
                }
                if (!cancelled) {
                  setComplianceCache(cache);
                  try { sessionStorage.setItem(COMPLIANCE_CACHE_KEY, JSON.stringify({ data: cache, cachedAt: Date.now() })); } catch { /* ignore */ }
                }
              });
          }, 1000);
          return () => { cancelled = true; };
        }
      }
    } catch { /* ignore */ }

    // No cache — fetch immediately
    fetch('/api/dashboard/sop-guideline-review?listAll=true', { cache: 'no-store' })
      .then(res => res.json())
      .catch(() => ({ success: false }))
      .then((json) => {
        if (cancelled || !json.success || !Array.isArray(json.results)) return;
        const cache: Record<string, ComplianceResult> = {};
        for (const r of json.results) {
          cache[r.sopNo] = {
            sopNo: r.sopNo,
            sopName: r.sopName || '',
            findings: Array.isArray(r.findings) ? r.findings : [],
            overallScore: r.overallScore ?? 0,
            clausesAnalyzed: r.clausesAnalyzed ?? 0,
            guidelineDocumentsUsed: r.guidelineDocumentsUsed ?? 0,
            runAt: r.runAt,
            ...(r.source ? { source: r.source } : {}),
          } as any;
        }
        setComplianceCache(cache);
        try { sessionStorage.setItem(COMPLIANCE_CACHE_KEY, JSON.stringify({ data: cache, cachedAt: Date.now() })); } catch { /* ignore */ }
      });
    return () => { cancelled = true; };
  }, []);
  const fetchObsoleteList = async () => {
    setObsoleteListLoading(true);
    try {
      const res = await fetch("/api/sop/obsolete-list");
      const j = await res.json();
      if (j.success) setObsoleteList(j.data ?? []);
    } catch { /* ignore */ }
    finally { setObsoleteListLoading(false); }
  };

  const openObsoleteDetails = async () => {
    setShowObsoleteDetails(true);
    if (obsoleteList.length === 0 && !obsoleteListLoading) {
      await fetchObsoleteList();
    }
  };

  const handleToggleObsoleteFilter = () => {
    if (!filterObsolete) {
      setFilterObsolete(true);
      fetchObsoleteList();
    } else {
      setFilterObsolete(false);
    }
  };

  const handleRemoveFromObsolete = async (identifier: string) => {
    if (removingObsoleteId) return;
    const password = window.prompt(`Enter password to restore "${identifier}" from Obsolete:`);
    if (!password) return;
    setRemovingObsoleteId(identifier);
    try {
      const res = await fetch("/api/sop/remove-obsolete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sopIdentifier: identifier, password }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        window.alert(j.error || "Failed to restore SOP");
        return;
      }
      setObsoleteList(prev => prev.filter(x => x.identifier !== identifier));
      setFilterObsolete(false);
      setLoading(true);
      setRefreshKey(k => k + 1);
    } catch {
      window.alert("Network error — please try again");
    } finally {
      setRemovingObsoleteId(null);
    }
  };

  const [locationImportBusy, setLocationImportBusy] = useState(false);

  const LOCATION_XLSX_INPUT_ID = "dashboard-sop-location-xlsx";

  // Canonical Dashboard view: one row per SOP family. If the same SOP exists in the
  // registry under multiple revisions, only the latest revision is shown, so the
  // total count matches the MCQ Bank page's "Unique SOPs" value.
  const primaryRegistryData = useMemo(
    () => filterPrimaryRegistryRowsUniqueByFamily(data),
    [data],
  );

  const effectiveData = data;

  // Cache keys and TTLs (defined outside useEffect for consistency)
  const SESSION_KEY = "dashboard_sops_cache";
  const LOCAL_KEY = "dashboard_sops_cache_persistent";
  const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const LOCAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /** Set to true by `triggerRefresh(true)` so the next fetch hits the server with `?refresh=1`. */
  const [forceServerRefresh, setForceServerRefresh] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem("user");
    if (!userData) {
      setTimeout(() => router.push("/login"), 0);
      return;
    }
    try {
      setUser(JSON.parse(userData));
    } catch {
      localStorage.removeItem("user");
      setTimeout(() => router.push("/login"), 0);
      return;
    }

    // --- Multi-tier client-side cache (sessionStorage → localStorage → network) ---
    // Tier 1: sessionStorage (5 min TTL) — freshest, skip network when valid
    // Tier 2: localStorage (24 hour TTL) — stale but shown instantly, then refreshed
    // Tier 3: Network fetch — when no cache is valid

    /** Hard bypass when URL asks for refresh=1, OR when a mutation (upload) requested a hard refresh. */
    const forceFresh = searchParams.get("refresh") === "1" || forceServerRefresh;
    /**
     * Soft revalidate after local mutations/uploads:
     * show cached data instantly, then fetch latest in background.
     */
    const shouldRevalidate = refreshKey > 0 || forceFresh;

    let hadImmediateCache = false;
    if (!forceFresh) {
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        if (raw) {
          const { data: cachedData, meta, cachedAt } = JSON.parse(raw);
          if (Date.now() - cachedAt <= LOCAL_TTL_MS) {
            console.log('💾 Dashboard: localStorage cache — showing stale, will refresh');
            setData(cachedData ?? []);
            setDashboardMeta(meta ?? null);
            setLoading(false);
            hadImmediateCache = true;
          }
        }
      } catch { /* ignore */ }
    }


    // ── Tier 1: sessionStorage (freshest — skip network entirely if valid) ──
    if (!forceFresh) {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (raw) {
          const { data: cachedData, meta, cachedAt } = JSON.parse(raw);
          if (Date.now() - cachedAt <= SESSION_TTL_MS) {
            console.log('📦 Dashboard: fresh sessionStorage cache');
            setData(cachedData ?? []);
            setDashboardMeta(meta ?? null);
            setLoading(false);
            hadImmediateCache = true;
            if (!shouldRevalidate) return; // skip network only when no revalidate requested
          }
        }
      } catch { /* ignore */ }
    }

    // ── Tier 2: localStorage (stale data shown instantly, then background refresh) ──

    // ── Tier 3: Network fetch ──
    const fetchData = async () => {
      // Only show the full-page spinner when there is no cached data to display.
      if (!hadImmediateCache) setLoading(true);
      setRefreshingLatest(hadImmediateCache);
      try {
        const sopRes = await fetch(
          `/api/dashboard/sops${forceFresh ? "?refresh=1" : ""}`,
          {
            cache: "no-store",
          },
        );
        if (!sopRes.ok) {
          console.error("Failed to fetch SOPs", sopRes.status);
          return;
        }
        const sopsJ = await sopRes.json();

        if (sopsJ.success) {
          const rawData = sopsJ.data ?? [];
          setData(rawData);
          setDashboardMeta((sopsJ.metadata as Record<string, unknown>) ?? null);
          // Persist fresh result to both caches
          const cachePayload = JSON.stringify({ data: rawData, meta: sopsJ.metadata ?? null, cachedAt: Date.now() });
          try {
            sessionStorage.setItem(SESSION_KEY, cachePayload);
          } catch { /* quota exceeded — ignore */ }
          try {
            localStorage.setItem(LOCAL_KEY, cachePayload);
          } catch { /* quota exceeded — ignore */ }
        }
      } catch (e) {
        console.error("Failed to fetch", e);
      } finally {
        setLoading(false);
        setRefreshingLatest(false);
        // One-shot: clear the hard-refresh flag now that the bust has been issued.
        if (forceServerRefresh) setForceServerRefresh(false);
      }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, forceServerRefresh]);

  const handleLogout = () => {
    localStorage.removeItem("user");
    router.push("/login");
  };

  /**
   * Soft-refresh dashboard data:
   * keep cached UI visible and revalidate in background for faster UX.
   * Pass `hard=true` after mutations (uploads, version fetches) so the server-side
   * 5-min cache for `/api/dashboard/sops` is bypassed and client caches are cleared —
   * otherwise the dashboard keeps showing stale Versions / DOCX / PDF counts.
   */
  const triggerRefresh = useCallback(async (hard: boolean = false) => {
    if (hard) {
      try { sessionStorage.removeItem('dashboard_sops_cache'); } catch { /* ignore */ }
      try { localStorage.removeItem('dashboard_sops_cache_persistent'); } catch { /* ignore */ }
      setForceServerRefresh(true);
    }
    setRefreshKey((k) => k + 1);
  }, []);

  const handleRecheckFiles = async () => {
    setRecheckingFiles(true);
    setRecheckSummary(null);
    setShowRecheckPanel(true);

    try {
      const res = await fetch('/api/dashboard/recheck-files', {
        method: 'POST',
        cache: 'no-store',
      });
      const json = await res.json();

      if (!json.success) throw new Error(json.error || 'Recheck failed');

      // Update availability overlay so table immediately marks missing files
      setFileAvailability(json.availability ?? {});
      setRecheckSummary({
        checked: json.checked ?? 0,
        found: json.found ?? 0,
        notFound: json.notFound ?? 0,
        dbCleared: json.dbCleared ?? 0,
        notFoundPaths: json.notFoundPaths ?? [],
      });

      // Always do a full data refresh so DB changes are reflected in the table
      try { sessionStorage.removeItem('dashboard_sops_cache'); } catch { /* ignore */ }
      try { localStorage.removeItem('dashboard_sops_cache_persistent'); } catch { /* ignore */ }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error('[recheck-files]', e);
      setRecheckSummary({ checked: 0, found: 0, notFound: 0, dbCleared: 0, notFoundPaths: [] });
      window.alert('Recheck failed: ' + String(e));
    } finally {
      setRecheckingFiles(false);
    }
  };

  const handleClearAllFileLinks = async () => {
    if (!window.confirm('This will clear ALL file URLs from the database (SOP, library, version artifacts). Only do this if you have already deleted the files from Bunny. Continue?')) return;
    setClearingFileLinks(true);
    try {
      const res = await fetch('/api/dashboard/clear-all-file-links', { method: 'POST', cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      const { cleared } = json;
      window.alert(`Done. Cleared:\n• ${cleared.sops} SOP file URLs\n• ${cleared.sopLibraryDocs} library documents\n• ${cleared.versionArtifacts} version artifact paths\n• ${cleared.superseded} superseded paths`);
      try { sessionStorage.removeItem('dashboard_sops_cache'); } catch { /* ignore */ }
      try { localStorage.removeItem('dashboard_sops_cache_persistent'); } catch { /* ignore */ }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      window.alert('Clear failed: ' + String(e));
    } finally {
      setClearingFileLinks(false);
    }
  };

  const handleMigrateToBunny = async () => {
    // Step 1: dry-run check
    setMigrateBunnyState({ status: 'checking', localCount: null });
    try {
      const dryRes = await fetch('/api/admin/migrate-to-bunny?dry=1');
      const dryData = await dryRes.json();
      const localCount = dryData.localPathCount ?? 0;
      if (localCount === 0) {
        setMigrateBunnyState({ status: 'done', migrated: 0, skipped: 0, failed: 0, total: 0 });
        return;
      }
      setMigrateBunnyState({ status: 'checking', localCount });
    } catch {
      setMigrateBunnyState({ status: 'error', message: 'Failed to check local files.' });
      return;
    }
  };

  const handleMigrateToBunnyConfirm = async () => {
    setMigrateBunnyState({ status: 'running' });
    try {
      const res = await fetch('/api/admin/migrate-to-bunny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Migration failed');
      setMigrateBunnyState({
        status: 'done',
        migrated: data.migrated ?? 0,
        skipped: data.skipped ?? 0,
        failed: data.failed ?? 0,
        total: data.total ?? 0,
      });
    } catch (err) {
      setMigrateBunnyState({ status: 'error', message: err instanceof Error ? err.message : 'Migration failed.' });
    }
  };

  const handleLocationExcelChange = async (
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLocationImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/sop/registry-locations", {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        window.alert(
          j.error ||
          `Import failed (${res.status}). Use your site Excel (DP No. + SOP No.) or a simple SOP NO + LOCATION sheet.`,
        );
        return;
      }
      triggerRefresh();
      window.alert(j.message || `Imported ${j.rowsProcessed ?? 0} row(s).`);
    } catch {
      window.alert("Could not import locations");
    } finally {
      setLocationImportBusy(false);
    }
  };

  const handleSort = (key: any) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc")
      direction = "desc";
    setSortConfig({ key, direction });
  };

  // Shape obsolete list into SOPTable-compatible rows
  const obsoleteTableRows = useMemo(() =>
    obsoleteList.map((item: any) => ({
      _id: item.identifier,
      sopNo: item.identifier,
      sopName: item.englishName || item.gujaratiName || item.identifier,
      englishName: item.englishName || "",
      gujaratiName: item.gujaratiName || "",
      department: item.department || "Other",
      language: item.language || "English",
      isDualLanguage: item.isDualLanguage || false,
      englishVersion: item.englishVersion || false,
      gujaratiVersion: item.gujaratiVersion || false,
      gujaratiFileMissing: item.gujaratiFileMissing || false,
      location: item.location || null,
      expiryDate: item.expiryDate || null,
      version: item.version || null,
      sopFile: item.sopFile || null,
      sopDocuments: item.sopDocuments || [],
      mediaStatus: { videoCount: 0, slideCount: 0, videos: false, slides: false, videoRequired: 0, slideRequired: 0, videoAvailable: 0, slideAvailable: 0 },
      versionArtifacts: [],
      versionArtifactsGujarati: [],
      previousVersionsStatus: [],
      obsoleteAt: item.obsoleteAt || item.archivedAt || null,
      fromRegistry: item.fromRegistry || false,
      isObsolete: true,
    })),
    [obsoleteList],
  );

  // Compute unique values for filter panel
  const uniqueLocations = useMemo(
    () =>
      [
        ...new Set(
          primaryRegistryData
            .map((r: any) => r.location)
            .filter((l: any) => l),
        ),
      ]
        .sort()
        .map(String),
    [primaryRegistryData],
  );

  const uniqueVersions = useMemo(
    () =>
      [
        ...new Set(
          primaryRegistryData
            .map((r: any) => r.version ?? null)
            .filter((v: any) => v != null),
        ),
      ]
        .sort((a: any, b: any) => Number(b) - Number(a))
        .map(String),
    [primaryRegistryData],
  );

  const uniqueLanguagesPanel = useMemo(
    () =>
      [
        ...new Set(
          primaryRegistryData.map((r: any) => {
            if (r.isDualLanguage) return "ENG/GUJ";
            if (r.gujaratiFileMissing) return "ENG (GUJ missing)";
            return r.language === "Gujarati" ? "GUJ" : "ENG";
          }),
        ),
      ].sort(),
    [primaryRegistryData],
  );

  // The perfect sorting & filtering logic
  const filteredAndSortedData = useMemo(() => {
    // One row per SOP family (latest revision only). Matches the capsule counts —
    // both capsules and this table ultimately reduce to the same per-family set,
    // so the "Total" capsule always equals the number of rows in this table.
    let result = filterPrimaryRegistryRowsUniqueByFamily(effectiveData);

    if (search) {
      const s = search.toLowerCase();
      result = result.filter((d: any) => {
        const fields = {
          sopNo: (d.sopNo || "").toLowerCase(),
          sopName:
            `${d.sopName || ""} ${d.englishName || ""} ${d.gujaratiName || ""}`.toLowerCase(),
          department: (d.department || "").toLowerCase(),
          location: String(d.location || "").toLowerCase(),
        };
        if (searchField === "all") {
          return (
            fields.sopNo.includes(s) ||
            fields.sopName.includes(s) ||
            fields.department.includes(s) ||
            fields.location.includes(s)
          );
        }
        return fields[searchField].includes(s);
      });
    }

    // Filter Department — use the same normalize + sopNo-prefix inference the
    // capsule uses, so the table filter and capsule counts always agree
    // (otherwise rows tagged "Other"/with prefix-mapped depts diverge).
    if (filterDept !== "All") {
      result = result.filter((d: any) => resolveRowCapsuleDept(d) === filterDept);
    }

    // Dual-language: match capsule "Dual" — rows that expect two EN+GU document slots (same as expectedDocxSlotsForRow === 2)
    if (filterDualLang) {
      result = result.filter((d: any) => expectedDocxSlotsForRow(d) >= 2);
    }

    // Filter File Type — Found vs Missing are MUTUALLY EXCLUSIVE per row:
    //   • Main DOCX/PDF "Found"  = rows with ALL expected slots filled (dual rows
    //     need both EN+GU). A half-covered dual row is NOT Found.
    //   • Main DOCX/PDF "Missing"= rows missing ≥1 expected slot (includes
    //     half-covered dual rows).
    //   • When [EN]/[GJ] is co-active, found/missing apply to THAT language's slot only.
    // (Note: the slot-level badge total can still be more than the row count returned
    // here, because each row contributes 1–2 slots to the badge.)
    // SKIP this filter when a version status filter is active — in that case the
    // DOCX/PDF setting is just a format scope for the version classifier (the
    // capsule version count uses only the classifier, not slot presence).
    if (filterFileType === "DOCX" && filterVersionStatus === "all") {
      result = result.filter((d: any) => {
        const slots = scanRowLanguageFileSlots(d);
        if (filterLanguage === "ENG") return slots.engDocx;
        if (filterLanguage === "GUJ") return slots.gujDocx;
        return countRowDocxPdfForCapsules(d).docx >= expectedDocxSlotsForRow(d);
      });
    } else if (filterFileType === "NO_DOCX" && filterVersionStatus === "all") {
      result = result.filter((d: any) => {
        const slots = scanRowLanguageFileSlots(d);
        if (filterLanguage === "ENG") return !slots.engDocx;
        if (filterLanguage === "GUJ") return !slots.gujDocx;
        return countRowDocxPdfForCapsules(d).docx < expectedDocxSlotsForRow(d);
      });
    } else if (filterFileType === "PDF" && filterVersionStatus === "all") {
      result = result.filter((d: any) => {
        const slots = scanRowLanguageFileSlots(d);
        if (filterLanguage === "ENG") return slots.engPdf;
        if (filterLanguage === "GUJ") return slots.gujPdf;
        return countRowDocxPdfForCapsules(d).pdf >= expectedPdfSlotsForRow(d);
      });
    } else if (filterFileType === "NO_PDF" && filterVersionStatus === "all") {
      result = result.filter((d: any) => {
        const slots = scanRowLanguageFileSlots(d);
        if (filterLanguage === "ENG") return !slots.engPdf;
        if (filterLanguage === "GUJ") return !slots.gujPdf;
        return countRowDocxPdfForCapsules(d).pdf < expectedPdfSlotsForRow(d);
      });
    }

    // Filter Language — aligns with DepartmentCapsules' "w/ EN" / "w/ GU" counters.
    // Overlap counting: a SOP is "English" if it's dual OR has any English signal
    // OR its stored language isn't Gujarati; it is "Gujarati" if it's dual OR has
    // any Gujarati signal OR its stored language is Gujarati. Dual rows match
    // BOTH languages.
    const rowHasEngSignal = (d: any): boolean => {
      const slots = scanRowLanguageFileSlots(d);
      return !!d.englishVersion || slots.engDocx || slots.engPdf;
    };
    const rowHasGujSignal = (d: any): boolean => {
      const slots = scanRowLanguageFileSlots(d);
      return !!d.gujaratiVersion || slots.gujDocx || slots.gujPdf;
    };
    const rowIsDual = (d: any): boolean => expectedDocxSlotsForRow(d) >= 2;
    const rowIsEng = (d: any): boolean => {
      if (rowIsDual(d)) return true;
      if (rowHasEngSignal(d)) return true;
      const stored = String(d?.language || "").trim().toLowerCase();
      return stored !== "gujarati" && !rowHasGujSignal(d);
    };
    const rowIsGuj = (d: any): boolean => {
      if (rowIsDual(d)) return true;
      if (rowHasGujSignal(d)) return true;
      return String(d?.language || "").trim().toLowerCase() === "gujarati";
    };
    // Skip the broad language filter when a version-status filter is active —
    // the version classifier already scopes by language (via expectedDocxSlotsForRow
    // and the per-language artifact arrays), and applying both narrows the result
    // count below the capsule's per-language version count.
    if (filterVersionStatus === "all") {
      if (filterLanguage === "ENG") result = result.filter(rowIsEng);
      else if (filterLanguage === "GUJ") result = result.filter(rowIsGuj);
      else if (filterLanguage === "BOTH")
        result = result.filter(
          (d: any) => d.isDualLanguage || (rowHasEngSignal(d) && rowHasGujSignal(d)),
        );
    }

    // Filter Media
    if (filterMedia === "video")
      result = result.filter((d: any) => d.mediaStatus?.videos);
    else if (filterMedia === "slides")
      result = result.filter((d: any) => d.mediaStatus?.slides);
    else if (filterMedia === "no-video")
      result = result.filter((d: any) => !d.mediaStatus?.videos);
    else if (filterMedia === "no-slides")
      result = result.filter((d: any) => !d.mediaStatus?.slides);
    else if (filterMedia === "no-media")
      result = result.filter(
        (d: any) => !d.mediaStatus?.videos && !d.mediaStatus?.slides,
      );

    if (filterVersionStatus !== "all") {
      const tier =
        filterVersionStatus === "allTwov"
          ? "allTwoFound"
          : "notFound";
      // When a format and/or language is co-active, use the per-language/format
      // classifier so the registry list mirrors the capsule sub-row counts.
      const fmt: "docx" | "pdf" | null =
        filterFileType === "DOCX" ? "docx" : filterFileType === "PDF" ? "pdf" : null;
      const lang: "EN" | "GJ" | null =
        filterLanguage === "ENG" ? "EN" : filterLanguage === "GUJ" ? "GJ" : null;

      if (fmt && lang) {
        result = result.filter(
          (d: any) =>
            classifySopVersionPerLangFormat(d, { lang, format: fmt }) === tier,
        );
      } else if (fmt) {
        // DOCX or PDF only — EN must match; GJ only counts when in scope.
        result = result.filter((d: any) => {
          const en = classifySopVersionPerLangFormat(d, { lang: "EN", format: fmt });
          const gj = classifySopVersionPerLangFormat(d, { lang: "GJ", format: fmt });
          // Row matches if any in-scope language hits the tier.
          if (en === tier) return true;
          if (gj === tier) return true;
          return false;
        });
      } else if (lang) {
        // Language only — classify against that language across both formats.
        result = result.filter((d: any) => {
          const docx = classifySopVersionPerLangFormat(d, { lang, format: "docx" });
          const pdf = classifySopVersionPerLangFormat(d, { lang, format: "pdf" });
          if (docx === tier) return true;
          if (pdf === tier) return true;
          return false;
        });
      } else {
        result = result.filter(
          (d: any) => classifySopVersionCapsule(d) === tier,
        );
      }
    }

    // Filter: Version Date (capsule) — green keeps rows with ALL slots dated;
    // red keeps rows missing at least one date. When a language is co-active,
    // restrict the check to that language's slots only.
    if (filterVersionDateStatus !== "all") {
      const wantFound = filterVersionDateStatus === "dateFoundv";
      const langScope: "EN" | "GJ" | null =
        filterLanguage === "ENG" ? "EN" : filterLanguage === "GUJ" ? "GJ" : null;
      result = result.filter((d: any) => {
        const en = countVersionDatesPerLang(d, "EN");
        const gj = countVersionDatesPerLang(d, "GJ");
        if (langScope === "EN") {
          if (wantFound) return en.found > 0 && en.notFound === 0;
          return en.notFound > 0;
        }
        if (langScope === "GJ") {
          if (wantFound) return gj.found > 0 && gj.notFound === 0;
          return gj.notFound > 0;
        }
        // Parent semantic: a row is "Found" if AT LEAST ONE language present
        // on the row has all of its expected slots dated. Mirrors the capsule
        // counter so parent ≥ each per-language sub-row.
        const enHasSlots = en.found + en.notFound > 0;
        const gjHasSlots = gj.found + gj.notFound > 0;
        const enFullyFound = enHasSlots && en.notFound === 0;
        const gjFullyFound = gjHasSlots && gj.notFound === 0;
        if (!enHasSlots && !gjHasSlots) return false;
        if (wantFound) return enFullyFound || gjFullyFound;
        return !enFullyFound && !gjFullyFound;
      });
    }

    // Filter Expiry alerts
    if (filterExpiry !== "all") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Use Math.floor (same as capsule accumulator) so that expired vs near-expiry
      // boundaries are consistent between the capsule counts and the filter results.
      result = result.filter((d: any) => {
        if (filterExpiry === "nodate") return !d.expiryDate;
        if (!d.expiryDate) return false;
        const diffDays = Math.floor(
          (new Date(d.expiryDate).getTime() - today.getTime()) /
          (1000 * 60 * 60 * 24),
        );
        if (filterExpiry === "expired") return diffDays < 0;
        if (filterExpiry === "high") return diffDays >= 0 && diffDays <= 30;
        if (filterExpiry === "medium") return diffDays > 30 && diffDays <= 60;
        /** 61–90 day window (charts / planning) */
        if (filterExpiry === "soon90") return diffDays > 60 && diffDays <= 90;
        if (filterExpiry === "low") return diffDays > 60;
        return true;
      });
    }

    if (dateFrom || dateTo) {
      const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
      const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
      result = result.filter((d: any) => {
        if (!d.expiryDate) return false;
        const ts = new Date(d.expiryDate).getTime();
        if (Number.isNaN(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
        return true;
      });
    }

    // Panel location filter
    if (panelFilterLocation.length > 0) {
      result = result.filter((d: any) => panelFilterLocation.includes(String(d.location || "")));
    }

    // Panel version filter
    if (panelFilterVersion.length > 0) {
      result = result.filter((d: any) => panelFilterVersion.includes(String(d.version ?? "")));
    }

    // Panel language filter
    if (panelFilterLanguage.length > 0) {
      const getLang = (d: any) => {
        if (d.isDualLanguage) return "ENG/GUJ";
        if (d.gujaratiFileMissing) return "ENG (GUJ missing)";
        return d.language === "Gujarati" ? "GUJ" : "ENG";
      };
      result = result.filter((d: any) => panelFilterLanguage.includes(getLang(d)));
    }

    // Panel date filter
    if (panelFilterDateFrom) {
      const fromTs = new Date(`${panelFilterDateFrom}T00:00:00`).getTime();
      result = result.filter((d: any) => {
        if (!d.expiryDate) return false;
        const ts = new Date(d.expiryDate).getTime();
        return ts >= fromTs;
      });
    }

    if (panelFilterDateTo) {
      const toTs = new Date(`${panelFilterDateTo}T23:59:59.999`).getTime();
      result = result.filter((d: any) => {
        if (!d.expiryDate) return false;
        const ts = new Date(d.expiryDate).getTime();
        return ts <= toTs;
      });
    }

    if (filterAbsoluteSop) {
      result = result.filter((d: any) => {
        const docs = countRowDocxPdfForCapsules(d);
        const completeFiles =
          docs.docx >= expectedDocxSlotsForRow(d) &&
          docs.pdf >= expectedPdfSlotsForRow(d);
        const hasMeta = Boolean((d.department || "").trim()) && Boolean((d.sopName || "").trim());
        return completeFiles && hasMeta;
      });
    }

    // ── Decorate-sort-undecorate ──────────────────────────────────────────────
    // Compute each row's sort key + stable tie-break key once, then sort by the
    // precomputed values. Avoids O(N log N) regex/object-scan calls per click.
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    const key = sortConfig.key;

    // Tie-break: SOP No parts cached once per row (prefix string + numeric doc/rev).
    type SopParts = { prefix: string; doc: number; rev: number };
    const cmpParts = (pa: SopParts, pb: SopParts): number => {
      if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1;
      if (pa.doc !== pb.doc) return pa.doc - pb.doc;
      return pa.rev - pb.rev;
    };

    const computePrimaryKey = (r: any): number | string => {
      switch (key) {
        case "sopNo":
          return 0; // primary handled via tie-break parts
        case "version": {
          const sopNo = String(r.sopNo || "");
          const m = sopNo.match(/-0*(\d+)$/);
          if (m) return parseInt(m[1], 10);
          const raw = r.version;
          if (raw == null || raw === "—") return -1;
          const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
          return isNaN(n) ? -1 : n;
        }
        case "department":
          return (r.department || "").toLowerCase();
        case "sopName":
          return (r.englishName || r.sopName || "").toLowerCase();
        case "location":
          return (r.location || "").toLowerCase();
        case "expiryDate":
          return r.expiryDate ? new Date(r.expiryDate).getTime() : Infinity;
        case "language": {
          if (r.isDualLanguage) return "eng/guj";
          if (r.gujaratiVersion || String(r.language || "").toLowerCase() === "gujarati") return "gujarati";
          return "english";
        }
        case "priorVersionCount":
          return (
            (Array.isArray(r.versionArtifacts) ? r.versionArtifacts.length : 0) +
            (Array.isArray(r.versionArtifactsGujarati)
              ? r.versionArtifactsGujarati.length
              : 0)
          );
        case "mediaStatus":
          return (
            (r.mediaStatus?.videoCount ?? (r.mediaStatus?.videos ? 1 : 0)) +
            (r.mediaStatus?.slideCount ?? (r.mediaStatus?.slides ? 1 : 0))
          );
        case "videos":
          return r.mediaStatus?.videoCount ?? (r.mediaStatus?.videos ? 1 : 0);
        case "slides":
          return r.mediaStatus?.slideCount ?? (r.mediaStatus?.slides ? 1 : 0);
        case "fileType": {
          const c = countRowDocxPdfForCapsules(r);
          return c.docx * 2 + c.pdf;
        }
        case "rowDocxCount":
          return countRowDocxPdfForCapsules(r).docx;
        case "rowPdfCount":
          return countRowDocxPdfForCapsules(r).pdf;
        case "guidelineScore": {
          const findings = complianceCache[String(r.sopNo)]?.findings ?? [];
          let nonCompliant = 0;
          let partial = 0;
          let informational = 0;
          for (const f of findings) {
            if (f?.complianceLevel === "non-compliant") nonCompliant++;
            else if (f?.complianceLevel === "partial") partial++;
            if (String(f?.issueSeverity || "").toLowerCase() === "informational")
              informational++;
          }
          return nonCompliant * 1000 + partial * 100 + informational;
        }
        default:
          return String(r[key] ?? "").toLowerCase();
      }
    };

    // Secondary keys (used only when primary is equal) — currently only
    // guidelineScore has a multi-level breakdown.
    const computeSecondaryKeys = (r: any): { total: number; score: number } | null => {
      if (key !== "guidelineScore") return null;
      const cache = complianceCache[String(r.sopNo)];
      const total = Array.isArray(cache?.findings) ? cache.findings.length : 0;
      const score = cache?.overallScore ?? -1;
      return { total, score };
    };

    // Decorate
    const decorated = result.map((row: any, idx: number) => {
      const sopNoStr = String(row.sopNo || "");
      const norm = normalizeSopIdentifierKey(sopNoStr.toUpperCase());
      const m = norm.match(/^([A-Z]{1,6})(\d+)-(\d+)$/);
      const parts: SopParts = m
        ? { prefix: m[1], doc: parseInt(m[2], 10), rev: parseInt(m[3], 10) }
        : { prefix: norm, doc: 0, rev: 0 };
      return {
        row,
        idx,
        parts,
        primary: computePrimaryKey(row),
        secondary: computeSecondaryKeys(row),
      };
    });

    const locationSentinel = key === "location";

    decorated.sort((a: typeof decorated[number], b: typeof decorated[number]) => {
      let cmp = 0;

      if (key === "sopNo") {
        cmp = cmpParts(a.parts, b.parts);
        return cmp !== 0 ? cmp * dir : a.idx - b.idx;
      }

      const pa = a.primary;
      const pb = b.primary;

      if (locationSentinel) {
        // Empty locations always go to end, regardless of direction
        const ea = pa === "";
        const eb = pb === "";
        if (ea && !eb) return 1;
        if (!ea && eb) return -1;
      }

      if (typeof pa === "number" && typeof pb === "number") {
        cmp = pa - pb;
      } else {
        cmp = pa < pb ? -1 : pa > pb ? 1 : 0;
      }

      if (cmp === 0 && a.secondary && b.secondary) {
        cmp = a.secondary.total - b.secondary.total;
        if (cmp === 0) cmp = a.secondary.score - b.secondary.score;
      }

      if (cmp !== 0) return cmp * dir;

      // Stable tie-break: SOP No ascending (department/version preserve this
      // even when the primary direction is desc, matching prior behavior).
      cmp = cmpParts(a.parts, b.parts);
      if (cmp !== 0) return cmp;
      return a.idx - b.idx;
    });

    return decorated.map((d) => d.row);
  }, [
    effectiveData,
    search,
    searchField,
    filterDept,
    filterMedia,
    filterExpiry,
    filterDualLang,
    filterFileType,
    filterLanguage,
    filterVersionStatus,
    filterVersionDateStatus,
    filterAbsoluteSop,
    dateFrom,
    dateTo,
    sortConfig,
    panelFilterLocation,
    panelFilterVersion,
    panelFilterLanguage,
    panelFilterDateFrom,
    panelFilterDateTo,
    complianceCache,
  ]);


  const supersededSlotCount = useMemo(() => {
    let n = 0;
    for (const r of effectiveData) {
      n +=
        (Array.isArray(r.versionArtifactsSuperseded)
          ? r.versionArtifactsSuperseded.length
          : 0) +
        (Array.isArray(r.versionArtifactsGujaratiSuperseded)
          ? r.versionArtifactsGujaratiSuperseded.length
          : 0);
    }
    return n;
  }, [effectiveData]);

  const mediaTotals = useMemo(() => {
    let totalVideos = 0;
    let totalSlides = 0;
    let totalDocx = 0;
    let totalPdf = 0;
    let pendingVideoSops = 0;
    let pendingSlideSops = 0;
    for (const r of filteredAndSortedData) {
      const v = r.mediaStatus?.videoCount ?? (r.mediaStatus?.videos ? 1 : 0);
      const s = r.mediaStatus?.slideCount ?? (r.mediaStatus?.slides ? 1 : 0);
      const docs = countRowDocxPdfAttached(r);
      totalVideos += v;
      totalSlides += s;
      totalDocx += docs.docx;
      totalPdf += docs.pdf;
      if (v <= 0) pendingVideoSops++;
      if (s <= 0) pendingSlideSops++;
    }
    return {
      totalVideos,
      totalSlides,
      totalDocx,
      totalPdf,
      pendingVideoSops,
      pendingSlideSops,
    };
  }, [filteredAndSortedData]);

  const capsuleFilterSnapshot = useMemo(
    () => ({
      filterDept,
      filterDualLang,
      filterExpiry,
      filterFileType,
      filterLanguage,
      filterMedia,
      filterVersionStatus,
      filterVersionDateStatus,
    }),
    [
      filterDept,
      filterDualLang,
      filterExpiry,
      filterFileType,
      filterLanguage,
      filterMedia,
      filterVersionStatus,
      filterVersionDateStatus,
    ],
  );

  /** Green = rows with asset + sort desc; red = rows missing asset + sort asc. */
  const applyCapsuleAvailMiss = useCallback(
    (
      dept: string,
      metric: CapsuleAvailMetric,
      side: "available" | "missing",
      lang?: "ENG" | "GUJ",
    ) => {
      setFilterDept(dept);
      setFilterDualLang(false);
      setFilterExpiry("all");
      setFilterLanguage(lang ?? "all");
      setFilterVersionStatus("all");
      setFilterVersionDateStatus("all");
      const direction = side === "available" ? "desc" : "asc";
      if (metric === "docx") {
        setFilterMedia("all");
        setFilterFileType(side === "available" ? "DOCX" : "NO_DOCX");
        setSortConfig({ key: "rowDocxCount", direction });
      } else if (metric === "pdf") {
        setFilterMedia("all");
        setFilterFileType(side === "available" ? "PDF" : "NO_PDF");
        setSortConfig({ key: "rowPdfCount", direction });
      } else if (metric === "video") {
        setFilterFileType("all");
        setFilterMedia(side === "available" ? "video" : "no-video");
        setSortConfig({ key: "videos", direction });
      } else {
        setFilterFileType("all");
        setFilterMedia(side === "available" ? "slides" : "no-slides");
        setSortConfig({ key: "slides", direction });
      }
      requestAnimationFrame(() => {
        sopRegistryRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    },
    [],
  );

  const applyCapsuleVersionSegment = useCallback(
    (
      dept: string,
      segment: SopVersionFilterSegment,
      lang?: "ENG" | "GUJ",
      format?: "docx" | "pdf",
    ) => {
      setFilterDept(dept);
      setFilterDualLang(false);
      setFilterExpiry("all");
      setFilterMedia("all");
      // Scope by file format when the click came from a DOCX/PDF version sub-row;
      // otherwise leave the format filter unset (matches the row-level "Versions" capsule).
      setFilterFileType(format === "docx" ? "DOCX" : format === "pdf" ? "PDF" : "all");
      setFilterLanguage(lang ?? "all");
      setFilterVersionStatus(segment);
      setFilterVersionDateStatus("all");
      // Green (allTwov) sorts highest-found first; red (notFoundv) sorts lowest-found first.
      // Use sopNo for stable secondary ordering when no count column applies.
      const direction = segment === "allTwov" ? "desc" : "asc";
      const sortKey =
        format === "docx"
          ? "rowDocxCount"
          : format === "pdf"
            ? "rowPdfCount"
            : "sopNo";
      setSortConfig({ key: sortKey, direction: sortKey === "sopNo" ? "asc" : direction });
      requestAnimationFrame(() => {
        sopRegistryRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    },
    [],
  );

  const applyCapsuleVersionDateSegment = useCallback(
    (
      dept: string,
      segment: "dateFoundv" | "dateNotFoundv",
      lang?: "ENG" | "GUJ",
    ) => {
      setFilterDept(dept);
      setFilterDualLang(false);
      setFilterExpiry("all");
      setFilterMedia("all");
      setFilterFileType("all");
      setFilterLanguage(lang ?? "all");
      setFilterVersionStatus("all");
      setFilterVersionDateStatus(segment);
      setSortConfig({ key: "sopNo", direction: "asc" });
      requestAnimationFrame(() => {
        sopRegistryRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    },
    [],
  );

  /** Chart → registry: expiry windows (optional `department` keeps dept filter for stacked chart clicks). */
  const applyChartExpiryFilter = useCallback(
    (
      key: "all" | "expired" | "high" | "medium" | "soon90" | "nodate",
      department?: string,
    ) => {
      setFilterDept(department ?? "All");
      setFilterDualLang(false);
      setFilterMedia("all");
      setFilterFileType("all");
      setFilterLanguage("all");
      setFilterVersionStatus("all");
      setFilterVersionDateStatus("all");
      setSearch("");
      setFilterExpiry(key);
      setSortConfig({ key: "expiryDate", direction: "asc" });
      requestAnimationFrame(() => {
        sopRegistryRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    },
    [],
  );

  const applyCapsuleFilter = useCallback(
    (dept: string, mode: CapsuleFilterMode) => {
      setFilterDept(dept);
      /** Full preset for label-based capsule rows: clears green/red (NO_DOCX, no-video, …) and table sort so the registry matches the click (green/red leave sort on row counts). */
      const resetNeutral = () => {
        setFilterDualLang(false);
        setFilterExpiry("all");
        setFilterMedia("all");
        setFilterFileType("all");
        setFilterLanguage("all");
        setFilterVersionStatus("all");
        setFilterVersionDateStatus("all");
        setSortConfig({ key: "sopNo", direction: "asc" });
      };
      switch (mode) {
        case "all":
          resetNeutral();
          setSearch("");
          break;
        case "dual":
          setFilterDualLang(true);
          setFilterExpiry("all");
          setFilterMedia("all");
          setFilterFileType("all");
          setFilterLanguage("all");
          setFilterVersionStatus("all");
          setFilterVersionDateStatus("all");
          setSortConfig({ key: "sopNo", direction: "asc" });
          break;
        case "eng":
          resetNeutral();
          setFilterLanguage("ENG");
          break;
        case "guj":
          resetNeutral();
          setFilterLanguage("GUJ");
          break;
        case "expired":
          resetNeutral();
          setFilterExpiry("expired");
          break;
        case "near":
          resetNeutral();
          setFilterExpiry("high");
          break;
        case "nodate":
          resetNeutral();
          setFilterExpiry("nodate");
          break;
        case "docx":
          resetNeutral();
          setFilterFileType("DOCX");
          break;
        case "pdf":
          resetNeutral();
          setFilterFileType("PDF");
          break;
        case "video":
          resetNeutral();
          setFilterMedia("video");
          break;
        case "slides":
          resetNeutral();
          setFilterMedia("slides");
          break;
        default:
          resetNeutral();
      }
      requestAnimationFrame(() => {
        sopRegistryRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    },
    [],
  );

  const handleMarkVersionSuperseded = useCallback(
    async (payload: {
      sopNo: string;
      lang: "English" | "Gujarati";
      version: number;
      docxPath?: string;
      pdfPath?: string;
    }) => {
      try {
        const user = (() => {
          try {
            return JSON.parse(localStorage.getItem("user") || "{}");
          } catch {
            return {};
          }
        })();
        const res = await fetch("/api/dashboard/supersede-version", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            createdBy: user?.username || user?.name || "dashboard-user",
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.success) {
          window.alert(j.error || "Failed to move version to Supersede SOP");
          return;
        }
        triggerRefresh();
      } catch {
        window.alert("Network error while superseding version");
      }
    },
    [triggerRefresh],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const handleClearFilters = () => {
    setResetFiltersTrigger(prev => prev + 1);
    setFilterDept("All");
    setFilterMedia("all");
    setFilterExpiry("all");
    setFilterDualLang(false);
    setFilterFileType("all");
    setFilterLanguage("all");
    setFilterVersionStatus("all");
    setFilterVersionDateStatus("all");
    setFilterAbsoluteSop(false);
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setSearchField("all");
    setSortConfig({ key: "sopNo", direction: "asc" });
    setFilterObsolete(false);
    setPanelFilterLocation([]);
    setPanelFilterVersion([]);
    setPanelFilterLanguage([]);
    setPanelFilterDateFrom("");
    setPanelFilterDateTo("");
  };

  const handleFilterExpired = () => {
    setFilterExpiry(filterExpiry === "expired" ? "all" : "expired");
    if (filterExpiry !== "expired")
      setSortConfig({ key: "expiryDate", direction: "asc" });
  };

  const handleFilterNearExpiry = () => {
    if (filterExpiry === "high" || filterExpiry === "medium") {
      setFilterExpiry("all");
    } else {
      setFilterExpiry("high");
      setSortConfig({ key: "expiryDate", direction: "asc" });
    }
  };

  const handleFilterActive = () => {
    setFilterExpiry(filterExpiry === "low" ? "all" : "low");
    if (filterExpiry !== "low")
      setSortConfig({ key: "expiryDate", direction: "desc" });
  };

  const handleFilterDualLanguage = () => {
    setFilterDualLang(!filterDualLang);
  };

  const handleFilterVideo = () => {
    setFilterMedia(filterMedia === "video" ? "all" : "video");
    if (filterMedia !== "video")
      setSortConfig({ key: "mediaStatus", direction: "desc" });
  };

  const handleFilterSlides = () => {
    setFilterMedia(filterMedia === "slides" ? "all" : "slides");
    if (filterMedia !== "slides")
      setSortConfig({ key: "mediaStatus", direction: "desc" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9fa] text-gray-800">
      {/* Top navigation: title, welcome, key metrics inline */}
      <header className="sticky top-0 z-40 flex shrink-0 flex-col gap-y-2 border-b border-gray-200 bg-gray-100 px-4 py-2.5 shadow-sm">
        {/* Top Row: Title + User Profile */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-600 shadow-sm">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-gray-900">
                SOP Control – Master Dashboard
              </h1>
              <p className="text-[10px] text-gray-600">
                Welcome, {user?.name || "User"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pl-4 border-l border-gray-200/60">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-100">
              <User className="h-3.5 w-3.5 text-purple-700" />
            </div>
            <div className="hidden md:block mr-2">
              <p className="text-[11px] font-semibold leading-tight text-gray-800">
                {user?.name}
              </p>
              <p className="text-[9px] font-bold uppercase leading-tight tracking-wider text-gray-500">
                {user?.role}
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleObsoleteFilter}
              className={`rounded-md p-1.5 transition-colors ${filterObsolete ? "bg-rose-200 text-rose-800" : "text-gray-500 hover:bg-rose-100 hover:text-rose-700"}`}
              title="Obsolete SOPs">
              <Archive className="h-4 w-4" />
            </button>
            {(user?.role === "admin" || user?.role === "qa-head") && (
              <Link
                href="/admin"
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-purple-200 hover:text-purple-700"
                title="Admin Panel">
                <Shield className="h-4 w-4" />
              </Link>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-100 hover:text-red-700"
              title="Logout">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Bottom Row: Filters & Toolbars */}
        <div className="flex flex-wrap items-center justify-between gap-y-2 w-full">



          <div className="flex flex-wrap items-center justify-end gap-2 flex-1 lg:flex-none">
            <button
              type="button"
              onClick={() => {
                setGuidelinesWizardPreset(null);
                setShowGuidelinesLibrary(true);
              }}
              className="hidden sm:inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-800 shadow-sm transition-colors hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              title="Browse stored regulatory guidelines (same library used for SOP checks)">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              Guidelines
            </button>
            {/* Show charts toggle */}
            <button
              type="button"
              onClick={() => setShowCharts((v) => !v)}
              className="hidden md:inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-semibold text-purple-700 shadow-sm transition-colors hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500">
              {showCharts ? "Hide charts" : "Show charts"}
            </button>
            <button
              type="button"
              onClick={() => setShowSuperseded(true)}
              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
              title="Prior version archive — older version files beyond the two newest per SOP">
              Prior Ver. Archive
              {supersededSlotCount > 0 ? (
                <span className="rounded-full bg-amber-200 px-1 py-px text-[9px] tabular-nums text-amber-950">
                  {supersededSlotCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setShowSOPFolderUploadModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-900 shadow-sm transition-colors hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              title="Upload superseded folders and fetch only SOP versions (annexures skipped)">
              <Upload className="h-3.5 w-3.5" />
              Version Fetch Upload
            </button>
            <button
              type="button"
              onClick={() => setShowTrainingVideoModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-2.5 py-1 text-[11px] font-semibold text-purple-900 shadow-sm transition-colors hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              title="Upload training videos (MP4/MOV/WEBM). Slides upload coming soon.">
              <Film className="h-3.5 w-3.5" />
              Upload Videos &amp; Slides
            </button>
            <div className="flex items-center gap-2 rounded-md border border-purple-200 bg-white/80 px-1.5 py-1">
              <span className="px-1 text-[9px] font-bold uppercase tracking-wide text-purple-700">
                Bulk
              </span>
              <div className="relative group">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 shadow-sm transition-colors hover:bg-purple-100">
                  <Upload className="h-3.5 w-3.5" /> Bulk Uploads
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
                <div className="absolute right-0 top-full pt-1 hidden w-48 group-hover:block z-50">
                  <div className="flex flex-col gap-1 rounded-md border border-gray-200 bg-white p-1.5 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setUploadModalTab("english");
                        setShowUploadModal(true);
                      }}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-purple-50 hover:text-purple-700 w-full text-left">
                      <Upload className="h-3.5 w-3.5 text-purple-600" /> Upload SOPs
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadModalTab("gujarati");
                        setShowUploadModal(true);
                      }}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 w-full text-left">
                      <Languages className="h-3.5 w-3.5 text-indigo-600" /> Gujarati
                      folders
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPdfUploadModal(true)}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-red-50 hover:text-red-700 w-full text-left">
                      <Upload className="h-3.5 w-3.5 text-red-600" /> Upload PDFs
                    </button>
                    <div className="my-0.5 h-px bg-gray-100 w-full" />
                    <label
                      htmlFor={LOCATION_XLSX_INPUT_ID}
                      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-slate-50 hover:text-slate-800 w-full text-left ${locationImportBusy ? "pointer-events-none opacity-50" : ""
                        }`}>
                      <Upload className="h-3.5 w-3.5 text-slate-500" /> Upload
                      locations
                    </label>
                    <div className="my-0.5 h-px bg-gray-100 w-full" />
                    <button
                      type="button"
                      onClick={handleMigrateToBunny}
                      disabled={migrateBunnyState.status === 'running' || migrateBunnyState.status === 'checking'}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-orange-50 hover:text-orange-700 w-full text-left disabled:opacity-50">
                      <Upload className="h-3.5 w-3.5 text-orange-500" /> Migrate to Bunny
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <input
              id={LOCATION_XLSX_INPUT_ID}
              type="file"
              accept=".xlsx,.xls,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              tabIndex={-1}
              disabled={locationImportBusy}
              aria-label="Upload location Excel"
              onChange={handleLocationExcelChange}
            />

            <Link
              href="/training-matrix"
              className="flex items-center gap-1.5 rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 shadow-sm transition-colors hover:bg-teal-100">
              <BarChart2 className="h-3.5 w-3.5" /> Training Matrix
            </Link>
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-white/80 px-1.5 py-1">
              <span className="px-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                Single
              </span>
              <button
                type="button"
                onClick={handleToggleObsoleteFilter}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${filterObsolete ? "border-rose-600 bg-rose-600 text-white hover:bg-rose-700" : "border-rose-400 bg-rose-50 text-rose-700 hover:bg-rose-100"}`}>
                <Archive className="h-3.5 w-3.5" /> Obsolete SOPs
              </button>
              <Link
                href="/sop-upload"
                className="flex items-center gap-1.5 rounded-md border border-purple-600 bg-white px-3 py-1.5 text-xs font-semibold text-purple-700 shadow-sm transition-colors hover:bg-purple-50">
                <Plus className="h-3.5 w-3.5" /> SOP Upload
              </Link>
              <Link
                href="/mcq-bank"
                className="flex items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100"
                title="Navigate to MCQ Bank section">
                <BarChart2 className="h-3.5 w-3.5" /> MCQ Bank
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}

      {/* Capsules with collapsible header */}
      <section className="border-b border-gray-200 bg-white">
        {/* Collapsible header */}
        <button
          onClick={() => setShowCapsules(prev => !prev)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group"
        >
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-indigo-500 shadow-sm shrink-0">
            <BarChart2 className="h-4 w-4 text-white" />
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-gray-800">
              By Department <span className="text-gray-500 font-medium">({new Set(primaryRegistryData.map((r: any) => String(r?.department || '').trim()).filter(Boolean)).size})</span>
            </span>
            <p className="text-xs text-gray-400 leading-none mt-0.5">Filter SOPs by department</p>
          </div>
          <span className="text-gray-400 group-hover:text-gray-600 transition-colors shrink-0">
            {showCapsules ? <ChevronDown className="h-4 w-4" /> : <ChevronDown className="h-4 w-4 -rotate-90" />}
          </span>
        </button>

        {/* Capsule cards */}
        {showCapsules && (
          <div className="bg-gray-100 px-2 py-1 sm:px-3 border-t border-gray-100">
            <div className="min-w-0 max-w-[1920px] mx-auto">
              <DepartmentCapsules
                data={primaryRegistryData}
                showTotalCapsule
                applyCapsuleFilter={applyCapsuleFilter}
                applyCapsuleAvailMiss={applyCapsuleAvailMiss}
                applyCapsuleVersionSegment={applyCapsuleVersionSegment}
                applyCapsuleVersionDateSegment={applyCapsuleVersionDateSegment}
                filterSnapshot={capsuleFilterSnapshot}
                sopsWithVideos={sopsWithVideos}
                sopsWithoutVideos={sopsWithoutVideos}
                sopsWithBrief={sopsWithBrief}
                sopsWithoutBrief={sopsWithoutBrief}
                sopsWithExplainer={sopsWithExplainer}
                sopsWithoutExplainer={sopsWithoutExplainer}
              />
            </div>
          </div>
        )}
      </section>

      {/* Charts panel toggled from header */}
      {showCharts && (
        <section className="border-b border-gray-200 bg-gray-50 px-2 py-4 sm:px-4">
          <DashboardCharts
            data={primaryRegistryData}
            applyCapsuleFilter={applyCapsuleFilter}
            applyCapsuleAvailMiss={applyCapsuleAvailMiss}
            applyChartExpiryFilter={applyChartExpiryFilter}
          />
        </section>
      )}

      {/* SOP Registry */}
      <main
        ref={sopRegistryRef}
        className="flex flex-1 flex-col px-3 pt-1 pb-2">
        <div className="mb-1 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h3 className={`text-xs font-bold uppercase tracking-wider ${filterObsolete ? "text-rose-700" : "text-gray-600"}`}>
              {filterObsolete ? "Obsolete SOPs" : "SOP Registry"}
            </h3>
            {refreshingLatest && (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                <Loader2 className="h-3 w-3 animate-spin" />
                Refreshing latest SOPs...
              </span>
            )}
            <button
              type="button"
              onClick={handleClearFilters}
              className="shrink-0 rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:border-gray-400"
              title="Clear search and all filters (default view)">
              Reset
            </button>

            <button
              type="button"
              onClick={async () => {
                const XLSX = (await import("xlsx")).default || await import("xlsx");
                const missing = primaryRegistryData.filter((d: any) => countRowDocxPdfAttached(d).docx === 0);
                const wsData = missing.map((d: any) => ({
                  "SOP Number": d.sopNo || "",
                  "SOP Name": d.englishName || d.sopName || "",
                  "Department": d.department || "",
                  "Version": d.version ?? "",
                  "File Status": "DOCX Missing"
                }));
                const ws = XLSX.utils.json_to_sheet(wsData);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Missing DOCX");
                XLSX.writeFile(wb, "Missing_DOCX_SOPs.xlsx");
              }}
              className="shrink-0 flex items-center gap-1 rounded border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700 shadow-sm transition-colors hover:bg-green-100 hover:border-green-400"
              title="Download list of SOPs missing DOCX files">
              <Download className="h-3 w-3" /> Export Missing DOCX
            </button>

            {(() => {
              const category = detectMissingCategory({
                filterFileType,
                filterMedia,
                filterVersionStatus,
                filterLanguage,
              });
              if (!category) return null;
              return (
                <button
                  type="button"
                  onClick={async () => {
                    const XLSX = (await import("xlsx")).default || await import("xlsx");
                    const rows = buildMissingExportRows(filteredAndSortedData as any[], category);
                    if (rows.length === 0) {
                      alert("No missing rows in current filter.");
                      return;
                    }
                    const ws = XLSX.utils.json_to_sheet(rows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, category.sheetName.slice(0, 31));
                    XLSX.writeFile(wb, category.fileName);
                  }}
                  className="shrink-0 flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-100 hover:border-rose-400"
                  title={`Download ${filteredAndSortedData.length} ${category.label} row(s) currently filtered`}>
                  <Download className="h-3 w-3" /> Export Missing Files ({filteredAndSortedData.length})
                </button>
              );
            })()}

            {/* Search & Filter */}
            <div className="flex items-center gap-1.5">
              <select
                value={searchField}
                onChange={(e) =>
                  setSearchField(
                    e.target.value as
                    | "all"
                    | "sopNo"
                    | "sopName"
                    | "department"
                    | "location",
                  )
                }
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-purple-500 focus:outline-none shadow-sm">
                <option value="all">All fields</option>
                <option value="sopNo">SOP No</option>
                <option value="sopName">SOP Name</option>
                <option value="department">Department</option>
                <option value="location">Location</option>
              </select>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search SOPs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-56 rounded border border-gray-300 bg-white py-1 pl-8 pr-7 text-xs text-gray-700 outline-none placeholder:text-gray-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 shadow-sm"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFilterPanelOpen((v) => !v)}
                className={`shrink-0 rounded border px-2 py-1 transition-colors shadow-sm ${filterPanelOpen || panelFilterLocation.length > 0 || panelFilterVersion.length > 0 || panelFilterLanguage.length > 0 || panelFilterDateFrom || panelFilterDateTo
                    ? "border-purple-400 bg-purple-50 text-purple-700"
                    : "border-gray-300 bg-white text-gray-600 hover:border-purple-300 hover:text-purple-600"
                  }`}
                title="Open filter panel">
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {filterObsolete && (
              <span className="rounded-full bg-rose-100 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                Obsolete filter active
              </span>
            )}
            <span className="text-[10px] font-semibold text-gray-500 tabular-nums">
              {filterObsolete ? obsoleteTableRows.length : filteredAndSortedData.length} result
              {(filterObsolete ? obsoleteTableRows.length : filteredAndSortedData.length) !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Filter Panel */}
        {filterPanelOpen && (
          <div className="mb-2 rounded-lg border border-gray-200 bg-white shadow-sm p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-gray-700 uppercase tracking-wider text-[10px]">Filters</span>
              <button
                type="button"
                onClick={() => {
                  setPanelFilterLocation([]);
                  setPanelFilterVersion([]);
                  setPanelFilterLanguage([]);
                  setPanelFilterDateFrom("");
                  setPanelFilterDateTo("");
                }}
                className="text-gray-400 hover:text-gray-600 text-[10px] font-semibold">
                Clear all
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-[10px]">
              {/* Location */}
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setPanelOpenSections((s) => ({
                      ...s,
                      location: !s.location,
                    }))
                  }
                  className="flex items-center justify-between w-full font-semibold text-gray-700 hover:text-gray-900 transition-colors">
                  Location
                  {panelOpenSections.location ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
                {panelOpenSections.location && (
                  <div className="mt-1 space-y-1 max-h-48 overflow-y-auto border border-gray-200 rounded p-2 bg-gray-50">
                    {uniqueLocations.length > 0 ? (
                      uniqueLocations.map((loc: string) => (
                        <label key={loc} className="flex items-center gap-1.5 cursor-pointer hover:text-gray-900">
                          <input
                            type="checkbox"
                            checked={panelFilterLocation.includes(loc)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPanelFilterLocation([...panelFilterLocation, loc]);
                              } else {
                                setPanelFilterLocation(
                                  panelFilterLocation.filter((l) => l !== loc),
                                );
                              }
                            }}
                            className="h-3 w-3 rounded border-gray-300"
                          />
                          <span className="text-gray-700">{loc}</span>
                        </label>
                      ))
                    ) : (
                      <span className="text-gray-400 text-[9px]">No locations</span>
                    )}
                  </div>
                )}
              </div>

              {/* Version */}
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setPanelOpenSections((s) => ({
                      ...s,
                      version: !s.version,
                    }))
                  }
                  className="flex items-center justify-between w-full font-semibold text-gray-700 hover:text-gray-900 transition-colors">
                  Version
                  {panelOpenSections.version ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
                {panelOpenSections.version && (
                  <div className="mt-1 space-y-1 max-h-48 overflow-y-auto border border-gray-200 rounded p-2 bg-gray-50">
                    {uniqueVersions.length > 0 ? (
                      uniqueVersions.map((ver: string) => (
                        <label key={ver} className="flex items-center gap-1.5 cursor-pointer hover:text-gray-900">
                          <input
                            type="checkbox"
                            checked={panelFilterVersion.includes(ver)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPanelFilterVersion([...panelFilterVersion, ver]);
                              } else {
                                setPanelFilterVersion(
                                  panelFilterVersion.filter((v) => v !== ver),
                                );
                              }
                            }}
                            className="h-3 w-3 rounded border-gray-300"
                          />
                          <span className="text-gray-700">{ver}</span>
                        </label>
                      ))
                    ) : (
                      <span className="text-gray-400 text-[9px]">No versions</span>
                    )}
                  </div>
                )}
              </div>

              {/* Language */}
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setPanelOpenSections((s) => ({
                      ...s,
                      language: !s.language,
                    }))
                  }
                  className="flex items-center justify-between w-full font-semibold text-gray-700 hover:text-gray-900 transition-colors">
                  Language
                  {panelOpenSections.language ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
                {panelOpenSections.language && (
                  <div className="mt-1 space-y-1 border border-gray-200 rounded p-2 bg-gray-50">
                    {uniqueLanguagesPanel.length > 0 ? (
                      uniqueLanguagesPanel.map((lang: string) => (
                        <label key={lang} className="flex items-center gap-1.5 cursor-pointer hover:text-gray-900">
                          <input
                            type="checkbox"
                            checked={panelFilterLanguage.includes(lang)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPanelFilterLanguage([...panelFilterLanguage, lang]);
                              } else {
                                setPanelFilterLanguage(
                                  panelFilterLanguage.filter((l) => l !== lang),
                                );
                              }
                            }}
                            className="h-3 w-3 rounded border-gray-300"
                          />
                          <span className="text-gray-700">{lang}</span>
                        </label>
                      ))
                    ) : (
                      <span className="text-gray-400 text-[9px]">No languages</span>
                    )}
                  </div>
                )}
              </div>

              {/* Date Range */}
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setPanelOpenSections((s) => ({
                      ...s,
                      date: !s.date,
                    }))
                  }
                  className="flex items-center justify-between w-full font-semibold text-gray-700 hover:text-gray-900 transition-colors">
                  Date Range
                  {panelOpenSections.date ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
                {panelOpenSections.date && (
                  <div className="mt-1 space-y-1.5 border border-gray-200 rounded p-2 bg-gray-50">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-semibold text-gray-600">From:</label>
                      <input
                        type="date"
                        value={panelFilterDateFrom}
                        onChange={(e) => setPanelFilterDateFrom(e.target.value)}
                        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[9px] focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-semibold text-gray-600">To:</label>
                      <input
                        type="date"
                        value={panelFilterDateTo}
                        onChange={(e) => setPanelFilterDateTo(e.target.value)}
                        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[9px] focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {filterObsolete && obsoleteListLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-rose-400 border-t-transparent" />
          </div>
        ) : filterObsolete && obsoleteTableRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
            <Archive className="h-10 w-10 opacity-30" />
            <p className="text-sm font-semibold">No obsolete SOPs found</p>
          </div>
        ) : !filterObsolete && filteredAndSortedData.length === 0 && data.length > 0 ? (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[11px] leading-snug text-amber-950 shadow-sm">
            <p className="font-bold text-amber-950">
              No SOPs match the current filters
            </p>
            <p className="mt-1 text-amber-900">
              {filterDualLang ? (
                <>
                  <strong>Dual language only</strong> is on — the table only
                  lists SOPs with both English and Gujarati files (same as the
                  &quot;Dual&quot; count in capsules).{" "}
                </>
              ) : null}
              {filterDept !== "All" ? (
                <>
                  Department is <strong>{filterDept}</strong>.{" "}
                </>
              ) : null}
              {filterExpiry !== "all" ? <>Expiry filter is active. </> : null}
              {filterFileType !== "all" ? (
                <>
                  File filter:{" "}
                  <strong>
                    {filterFileType === "NO_DOCX"
                      ? "Missing DOCX"
                      : filterFileType === "NO_PDF"
                        ? "Missing PDF"
                        : filterFileType}
                  </strong>
                  .{" "}
                </>
              ) : null}
              {filterLanguage !== "all" ? (
                <>
                  Language <strong>{filterLanguage}</strong> filter is on.{" "}
                </>
              ) : null}
              {filterMedia !== "all" && filterMedia !== "no-media" ? (
                <>
                  Media:{" "}
                  <strong>
                    {filterMedia === "no-video"
                      ? "No video"
                      : filterMedia === "no-slides"
                        ? "No slides"
                        : filterMedia}
                  </strong>
                  .{" "}
                </>
              ) : null}
              {filterVersionStatus !== "all" ? (
                <>
                  Version:{" "}
                  <strong>
                    {filterVersionStatus === "allTwov"
                      ? "All Two Found"
                      : "Not Found"}
                  </strong>
                  .{" "}
                </>
              ) : null}
              {search.trim() ? <>Search text is narrowing results. </> : null}
              <button
                type="button"
                onClick={handleClearFilters}
                className="mt-1 inline font-bold text-purple-800 underline decoration-purple-400 hover:text-purple-950">
                Reset all filters
              </button>{" "}
              or adjust the header / column filters.
            </p>
          </div>
        ) : null}
        {!(filterObsolete && obsoleteListLoading) && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 shadow-sm">
            <SOPTable
              data={filterObsolete ? obsoleteTableRows : filteredAndSortedData}
              filterOptionsSource={filterObsolete ? obsoleteTableRows : primaryRegistryData}
              sortConfig={sortConfig}
              onSort={handleSort}
              filterDeptFromParent={filterDept}
              onDepartmentFilterChange={(dept: string) => setFilterDept(dept)}
              complianceCache={complianceCache}
              reviewingInBackground={reviewingInBackground}
              onViewCompliance={(
                sopNo: string,
                filters?: {
                  status?: 'all' | 'compliant' | 'partial' | 'non-compliant' | 'not-applicable';
                  severity?: 'all' | 'critical' | 'major' | 'minor' | 'informational';
                },
              ) => {
                setViewingComplianceSopNo(null);
                setViewingComplianceFilter({
                  status: filters?.status ?? "all",
                  severity: filters?.severity ?? "all",
                });
                setViewingComplianceFullSopNo(sopNo);
              }}
              onOpenGuidelineWizard={(row: { _id: string; sopNo: string }) => {
                setGuidelinesWizardPreset(row);
                setShowGuidelinesLibrary(true);
                setWizardMinimized(false);
              }}
              onMarkObsolete={() => triggerRefresh()}
              onSopUpdated={() => triggerRefresh(true)}
              onMarkVersionSuperseded={handleMarkVersionSuperseded}
              isObsoleteView={filterObsolete}
              onRemoveObsolete={handleRemoveFromObsolete}
              removingObsoleteId={removingObsoleteId}
              fileAvailability={fileAvailability}
            />
          </div>
        )}
      </main>

      {/* Recheck Files result modal */}
      {showRecheckPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl flex flex-col" style={{ maxHeight: '80vh' }}>
            {/* Header */}
            <div className="flex items-center justify-between gap-2 rounded-t-xl border-b border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                {recheckingFiles ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                ) : recheckSummary && recheckSummary.notFound > 0 ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600 font-bold text-xs">✗</span>
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 font-bold text-xs">✓</span>
                )}
                <span className="text-sm font-bold text-gray-800">
                  {recheckingFiles ? 'Checking files in Bunny CDN…' : 'File Recheck Result'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowRecheckPanel(false)}
                disabled={recheckingFiles}
                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Loading state */}
            {recheckingFiles && (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                <p className="text-sm text-gray-500">Querying Bunny Storage API for each file…</p>
                <p className="text-xs text-gray-400">This may take 30–60 seconds depending on file count.</p>
              </div>
            )}

            {/* Result */}
            {!recheckingFiles && recheckSummary && (
              <>
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-200">
                  <div className="flex flex-col items-center py-4 bg-white">
                    <span className="text-2xl font-bold text-gray-800">{recheckSummary.checked}</span>
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mt-0.5">Total Checked</span>
                  </div>
                  <div className="flex flex-col items-center py-4 bg-white">
                    <span className="text-2xl font-bold text-emerald-600">{recheckSummary.found}</span>
                    <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wide mt-0.5">Found in Bunny</span>
                  </div>
                  <div className="flex flex-col items-center py-4 bg-white">
                    <span className="text-2xl font-bold text-red-600">{recheckSummary.notFound}</span>
                    <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mt-0.5">Missing / Deleted</span>
                  </div>
                </div>

                {/* DB cleared banner */}
                {recheckSummary.dbCleared > 0 && (
                  <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-100 px-4 py-2 text-xs text-amber-800">
                    <span className="font-bold">DB updated:</span>
                    <span>{recheckSummary.dbCleared} record(s) cleared from database. Dashboard is refreshing…</span>
                  </div>
                )}

                {recheckSummary.notFound === 0 && (
                  <div className="flex items-center gap-2 bg-emerald-50 border-b border-emerald-100 px-4 py-2 text-xs text-emerald-800 font-medium">
                    ✓ All files verified — every DOCX and PDF in the database is present in Bunny CDN.
                  </div>
                )}

                {/* Missing files list */}
                {(recheckSummary.notFoundPaths?.length ?? 0) > 0 && (
                  <div className="flex flex-col min-h-0">
                    <div className="px-4 py-2 bg-red-50 border-b border-red-100">
                      <p className="text-xs font-bold text-red-700">Missing files removed from DB ({recheckSummary.notFoundPaths!.length}):</p>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1" style={{ maxHeight: '260px' }}>
                      {recheckSummary.notFoundPaths!.map((p, i) => {
                        const parts = p.replace(/\\/g, '/').split('/');
                        const name = parts[parts.length - 1] || p;
                        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                        const isDocx = /\.(docx|doc)$/i.test(name);
                        const isPdf = /\.pdf$/i.test(name);
                        return (
                          <div key={i} className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50/60 px-2 py-1.5">
                            <span className={`mt-0.5 shrink-0 text-[9px] font-bold px-1 py-0.5 rounded ${isDocx ? 'bg-purple-100 text-purple-700' : isPdf ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                              {isDocx ? 'DOCX' : isPdf ? 'PDF' : 'FILE'}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold text-red-800 break-all leading-tight">{name.replace(/^\d{10,}[-_]/, '')}</p>
                              {dir && <p className="text-[9px] text-gray-400 break-all leading-none mt-0.5">{dir}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => void handleRecheckFiles()}
                    className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                    <RefreshCw className="h-3.5 w-3.5" /> Run Again
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRecheckPanel(false)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <DepartmentStatsModal
        isOpen={showDeptModal}
        onClose={() => setShowDeptModal(false)}
        data={primaryRegistryData}
      />
      <UploadSOPModal
        isOpen={showUploadModal}
        initialTab={uploadModalTab}
        onClose={() => setShowUploadModal(false)}
        onSuccess={(uploaded: UploadedSOPRef[], generateMcqs: boolean) => {
          // When the user opts into MCQ generation, register each uploaded SOP with the
          // pipeline tracker so the progress dock can poll status until completion.
          // Without MCQs, there's no pipeline to poll — just bust caches and reload.
          if (generateMcqs && uploaded.length > 0) {
            trackMany(
              uploaded.map((u) => ({
                sopId: u.sopId,
                sopIdentifier: u.sopIdentifier,
                sopName: u.sopName,
                department: u.department,
                language: u.language,
              })),
            );
          }
          // Hard refresh via state — keeps React tree mounted (no full-page flash),
          // busts both client caches and forces the server `?refresh=1` rebuild.
          void triggerRefresh(true);
        }}
      />
      <UploadPDFModal
        isOpen={showPdfUploadModal}
        onClose={() => setShowPdfUploadModal(false)}
        onSuccess={() => triggerRefresh()}
      />
      <SOPFolderUploadModal
        isOpen={showSOPFolderUploadModal}
        onClose={() => setShowSOPFolderUploadModal(false)}
        onSuccess={() => {
          // Hard refresh: clears client caches + forces server `?refresh=1` rebuild,
          // but keeps the React tree mounted so the user sees an inline spinner
          // instead of a full white-flash page reload.
          void triggerRefresh(true);
        }}
      />
      <VideoUploadModal
        isOpen={showTrainingVideoModal}
        onClose={() => setShowTrainingVideoModal(false)}
        onSuccess={() => {
          setShowTrainingVideoModal(false);
          // Full refresh so the Videos capsule picks up the new training-video
          // uploads (counted via filename → SOP code linkage server-side).
          void triggerRefresh(true);
        }}
      />
      <PipelineProgressDock
        tracked={trackedPipelines}
        onComplete={() => triggerRefresh()}
        onDismiss={(sopId) => untrack(sopId)}
        onSiblingFound={(entry) => trackUpload(entry)}
      />

      {/* Migrate to Bunny modal */}
      {migrateBunnyState.status !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-base font-bold text-gray-900">Migrate DOCX files to Bunny CDN</h2>

            {migrateBunnyState.status === 'checking' && migrateBunnyState.localCount === null && (
              <div className="flex items-center gap-3 py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                <p className="text-sm text-gray-600">Scanning for local files…</p>
              </div>
            )}

            {migrateBunnyState.status === 'checking' && migrateBunnyState.localCount !== null && (
              <>
                <p className="mt-2 text-sm text-gray-600">
                  Found <span className="font-bold text-orange-600">{migrateBunnyState.localCount}</span> SOP record{migrateBunnyState.localCount !== 1 ? 's' : ''} with local file paths not yet on Bunny CDN.
                </p>
                <p className="mt-1 text-xs text-gray-500">Files will be uploaded to Bunny and DB records updated. This may take a few minutes.</p>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => void handleMigrateToBunnyConfirm()}
                    className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">
                    <Upload className="h-4 w-4" /> Start migration
                  </button>
                  <button
                    type="button"
                    onClick={() => setMigrateBunnyState({ status: 'idle' })}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </>
            )}

            {migrateBunnyState.status === 'running' && (
              <div className="flex items-center gap-3 py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                <p className="text-sm text-gray-600">Uploading files to Bunny CDN… please wait.</p>
              </div>
            )}

            {migrateBunnyState.status === 'done' && (
              <>
                {migrateBunnyState.total === 0 ? (
                  <p className="mt-2 text-sm text-green-700 font-semibold">All files are already on Bunny CDN.</p>
                ) : (
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="text-green-700 font-semibold">Migration complete.</p>
                    <p className="text-gray-600">Uploaded: <span className="font-bold text-green-600">{migrateBunnyState.migrated}</span></p>
                    <p className="text-gray-600">Already on CDN: <span className="font-bold text-gray-700">{migrateBunnyState.skipped}</span></p>
                    {migrateBunnyState.failed > 0 && (
                      <p className="text-red-600">Failed: <span className="font-bold">{migrateBunnyState.failed}</span> (file not found on disk)</p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setMigrateBunnyState({ status: 'idle' })}
                  className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                  Close
                </button>
              </>
            )}

            {migrateBunnyState.status === 'error' && (
              <>
                <p className="mt-2 text-sm text-red-600">{migrateBunnyState.message}</p>
                <button
                  type="button"
                  onClick={() => setMigrateBunnyState({ status: 'idle' })}
                  className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* ── Floating status chips + completion toasts ── */}
      <div className="fixed bottom-6 right-6 z-[99] flex flex-col items-end gap-2 pointer-events-none">
        {/* Completion toasts */}
        {completionToasts.map((toast) => (
          <div
            key={toast.sopNo}
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-xl animate-in slide-in-from-right-4"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <div className="text-sm">
              <p className="font-bold text-gray-900">Analysis complete</p>
              <p className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{toast.sopNo}</span> · {toast.findingsCount} findings
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompletionToasts((prev) => prev.filter((t) => t.sopNo !== toast.sopNo))}
              className="ml-2 rounded p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {/* In-progress chips */}
        {[...reviewingInBackground].map((sopNo) => {
          const elapsed = analysisElapsedMap[sopNo] ?? 0;
          return (
            <div
              key={sopNo}
              className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 shadow-lg"
            >
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600 shrink-0" />
              <div className="text-xs">
                <p className="font-semibold text-gray-800">Analyzing <span className="text-indigo-700">{sopNo}</span></p>
                <p className="text-gray-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
                </p>
              </div>
              {wizardMinimized && showGuidelinesLibrary && (
                <button
                  type="button"
                  onClick={() => setWizardMinimized(false)}
                  className="ml-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  View
                </button>
              )}
            </div>
          );
        })}

        {/* Resume button when wizard is minimized and nothing is running */}
        {wizardMinimized && showGuidelinesLibrary && reviewingInBackground.size === 0 && (
          <button
            type="button"
            onClick={() => setWizardMinimized(false)}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-indigo-600 text-white px-4 py-2 shadow-lg hover:bg-indigo-700 transition-all font-semibold text-sm"
          >
            <Sparkles className="h-4 w-4" />
            Resume Analysis
          </button>
        )}
      </div>
      <SupersededVersionsPanel
        open={showSuperseded}
        onClose={() => setShowSuperseded(false)}
        data={effectiveData}
      />

      {/* Obsolete SOP Details modal */}
      {showObsoleteDetails && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowObsoleteDetails(false)}
        >
          <div
            className="w-full max-w-5xl rounded-xl border border-gray-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
                  <Archive className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-gray-900">Obsolete SOP Details</h2>
                  <p className="text-[10px] font-semibold text-gray-500">
                    {obsoleteListLoading ? "Loading…" : `${obsoleteList.length} SOP(s)`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowObsoleteDetails(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto p-4">
              {obsoleteListLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-400">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-rose-400 border-t-transparent" />
                  <span className="ml-3 text-sm font-semibold">Loading obsolete SOPs…</span>
                </div>
              ) : obsoleteList.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
                  <Archive className="h-10 w-10 opacity-30" />
                  <p className="text-sm font-semibold">No obsolete SOPs found</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="border-b border-gray-200">
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] text-gray-600">SOP No</th>
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] text-gray-600">Name</th>
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] text-gray-600">Department</th>
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] text-gray-600">Language</th>
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] text-gray-600">Obsolete At</th>
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] text-gray-600">Reason</th>
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] text-gray-600 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {obsoleteList.map((item: any) => (
                        <tr key={item.identifier} className="border-b border-gray-100 hover:bg-rose-50/30">
                          <td className="px-3 py-2 font-mono font-bold text-rose-800 whitespace-nowrap">{item.identifier}</td>
                          <td className="px-3 py-2 font-semibold text-gray-800">
                            {item.englishName || item.gujaratiName || item.identifier}
                          </td>
                          <td className="px-3 py-2 text-gray-700">{item.department || "—"}</td>
                          <td className="px-3 py-2 text-gray-700">{item.language || "—"}</td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                            {item.obsoleteAt ? new Date(item.obsoleteAt).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{item.obsoleteReason || "—"}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              disabled={!!removingObsoleteId}
                              onClick={() => void handleRemoveFromObsolete(String(item.identifier))}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                              {removingObsoleteId === String(item.identifier) ? "Restoring…" : "Restore"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <GuidelinesComplianceWizard
        open={showGuidelinesLibrary}
        minimized={wizardMinimized}
        onClose={() => {
          setShowGuidelinesLibrary(false);
          setWizardMinimized(false);
        }}
        onMinimize={() => setWizardMinimized(true)}
        registryRows={data}
        prefetchedGuidelines={prefetchedGuidelines}
        presetSop={guidelinesWizardPreset}
        onResult={handleComplianceResult}
        onAnalysisStart={(sopNo) => {
          setReviewingInBackground((prev) => new Set(prev).add(sopNo));
          setAnalysisStartTimes((prev) => ({ ...prev, [sopNo]: Date.now() }));
        }}
      />
      {viewingComplianceSopNo && complianceCache[viewingComplianceSopNo] && (
        <GuidelinesResultPanel
          result={complianceCache[viewingComplianceSopNo]}
          onClose={() => setViewingComplianceSopNo(null)}
          onRerun={() => {
            const result = complianceCache[viewingComplianceSopNo];
            const row = data.find(
              (r: any) => String(r.sopNo) === viewingComplianceSopNo,
            );
            setViewingComplianceSopNo(null);
            setGuidelinesWizardPreset({
              _id: row ? String(row._id) : "",
              sopNo: result.sopNo,
            });
            setShowGuidelinesLibrary(true);
          }}
        />
      )}

      {/* Full-screen compliance viewer — triggered by orange button */}
      {viewingComplianceFullSopNo && complianceCache[viewingComplianceFullSopNo] && (
        <ComplianceFullViewer
          result={complianceCache[viewingComplianceFullSopNo]}
          onClose={() => setViewingComplianceFullSopNo(null)}
          onRerun={() => {
            const result = complianceCache[viewingComplianceFullSopNo];
            const row = data.find(
              (r: any) => String(r.sopNo) === viewingComplianceFullSopNo,
            );
            setViewingComplianceFullSopNo(null);
            setViewingComplianceFilter({ status: "all", severity: "all" });
            setGuidelinesWizardPreset({
              _id: row ? String(row._id) : "",
              sopNo: result.sopNo,
            });
            setShowGuidelinesLibrary(true);
          }}
          initialFilterStatus={viewingComplianceFilter.status}
          initialFilterSeverity={viewingComplianceFilter.severity}
        />
      )}

    </div>
  );
}
