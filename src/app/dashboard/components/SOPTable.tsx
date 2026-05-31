"use client";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  FileText,
  Video,
  Presentation,
  CheckCircle2,
  AlertTriangle,
  Info,
  File,
  Calendar,
  User as UserIcon,
  Users,
  Eye,
  Download,
  BookOpen,
  Sparkles,
  Printer,
  Trash2,
  X,
  Loader2,
  Pencil,
} from "lucide-react";
import SOPPipelineStatus from "@/components/SOPPipelineStatus";
import { useState, Fragment, useEffect, useRef, useMemo, type ReactNode } from "react";
import {
  fileKindFromStoredPath,
  fileKindToLabel,
} from "@/lib/filePathFileKind";
import {
  buildViewDocHref,
  buildDocxDownloadHref,
  buildPdfDownloadHref,
} from "@/lib/viewDocLinks";
const buildPreviewHref = buildViewDocHref;
import { cleanSOPName } from "@/lib/sopLibraryHelper";
import { normalizeUnicodeHyphens } from "@/lib/sopIdentifierNormalize";
import { pathSuggestsGujarati } from "@/lib/pathLanguageDetection";
import { CAPSULE_DEPARTMENTS } from "@/lib/capsuleDepartments";

const DEPT_ALL = "All";

export default function SOPTable({
  data,
  filterOptionsSource,
  sortConfig,
  onSort,
  onRowClick,
  filterDeptFromParent,
  onDepartmentFilterChange,
  onOpenGuidelineWizard,
  complianceCache,
  reviewingInBackground,
  onViewCompliance,
  onMarkObsolete,
  onSopUpdated,
  onMarkVersionSuperseded,
  isObsoleteView,
  onRemoveObsolete,
  removingObsoleteId,
  fileAvailability,
  resetFiltersTrigger,
}: any) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Dynamic department list: union of canonical depts + every dept seen in the data
  const availableDepartments = useMemo(() => {
    const seen = new Set<string>();
    const rows: any[] = Array.isArray(filterOptionsSource) ? filterOptionsSource : (Array.isArray(data) ? data : []);
    for (const r of rows) {
      const d = typeof r?.department === 'string' ? r.department.trim() : '';
      if (d) seen.add(d);
    }
    for (const d of CAPSULE_DEPARTMENTS) seen.add(d);
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [filterOptionsSource, data]);


  // Inline training-video preview modal state. Opened from the Video column
  // when the user clicks a training-video link on a row.
  type RowTrainingVideo = {
    url: string;
    title: string;
    fileName?: string;
    thumbnailUrl?: string;
    kind: 'brief' | 'explainer' | 'unknown';
    language: 'English' | 'Gujarati';
  };
  const [previewVideo, setPreviewVideo] = useState<
    | (RowTrainingVideo & { sopNo?: string; department?: string })
    | null
  >(null);

  // Obsolete confirm modal state
  const [obsoleteTarget, setObsoleteTarget] = useState<{ sopNo: string; sopName: string } | null>(null);
  const [obsoletePassword, setObsoletePassword] = useState("");
  const [obsoleteBusy, setObsoleteBusy] = useState(false);
  const [obsoleteError, setObsoleteError] = useState("");
  const obsoleteInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm modal state
  const [deleteTarget, setDeleteTarget] = useState<{ sopNo: string; sopName: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteInputRef = useRef<HTMLInputElement>(null);

  // Edit modal state
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    sopName: '',
    department: '',
    location: '',
    version: '',
    effectiveDate: '',
    reviewDate: '',
    owner: '',
    processArea: '',
    guidelineReference: '',
    remarks: '',
    englishDocxLink: '',
    englishPdfLink: '',
    gujaratiDocxLink: '',
    gujaratiPdfLink: '',
    englishVideoLink: '',
    gujaratiVideoLink: '',
    englishSlideLink: '',
    gujaratiSlideLink: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState(false);

  const [filters, setFilters] = useState({
    department: "",
    language: "",
    fileType: "",
    videos: "",
    presentations: "",
    expiryStatus: "",
  });

  useEffect(() => {
    if (resetFiltersTrigger) {
      setFilters({
        department: "",
        language: "",
        fileType: "",
        videos: "",
        presentations: "",
        expiryStatus: "",
      });
    }
  }, [resetFiltersTrigger]);

  useEffect(() => {
    if (filterDeptFromParent === undefined) return;
    const next =
      filterDeptFromParent === DEPT_ALL || !filterDeptFromParent
        ? ""
        : filterDeptFromParent;
    setFilters((prev) =>
      prev.department === next ? prev : { ...prev, department: next },
    );
  }, [filterDeptFromParent]);

  const getRawLanguage = (row: any) => {
    if (row.isDualLanguage) return "ENG/GUJ";
    if (row.gujaratiFileMissing) return "ENG (GUJ missing)";
    return isGujaratiLanguage(row.language) ? "GUJ" : "ENG";
  };
  const isGujaratiLanguage = (value: unknown) =>
    String(value || "").trim().toLowerCase() === "gujarati";

  const getRawFileTypes = (row: any) => {
    const types = new Set<string>();
    if (row.sopFile?.filePath)
      types.add(
        fileKindToLabel(
          fileKindFromStoredPath(row.sopFile.filePath, row.sopFile.fileType),
        ),
      );
    (row.sopDocuments || []).forEach((doc: any) => {
      if (doc.filePath)
        types.add(
          fileKindToLabel(fileKindFromStoredPath(doc.filePath, doc.fileType)),
        );
    });
    const arr = Array.from(types).sort();
    return arr.length === 0 ? "None" : arr.join(" / ");
  };

  const getRawVideos = (row: any) =>
    (row.mediaStatus?.videoCount ?? (row.mediaStatus?.videos ? 1 : 0)) > 0
      ? "Yes"
      : "No";
  const getRawPresentations = (row: any) =>
    (row.mediaStatus?.slideCount ?? (row.mediaStatus?.slides ? 1 : 0)) > 0
      ? "Yes"
      : "No";

  const extractLinksFromRow = (row: any) => {
    let engDocx = '';
    let engPdf = '';
    let gujDocx = '';
    let gujPdf = '';

    const addLink = (path: string, lang: string, type: string) => {
      if (!path) return;
      const k = fileKindFromStoredPath(path, type);
      const isGuj = isGujaratiLanguage(lang) || pathSuggestsGujarati(path);
      if (isGuj) {
        if ((k === 'docx' || k === 'doc') && !gujDocx) gujDocx = path;
        if (k === 'pdf' && !gujPdf) gujPdf = path;
      } else {
        if ((k === 'docx' || k === 'doc') && !engDocx) engDocx = path;
        if (k === 'pdf' && !engPdf) engPdf = path;
      }
    };

    if (row.sopFile?.filePath) addLink(row.sopFile.filePath, row.sopFile.language || 'English', row.sopFile.fileType);
    if (row.gujaratiFileUrl) addLink(row.gujaratiFileUrl, 'Gujarati', 'pdf');
    (row.sopDocuments || []).forEach((doc: any) => {
      addLink(doc.filePath, doc.language || 'English', doc.fileType);
    });

    return { engDocx, engPdf, gujDocx, gujPdf };
  };

  const getRawExpiryStatus = (row: any) => {
    if (!row.expiryDate) return "Not Set";
    const expiry = new Date(row.expiryDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.floor(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays < 0) return "Expired";
    if (diffDays <= 30) return "High Priority";
    if (diffDays <= 60) return "Medium Priority";
    return "Active";
  };

  const getGuidelineMetrics = (row: any) => {
    const result = complianceCache && complianceCache[row.sopNo];
    const findings = Array.isArray(result?.findings) ? result.findings : [];
    const nonCompliant = findings.filter(
      (f: any) => f?.complianceLevel === "non-compliant",
    ).length;
    const partial = findings.filter(
      (f: any) => f?.complianceLevel === "partial",
    ).length;
    const informational = findings.filter(
      (f: any) =>
        String(f?.issueSeverity || "").toLowerCase() === "informational",
    ).length;
    return {
      result,
      nonCompliant,
      partial,
      informational,
      total: findings.length,
    };
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortConfig.key !== field)
      return (
        <ArrowUpDown className="h-3 w-3 text-gray-400 ml-0.5 inline opacity-60" />
      );
    return sortConfig.direction === "asc" ? (
      <ArrowUp className="h-3 w-3 text-purple-600 ml-0.5 inline" />
    ) : (
      <ArrowDown className="h-3 w-3 text-purple-600 ml-0.5 inline" />
    );
  };

  const toggleRow = (rowId: string) =>
    setExpandedRow(expandedRow === rowId ? null : rowId);

  /** In-app preview for DOCX/PDF (including CDN https paths). Other URLs fall back to download/open. */
  const buildPreviewHref = (
    path: string,
    identifier?: string,
    language?: string,
  ) => {
    const trimmed = (path || "").trim();
    const kind = fileKindFromStoredPath(trimmed);
    if (kind === "docx" || kind === "doc") {
      return buildViewDocHref(path, identifier, language);
    }
    if (kind === "pdf") {
      const dl = new URLSearchParams();
      dl.set("path", path);
      if (identifier) dl.set("identifier", identifier);
      if (language) dl.set("language", language);
      return `/api/files/download?${dl.toString()}`;
    }
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const dl = new URLSearchParams();
    dl.set("path", path);
    dl.set("open", "1");
    if (identifier) dl.set("identifier", identifier);
    if (language) dl.set("language", language);
    return `/api/files/download?${dl.toString()}`;
  };

  type VersionArtifactEntry = {
    version: number;
    docxPath?: string;
    pdfPath?: string;
  };

  /** Registry: show v09, v10 (two-digit) for single-digit revs; three-digit left as-is */
  const formatPriorVersionLabel = (v: number) => {
    const n =
      typeof v === "number" && !Number.isNaN(v) ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n)) return "V?";
    return `V${n}`;
  };

  /**
   * Prior-version column: always the last `maxRows` revisions immediately below current (inclusive of V0).
   * V1 → [0]; V2 → [1,0]; V6 → [5,4]. Uses SOP No revision when parsable; else highest stored artifact version.
   */
  const computePriorVersionSlotVersions = (
    entries: VersionArtifactEntry[],
    currentRev: number | null,
    maxRows: number,
  ): number[] => {
    const highestStored =
      entries.length > 0
        ? Math.max(...entries.map((e) => Number(e.version)))
        : null;
    const effectiveCurrent =
      currentRev != null && Number.isFinite(currentRev)
        ? currentRev
        : highestStored;
    if (
      effectiveCurrent == null ||
      !Number.isFinite(effectiveCurrent) ||
      effectiveCurrent < 1
    ) {
      return [];
    }
    const numSlots = Math.min(maxRows, effectiveCurrent);
    const out: number[] = [];
    for (let i = 1; i <= numSlots; i++) {
      const v = effectiveCurrent - i;
      if (v < 0) break;
      out.push(v);
    }
    return out;
  };

  /**
   * Stacked ENG/GUJ prior columns: true bilingual row, or both languages have files in registry
   * (some SOPs are not flagged `isDualLanguage` but still have English + Gujarati docs — e.g. MAGE01-08).
   */
  const useAlignedEnGuPriorVersions = (row: any) =>
    Boolean(row?.isDualLanguage) ||
    (Boolean(row?.englishVersion) && Boolean(row?.gujaratiVersion));

  /** One language row: V5 / V4 columns with DOCX+PDF or “Not Found” when no files for that slot. */
  const renderVersionArtifactSlotRow = (
    entries: VersionArtifactEntry[] | undefined,
    row: any,
    lang: "English" | "Gujarati",
    slotVersions: number[],
    subLabel?: string,
    allowSupersede = false,
  ): ReactNode => {
    if (slotVersions.length === 0) return null;
    const safeEntries = entries ?? [];
    const entryByVersion = new Map<number, VersionArtifactEntry>(
      safeEntries.map((e) => [e.version, e]),
    );
    const sorted = slotVersions.map((v) => {
      const entry = entryByVersion.get(v);
      return entry ?? { version: v, missing: true };
    });

    return (
      <div className="flex flex-row flex-nowrap items-center gap-x-2 leading-none">
        {subLabel && (
          <span className="text-[8px] font-bold uppercase text-gray-400 leading-none w-[18px] shrink-0">
            {subLabel}
          </span>
        )}
        <div className="flex flex-row flex-nowrap gap-3 items-center">
          {sorted.map((e) => (
            <div key={`${lang}-v${e.version}`} className="flex flex-row items-center gap-0.5">
              <span className="text-[9px] font-bold text-gray-700 leading-none whitespace-nowrap">
                {formatPriorVersionLabel(e.version)}
              </span>
              {"missing" in e ? (
                <span
                  className="text-[8px] font-bold text-red-500 leading-none"
                  title="This version was not uploaded — not available">
                  ✗
                </span>
              ) : (
              <div className="flex items-center gap-0.5 leading-none text-[8px] font-bold">
                {e.docxPath ? (
                  <a
                    href={buildPreviewHref(e.docxPath, row.sopNo, lang)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    className="text-green-600 hover:underline">
                    DOCX
                  </a>
                ) : (e.pdfPath ? (
                  <span
                    className="text-red-500"
                    title="DOCX file is missing for this version">
                    DOCX
                  </span>
                ) : null)}
                {(e.docxPath || e.pdfPath) ? (
                  <span className="text-gray-300 select-none">/</span>
                ) : null}
                {e.pdfPath ? (
                  <a
                    href={buildPreviewHref(e.pdfPath, row.sopNo, lang)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    className="text-green-600 hover:underline">
                    PDF
                  </a>
                ) : (e.docxPath ? (
                  <span
                    className="text-red-500"
                    title="PDF file is missing for this version">
                    PDF
                  </span>
                ) : null)}
                {!e.docxPath && !e.pdfPath ? (
                  <span className="text-gray-400">—</span>
                ) : null}
                {allowSupersede ? (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onMarkVersionSuperseded?.({
                        sopNo: String(row.sopNo || ""),
                        lang,
                        version: Number(e.version),
                        docxPath: e.docxPath,
                        pdfPath: e.pdfPath,
                      });
                    }}
                    className="ml-1 rounded border border-amber-300 bg-amber-50 px-1 py-px text-[7px] font-bold text-amber-900 hover:bg-amber-100"
                    title="Move this version to Supersede SOP section">
                    Supersede
                  </button>
                ) : null}
              </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderVersionArtifactLinks = (
    entries: VersionArtifactEntry[] | undefined,
    row: any,
    lang: "English" | "Gujarati",
    subLabel?: string,
    maxRows = 2,
    allowSupersede = false,
  ): ReactNode => {
    if (!entries?.length) return null;
    const currentRev = getDisplayCurrentRevision(row);
    const slots = computePriorVersionSlotVersions(entries, currentRev, maxRows);
    if (slots.length === 0) return null;
    return renderVersionArtifactSlotRow(
      entries,
      row,
      lang,
      slots,
      subLabel,
      allowSupersede,
    );
  };

  const getFirstPathByType = (row: any, type: string): string | null => {
    const t = type.toLowerCase() as "pdf" | "docx" | "doc";
    const matches = (path: string, declared?: string) =>
      fileKindFromStoredPath(path, declared) === t;
    if (
      row.sopFile?.filePath &&
      matches(row.sopFile.filePath, row.sopFile.fileType)
    )
      return row.sopFile.filePath;
    const doc = (row.sopDocuments || []).find(
      (d: any) => d.filePath && matches(d.filePath, d.fileType),
    );
    return doc?.filePath || null;
  };

  /** Same physical file may appear with/without leading slash or mixed separators */
  const normalizePathKey = (p: string) => {
    const base = (p || "").trim().split(/[?#]/)[0];
    return base
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
  };

  const getFileTypes = (row: any) => {
    // Enhanced language detection: checks both explicit language field and path-based heuristics
    const detectDocLang = (doc: any): "GUJ" | "ENG" => {
      if (isGujaratiLanguage(doc.language)) return "GUJ";
      // If no explicit language but path contains Gujarati signals, classify as GUJ
      const pathStr = doc.filePath || doc.fileUrl || '';
      if (pathStr && pathSuggestsGujarati(pathStr)) return "GUJ";
      return "ENG";
    };

    const rawDocs: Array<{ type: string; path: string; lang: string }> = [];

    (row.sopDocuments || []).forEach((doc: any) => {
      if (doc.filePath) {
        rawDocs.push({
          type: fileKindToLabel(
            fileKindFromStoredPath(doc.filePath, doc.fileType),
          ),
          path: doc.filePath,
          lang: detectDocLang(doc),
        });
      }
    });

    // Primary sopFile only if not already listed (avoids duplicate DOCX line when library + row share the same path)
    if (row.sopFile?.filePath) {
      const k = normalizePathKey(row.sopFile.filePath);
      const dup = rawDocs.some((d) => normalizePathKey(d.path) === k);
      if (!dup) {
        rawDocs.push({
          type: fileKindToLabel(
            fileKindFromStoredPath(row.sopFile.filePath, row.sopFile.fileType),
          ),
          path: row.sopFile.filePath,
          lang: detectDocLang(row.sopFile),
        });
      }
    }
    if (rawDocs.length === 0) {
      const isDual = Boolean(row.isDualLanguage) || Boolean(row.gujaratiFileMissing);
      const missingRow = (langLabel: string) => (
        <div className="grid grid-cols-[20px_50px_4px_42px] items-center gap-x-0.5 text-left leading-none min-h-[10px]">
          <span className="text-[8px] font-bold text-gray-500">{langLabel}</span>
          <span className="text-[8px] font-bold leading-none text-red-600 whitespace-nowrap" title="DOCX link cleared — file missing">DOCX&nbsp;✗</span>
          <div className="flex justify-center text-gray-300 text-[9px] select-none" />
          <span className="text-[8px] font-bold leading-none text-red-600 whitespace-nowrap" title="PDF link cleared — file missing">PDF&nbsp;✗</span>
        </div>
      );
      return (
        <div className="flex w-max flex-col gap-px text-left leading-none">
          {missingRow("ENG")}
          {isDual ? missingRow("GUJ") : null}
        </div>
      );
    }

    const pathsSeenAsEng = new Set<string>();
    rawDocs.forEach((d) => {
      if (d.lang === "ENG") pathsSeenAsEng.add(normalizePathKey(d.path));
    });

    /** Same physical path as an English doc → one link only (ENG). Otherwise trust SOPLibrary `language` even if the path has no "guj" in the filename. */
    const validatedDocs = rawDocs.map((d) => {
      if (d.lang !== "GUJ") return d;
      if (pathsSeenAsEng.has(normalizePathKey(d.path)))
        return { ...d, lang: "ENG" };
      return d;
    });

    // One row per unique file (normalized path); prefer ENG if both tagged
    const byNormPath = new Map<string, (typeof validatedDocs)[number]>();
    validatedDocs.forEach((d) => {
      const key = normalizePathKey(d.path);
      const existing = byNormPath.get(key);
      if (!existing) {
        byNormPath.set(key, d);
        return;
      }
      if (existing.lang === "GUJ" && d.lang === "ENG") byNormPath.set(key, d);
    });
    const cleanedDocs = Array.from(byNormPath.values());

    /** At most one link per language + file type (avoids DOCX DOCX PDF PDF from duplicate library rows) */
    const byLangType = new Map<string, (typeof cleanedDocs)[number]>();
    for (const d of cleanedDocs) {
      const key = `${d.lang}:${(d.type || "").toUpperCase()}`;
      if (!byLangType.has(key)) byLangType.set(key, d);
    }
    const uniqueDocs = Array.from(byLangType.values());

    const typeOrder = (t: string) =>
      t === "DOCX" || t === "DOC" ? 0 : t === "PDF" ? 1 : 2;
    const engDocs = uniqueDocs
      .filter((d) => d.lang === "ENG")
      .sort((a, b) => typeOrder(a.type) - typeOrder(b.type));
    const gujDocs = uniqueDocs
      .filter((d) => d.lang === "GUJ")
      .sort((a, b) => typeOrder(a.type) - typeOrder(b.type));
    const hasBothFileLangs = engDocs.length > 0 && gujDocs.length > 0;
    /** Same layout as prior-version columns: bilingual DB row, both version flags, both langs in Files, or GUJ file missing */
    const useLangRows =
      Boolean(row.isDualLanguage) ||
      hasBothFileLangs ||
      Boolean(row.gujaratiFileMissing) ||
      (Boolean(row.englishVersion) && Boolean(row.gujaratiVersion));

    const isWordType = (t: string) => t === "DOCX" || t === "DOC";

    const renderSlot = (doc: (typeof uniqueDocs)[number] | undefined) => {
      if (!doc) return <div />;

      const langParam = doc.lang === "GUJ" ? "Gujarati" : "English";
      const previewHref = buildPreviewHref(
        doc.path,
        row.sopNo,
        langParam,
      );
      const pathKind = fileKindFromStoredPath(doc.path, doc.type);
      const docxDlHref =
        pathKind === "docx" || pathKind === "doc"
          ? buildDocxDownloadHref(doc.path, row.sopNo, langParam)
          : null;
      const pdfDlHref =
        pathKind === "pdf"
          ? buildPdfDownloadHref(doc.path, row.sopNo, langParam)
          : null;
      const isWord = isWordType(doc.type);
      const linkColor = "text-green-600";
      const fileLinkClass = `font-bold text-[9px] ${linkColor} hover:underline whitespace-nowrap shrink-0`;

      // If a recheck has been run and this specific path is confirmed missing in Bunny CDN
      if (fileAvailability && fileAvailability[doc.path] === false) {
        return (
          <span
            className="text-[8px] font-bold leading-none text-red-600"
            title={`${doc.type} not found in Bunny CDN (file was deleted or moved)`}>
            {doc.type} ✗
          </span>
        );
      }

      return (
        <div className="flex flex-nowrap items-center gap-0.5 overflow-visible">
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className={fileLinkClass}
            title={isWord ? "Preview document" : "Preview PDF"}
            onClick={(e) => e.stopPropagation()}>
            {doc.type}
          </a>
          {docxDlHref ? (
            <a
              href={docxDlHref}
              className="shrink-0 rounded p-px text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title={`Download ${doc.type}`}
              onClick={(e) => e.stopPropagation()}>
              <Download className="h-2.5 w-2.5" />
            </a>
          ) : pdfDlHref ? (
            <a
              href={pdfDlHref}
              target="_blank"
              rel="noopener noreferrer"
              title={`Download ${doc.type}`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded p-px text-slate-600 hover:bg-slate-100"
              aria-label={`Download ${doc.type}`}>
              <Download className="h-2.5 w-2.5" />
            </a>
          ) : null}
        </div>
      );
    };

    const renderLangRow = (docs: typeof cleanedDocs, langLabel: string) => {
      const wordDoc = docs.find((d) => isWordType(d.type));
      const pdfDoc = docs.find((d) => d.type === "PDF");

      return (
        <div className="grid grid-cols-[20px_50px_4px_42px] items-center gap-x-0.5 text-left leading-none min-h-[10px]">
          <span className="text-[8px] font-bold text-gray-500">
            {langLabel}
          </span>
          {docs.length === 0 ? (
            <>
              <span className="text-[8px] font-bold leading-none text-red-600" title="DOCX link cleared — file missing">DOCX ✗</span>
              <div className="flex justify-center text-gray-300 text-[9px] select-none" />
              <span className="text-[8px] font-bold leading-none text-red-600" title="PDF link cleared — file missing">PDF ✗</span>
            </>
          ) : (
            <>
              {wordDoc ? (
                renderSlot(wordDoc)
              ) : (
                <span
                  className="text-[8px] font-bold leading-none text-red-600 whitespace-nowrap"
                  title="DOCX missing for this language (current revision)">
                  DOCX&nbsp;✗
                </span>
              )}
              <div className="flex justify-center text-gray-300 text-[9px] select-none">
                {wordDoc && pdfDoc ? "·" : ""}
              </div>
              {pdfDoc ? (
                renderSlot(pdfDoc)
              ) : (
                <span
                  className="text-[8px] font-bold leading-none text-red-600 whitespace-nowrap"
                  title="PDF missing for this language (current revision)">
                  PDF&nbsp;✗
                </span>
              )}
            </>
          )}
        </div>
      );
    };

    return (
      <div className="flex w-max flex-col gap-px text-left leading-none">
        {engDocs.length > 0 || useLangRows
          ? renderLangRow(engDocs, "ENG")
          : null}
        {gujDocs.length > 0 || useLangRows
          ? renderLangRow(gujDocs, "GUJ")
          : null}
      </div>
    );
  };

  /** e.g. 1028 days (34 months 8 days) — months = floor(days/30), remainder days */
  const formatExpiryVerbose = (dateStr: any): ReactNode => {
    if (!dateStr) return (
      <span className="inline-block rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[8px] font-semibold text-gray-400">
        No Date
      </span>
    );
    const review = new Date(dateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.floor(
      (review.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    const absDays = Math.abs(diffDays);
    const dayBasis = diffDays >= 0 ? diffDays : absDays;
    const months = Math.floor(dayBasis / 30);
    const remDays = dayBasis - months * 30;
    const moLabel = months === 1 ? "month" : "months";
    const dayLabel = remDays === 1 ? "day" : "days";
    const breakdown =
      months > 0 && remDays > 0
        ? ` (${months} ${moLabel} ${remDays} ${dayLabel})`
        : months > 0
          ? ` (${months} ${moLabel})`
          : remDays > 0 && absDays < 30
            ? ""
            : absDays > 0
              ? ` (${remDays} ${dayLabel})`
              : "";

    let label = "";
    let colorClass = "";
    const topDayWord = (d: number) => (d === 1 ? "day" : "days");
    if (diffDays < 0) {
      label = `Expired · ${absDays} ${topDayWord(absDays)} ago${breakdown}`;
      colorClass = "text-red-700 bg-red-50 border-red-200";
    } else if (diffDays <= 30) {
      label = `${diffDays} ${topDayWord(diffDays)}${breakdown}`;
      colorClass = "text-orange-700 bg-orange-50 border-orange-200";
    } else {
      label = `${diffDays} ${topDayWord(diffDays)}${breakdown}`;
      colorClass =
        diffDays <= 90
          ? "text-yellow-800 bg-yellow-50 border-yellow-200"
          : "text-emerald-800 bg-emerald-50 border-emerald-200";
    }
    return (
      <span
        className={`inline-block max-w-[200px] rounded border px-1 py-0.5 text-[8px] font-semibold leading-snug ${colorClass}`}
        title={`Expiry: ${review.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}>
        {label}
      </span>
    );
  };

  const getVersionNum = (sopNo: string) => {
    if (typeof sopNo !== "string") return null;
    const u = normalizeUnicodeHyphens(sopNo.trim()).replace(
      /[\u200B-\u200D\uFEFF]/g,
      "",
    );
    const m = u.match(/-0*(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  };

  /** Current revision from SOP No (QAGE01-11 → 11); folder-only rows may only have row.version */
  const getDisplayCurrentRevision = (row: any): number | null => {
    const fromNo = getVersionNum(row.sopNo);
    if (fromNo != null) return fromNo;
    const rv = row.version;
    if (typeof rv === "number" && Number.isFinite(rv)) return rv;
    if (typeof rv === "string" && /^\d+$/.test(rv.trim()))
      return parseInt(rv.trim(), 10);
    return null;
  };


  const deriveGujaratiSubtitle = (row: any): string => {
    const direct = String(row?.gujaratiName || "").trim();
    if (direct && /[\u0A80-\u0AFF]/.test(direct)) return direct;

    // Fallback: Gujarati file entries often carry the real title in fileName/path.
    const gujDoc = (row?.sopDocuments || []).find((d: any) => {
      const lang = String(d?.language || "").toLowerCase();
      if (lang !== "gujarati") return false;
      const raw = String(d?.fileName || d?.filePath || "");
      return /[\u0A80-\u0AFF]/.test(raw);
    });
    if (!gujDoc) return "";

    const raw = String(gujDoc.fileName || gujDoc.filePath || "");
    const cleaned = cleanSOPName(raw, row?.sopNo);
    return /[\u0A80-\u0AFF]/.test(cleaned) ? cleaned : "";
  };

  // Precompute the filter-relevant string for each row ONCE per data array.
  // Both the row-filter pass and (when no separate source is provided) the
  // dropdown unique-value sets share this cache, so we don't re-scan
  // sopFile/sopDocuments paths or build Dates on every sort click.
  const rowFilterKeys = useMemo(() => {
    return data.map((row: any) => ({
      department: row.department || "",
      language: getRawLanguage(row),
      fileType: getRawFileTypes(row),
      videos: getRawVideos(row),
      presentations: getRawPresentations(row),
      expiryStatus: getRawExpiryStatus(row),
    }));
  }, [data]);

  // Dropdown options should reflect the FULL dataset (so selecting a department
  // doesn't shrink the department dropdown to just that department). Source from
  // `filterOptionsSource` when provided, else fall back to the (already-filtered)
  // `data`.
  const optionsSource: any[] = filterOptionsSource ?? data;

  const {
    uniqueDepartments,
    uniqueLanguages,
    uniqueFileTypes,
    uniqueVideos,
    uniquePresentations,
    uniqueExpiryStatus,
  } = useMemo(() => {
    const depts = new Set<string>([
      "Engineering and Maintenance",
      "Microbiology",
      "Personnel",
      "Production",
      "QA",
      "QC",
      "Store",
    ]);
    const langs = new Set<string>();
    const files = new Set<string>();
    const vids = new Set<string>();
    const pres = new Set<string>();
    const exp = new Set<string>();

    for (const row of optionsSource) {
      const d = row.department || "";
      if (d) depts.add(d);
      const l = getRawLanguage(row);
      if (l) langs.add(l);
      const f = getRawFileTypes(row);
      if (f) files.add(f);
      const v = getRawVideos(row);
      if (v) vids.add(v);
      const p = getRawPresentations(row);
      if (p) pres.add(p);
      const e = getRawExpiryStatus(row);
      if (e) exp.add(e);
    }

    return {
      uniqueDepartments: Array.from(depts).filter(Boolean).sort(),
      uniqueLanguages: Array.from(langs).filter(Boolean).sort(),
      uniqueFileTypes: Array.from(files).filter(Boolean).sort(),
      uniqueVideos: Array.from(vids).filter(Boolean).sort(),
      uniquePresentations: Array.from(pres).filter(Boolean).sort(),
      uniqueExpiryStatus: Array.from(exp).filter(Boolean).sort(),
    };
  }, [optionsSource]);

  const displayedData = useMemo(() => {
    const noFilters =
      !filters.department &&
      !filters.language &&
      !filters.fileType &&
      !filters.videos &&
      !filters.presentations &&
      !filters.expiryStatus;
    if (noFilters) return data;
    return data.filter((row: any, i: number) => {
      const k = rowFilterKeys[i];
      if (filters.department && k.department !== filters.department) return false;
      if (filters.language && k.language !== filters.language) return false;
      if (filters.fileType && k.fileType !== filters.fileType) return false;
      if (filters.videos && k.videos !== filters.videos) return false;
      if (filters.presentations && k.presentations !== filters.presentations)
        return false;
      if (filters.expiryStatus && k.expiryStatus !== filters.expiryStatus)
        return false;
      return true;
    });
  }, [data, rowFilterKeys, filters]);

  const thBase =
    "px-1 py-0.5 align-top text-[9px] font-bold text-gray-600 uppercase tracking-wide whitespace-normal break-words";
  const selBase =
    "w-full text-[8px] p-px border border-gray-300 rounded bg-white focus:outline-none focus:border-purple-500 cursor-pointer leading-tight";
  const sortBtn =
    "flex w-full items-center gap-0.5 rounded px-0.5 py-1 text-left font-bold uppercase tracking-wide text-gray-600 hover:bg-purple-50/80 hover:text-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-400";

  return (
    <div className="flex flex-col w-full bg-gray-50">
      <div
        className="w-full overflow-auto overscroll-contain"
        style={{
          // Keeps layout stable when scrollbars appear/disappear (prevents “jumping”).
          scrollbarGutter: "stable both-edges",
          // Hint to the browser that this subtree is independent (reduces scroll jank on big tables).
          contain: "content",
        }}>
        <table className="w-full min-w-max table-fixed text-left border-collapse">
          <thead className="bg-gray-100 border-b border-gray-300">
            <tr>
              <th className={`${thBase} text-center w-10`} title="Serial number">
                SR
              </th>
              <th className={`${thBase} whitespace-nowrap w-32`}>
                <button
                  type="button"
                  className={sortBtn}
                  onClick={() => onSort("sopNo")}>
                  SOP No <SortIcon field="sopNo" />
                </button>
              </th>
              <th
                className={`${thBase} text-center w-12 whitespace-nowrap`}
                title="Current revision from SOP number (e.g. QAGE01-11 → 11)">
                <button
                  type="button"
                  className={sortBtn}
                  onClick={() => onSort("version")}>
                  Ver <SortIcon field="version" />
                </button>
              </th>
              <th className={`${thBase} w-[24rem]`}>
                <button
                  type="button"
                  className={sortBtn}
                  onClick={() => onSort("sopName")}>
                  SOP Name <SortIcon field="sopName" />
                </button>
              </th>
              <th className={`${thBase} w-20`}>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[8px] font-bold text-gray-500 uppercase tracking-widest leading-none">Guideline</span>
                  <button
                    type="button"
                    className={`${sortBtn} justify-center py-0.5`}
                    onClick={() => onSort("guidelineScore")}
                    title="Sort by guideline compliance score">
                    <Sparkles className="h-3 w-3 text-orange-500 shrink-0" />
                    <SortIcon field="guidelineScore" />
                  </button>
                </div>
              </th>
              <th className={`${thBase} w-28`}>
                <button
                  type="button"
                  className={sortBtn}
                  onClick={() => onSort("location")}>
                  Location <SortIcon field="location" />
                </button>
              </th>
              <th
                className={`${thBase} w-[16rem]`}
                title="Up to two prior revisions (DOCX/PDF links) per language. Older files: Supersede SOP.">
                <button
                  type="button"
                  className={sortBtn}
                  onClick={() => onSort("priorVersionCount")}>
                  Prior versions <SortIcon field="priorVersionCount" />
                </button>
              </th>
              <th className={`${thBase} w-40`}>
                <div className="flex flex-col gap-px">
                  <button
                    type="button"
                    className={sortBtn}
                    onClick={() => onSort("department")}>
                    Department <SortIcon field="department" />
                  </button>
                  <select
                    className={selBase}
                    value={filters.department}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFilters({ ...filters, department: next });
                      // Keep the parent's filterDept in sync so the upstream
                      // filter pipeline doesn't pre-narrow rows behind us.
                      onDepartmentFilterChange?.(next ? next : DEPT_ALL);
                    }}>
                    <option value="">All</option>
                    {uniqueDepartments.map((v: any) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
              <th className={`${thBase} w-20`}>
                <div className="flex flex-col gap-px">
                  <button
                    type="button"
                    className={sortBtn}
                    onClick={() => onSort("language")}>
                    Lang <SortIcon field="language" />
                  </button>
                  <select
                    className={selBase}
                    value={filters.language}
                    onChange={(e) =>
                      setFilters({ ...filters, language: e.target.value })
                    }>
                    <option value="">All</option>
                    {uniqueLanguages.map((v: any) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
              <th
                className={`${thBase} w-32 pr-3`}
                title="Current approved files: English first, then Gujarati when dual">
                <div className="flex flex-col gap-px">
                  <button
                    type="button"
                    className={sortBtn}
                    onClick={() => onSort("fileType")}>
                    Files <SortIcon field="fileType" />
                  </button>
                  <select
                    className={selBase}
                    value={filters.fileType}
                    onChange={(e) =>
                      setFilters({ ...filters, fileType: e.target.value })
                    }>
                    <option value="">All</option>
                    {uniqueFileTypes.map((v: any) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
              <th className={`${thBase} w-24 pr-3`}>
                <div className="flex flex-col gap-px">
                  <button
                    type="button"
                    className={sortBtn}
                    onClick={() => onSort("videos")}
                    title="Sort by video attachments">
                    Video <SortIcon field="videos" />
                  </button>
                  <select
                    className={selBase}
                    value={filters.videos}
                    onChange={(e) =>
                      setFilters({ ...filters, videos: e.target.value })
                    }>
                    <option value="">All</option>
                    {uniqueVideos.map((v: any) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
              <th className={`${thBase} w-20`}>
                <div className="flex flex-col gap-px">
                  <button
                    type="button"
                    className={sortBtn}
                    onClick={() => onSort("slides")}
                    title="Sort by slide decks">
                    Slides <SortIcon field="slides" />
                  </button>
                  <select
                    className={selBase}
                    value={filters.presentations}
                    onChange={(e) =>
                      setFilters({ ...filters, presentations: e.target.value })
                    }>
                    <option value="">All</option>
                    {uniquePresentations.map((v: any) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
              <th className={`${thBase} w-28`}>
                <div className="flex flex-col gap-px">
                  <button
                    type="button"
                    className={sortBtn}
                    onClick={() => onSort("createdAt")}
                    title="Sort by upload date">
                    Uploaded <SortIcon field="createdAt" />
                  </button>
                </div>
              </th>
              <th className={`${thBase} w-36`}>
                <div className="flex flex-col gap-px">
                  <button
                    type="button"
                    className={sortBtn}
                    onClick={() => onSort("expiryDate")}>
                    Expiry <SortIcon field="expiryDate" />
                  </button>
                  <select
                    className={selBase}
                    value={filters.expiryStatus}
                    onChange={(e) =>
                      setFilters({ ...filters, expiryStatus: e.target.value })
                    }>
                    <option value="">All</option>
                    {uniqueExpiryStatus.map((v: any) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </th>

            </tr>
          </thead>
          <tbody className="text-[10px] text-gray-700">
            {isObsoleteView && displayedData.length > 0 && (
              <tr className="bg-rose-50 border-b border-rose-200">
                <td colSpan={14} className="px-3 py-1.5 text-[10px] font-semibold text-rose-700">
                  Showing {displayedData.length} obsolete SOP{displayedData.length !== 1 ? "s" : ""} — these have been removed from the active registry. Expand a row to restore.
                </td>
              </tr>
            )}
            {displayedData.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="px-4 py-6 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-1">
                    <FileText className="h-5 w-5 text-gray-300" />
                    <p className="text-xs">No SOPs found</p>
                  </div>
                </td>
              </tr>
            ) : (
              displayedData.map((row: any, idx: number) => {
                const isExpanded = expandedRow === row._id;
                const vNum = getVersionNum(row.sopNo);
                const displayRev = getDisplayCurrentRevision(row);
                const videoCount =
                  row.mediaStatus?.videoCount ?? (row.mediaStatus?.videos ? 1 : 0);
                const slideCount =
                  row.mediaStatus?.slideCount ?? (row.mediaStatus?.slides ? 1 : 0);
                const mediaTags = [
                  videoCount > 0 ? "VIDEO_READY" : "VIDEO_PENDING",
                  slideCount > 0 ? "SLIDE_READY" : "SLIDE_PENDING",
                  row.isDualLanguage ? "LANG_BOTH" : row.language === "Gujarati" ? "LANG_GUJ" : "LANG_ENG",
                  `TYPE_${String(row.sopNo || "").replace(/[^A-Za-z].*$/, "").toUpperCase() || "GEN"}`,
                ];
                return (
                  <Fragment key={row._id ?? `row-${idx}`}>
                    <tr
                      onClick={() => toggleRow(row._id)}
                      className={`hover:bg-purple-50/80 cursor-pointer transition-colors group border-b border-gray-100/80 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/60"} ${isExpanded ? "bg-purple-50" : ""}`}>
                      {/* SR No */}
                      <td className="px-1 py-px text-center align-middle text-[10px] font-bold text-gray-600 tabular-nums">
                        {idx + 1}
                      </td>
                      {/* SOP No */}
                      <td className={`px-1 py-px font-mono text-[14px] font-bold tracking-wider group-hover:underline whitespace-nowrap align-middle ${isObsoleteView ? "text-rose-700" : "text-purple-700"}`}>
                        <span className="inline-flex items-center gap-1">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-purple-600" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          )}
                          {row.sopNo}
                        </span>
                      </td>
                      {/* Current revision (from SOP No or folder-upload row) */}
                      <td className="px-1 py-px text-center align-middle">
                        {displayRev != null ? (
                          <span className="text-[11px] font-bold text-gray-800 tabular-nums">
                            {displayRev}
                          </span>
                        ) : (
                          <span className="text-[9px] text-gray-400">—</span>
                        )}
                      </td>
                      {/* SOP Name — English first, Gujarati second */}
                      <td className="px-1 py-px font-medium text-gray-800 flex-1 align-middle">
                        {(() => {
                          const norm = (s: string) =>
                            String(s || "")
                              .replace(/\s+/g, " ")
                              .trim()
                              .toLowerCase();
                          // English on top, Gujarati below
                          const line1 = cleanSOPName(row.englishName || row.sopName, row.sopNo);
                          const line2 = deriveGujaratiSubtitle(row);
                          const showLine2 =
                            line2 && norm(line2) !== norm(line1);
                          const title = showLine2
                            ? `${line1}\n${line2}`
                            : line1;
                          const hasResult =
                            complianceCache && complianceCache[row.sopNo];
                          return (
                            <div
                              className="flex items-center gap-2 w-full"
                              title={title}>
                              <div className="flex flex-col gap-0 leading-tight min-w-0 flex-1">
                                <span className="text-[12px] font-bold leading-tight text-gray-900 whitespace-normal break-words">
                                  {line1}
                                </span>
                                {showLine2 ? (
                                  <span className="text-[10px] font-bold leading-tight text-indigo-700 whitespace-normal break-words">
                                    {cleanSOPName(line2, row.sopNo)}
                                  </span>
                                ) : null}
                                {/* Automated pipeline status tracker */}
                                {row._id && row.pipelineStatus && row.pipelineStatus !== 'idle' && (
                                  <div onClick={e => e.stopPropagation()}>
                                    <SOPPipelineStatus
                                      sopId={String(row._id)}
                                      sopName={line1}
                                      compact={true}
                                    />
                                  </div>
                                )}
                              </div>

                            </div>
                          );
                        })()}
                      </td>
                      {/* Guideline compliance score */}
                      <td className="px-1 py-px text-center align-middle">
                        {(() => {
                          const isRunning = reviewingInBackground?.has(String(row.sopNo));
                          const { result, total: guidelineCount } = getGuidelineMetrics(row);
                          const hasResult = !!result;
                          return (
                            <button
                              type="button"
                              title={isRunning ? `Analyzing guideline compliance for ${row.sopNo}` : hasResult ? `View guideline compliance results for ${row.sopNo}` : "Run guideline compliance check"}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hasResult) {
                                  onViewCompliance?.(row.sopNo);
                                } else if (!isRunning) {
                                  onOpenGuidelineWizard?.({ _id: String(row._id), sopNo: String(row.sopNo) });
                                }
                              }}
                              disabled={isRunning}
                              className={`relative shrink-0 rounded px-1.5 py-0.5 transition-colors font-bold tabular-nums text-[11px] leading-none ${
                                isRunning
                                  ? 'text-indigo-700 bg-indigo-50 animate-pulse'
                                  : hasResult
                                  ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                  : 'text-gray-500 bg-gray-100 hover:bg-orange-50 hover:text-orange-600'
                              }`}
                            >
                              {isRunning ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : hasResult ? (
                                guidelineCount
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </button>
                          );
                        })()}
                      </td>
                      <td className="px-1 py-px align-middle max-w-[100px]">
                        <span
                          className="line-clamp-1 text-[8px] leading-snug text-gray-600 cursor-help"
                          title={row.location || undefined}>
                          {row.location ? (
                            row.location
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </span>
                      </td>
                      {/* Versions: uploaded last-3 PDF/DOCX, else legacy AV availability */}
                      <td className="px-0.5 py-px align-middle">
                        {(() => {
                          const eng = Array.isArray(row.versionArtifacts)
                            ? row.versionArtifacts
                            : [];
                          const guj = Array.isArray(
                            row.versionArtifactsGujarati,
                          )
                            ? row.versionArtifactsGujarati
                            : [];
                          const currentRev = getDisplayCurrentRevision(row);
                          const slotBasis =
                            eng.length > 0 ? eng : guj;
                          const dualSlots = computePriorVersionSlotVersions(
                            slotBasis,
                            currentRev,
                            2,
                          );

                          /** ENG+GUJ aligned stacks: Mongo dual row, or registry has both language files (same prior slots). */
                          if (
                            useAlignedEnGuPriorVersions(row) &&
                            dualSlots.length > 0
                          ) {
                            return (
                              <div className="flex flex-col gap-[1px] py-0 leading-none">
                                {renderVersionArtifactSlotRow(
                                  eng,
                                  row,
                                  "English",
                                  dualSlots,
                                  "ENG",
                                  false,
                                )}
                                {renderVersionArtifactSlotRow(
                                  guj,
                                  row,
                                  "Gujarati",
                                  dualSlots,
                                  "GUJ",
                                  false,
                                )}
                              </div>
                            );
                          }

                          if (eng.length > 0 || guj.length > 0) {
                            return (
                              <div className="flex flex-col gap-1 py-0.5">
                                {eng.length > 0 &&
                                  renderVersionArtifactLinks(
                                    eng,
                                    row,
                                    "English",
                                    "ENG",
                                  )}
                                {guj.length > 0 &&
                                  renderVersionArtifactLinks(
                                    guj,
                                    row,
                                    "Gujarati",
                                    "GUJ",
                                  )}
                              </div>
                            );
                          }
                          /** No artifact rows yet — still show V(n−1).. including V0 from SOP No */
                          if (dualSlots.length > 0) {
                            const monoLang =
                              row.language === "Gujarati"
                                ? "Gujarati"
                                : "English";
                            return renderVersionArtifactSlotRow(
                              [],
                              row,
                              monoLang,
                              dualSlots,
                              monoLang === "Gujarati" ? "GUJ" : "ENG",
                              false,
                            );
                          }
                          const items: {
                            label: string;
                            ok: boolean;
                            key: string;
                            version: number;
                          }[] = [];
                          if (Array.isArray(row.previousVersionsStatus)) {
                            row.previousVersionsStatus
                              .slice(0, 2)
                              .forEach((v: any) => {
                                items.push({
                                  label: formatPriorVersionLabel(v.version),
                                  ok: !!v.available,
                                  key: `p-${v.version}`,
                                  version: Number(v.version),
                                });
                              });
                          }
                          items.sort((a, b) => b.version - a.version);
                          if (items.length === 0)
                            return (
                              <span className="text-[8px] text-gray-400">
                                —
                              </span>
                            );
                          const legacyLangLabel =
                            row.language === "Gujarati" ? "GUJ" : "ENG";
                          return (
                            <div className="flex flex-row flex-nowrap items-center gap-x-2 leading-none">
                              <span className="text-[8px] font-bold uppercase text-gray-400 leading-none w-[18px] shrink-0">
                                {legacyLangLabel}
                              </span>
                              <table className="border-collapse text-[10px] leading-tight text-gray-600 table-fixed">
                                <colgroup>
                                  <col className="w-[2.25rem]" />
                                  <col />
                                </colgroup>
                                <tbody>
                                  {items.map((it) => (
                                    <tr key={it.key}>
                                      <td className="py-px pr-1 align-middle font-semibold whitespace-nowrap">
                                        {it.label}
                                      </td>
                                      <td className="py-px align-middle">
                                        <span
                                          className={
                                            it.ok
                                              ? "text-emerald-600"
                                              : "text-red-500"
                                          }>
                                          {it.ok ? "✓" : "✗"}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </td>
                      {/* Dept */}
                      <td className="px-1 py-px text-gray-700 whitespace-nowrap align-middle">
                        <span className="bg-gray-200 text-gray-700 px-1 py-px rounded text-[9px] font-semibold leading-tight">
                          {row.department || "Other"}
                        </span>
                      </td>
                      {/* Lang */}
                      <td className="px-1 py-px text-center whitespace-nowrap align-middle">
                        {row.isDualLanguage ? (
                          <div className="inline-flex flex-col items-center gap-0 leading-none">
                            <span className="text-[9px] font-bold text-gray-800">
                              ENG
                            </span>
                            <span className="text-[9px] font-bold text-indigo-800">
                              GUJ
                            </span>
                          </div>
                        ) : row.gujaratiFileMissing ? (
                          <span
                            className="inline-flex flex-col items-center gap-0 leading-none"
                            title="There is a Gujarati SOP record in the database, but it points to the same file as English (or no separate Gujarati path). Upload/link a Gujarati DOCX/PDF in SOP Library or the Gujarati SOP record.">
                            <span className="text-[9px] font-semibold text-gray-700 leading-tight">
                              ENG
                            </span>
                            <span className="text-[7px] font-bold leading-none text-amber-700 bg-amber-50 border border-amber-200 rounded px-0.5">
                              no GUJ
                            </span>
                          </span>
                        ) : (
                          <span className="text-[9px] font-semibold text-gray-700">
                            {row.language === "Gujarati" ? "GUJ" : "ENG"}
                          </span>
                        )}
                      </td>
                      {/* File */}
                      <td className="pl-1 pr-3 py-px align-middle text-left">
                        {getFileTypes(row)}
                      </td>
                      {/* Video links — clickable per-video chips that open
                          an in-app preview. Falls back to a count when only
                          the legacy library video flag is set. */}
                      <td className="pl-1 pr-3 py-px text-left whitespace-nowrap align-middle">
                        {(() => {
                          const tvs = Array.isArray(row.trainingVideos) ? row.trainingVideos : [];
                          if (tvs.length === 0) {
                            const n =
                              row.mediaStatus?.videoCount ??
                              (row.mediaStatus?.videos ? 1 : 0);
                            return n > 0 ? (
                              <span className="text-[10px] font-bold tabular-nums text-emerald-700">
                                {n}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-[9px]">0</span>
                            );
                          }
                          const labelFor = (v: any) => {
                            if (v?.kind === 'brief') return 'Brief';
                            if (v?.kind === 'explainer') return 'Explainer';
                            return 'Video';
                          };
                          const isGuj = (v: any) => isGujaratiLanguage(v?.language);
                          const engVids = tvs.filter((v: any) => !isGuj(v));
                          const gujVids = tvs.filter((v: any) => isGuj(v));
                          const showGujRow =
                            gujVids.length > 0 ||
                            Boolean(row.isDualLanguage) ||
                            (Boolean(row.englishVersion) && Boolean(row.gujaratiVersion));

                          const shortLabel = (v: any) => {
                            if (v?.kind === 'brief') return 'Br';
                            if (v?.kind === 'explainer') return 'Ex';
                            return 'Vid';
                          };
                          const renderChip = (v: any, i: number) => (
                            <button
                              key={`${v.url}-${i}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewVideo({
                                  ...(v as RowTrainingVideo),
                                  sopNo: row.sopNo,
                                  department: row.department,
                                });
                              }}
                              title={`Preview ${labelFor(v)} — ${v.title || v.fileName || 'video'}${v.language ? ` (${v.language})` : ''}`}
                              className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-0.5 py-px text-[8px] font-semibold text-emerald-700 hover:bg-emerald-100"
                            >
                              <Video className="h-2 w-2" aria-hidden />
                              {shortLabel(v)}
                            </button>
                          );

                          const renderLangRow = (
                            langLabel: string,
                            vids: any[],
                          ) => (
                            <div className="flex items-center gap-1 text-left leading-none min-h-[10px]">
                              <span className="w-[24px] shrink-0 text-[8px] font-bold text-gray-500">
                                {langLabel}
                              </span>
                              {vids.length > 0 ? (
                                <div className="inline-flex flex-row flex-wrap items-center gap-0.5">
                                  {vids.map((v, i) => renderChip(v, i))}
                                </div>
                              ) : (
                                <span
                                  className="text-[8px] font-bold leading-none text-red-600 whitespace-nowrap"
                                  title={`No ${langLabel} training video uploaded`}>
                                  Video&nbsp;✗
                                </span>
                              )}
                            </div>
                          );

                          return (
                            <div className="flex w-max flex-col gap-px text-left leading-none">
                              {renderLangRow("ENG", engVids)}
                              {showGujRow ? renderLangRow("GUJ", gujVids) : null}
                            </div>
                          );
                        })()}
                      </td>
                      {/* Slide links — clickable per-PDF chips that open in a
                          new tab using the existing Bunny CDN URL. Falls back
                          to a count when only library slides exist. */}
                      <td className="px-1 py-px text-left whitespace-nowrap align-middle">
                        {(() => {
                          const tss = Array.isArray(row.trainingSlides) ? row.trainingSlides : [];
                          if (tss.length === 0) {
                            const n =
                              row.mediaStatus?.slideCount ??
                              (row.mediaStatus?.slides ? 1 : 0);
                            return n > 0 ? (
                              <span className="text-[10px] font-bold tabular-nums text-indigo-700">
                                {n}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-[9px]">0</span>
                            );
                          }
                          const isGuj = (s: any) => isGujaratiLanguage(s?.language);
                          const engSlides = tss.filter((s: any) => !isGuj(s));
                          const gujSlides = tss.filter((s: any) => isGuj(s));
                          const showGujRow =
                            gujSlides.length > 0 ||
                            Boolean(row.isDualLanguage) ||
                            (Boolean(row.englishVersion) && Boolean(row.gujaratiVersion));

                          const renderChip = (s: any, i: number) => (
                            <a
                              key={`${s.url}-${i}`}
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title={`Open ${s.title || s.fileName || 'slide'}${s.language ? ` (${s.language})` : ''}`}
                              className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1 py-px text-[9px] font-semibold text-indigo-700 hover:bg-indigo-100"
                            >
                              <FileText className="h-2.5 w-2.5" aria-hidden />
                              PDF
                            </a>
                          );

                          const renderLangRow = (
                            langLabel: string,
                            slides: any[],
                          ) => (
                            <div className="flex items-center gap-1 text-left leading-none min-h-[10px]">
                              <span className="w-[24px] shrink-0 text-[8px] font-bold text-gray-500">
                                {langLabel}
                              </span>
                              {slides.length > 0 ? (
                                <div className="inline-flex flex-row flex-wrap items-center gap-0.5">
                                  {slides.map((s, i) => renderChip(s, i))}
                                </div>
                              ) : (
                                <span
                                  className="text-[8px] font-bold leading-none text-red-600 whitespace-nowrap"
                                  title={`No ${langLabel} training slide uploaded`}>
                                  PDF&nbsp;✗
                                </span>
                              )}
                            </div>
                          );

                          return (
                            <div className="flex w-max flex-col gap-px text-left leading-none">
                              {renderLangRow("ENG", engSlides)}
                              {showGujRow ? renderLangRow("GUJ", gujSlides) : null}
                            </div>
                          );
                        })()}
                      </td>
                      {/* Uploaded date + time */}
                      <td className="px-1 py-px text-left align-middle whitespace-nowrap">
                        {row.createdAt ? (() => {
                          const d = new Date(row.createdAt);
                          if (isNaN(d.getTime())) {
                            return <span className="text-[9px] text-gray-400">—</span>;
                          }
                          const datePart = d.toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          });
                          const timePart = d.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          });
                          return (
                            <div className="flex flex-col leading-tight">
                              <span className="text-[10px] font-semibold text-gray-700 tabular-nums">{datePart}</span>
                              <span className="text-[9px] text-gray-500 tabular-nums">{timePart}</span>
                            </div>
                          );
                        })() : (
                          <span className="text-[9px] text-gray-400">—</span>
                        )}
                      </td>
                      {/* Expiry */}
                      <td className="px-1 py-px text-left align-middle">
                        <div className="flex items-center gap-0.5">
                          {formatExpiryVerbose(row.expiryDate)}
                          {!isObsoleteView && (
                            <>
                              <button
                                type="button"
                                title="Edit this SOP"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const toDate = (d: any) =>
                                    d ? new Date(d).toISOString().split("T")[0] : "";
                                  const links = extractLinksFromRow(row);
                                  setEditForm({
                                    sopName: String(row.englishName || row.sopName || ""),
                                    department: String(row.department || ""),
                                    location: String(row.location || ""),
                                    version: String(row.version || ""),
                                    effectiveDate: toDate(row.effectiveDate),
                                    reviewDate: toDate(row.expiryDate),
                                    owner: String(row.owner || ""),
                                    processArea: String(row.processArea || ""),
                                    guidelineReference: String(row.guidelineReference || ""),
                                    remarks: String(row.remarks || ""),
                                    englishDocxLink: links.engDocx,
                                    englishPdfLink: links.engPdf,
                                    gujaratiDocxLink: links.gujDocx,
                                    gujaratiPdfLink: links.gujPdf,
                                    englishVideoLink: '',
                                    gujaratiVideoLink: '',
                                    englishSlideLink: '',
                                    gujaratiSlideLink: '',
                                  });
                                  setEditError("");
                                  setEditSuccess(false);
                                  setEditTarget(row);
                                }}
                                className="shrink-0 rounded p-0.5 text-purple-600 hover:bg-purple-100 transition-colors"
                              >
                                <Pencil className="h-2.5 w-2.5" />
                              </button>
                              <button
                                type="button"
                                title="Print this SOP"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.print();
                                }}
                                className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-100 transition-colors"
                              >
                                <Printer className="h-2.5 w-2.5" />
                              </button>
                              <button
                                type="button"
                                title="Delete this SOP"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget({ sopNo: row.sopNo, sopName: row.englishName || row.sopName || "" });
                                  setDeletePassword("");
                                  setDeleteError("");
                                }}
                                className="shrink-0 rounded p-0.5 text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>

                    </tr>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <tr className="bg-purple-50 border-b border-purple-200">
                        <td colSpan={14} className="px-4 py-3">
                          <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2">
                              <h4 className="text-[10px] font-bold text-gray-700 uppercase tracking-wide border-b border-gray-300 pb-0.5">
                                Basic Information
                              </h4>
                              <div className="space-y-1 text-[10px]">
                                <div className="flex justify-between">
                                  <span className="text-gray-600 font-semibold">
                                    SOP Number:
                                  </span>
                                  <span className="text-gray-800 font-bold">
                                    {row.sopNo}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600 font-semibold">
                                    Version:
                                  </span>
                                  <span className="text-gray-800 font-bold">
                                    {displayRev != null
                                      ? displayRev
                                      : row.version || "—"}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600 font-semibold">
                                    Department:
                                  </span>
                                  <span className="text-gray-800 font-bold">
                                    {row.department || "Other"}
                                  </span>
                                </div>
                                {row.location ? (
                                  <div className="flex justify-between gap-2">
                                    <span className="text-gray-600 font-semibold shrink-0">
                                      Location:
                                    </span>
                                    <span className="text-gray-800 font-bold text-right">
                                      {row.location}
                                    </span>
                                  </div>
                                ) : null}
                                <div className="flex justify-between">
                                  <span className="text-gray-600 font-semibold">
                                    Language:
                                  </span>
                                  <span className="text-gray-800 font-bold">
                                    {row.isDualLanguage
                                      ? "English & Gujarati"
                                      : row.language === "Gujarati"
                                        ? "Gujarati"
                                        : "English"}
                                  </span>
                                </div>
                                {row.englishName && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-600 font-semibold">
                                      English Name:
                                    </span>
                                    <span
                                      className="text-gray-800 font-bold truncate max-w-[180px]"
                                      title={row.englishName}>
                                      {row.englishName}
                                    </span>
                                  </div>
                                )}
                                {row.gujaratiName && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-600 font-semibold">
                                      Gujarati Name:
                                    </span>
                                    <span
                                      className="text-gray-800 font-bold truncate max-w-[180px]"
                                      title={row.gujaratiName}>
                                      {row.gujaratiName}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <h4 className="text-[10px] font-bold text-gray-700 uppercase tracking-wide border-b border-gray-300 pb-0.5">
                                Documents & Revisions
                              </h4>
                              <div className="space-y-1.5 text-[10px]">
                                <div className="flex items-start gap-1.5">
                                  <File className="h-3 w-3 text-gray-500 mt-0.5 shrink-0" />
                                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className="text-gray-600 font-semibold">
                                      Active Files:
                                    </span>
                                    {(() => {
                                      const allDocs: Array<{
                                        fileName: string;
                                        filePath: string;
                                        fileType?: string;
                                        language?: string;
                                        label: string;
                                      }> = [];

                                      if (row.sopFile?.filePath) {
                                        allDocs.push({
                                          fileName: row.englishName || row.sopName || row.sopFile.fileName,
                                          filePath: row.sopFile.filePath,
                                          fileType: row.sopFile.fileType,
                                          language: row.sopFile.language || "English",
                                          label: "Active",
                                        });
                                      }

                                      if (row.gujaratiFileUrl && row.gujaratiFileUrl !== row.fileUrl) {
                                        allDocs.push({
                                          fileName: row.gujaratiName || row.sopName || "Gujarati SOP",
                                          filePath: row.gujaratiFileUrl,
                                          fileType: "pdf",
                                          language: "Gujarati",
                                          label: "Active",
                                        });
                                      }

                                      (row.sopDocuments || []).forEach((doc: any) => {
                                        if (!doc.filePath || doc.filePath === row.fileUrl || doc.filePath === row.gujaratiFileUrl) return;
                                        if (!allDocs.some((d) => d.filePath === doc.filePath)) {
                                          allDocs.push({
                                            fileName: doc.fileName,
                                            filePath: doc.filePath,
                                            fileType: doc.fileType,
                                            language: doc.language || "English",
                                            label: "Attachment",
                                          });
                                        }
                                      });

                                      if (allDocs.length === 0) return <span className="text-gray-500">No documents</span>;

                                      return (
                                        <div className="flex flex-col gap-0.5">
                                          {allDocs.map((doc, i) => {
                                            const docLang = isGujaratiLanguage(doc.language) ? "Gujarati" : "English";
                                            const prevHref = buildPreviewHref(doc.filePath, row.sopNo, docLang);
                                            const dk = fileKindFromStoredPath(doc.filePath, doc.fileType);
                                            const dDocx = (dk === "docx" || dk === "doc") ? buildDocxDownloadHref(doc.filePath, row.sopNo, docLang) : null;
                                            const dPdf = (dk === "pdf") ? buildPdfDownloadHref(doc.filePath, row.sopNo, docLang) : null;
                                            return (
                                              <div key={`doc-${i}`} className="flex items-center gap-0.5 rounded border border-purple-100 bg-purple-50 pr-0.5">
                                                <a href={prevHref} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-[10px] font-medium text-purple-700 hover:bg-purple-100" title="Preview">
                                                  <FileText className="h-2.5 w-2.5 shrink-0" />
                                                  <div className="flex flex-col min-w-0 leading-tight">
                                                    <span className="text-[7px] font-bold uppercase tracking-wider text-purple-400">{doc.label}</span>
                                                    <span className="truncate" title={doc.fileName}>{cleanSOPName(doc.fileName, row.sopNo)}</span>
                                                  </div>
                                                  {isGujaratiLanguage(doc.language) && <span className="text-[8px] text-indigo-600 font-bold ml-auto shrink-0 bg-indigo-50 px-1 rounded border border-indigo-100">GUJ</span>}
                                                </a>
                                                <a href={prevHref} target="_blank" rel="noopener noreferrer" className="p-1 text-violet-600 hover:bg-violet-100"><Eye className="h-3 w-3" /></a>
                                                {dDocx && <a href={dDocx} className="p-1 text-blue-600 hover:bg-blue-50" title="Download DOCX" onClick={(e) => e.stopPropagation()}><Download className="h-3 w-3" /></a>}
                                                {dPdf && <a href={dPdf} className="p-1 text-slate-600 hover:bg-slate-100" title="Download PDF" onClick={(e) => e.stopPropagation()}><Download className="h-3 w-3" /></a>}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })()}

                                    {/* Prior revisions: dual = EN + GUJ same V columns; single = one language */}
                                    {(() => {
                                      const eng = Array.isArray(row.versionArtifacts)
                                        ? row.versionArtifacts
                                        : [];
                                      const guj = Array.isArray(row.versionArtifactsGujarati)
                                        ? row.versionArtifactsGujarati
                                        : [];
                                      const cr = getDisplayCurrentRevision(row);
                                      const expSlots = computePriorVersionSlotVersions(
                                        eng.length > 0 ? eng : guj,
                                        cr,
                                        2,
                                      );
                                      if (
                                        useAlignedEnGuPriorVersions(row) &&
                                        expSlots.length > 0
                                      ) {
                                        return (
                                          <>
                                            <div className="mt-2 rounded border border-teal-200 bg-teal-50/60 px-2 py-1.5">
                                              <span className="text-[9px] font-bold uppercase tracking-wide text-teal-900">
                                                Prior revisions (English)
                                              </span>
                                              <div className="mt-1">
                                                {renderVersionArtifactSlotRow(
                                                  eng,
                                                  row,
                                                  "English",
                                                  expSlots,
                                                  undefined,
                                                  true,
                                                )}
                                              </div>
                                            </div>
                                            <div className="mt-2 rounded border border-indigo-200 bg-indigo-50/60 px-2 py-1.5">
                                              <span className="text-[9px] font-bold uppercase tracking-wide text-indigo-900">
                                                Prior revisions (Gujarati)
                                              </span>
                                              <div className="mt-1">
                                                {renderVersionArtifactSlotRow(
                                                  guj,
                                                  row,
                                                  "Gujarati",
                                                  expSlots,
                                                  undefined,
                                                  true,
                                                )}
                                              </div>
                                            </div>
                                          </>
                                        );
                                      }
                                      return (
                                        <>
                                          {eng.length > 0 ? (
                                            <div className="mt-2 rounded border border-teal-200 bg-teal-50/60 px-2 py-1.5">
                                              <span className="text-[9px] font-bold uppercase tracking-wide text-teal-900">
                                                Prior Revisions
                                              </span>
                                              <div className="mt-1">
                                                {renderVersionArtifactLinks(
                                                  eng,
                                                  row,
                                                  "English",
                                                  undefined,
                                                  2,
                                                  true,
                                                )}
                                              </div>
                                            </div>
                                          ) : null}
                                          {!useAlignedEnGuPriorVersions(row) &&
                                          guj.length > 0 ? (
                                            <div className="mt-2 rounded border border-indigo-200 bg-indigo-50/60 px-2 py-1.5">
                                              <span className="text-[9px] font-bold uppercase tracking-wide text-indigo-900">
                                                Prior revisions (Gujarati)
                                              </span>
                                              <div className="mt-1">
                                                {renderVersionArtifactLinks(
                                                  guj,
                                                  row,
                                                  "Gujarati",
                                                  undefined,
                                                  2,
                                                  true,
                                                )}
                                              </div>
                                            </div>
                                          ) : null}
                                        </>
                                      );
                                    })()}

                                    {/* Superseded Versions */}
                                    {Array.isArray(row.versionArtifactsSuperseded) && row.versionArtifactsSuperseded.length > 0 && (
                                      <div className="mt-1 rounded border border-amber-200 bg-amber-50/70 px-2 py-1">
                                        <span className="text-[8px] font-bold uppercase tracking-wide text-amber-900 leading-none">Archive</span>
                                        <div className="mt-0.5 opacity-80">{renderVersionArtifactLinks(row.versionArtifactsSuperseded, row, "English")}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <h4 className="text-[10px] font-bold text-gray-700 uppercase tracking-wide border-b border-gray-300 pb-0.5">
                                Training & Status
                              </h4>
                              <div className="space-y-2 text-[10px]">
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <Video className="h-3 w-3 text-emerald-600" />
                                    <span className="text-gray-600 font-semibold">Training Video:</span>
                                    <span className={`font-bold ${videoCount > 0 ? "text-emerald-700" : "text-gray-400"}`}>{videoCount > 0 ? "Available" : "Not Available"}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <Presentation className="h-3 w-3 text-indigo-600" />
                                    <span className="text-gray-600 font-semibold">Slides & Materials:</span>
                                    <span className={`font-bold ${slideCount > 0 ? "text-indigo-700" : "text-gray-400"}`}>{slideCount > 0 ? "Available" : "Not Available"}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <CheckCircle2 className="h-3 w-3 text-purple-600" />
                                    <span className="text-gray-600 font-semibold">MCQ Bank:</span>
                                    <span className={`font-bold ${row.mcqStatus === "assigned" ? "text-purple-700" : "text-gray-400"}`}>{row.mcqStatus === "assigned" ? "Assigned" : "Pending"}</span>
                                  </div>
                                </div>

                                <div className="space-y-1.5 pt-2 border-t border-gray-200">
                                  <div className="flex items-center gap-1.5">
                                    <Calendar className="h-3 w-3 text-gray-600" />
                                    <span className="text-gray-600 font-semibold">Expiry:</span>
                                    <span className="font-bold">{formatExpiryVerbose(row.expiryDate)}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <UserIcon className="h-3 w-3 text-gray-500" />
                                    <span className="text-gray-600 font-semibold">Trainer:</span>
                                    <span className="text-gray-800 font-bold truncate" title={row.assignedTrainer}>{row.assignedTrainer || "Unassigned"}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <Users className="h-3 w-3 text-gray-500" />
                                    <span className="text-gray-600 font-semibold">Users:</span>
                                    <span className="text-gray-800 font-bold">{row.assignedUsers?.length || 0}</span>
                                  </div>
                                </div>

                                <div className="space-y-1 pt-2">
                                  <button type="button" onClick={(e) => { e.stopPropagation(); onOpenGuidelineWizard?.({ _id: String(row._id), sopNo: String(row.sopNo) }); }} className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[10px] font-bold text-indigo-800 hover:bg-indigo-100 transition-colors"><BookOpen className="h-3.5 w-3.5" />Guideline check</button>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); const toDate = (d: any) => d ? new Date(d).toISOString().split('T')[0] : ''; const links = extractLinksFromRow(row); setEditForm({ sopName: String(row.englishName || row.sopName || ''), department: String(row.department || ''), location: String(row.location || ''), version: String(row.version || ''), effectiveDate: toDate(row.effectiveDate), reviewDate: toDate(row.expiryDate), owner: String(row.owner || ''), processArea: String(row.processArea || ''), guidelineReference: String(row.guidelineReference || ''), remarks: String(row.remarks || ''), englishDocxLink: links.engDocx, englishPdfLink: links.engPdf, gujaratiDocxLink: links.gujDocx, gujaratiPdfLink: links.gujPdf, englishVideoLink: '', gujaratiVideoLink: '', englishSlideLink: '', gujaratiSlideLink: '' }); setEditError(''); setEditSuccess(false); setEditTarget(row); }} className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-purple-200 bg-purple-50 px-2 py-1.5 text-[10px] font-bold text-purple-700 hover:bg-purple-100 transition-colors"><Pencil className="h-3.5 w-3.5" />Edit SOP</button>
                                  {isObsoleteView && (
                                    <button type="button" onClick={(e) => { e.stopPropagation(); window.print(); }} className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold text-slate-700 hover:bg-slate-100 transition-colors"><Printer className="h-3.5 w-3.5" />Print record</button>
                                  )}
                                  {isObsoleteView ? (
                                    <button type="button" disabled={!!removingObsoleteId} onClick={(e) => { e.stopPropagation(); onRemoveObsolete?.(String(row.sopNo || "")); }} className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"><Trash2 className="h-3.5 w-3.5" />{removingObsoleteId === String(row.sopNo || "") ? "Restoring..." : "Restore SOP"}</button>
                                  ) : (
                                    <button type="button" onClick={(e) => { e.stopPropagation(); setObsoleteTarget({ sopNo: String(row.sopNo), sopName: String(row.englishName || row.sopName || row.sopNo) }); setObsoletePassword(""); setObsoleteError(""); setTimeout(() => obsoleteInputRef.current?.focus(), 50); }} className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-bold text-red-700 hover:bg-red-100 transition-colors"><Trash2 className="h-3.5 w-3.5" />Mark Obsolete</button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>


      {/* Edit SOP modal */}
      {editTarget && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!editSaving) setEditTarget(null); }}>
          <div
            className="w-full max-w-2xl rounded-2xl border border-purple-200 bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-white">Edit SOP Details</h3>
                <p className="text-xs text-purple-200 font-mono mt-0.5">{editTarget.sopNo}</p>
              </div>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => setEditTarget(null)}
                className="rounded-lg p-1.5 text-white/80 hover:bg-white/20 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {editSuccess && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> SOP updated successfully!
                </div>
              )}
              {editError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700">
                  {editError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-700 mb-1">SOP Name</label>
                  <input
                    type="text"
                    value={editForm.sopName}
                    onChange={(e) => setEditForm({ ...editForm, sopName: e.target.value })}
                    placeholder="Enter SOP name"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Department</label>
                  {(() => {
                    const inList = availableDepartments.includes(editForm.department);
                    const isOther = !inList && editForm.department.length > 0;
                    return (
                      <>
                        <select
                          value={isOther ? "__other__" : editForm.department}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__other__") {
                              setEditForm({ ...editForm, department: inList ? "" : editForm.department });
                            } else {
                              setEditForm({ ...editForm, department: v });
                            }
                          }}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                        >
                          <option value="" disabled>Select department…</option>
                          {availableDepartments.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                          <option value="__other__">Other (new department)…</option>
                        </select>
                        {isOther && (
                          <input
                            type="text"
                            value={editForm.department}
                            onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                            placeholder="Enter new department name"
                            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                          />
                        )}
                      </>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Location</label>
                  <input
                    type="text"
                    value={editForm.location}
                    onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                    placeholder="e.g. Building A, Area 2"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Version</label>
                  <input
                    type="text"
                    value={editForm.version}
                    onChange={(e) => setEditForm({ ...editForm, version: e.target.value })}
                    placeholder="e.g. 1.0"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Owner</label>
                  <input
                    type="text"
                    value={editForm.owner}
                    onChange={(e) => setEditForm({ ...editForm, owner: e.target.value })}
                    placeholder="e.g. John Doe"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Effective Date</label>
                  <input
                    type="date"
                    value={editForm.effectiveDate}
                    onChange={(e) => setEditForm({ ...editForm, effectiveDate: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                    style={{ colorScheme: 'light' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Review / Expiry Date</label>
                  <input
                    type="date"
                    value={editForm.reviewDate}
                    onChange={(e) => setEditForm({ ...editForm, reviewDate: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                    style={{ colorScheme: 'light' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Process Area</label>
                  <input
                    type="text"
                    value={editForm.processArea}
                    onChange={(e) => setEditForm({ ...editForm, processArea: e.target.value })}
                    placeholder="e.g. Quality Control"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-700 mb-1">Guideline Reference</label>
                  <input
                    type="text"
                    value={editForm.guidelineReference}
                    onChange={(e) => setEditForm({ ...editForm, guidelineReference: e.target.value })}
                    placeholder="e.g. ICH Q7, FDA 21 CFR Part 211"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-700 mb-1">Remarks</label>
                  <textarea
                    value={editForm.remarks}
                    onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                    rows={3}
                    placeholder="Add any notes or remarks about this SOP..."
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none"
                  />
                </div>

                <div className="col-span-2 pt-2 border-t border-gray-200">
                  <h4 className="text-xs font-bold text-gray-700 mb-3">Document Links</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">English DOCX Link</label>
                      <input
                        type="text"
                        value={editForm.englishDocxLink}
                        onChange={(e) => setEditForm({ ...editForm, englishDocxLink: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">English PDF Link</label>
                      <input
                        type="text"
                        value={editForm.englishPdfLink}
                        onChange={(e) => setEditForm({ ...editForm, englishPdfLink: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                      />
                    </div>
                    {(editTarget?.isDualLanguage || editTarget?.language === 'Gujarati' || editForm.gujaratiDocxLink || editForm.gujaratiPdfLink || (editTarget?.sopDocuments || []).some((d: any) => isGujaratiLanguage(d.language) || pathSuggestsGujarati(d.filePath))) ? (
                      <>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">Gujarati DOCX Link</label>
                          <input
                            type="text"
                            value={editForm.gujaratiDocxLink}
                            onChange={(e) => setEditForm({ ...editForm, gujaratiDocxLink: e.target.value })}
                            placeholder="https://..."
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">Gujarati PDF Link</label>
                          <input
                            type="text"
                            value={editForm.gujaratiPdfLink}
                            onChange={(e) => setEditForm({ ...editForm, gujaratiPdfLink: e.target.value })}
                            placeholder="https://..."
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="col-span-2 pt-2 border-t border-gray-200">
                  <h4 className="text-xs font-bold text-gray-700 mb-3">Video Links</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">English Video Link</label>
                      <input
                        type="text"
                        value={editForm.englishVideoLink}
                        onChange={(e) => setEditForm({ ...editForm, englishVideoLink: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">Gujarati Video Link</label>
                      <input
                        type="text"
                        value={editForm.gujaratiVideoLink}
                        onChange={(e) => setEditForm({ ...editForm, gujaratiVideoLink: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>

                <div className="col-span-2 pt-2 border-t border-gray-200">
                  <h4 className="text-xs font-bold text-gray-700 mb-3">Slide Links</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">English Slide Link</label>
                      <input
                        type="text"
                        value={editForm.englishSlideLink}
                        onChange={(e) => setEditForm({ ...editForm, englishSlideLink: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">Gujarati Slide Link</label>
                      <input
                        type="text"
                        value={editForm.gujaratiSlideLink}
                        onChange={(e) => setEditForm({ ...editForm, gujaratiSlideLink: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button
                type="button"
                disabled={editSaving}
                onClick={() => setEditTarget(null)}
                className="px-5 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={editSaving}
                onClick={handleEditSave}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-sm font-bold text-white hover:from-purple-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md shadow-purple-200">
                {editSaving ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
                ) : (
                  <><Pencil className="h-3.5 w-3.5" />Save Changes</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}>
          <div
            className="mx-4 w-full max-w-sm rounded-xl border border-red-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                  <Trash2 className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Delete SOP</h3>
                  <p className="text-[10px] text-gray-500">This permanently deletes all revisions</p>
                </div>
              </div>
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded p-0.5 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 rounded bg-red-50 border border-red-100 px-3 py-2 text-[11px] font-semibold text-red-900 leading-snug">
              <span className="block font-bold text-red-800">{deleteTarget.sopNo}</span>
              {deleteTarget.sopName}
            </p>
            <p className="mb-2 text-[10px] text-gray-600 leading-snug">
              This will permanently delete all revisions of this SOP from the database. This action cannot be undone.
              Enter the password to confirm.
            </p>
            <input
              ref={deleteInputRef}
              type="password"
              placeholder="Enter password"
              value={deletePassword}
              onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && deletePassword && !deleteBusy) handleDeleteConfirm(); }}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-800 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-300 mb-1"
            />
            {deleteError && <p className="text-[10px] text-red-600 font-semibold mb-2">{deleteError}</p>}
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => setDeleteTarget(null)} className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={!deletePassword || deleteBusy}
                onClick={handleDeleteConfirm}
                className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {deleteBusy ? "Deleting…" : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Obsolete confirmation modal */}
      {obsoleteTarget && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setObsoleteTarget(null)}>
          <div
            className="mx-4 w-full max-w-sm rounded-xl border border-red-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                  <Trash2 className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Mark as Obsolete</h3>
                  <p className="text-[10px] text-gray-500">This action cannot be undone</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setObsoleteTarget(null)}
                className="rounded p-0.5 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 rounded bg-red-50 border border-red-100 px-3 py-2 text-[11px] font-semibold text-red-900 leading-snug">
              <span className="block font-bold text-red-800">{obsoleteTarget.sopNo}</span>
              {obsoleteTarget.sopName}
            </p>
            <p className="mb-2 text-[10px] text-gray-600 leading-snug">
              This SOP will be removed from the registry and capsule data and moved to the Obsolete SOPs section.
              Enter the obsolete password to confirm.
            </p>
            <input
              ref={obsoleteInputRef}
              type="password"
              placeholder="Enter password"
              value={obsoletePassword}
              onChange={(e) => { setObsoletePassword(e.target.value); setObsoleteError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && obsoletePassword && !obsoleteBusy) handleObsoleteConfirm();
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-800 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-300 mb-1"
            />
            {obsoleteError && (
              <p className="text-[10px] text-red-600 font-semibold mb-2">{obsoleteError}</p>
            )}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setObsoleteTarget(null)}
                className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={!obsoletePassword || obsoleteBusy}
                onClick={handleObsoleteConfirm}
                className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {obsoleteBusy ? "Processing…" : "Confirm Obsolete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline training-video preview — opened by clicking a video chip
          in the Video column. Streams directly from Bunny CDN, no download. */}
      {previewVideo && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4"
          onClick={() => setPreviewVideo(null)}
        >
          <div
            className="w-full max-w-4xl rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-gray-200 px-4 py-2.5">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-gray-800">
                  {previewVideo.title || previewVideo.fileName || 'Training video'}
                </h2>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {previewVideo.sopNo ? previewVideo.sopNo : ''}
                  {previewVideo.kind && previewVideo.kind !== 'unknown'
                    ? ` • ${previewVideo.kind === 'brief' ? 'Brief' : 'Explainer'}`
                    : ''}
                  {previewVideo.language ? ` • ${previewVideo.language}` : ''}
                  {previewVideo.department ? ` • ${previewVideo.department}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewVideo(null)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="bg-black">
              <video
                src={previewVideo.url}
                controls
                autoPlay
                preload="metadata"
                playsInline
                controlsList="nodownload"
                onContextMenu={(e) => e.preventDefault()}
                className="mx-auto max-h-[70vh] w-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  async function handleEditSave() {
    if (!editTarget) return;
    setEditSaving(true);
    setEditError('');
    setEditSuccess(false);
    try {
      const res = await fetch('/api/sop-monitoring/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sopId: String(editTarget._id),
          sopName: editForm.sopName,
          department: editForm.department,
          location: editForm.location,
          version: editForm.version,
          effectiveDate: editForm.effectiveDate,
          reviewDate: editForm.reviewDate,
          owner: editForm.owner,
          processArea: editForm.processArea,
          guidelineReference: editForm.guidelineReference,
          remarks: editForm.remarks,
          userId: 'system_user',
          userName: 'Dashboard User',
          userRole: 'Administrator',
          userDepartment: editTarget.department,
          reason: 'Manual update via Dashboard',
          englishDocxLink: editForm.englishDocxLink,
          englishPdfLink: editForm.englishPdfLink,
          gujaratiDocxLink: editForm.gujaratiDocxLink,
          gujaratiPdfLink: editForm.gujaratiPdfLink,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setEditError(json.error || 'Failed to save changes');
        return;
      }
      setEditSuccess(true);
      // Update the local row data so the table reflects changes immediately
      if (editTarget.englishName !== undefined) editTarget.englishName = editForm.sopName;
      else editTarget.sopName = editForm.sopName;
      editTarget.department = editForm.department;
      editTarget.location = editForm.location;
      editTarget.version = editForm.version;
      editTarget.owner = editForm.owner;
      editTarget.processArea = editForm.processArea;
      editTarget.guidelineReference = editForm.guidelineReference;
      editTarget.remarks = editForm.remarks;
      if (editForm.effectiveDate) editTarget.effectiveDate = editForm.effectiveDate;
      if (editForm.reviewDate) editTarget.expiryDate = editForm.reviewDate;
      
      // Update document links locally
      if (editForm.englishPdfLink) editTarget.fileUrl = editForm.englishPdfLink;
      
      // Update sopDocuments array locally
      let updatedDocs = editTarget.sopDocuments ? [...editTarget.sopDocuments] : [];
      
      const upsertLocalDoc = (lang: string, type: string, path: string, label: string) => {
        updatedDocs = updatedDocs.filter((d: any) => !(d.language === lang && d.fileType === type));
        if (path) {
          updatedDocs.push({ fileName: label, filePath: path, fileType: type, language: lang });
        }
      };
      
      if (editForm.englishDocxLink !== undefined) upsertLocalDoc('English', 'docx', editForm.englishDocxLink, 'English DOCX');
      if (editForm.gujaratiDocxLink !== undefined) upsertLocalDoc('Gujarati', 'docx', editForm.gujaratiDocxLink, 'Gujarati DOCX');
      if (editForm.gujaratiPdfLink !== undefined) upsertLocalDoc('Gujarati', 'pdf', editForm.gujaratiPdfLink, 'Gujarati PDF');
      
      editTarget.sopDocuments = updatedDocs;

      // Notify the dashboard so it busts caches and reloads with the new department
      try { onSopUpdated?.(); } catch { }

      setTimeout(() => setEditTarget(null), 1200);
    } catch {
      setEditError('Network error — please try again');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || !deletePassword) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const user = (() => {
        try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; }
      })();
      const res = await fetch("/api/sop/mark-obsolete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sopIdentifier: deleteTarget.sopNo,
          password: deletePassword,
          username: user?.username,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setDeleteError(json.error || "Failed to delete SOP");
        return;
      }
      setDeleteTarget(null);
      setDeletePassword("");
      onMarkObsolete?.(deleteTarget.sopNo);
    } catch {
      setDeleteError("Network error — please try again");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleObsoleteConfirm() {
    if (!obsoleteTarget || !obsoletePassword) return;
    setObsoleteBusy(true);
    setObsoleteError("");
    try {
      const user = (() => {
        try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; }
      })();
      const res = await fetch("/api/sop/mark-obsolete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sopIdentifier: obsoleteTarget.sopNo,
          password: obsoletePassword,
          username: user?.username,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setObsoleteError(json.error || "Failed to mark obsolete");
        return;
      }
      setObsoleteTarget(null);
      setObsoletePassword("");
      onMarkObsolete?.(obsoleteTarget.sopNo);
    } catch {
      setObsoleteError("Network error — please try again");
    } finally {
      setObsoleteBusy(false);
    }
  }
}
