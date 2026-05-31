"use client";

import { useMemo, ReactNode } from "react";
import { Video, Presentation, FileText } from "lucide-react";
import {
  countRowDocxPdfForCapsules,
  expectedDocxSlotsForRow,
  expectedPdfSlotsForRow,
  scanRowLanguageFileSlots,
} from "@/lib/registryRowDocCounts";
import { isStandardRegistrySopNumber, isArtifactOnlyRegistryRow } from "@/lib/registryPrimaryRows";
import {
  CAPSULE_DEPARTMENTS,
  resolveRowCapsuleDept,
} from "@/lib/capsuleDepartments";
import {
  classifySopVersionCapsule,
  classifySopVersionPerLangFormat,
  type SopVersionFilterSegment,
} from "@/lib/sopVersionCapsuleClassify";
import {
  countVersionDatesPerLang,
  type VersionDateSegment,
} from "@/lib/sopVersionDateClassify";

export { CAPSULE_DEPARTMENTS } from "@/lib/capsuleDepartments";

type CapsuleAcc = {
  total: number;
  dualLang: number;
  expired: number;
  nearExpiry: number;
  docxSOPs: number;
  pdfSOPs: number;
  docxFoundRows: number;
  pdfFoundRows: number;
  expectedDocx: number;
  expectedPdf: number;
  docxFiles: number;
  pdfFiles: number;
  missingDocxRows: number;
  missingPdfRows: number;
  eng: number;
  guj: number;
  videos: number;
  slides: number;
  videoRequired: number;
  slideRequired: number;
  videoAvailable: number;
  slideAvailable: number;
  versionAllTwoFound: number;
  versionNotFound: number;
  missingExpiry: number;
  langDocx: Map<string, { found: number; missing: number }>;
  langPdf: Map<string, { found: number; missing: number }>;
  langDocxVersion: Map<string, { allTwoFound: number; notFound: number }>;
  langPdfVersion: Map<string, { allTwoFound: number; notFound: number }>;
  docxVersionAllTwoFound: number;
  docxVersionNotFound: number;
  pdfVersionAllTwoFound: number;
  pdfVersionNotFound: number;
  /** Version-Date capsule: across every expected (lang × version) slot for the row. */
  versionDateFound: number;
  versionDateNotFound: number;
  langVersionDate: Map<string, { found: number; notFound: number }>;
};

function emptyCapsuleAcc(): CapsuleAcc {
  return {
    total: 0,
    dualLang: 0,
    expired: 0,
    nearExpiry: 0,
    docxSOPs: 0,
    pdfSOPs: 0,
    docxFoundRows: 0,
    pdfFoundRows: 0,
    expectedDocx: 0,
    expectedPdf: 0,
    docxFiles: 0,
    pdfFiles: 0,
    missingDocxRows: 0,
    missingPdfRows: 0,
    eng: 0,
    guj: 0,
    videos: 0,
    slides: 0,
    videoRequired: 0,
    slideRequired: 0,
    videoAvailable: 0,
    slideAvailable: 0,
    versionAllTwoFound: 0,
    versionNotFound: 0,
    missingExpiry: 0,
    langDocx: new Map(),
    langPdf: new Map(),
    langDocxVersion: new Map(),
    langPdfVersion: new Map(),
    docxVersionAllTwoFound: 0,
    docxVersionNotFound: 0,
    pdfVersionAllTwoFound: 0,
    pdfVersionNotFound: 0,
    versionDateFound: 0,
    versionDateNotFound: 0,
    langVersionDate: new Map(),
  };
}

function langShortCode(lang: string): string {
  if (lang === "English") return "EN";
  if (lang === "Gujarati") return "GJ";
  return lang.substring(0, 2).toUpperCase();
}

function sortLangCodes(codes: string[]): string[] {
  return [...codes].sort((a, b) => {
    if (a === "EN") return -1;
    if (b === "EN") return 1;
    if (a === "GJ") return -1;
    if (b === "GJ") return 1;
    return a.localeCompare(b);
  });
}

function foldRegistryRowIntoCapsuleAcc(
  s: CapsuleAcc,
  row: any,
  today: Date,
  dayMs: number,
) {
  s.total++;

  /** Bilingual for registry math: expect EN + GU document slots (not only DB `isDualLanguage`). */
  if (expectedDocxSlotsForRow(row) >= 2) s.dualLang++;

  if (row.expiryDate) {
    const exp = new Date(row.expiryDate).getTime();
    // Use Math.floor so that a SOP whose date is fractionally past midnight is
    // counted the same way the parent expiry filter counts it (diffDays < 0 → expired).
    const diffDays = Math.floor((exp - today.getTime()) / dayMs);
    if (diffDays < 0) s.expired++;
    else if (diffDays <= 30) s.nearExpiry++; // "Near" matches the "high" filter (0-30 days)
  }

  const { docx: nDocxFiles, pdf: nPdfFiles } = countRowDocxPdfForCapsules(row);
  s.docxFiles += nDocxFiles;
  s.pdfFiles += nPdfFiles;
  if (nDocxFiles > 0) s.docxSOPs++;
  if (nPdfFiles > 0) s.pdfSOPs++;

  const expDocx = expectedDocxSlotsForRow(row);
  const expPdf = expectedPdfSlotsForRow(row);
  s.expectedDocx += expDocx;
  s.expectedPdf += expPdf;

  if (nDocxFiles < expDocx) s.missingDocxRows++;
  else s.docxFoundRows++;
  if (nPdfFiles < expPdf) s.missingPdfRows++;
  else s.pdfFoundRows++;

  // Total per-language SOP counts (overlap allowed): every SOP that is English
  // contributes to w/EN, every SOP that is Gujarati contributes to w/GU. A Dual
  // SOP is both English and Gujarati so it contributes to BOTH buckets. This
  // makes w/EN = English-SOPs-total (English-only + Dual) and w/GU = Gujarati-
  // SOPs-total (Gujarati-only + Dual). Equivalently:
  //   w/EN = SOPs - Gujarati-only
  //   w/GU = SOPs - English-only
  // Dual rows are detected via expectedDocxSlotsForRow (matches the Dual bucket
  // accumulated above) so even a dual row whose files are missing still counts
  // toward both languages — the row is *defined* as bilingual.
  const langSlots = scanRowLanguageFileSlots(row);
  const isDualRow = expectedDocxSlotsForRow(row) >= 2;
  const hasEngSignal =
    !!row.englishVersion || langSlots.engDocx || langSlots.engPdf;
  const hasGujSignal =
    !!row.gujaratiVersion || langSlots.gujDocx || langSlots.gujPdf;
  const stored = String(row?.language || "").trim().toLowerCase();
  // A row "is English" if it's dual OR has any English signal OR its stored
  // language isn't Gujarati (default English when no signal is present).
  const rowIsEng = isDualRow || hasEngSignal || (stored !== "gujarati" && !hasGujSignal);
  // A row "is Gujarati" if it's dual OR has any Gujarati signal OR its stored
  // language is Gujarati.
  const rowIsGuj = isDualRow || hasGujSignal || stored === "gujarati";
  if (rowIsEng) s.eng++;
  if (rowIsGuj) s.guj++;
  if (row.mediaStatus?.videos) s.videos++;
  if (row.mediaStatus?.slides) s.slides++;

  s.videoRequired += row.mediaStatus?.videoRequired ?? (row.isDualLanguage ? 4 : 2);
  s.slideRequired += row.mediaStatus?.slideRequired ?? (row.isDualLanguage ? 2 : 1);
  s.videoAvailable += row.mediaStatus?.videoAvailable ?? 0;
  s.slideAvailable += row.mediaStatus?.slideAvailable ?? 0;

  // Versions total counts language slots (dual rows = 2, single = 1) so the
  // sum lines up with expectedDocx (e.g. 473 = 427 + 46 dual). Both languages
  // of a dual row share the same registry row, so they classify identically.
  const vt = classifySopVersionCapsule(row);
  const versionSlots = expectedDocxSlotsForRow(row) >= 2 ? 2 : 1;
  if (vt === "allTwoFound") s.versionAllTwoFound += versionSlots;
  else s.versionNotFound += versionSlots;

  if (!row.expiryDate) s.missingExpiry++;

  // Per-language breakdown (reuse the slot scan computed above)
  const slots = langSlots;
  const isDualDocx = expectedDocxSlotsForRow(row) >= 2;
  const isDualPdf = expectedPdfSlotsForRow(row) >= 2;

  const langPairs: Array<{
    code: "EN" | "GJ";
    docxFound: boolean;
    pdfFound: boolean;
    expectDocx: boolean;
    expectPdf: boolean;
  }> = [
    {
      code: "EN",
      docxFound: slots.engDocx,
      pdfFound: slots.engPdf,
      expectDocx: true,
      expectPdf: true,
    },
    {
      code: "GJ",
      docxFound: slots.gujDocx,
      pdfFound: slots.gujPdf,
      expectDocx: isDualDocx,
      expectPdf: isDualPdf,
    },
  ];

  for (const lp of langPairs) {
    // DOCX per-language: file presence
    if (lp.expectDocx) {
      if (!s.langDocx.has(lp.code)) {
        s.langDocx.set(lp.code, { found: 0, missing: 0 });
      }
      const ld = s.langDocx.get(lp.code)!;
      if (lp.docxFound) ld.found++;
      else ld.missing++;

      // DOCX versions per-language — classify against THIS language's artifact list,
      // checking docxPath specifically. Returns null when not in scope.
      const dvt = classifySopVersionPerLangFormat(row, {
        lang: lp.code,
        format: "docx",
      });
      if (dvt !== null) {
        if (!s.langDocxVersion.has(lp.code)) {
          s.langDocxVersion.set(lp.code, { allTwoFound: 0, notFound: 0 });
        }
        const ldv = s.langDocxVersion.get(lp.code)!;
        if (dvt === "allTwoFound") ldv.allTwoFound++;
        else ldv.notFound++;
      }
    }

    // PDF per-language: file presence
    if (lp.expectPdf) {
      if (!s.langPdf.has(lp.code)) {
        s.langPdf.set(lp.code, { found: 0, missing: 0 });
      }
      const lp2 = s.langPdf.get(lp.code)!;
      if (lp.pdfFound) lp2.found++;
      else lp2.missing++;

      // PDF versions per-language — pdfPath in the matching language artifact list.
      const pvt = classifySopVersionPerLangFormat(row, {
        lang: lp.code,
        format: "pdf",
      });
      if (pvt !== null) {
        if (!s.langPdfVersion.has(lp.code)) {
          s.langPdfVersion.set(lp.code, { allTwoFound: 0, notFound: 0 });
        }
        const lpv = s.langPdfVersion.get(lp.code)!;
        if (pvt === "allTwoFound") lpv.allTwoFound++;
        else lpv.notFound++;
      }
    }
  }

  // Aggregate format-scoped version counts (sum of per-language buckets to stay consistent)
  const enDocxVt = classifySopVersionPerLangFormat(row, { lang: "EN", format: "docx" });
  const gjDocxVt = classifySopVersionPerLangFormat(row, { lang: "GJ", format: "docx" });
  const enPdfVt = classifySopVersionPerLangFormat(row, { lang: "EN", format: "pdf" });
  const gjPdfVt = classifySopVersionPerLangFormat(row, { lang: "GJ", format: "pdf" });

  for (const t of [enDocxVt, gjDocxVt]) {
    if (t === "allTwoFound") s.docxVersionAllTwoFound++;
    else if (t === "notFound") s.docxVersionNotFound++;
  }
  for (const t of [enPdfVt, gjPdfVt]) {
    if (t === "allTwoFound") s.pdfVersionAllTwoFound++;
    else if (t === "notFound") s.pdfVersionNotFound++;
  }

  // Version-Date capsule: SLOT-level counts so the parent total matches the
  // total (lang × version) slot count (same axis as the Versions/DOCX/PDF
  // capsules). Each row contributes its own per-language slot tallies.
  //   - parent  found    = sum over rows of (EN found slots + GJ found slots)
  //   - parent  notFound = sum over rows of (EN notFound slots + GJ notFound slots)
  //   - DATE EN found/notFound = sum of EN slots only across rows
  //   - DATE GJ found/notFound = sum of GJ slots only across rows
  // Parent = EN + GJ by construction, so parent ≥ each child.
  const enDates = countVersionDatesPerLang(row, "EN");
  const gjDates = countVersionDatesPerLang(row, "GJ");
  s.versionDateFound += enDates.found + gjDates.found;
  s.versionDateNotFound += enDates.notFound + gjDates.notFound;
  if (enDates.found + enDates.notFound > 0) {
    if (!s.langVersionDate.has("EN")) s.langVersionDate.set("EN", { found: 0, notFound: 0 });
    const e = s.langVersionDate.get("EN")!;
    e.found += enDates.found;
    e.notFound += enDates.notFound;
  }
  if (gjDates.found + gjDates.notFound > 0) {
    if (!s.langVersionDate.has("GJ")) s.langVersionDate.set("GJ", { found: 0, notFound: 0 });
    const g = s.langVersionDate.get("GJ")!;
    g.found += gjDates.found;
    g.notFound += gjDates.notFound;
  }
}

function accToDeptCapsuleStats(department: string, s: CapsuleAcc): DeptCapsuleStats {
  return {
    department,
    totalSOPs: s.total,
    dualLangRows: s.dualLang,
    expired: s.expired,
    nearExpiry: s.nearExpiry,
    docxSOPs: s.docxSOPs,
    pdfSOPs: s.pdfSOPs,
    docxFoundRows: s.docxFoundRows,
    pdfFoundRows: s.pdfFoundRows,
    expectedDocx: s.expectedDocx,
    expectedPdf: s.expectedPdf,
    docxFiles: s.docxFiles,
    pdfFiles: s.pdfFiles,
    missingDocxRows: s.missingDocxRows,
    missingPdfRows: s.missingPdfRows,
    eng: s.eng,
    guj: s.guj,
    videos: s.videos,
    slides: s.slides,
    videoRequired: s.videoRequired,
    slideRequired: s.slideRequired,
    videoAvailable: s.videoAvailable,
    slideAvailable: s.slideAvailable,
    versionAllTwoFound: s.versionAllTwoFound,
    versionNotFound: s.versionNotFound,
    missingExpiry: s.missingExpiry,
    langDocx: s.langDocx,
    langPdf: s.langPdf,
    langDocxVersion: s.langDocxVersion,
    langPdfVersion: s.langPdfVersion,
    docxVersionAllTwoFound: s.docxVersionAllTwoFound,
    docxVersionNotFound: s.docxVersionNotFound,
    pdfVersionAllTwoFound: s.pdfVersionAllTwoFound,
    pdfVersionNotFound: s.pdfVersionNotFound,
    versionDateFound: s.versionDateFound,
    versionDateNotFound: s.versionDateNotFound,
    langVersionDate: s.langVersionDate,
  };
}

/** Total row: every primary-format registry row (same scope as `filterPrimaryRegistryRows`), not only the 7 named departments. */
export function computeCapsuleGrandTotalStat(data: any[]): DeptCapsuleStats {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 1000 * 60 * 60 * 24;
  const s = emptyCapsuleAcc();
  for (const row of data || []) {
    if (!isStandardRegistrySopNumber(row)) continue;
    // Exclude all artifact-only rows — they are not full SOP registry entries.
    // This keeps the capsule total aligned with the SOP table (both use
    // `filterPrimaryRegistryRows`), so users see the same number everywhere.
    if (isArtifactOnlyRegistryRow(row)) continue;
    foldRegistryRowIntoCapsuleAcc(s, row, today, dayMs);
  }
  return accToDeptCapsuleStats("Total", s);
}

export interface DeptCapsuleStats {
  department: string;
  totalSOPs: number;
  dualLangRows: number;
  expired: number;
  nearExpiry: number;
  docxSOPs: number;
  pdfSOPs: number;
  docxFoundRows: number;
  pdfFoundRows: number;
  expectedDocx: number;
  expectedPdf: number;
  docxFiles: number;
  pdfFiles: number;
  missingDocxRows: number;
  missingPdfRows: number;
  eng: number;
  guj: number;
  videos: number;
  slides: number;
  videoRequired: number;
  slideRequired: number;
  videoAvailable: number;
  slideAvailable: number;
  /** All Two Found: version-0 SOPs or all expected prior versions available */
  versionAllTwoFound: number;
  /** Not Found: expected prior versions exist but not all were found */
  versionNotFound: number;
  missingExpiry: number;
  langDocx: Map<string, { found: number; missing: number }>;
  langPdf: Map<string, { found: number; missing: number }>;
  langDocxVersion: Map<string, { allTwoFound: number; notFound: number }>;
  langPdfVersion: Map<string, { allTwoFound: number; notFound: number }>;
  docxVersionAllTwoFound: number;
  docxVersionNotFound: number;
  pdfVersionAllTwoFound: number;
  pdfVersionNotFound: number;
  /** Version-Date capsule: slot-level (lang × version) Date Found / Date Not Found. */
  versionDateFound: number;
  versionDateNotFound: number;
  langVersionDate: Map<string, { found: number; notFound: number }>;
}

function computeDepartmentStats(data: any[]): DeptCapsuleStats[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = 1000 * 60 * 60 * 24;

  const byDept = new Map<string, CapsuleAcc>();

  const defaultOrder = [...CAPSULE_DEPARTMENTS];
  defaultOrder.forEach((dept) => {
    byDept.set(dept, emptyCapsuleAcc());
  });
  const extraDepartments = new Set<string>();

  data.forEach((row: any) => {
    if (!isStandardRegistrySopNumber(row)) return;
    if (isArtifactOnlyRegistryRow(row)) return;

    const dept = resolveRowCapsuleDept(row);
    if (!dept) return;
    if (!byDept.has(dept)) {
      byDept.set(dept, emptyCapsuleAcc());
      if (!defaultOrder.includes(dept as any)) extraDepartments.add(dept);
    }

    const s = byDept.get(dept)!;
    foldRegistryRowIntoCapsuleAcc(s, row, today, day);
  });

  const order = [
    ...defaultOrder,
    ...Array.from(extraDepartments).sort((a, b) => a.localeCompare(b)),
  ];

  return order.map((department) =>
    accToDeptCapsuleStats(department, byDept.get(department)!),
  );
}

function CapsuleMetric({
  label,
  value,
  valueClass,
  onClick,
  title,
  isActive,
}: {
  label: ReactNode;
  value: number;
  valueClass?: string;
  onClick: () => void;
  title: string;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={title}
      aria-pressed={isActive ? true : undefined}
      className={`flex w-full min-h-[24px] cursor-pointer items-center justify-between gap-1.5 rounded-[4px] px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-purple-100/80 active:bg-purple-200/60 focus:z-10 focus:outline-none focus:ring-1 focus:ring-purple-400 focus:ring-offset-0 ${
        isActive
          ? "border border-purple-400 bg-purple-100/90"
          : "border border-transparent"
      }`}>
      <span className="min-w-0 shrink text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
      <span
        className={`font-bold tabular-nums shrink-0 leading-tight ${valueClass ?? "text-gray-900"}`}>
        {value}
      </span>
    </button>
  );
}

export type CapsuleAvailMetric = "docx" | "pdf" | "video" | "slides";

/** Green = filled slots (DOCX/PDF); red = missing slots; click filters still use row-level “has any” / “has gap”. */
function CapsuleMetricAvailMissing({
  label,
  totalExpected,
  available,
  missingCount,
  onFilterClick,
  onAvailableClick,
  onMissingClick,
  highlightAvailable,
  highlightMissing,
  filterRowActive,
  titleSummary,
}: {
  label: ReactNode;
  totalExpected: number;
  available: number;
  missingCount?: number;
  onFilterClick: () => void;
  onAvailableClick: () => void;
  onMissingClick: () => void;
  highlightAvailable: boolean;
  highlightMissing: boolean;
  filterRowActive: boolean;
  titleSummary: string;
}) {
  const missing = missingCount !== undefined ? missingCount : Math.max(0, totalExpected - available);

  return (
    <div
      className={`grid min-h-[26px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-[5px] px-1 py-px text-[10px] transition-colors ${
        filterRowActive
          ? "bg-purple-50/90 ring-1 ring-purple-300/80"
          : "border border-transparent"
      }`}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onFilterClick();
        }}
        title={`Filter: ${titleSummary}`}
        aria-pressed={filterRowActive ? true : undefined}
        className="min-w-0 cursor-pointer truncate text-left text-gray-600 transition-colors hover:text-purple-800 focus:z-10 focus:outline-none focus:ring-1 focus:ring-purple-400 rounded px-0.5 -mx-0.5">
        {label}
      </button>
      <div
        className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-gray-200/90 bg-white/95 px-0.5 py-px shadow-sm tabular-nums"
        aria-label={`${available} slots filled, ${missing} missing of ${totalExpected} expected`}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAvailableClick();
          }}
          title="Show only rows that have this attachment; sort by count (highest first)"
          aria-pressed={highlightAvailable ? true : undefined}
          className={`min-w-[1.35rem] cursor-pointer rounded px-1 py-0.5 text-center text-[10px] font-bold leading-none text-emerald-700 transition-colors hover:bg-emerald-50 focus:z-10 focus:outline-none focus:ring-1 focus:ring-emerald-500/70 ${
            highlightAvailable
              ? "bg-emerald-100 ring-1 ring-emerald-400/80"
              : ""
          }`}>
          {available}
        </button>
        <span
          className="select-none text-[8px] font-light text-gray-300"
          aria-hidden>
          |
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMissingClick();
          }}
          title="Show only rows missing this attachment; sort by count (lowest first)"
          aria-pressed={highlightMissing ? true : undefined}
          className={`min-w-[1.35rem] cursor-pointer rounded px-1 py-0.5 text-center text-[10px] font-bold leading-none text-red-600 transition-colors hover:bg-red-50 focus:z-10 focus:outline-none focus:ring-1 focus:ring-red-400/70 ${
            highlightMissing ? "bg-red-100 ring-1 ring-red-400/80" : ""
          }`}>
          {missing}
        </button>
      </div>
    </div>
  );
}

/** Version pair (2-color) for a single language on same line */
function CompactVersionPairForLang({
  lang,
  allTwoFoundV,
  notFoundV,
  onGreenClick,
  onRedClick,
  highlightGreen,
  highlightRed,
}: {
  lang: string;
  allTwoFoundV: number;
  notFoundV: number;
  onGreenClick?: () => void;
  onRedClick?: () => void;
  highlightGreen?: boolean;
  highlightRed?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-gray-500 text-[9px] font-medium min-w-fit">{lang}</span>
      <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-gray-200/80 bg-white/90 px-0.5 py-0.5 shadow-sm tabular-nums">
        <button
          type="button"
          onClick={onGreenClick ? (e) => { e.preventDefault(); e.stopPropagation(); onGreenClick(); } : undefined}
          className={`min-w-[1.3rem] rounded px-0.5 py-0 text-center text-[10px] font-bold leading-tight text-emerald-700 transition-colors ${onGreenClick ? "cursor-pointer hover:bg-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-400" : "cursor-default"} ${highlightGreen ? "bg-emerald-100 ring-1 ring-emerald-400/80" : ""}`}>
          {allTwoFoundV}
        </button>
        <span className="select-none text-[7px] text-gray-300 leading-tight">|</span>
        <button
          type="button"
          onClick={onRedClick ? (e) => { e.preventDefault(); e.stopPropagation(); onRedClick(); } : undefined}
          className={`min-w-[1.3rem] rounded px-0.5 py-0 text-center text-[10px] font-bold leading-tight text-red-600 transition-colors ${onRedClick ? "cursor-pointer hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-400" : "cursor-default"} ${highlightRed ? "bg-red-100 ring-1 ring-red-400/80" : ""}`}>
          {notFoundV}
        </button>
      </div>
    </div>
  );
}

/** Two language version pairs (EN, GUJ) on same horizontal line */
function CompactLanguageVersionPairRow({
  langVersionDataMap,
  onGreenClick,
  onRedClick,
  filterSnapshot,
  deptScope,
  format,
}: {
  langVersionDataMap: Map<string, { allTwoFound: number; notFound: number; filter: "ENG" | "GUJ" }>;
  onGreenClick?: (lang: "ENG" | "GUJ") => void;
  onRedClick?: (lang: "ENG" | "GUJ") => void;
  filterSnapshot?: CapsuleFilterSnapshot;
  deptScope?: string;
  format?: "docx" | "pdf";
}) {
  const langs = sortLangCodes([...langVersionDataMap.keys()]);

  return (
    <div className="flex w-full min-h-[22px] items-center justify-between gap-1 px-1 py-0 text-[9px]">
      {langs.map((lang) => {
        const data = langVersionDataMap.get(lang)!;
        const langFilter = data.filter;
        const highlightGreen = filterSnapshot && deptScope && format
          ? capsuleVersionSegmentMatches(deptScope, "allTwov", filterSnapshot, {
              requireFormat: format,
              requireLanguage: langFilter,
            })
          : false;
        const highlightRed = filterSnapshot && deptScope && format
          ? capsuleVersionSegmentMatches(deptScope, "notFoundv", filterSnapshot, {
              requireFormat: format,
              requireLanguage: langFilter,
            })
          : false;
        return (
          <CompactVersionPairForLang
            key={lang}
            lang={lang}
            allTwoFoundV={data.allTwoFound}
            notFoundV={data.notFound}
            onGreenClick={onGreenClick ? () => onGreenClick(langFilter) : undefined}
            onRedClick={onRedClick ? () => onRedClick(langFilter) : undefined}
            highlightGreen={highlightGreen}
            highlightRed={highlightRed}
          />
        );
      })}
    </div>
  );
}

/** Two language sub-rows (EN, GUJ) on same horizontal line with aligned counts */
function CompactLanguagePairRow({
  langDataMap,
  onAvailableClick,
  onMissingClick,
  filterSnapshot,
  deptScope,
  metric,
}: {
  langDataMap: Map<string, { found: number; missing: number; filter: "ENG" | "GUJ" }>;
  onAvailableClick: (lang: "ENG" | "GUJ") => void;
  onMissingClick: (lang: "ENG" | "GUJ") => void;
  filterSnapshot: CapsuleFilterSnapshot;
  deptScope: string;
  metric: "docx" | "pdf";
}) {
  const langs = sortLangCodes([...langDataMap.keys()]);
  const availableFileType = metric === "docx" ? "DOCX" : "PDF";
  const missingFileType = metric === "docx" ? "NO_DOCX" : "NO_PDF";

  return (
    <div className="flex w-full min-h-[22px] items-center justify-between gap-1 px-1 py-0 text-[9px]">
      {langs.map((lang) => {
        const data = langDataMap.get(lang)!;
        const langFilter = data.filter;
        const isAvailActive =
          filterSnapshot.filterDept === deptScope &&
          filterSnapshot.filterLanguage === langFilter &&
          filterSnapshot.filterFileType === availableFileType &&
          !filterSnapshot.filterDualLang &&
          filterSnapshot.filterExpiry === "all" &&
          filterSnapshot.filterMedia === "all" &&
          filterSnapshot.filterVersionStatus === "all";
        const isMissingActive =
          filterSnapshot.filterDept === deptScope &&
          filterSnapshot.filterLanguage === langFilter &&
          filterSnapshot.filterFileType === missingFileType &&
          !filterSnapshot.filterDualLang &&
          filterSnapshot.filterExpiry === "all" &&
          filterSnapshot.filterMedia === "all" &&
          filterSnapshot.filterVersionStatus === "all";

        return (
          <div key={lang} className="flex items-center gap-0.5">
            <span className="text-gray-500 text-[9px] font-medium min-w-fit">{lang}</span>
            <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-gray-200/80 bg-white/90 px-0.5 py-0.5 shadow-sm tabular-nums">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAvailableClick(langFilter); }}
                className={`min-w-[1.3rem] cursor-pointer rounded px-0.5 py-0 text-center text-[10px] font-bold leading-tight text-emerald-700 transition-colors hover:bg-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-400 ${
                  isAvailActive ? "bg-emerald-100 ring-1 ring-emerald-400/80" : ""
                }`}>
                {data.found}
              </button>
              <span className="select-none text-[7px] text-gray-300 leading-tight">|</span>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMissingClick(langFilter); }}
                className={`min-w-[1.3rem] cursor-pointer rounded px-0.5 py-0 text-center text-[10px] font-bold leading-tight text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-400 ${
                  isMissingActive ? "bg-red-100 ring-1 ring-red-400/80" : ""
                }`}>
                {data.missing}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Version row: 2 buckets.
 * Green = All Two Found (version-0 SOPs or all expected prior versions present)
 * Red   = Not Found (expected prior versions exist but not all were found)
 */
function CapsuleMetricVersionPair({
  totalSOPs,
  allTwoFoundV,
  notFoundV,
  onLabelClick,
  onGreenClick,
  onRedClick,
  highlightGreen,
  highlightRed,
  filterRowActive,
  titleSummary,
  label = "Versions",
}: {
  totalSOPs: number;
  allTwoFoundV: number;
  notFoundV: number;
  onLabelClick: () => void;
  onGreenClick: () => void;
  onRedClick: () => void;
  highlightGreen: boolean;
  highlightRed: boolean;
  filterRowActive: boolean;
  titleSummary: string;
  label?: ReactNode;
}) {
  return (
    <div
      className={`grid min-h-[26px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-[5px] px-1 py-px text-[10px] transition-colors ${
        filterRowActive
          ? "bg-purple-50/90 ring-1 ring-purple-300/80"
          : "border border-transparent"
      }`}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onLabelClick();
        }}
        title={`Filter: ${titleSummary}`}
        aria-pressed={filterRowActive ? true : undefined}
        className="min-w-0 cursor-pointer truncate text-left text-gray-600 transition-colors hover:text-purple-800 focus:z-10 focus:outline-none focus:ring-1 focus:ring-purple-400 rounded px-0.5 -mx-0.5">
        {label}
      </button>
      <div
        className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-gray-200/90 bg-white/95 px-0.5 py-px shadow-sm tabular-nums"
        aria-label={`Version status: ${allTwoFoundV} all two found, ${notFoundV} not found of ${totalSOPs} SOPs`}>
        {/* All Two Found — version-0 SOPs or all expected prior versions available */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onGreenClick(); }}
          title={`All Two Found: ${allTwoFoundV} SOPs (version-0 or all expected prior versions available)`}
          aria-pressed={highlightGreen ? true : undefined}
          className={`min-w-[1.35rem] cursor-pointer rounded px-0.5 py-0.5 text-center text-[10px] font-bold leading-none text-emerald-700 transition-colors hover:bg-emerald-50 focus:z-10 focus:outline-none focus:ring-1 focus:ring-emerald-500/70 ${
            highlightGreen ? "bg-emerald-100 ring-1 ring-emerald-400/80" : ""
          }`}>
          {allTwoFoundV}
        </button>
        <span className="select-none text-[8px] font-light text-gray-300" aria-hidden>|</span>
        {/* Not Found — expected prior versions exist but not all were found */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRedClick(); }}
          title={`Not Found: ${notFoundV} SOPs with expected prior versions but not all found`}
          aria-pressed={highlightRed ? true : undefined}
          className={`min-w-[1.35rem] cursor-pointer rounded px-0.5 py-0.5 text-center text-[10px] font-bold leading-none text-red-600 transition-colors hover:bg-red-50 focus:z-10 focus:outline-none focus:ring-1 focus:ring-red-400/70 ${
            highlightRed ? "bg-red-100 ring-1 ring-red-400/80" : ""
          }`}>
          {notFoundV}
        </button>
      </div>
    </div>
  );
}

/** One preset per metric row — parent applies full filter state (avoids stale Dual/lang/etc. stacking). */
export type CapsuleFilterMode =
  | "all"
  | "dual"
  | "eng"
  | "guj"
  | "expired"
  | "near"
  | "nodate"
  | "docx"
  | "pdf"
  | "video"
  | "slides";

export type CapsuleFilterSnapshot = {
  filterDept: string;
  filterDualLang: boolean;
  filterExpiry: string;
  filterFileType: "all" | "DOCX" | "NO_DOCX" | "PDF" | "NO_PDF";
  filterLanguage: "all" | "ENG" | "GUJ" | "BOTH";
  filterMedia: string;
  filterVersionStatus: "all" | SopVersionFilterSegment;
  /** Optional file-format scope for the active version filter ("docx" or "pdf"). */
  filterVersionFormat?: "all" | "docx" | "pdf";
  /** Version-Date capsule active segment ("all" | "dateFoundv" | "dateNotFoundv"). */
  filterVersionDateStatus?: "all" | VersionDateSegment;
};

export type CapsuleVersionFormat = "any" | "docx" | "pdf";

function capsuleVersionSegmentMatches(
  deptScope: string,
  segment: SopVersionFilterSegment,
  f: CapsuleFilterSnapshot,
  opts?: {
    /** When matching the row-level "Versions" capsule, require no format scope active. */
    requireAnyFormat?: boolean;
    /** When matching a format-scoped sub-row, require this format scope active. */
    requireFormat?: "docx" | "pdf";
    /** When matching a language sub-cell, require this language to be active. */
    requireLanguage?: "ENG" | "GUJ";
  },
): boolean {
  if (f.filterDept !== deptScope) return false;
  if (f.filterDualLang || f.filterExpiry !== "all" || f.filterMedia !== "all")
    return false;
  if (f.filterVersionStatus !== segment) return false;

  if (opts?.requireFormat) {
    const want = opts.requireFormat === "docx" ? "DOCX" : "PDF";
    if (f.filterFileType !== want) return false;
  } else if (opts?.requireAnyFormat) {
    if (f.filterFileType !== "all") return false;
  } else {
    // Default (legacy callers): only match when no format/language scope is active.
    if (f.filterFileType !== "all") return false;
    if (f.filterLanguage !== "all") return false;
  }

  if (opts?.requireLanguage) {
    if (f.filterLanguage !== opts.requireLanguage) return false;
  } else if (!opts?.requireFormat) {
    if (f.filterLanguage !== "all") return false;
  }
  return true;
}

function capsuleVersionDateSegmentMatches(
  deptScope: string,
  segment: VersionDateSegment,
  f: CapsuleFilterSnapshot,
  opts?: { requireLanguage?: "ENG" | "GUJ" },
): boolean {
  if (f.filterDept !== deptScope) return false;
  if (
    f.filterDualLang ||
    f.filterExpiry !== "all" ||
    f.filterMedia !== "all" ||
    f.filterFileType !== "all" ||
    f.filterVersionStatus !== "all"
  )
    return false;
  if ((f.filterVersionDateStatus ?? "all") !== segment) return false;
  if (opts?.requireLanguage) {
    if (f.filterLanguage !== opts.requireLanguage) return false;
  } else {
    if (f.filterLanguage !== "all") return false;
  }
  return true;
}

function capsuleAvailMissMatches(
  deptScope: string,
  metric: CapsuleAvailMetric,
  side: "available" | "missing",
  f: CapsuleFilterSnapshot,
): boolean {
  if (f.filterDept !== deptScope) return false;
  if (
    f.filterDualLang ||
    f.filterExpiry !== "all" ||
    f.filterLanguage !== "all" ||
    f.filterVersionStatus !== "all"
  )
    return false;

  if (metric === "docx") {
    if (f.filterMedia !== "all") return false;
    return side === "available"
      ? f.filterFileType === "DOCX"
      : f.filterFileType === "NO_DOCX";
  }
  if (metric === "pdf") {
    if (f.filterMedia !== "all") return false;
    return side === "available"
      ? f.filterFileType === "PDF"
      : f.filterFileType === "NO_PDF";
  }
  if (metric === "video") {
    if (f.filterFileType !== "all") return false;
    return side === "available"
      ? f.filterMedia === "video"
      : f.filterMedia === "no-video";
  }
  if (metric === "slides") {
    if (f.filterFileType !== "all") return false;
    return side === "available"
      ? f.filterMedia === "slides"
      : f.filterMedia === "no-slides";
  }
  return false;
}

function capsuleMetricMatches(
  deptScope: string,
  mode: CapsuleFilterMode,
  f: CapsuleFilterSnapshot,
): boolean {
  if (f.filterDept !== deptScope) return false;
  const neutral =
    !f.filterDualLang &&
    f.filterExpiry === "all" &&
    f.filterFileType === "all" &&
    f.filterLanguage === "all" &&
    f.filterMedia === "all" &&
    f.filterVersionStatus === "all";
  switch (mode) {
    case "all":
      return neutral;
    case "dual":
      return (
        f.filterDualLang &&
        f.filterExpiry === "all" &&
        f.filterFileType === "all" &&
        f.filterLanguage === "all" &&
        f.filterMedia === "all" &&
        f.filterVersionStatus === "all"
      );
    case "eng":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "all" &&
        f.filterFileType === "all" &&
        f.filterLanguage === "ENG" &&
        f.filterMedia === "all" &&
        f.filterVersionStatus === "all"
      );
    case "guj":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "all" &&
        f.filterFileType === "all" &&
        f.filterLanguage === "GUJ" &&
        f.filterMedia === "all" &&
        f.filterVersionStatus === "all"
      );
    case "expired":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "expired" &&
        f.filterFileType === "all" &&
        f.filterLanguage === "all" &&
        f.filterMedia === "all" &&
        f.filterVersionStatus === "all"
      );
    case "near":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "high" &&
        f.filterFileType === "all" &&
        f.filterLanguage === "all" &&
        f.filterMedia === "all" &&
        f.filterVersionStatus === "all"
      );
    case "nodate":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "nodate" &&
        f.filterFileType === "all" &&
        f.filterLanguage === "all" &&
        f.filterMedia === "all" &&
        f.filterVersionStatus === "all"
      );
    case "docx":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "all" &&
        f.filterFileType === "DOCX" &&
        f.filterLanguage === "all" &&
        f.filterMedia === "all" &&
        f.filterVersionStatus === "all"
      );
    case "pdf":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "all" &&
        f.filterFileType === "PDF" &&
        f.filterLanguage === "all" &&
        f.filterMedia === "all" &&
        f.filterVersionStatus === "all"
      );
    case "video":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "all" &&
        f.filterFileType === "all" &&
        f.filterLanguage === "all" &&
        f.filterMedia === "video" &&
        f.filterVersionStatus === "all"
      );
    case "slides":
      return (
        !f.filterDualLang &&
        f.filterExpiry === "all" &&
        f.filterFileType === "all" &&
        f.filterLanguage === "all" &&
        f.filterMedia === "slides" &&
        f.filterVersionStatus === "all"
      );
    default:
      return false;
  }
}

function DepartmentCapsuleCard({
  stat,
  applyCapsuleFilter,
  applyCapsuleAvailMiss,
  applyCapsuleVersionSegment,
  applyCapsuleVersionDateSegment,
  filterSnapshot,
  variant = "department",
  sopsWithVideos,
  sopsWithoutVideos,
  sopsWithBrief,
  sopsWithoutBrief,
  sopsWithExplainer,
  sopsWithoutExplainer,
}: {
  stat: DeptCapsuleStats;
  applyCapsuleFilter: (dept: string, mode: CapsuleFilterMode) => void;
  applyCapsuleAvailMiss: (
    dept: string,
    metric: CapsuleAvailMetric,
    side: "available" | "missing",
    lang?: "ENG" | "GUJ",
  ) => void;
  applyCapsuleVersionSegment: (
    dept: string,
    segment: SopVersionFilterSegment,
    lang?: "ENG" | "GUJ",
    format?: "docx" | "pdf",
  ) => void;
  applyCapsuleVersionDateSegment: (
    dept: string,
    segment: VersionDateSegment,
    lang?: "ENG" | "GUJ",
  ) => void;
  filterSnapshot: CapsuleFilterSnapshot;
  variant?: "department" | "grand";
  sopsWithVideos?: number;
  sopsWithoutVideos?: number;
  sopsWithBrief?: number;
  sopsWithoutBrief?: number;
  sopsWithExplainer?: number;
  sopsWithoutExplainer?: number;
}) {
  const isGrand = variant === "grand";
  const label = isGrand ? "Total" : (stat.department ?? "Other");
  const deptForFilter = isGrand ? "All" : label;
  const scopeHint = isGrand ? "All departments" : label;

  const apply = (mode: CapsuleFilterMode) =>
    applyCapsuleFilter(deptForFilter, mode);

  const headerActive =
    !isGrand && capsuleMetricMatches(deptForFilter, "all", filterSnapshot);

  return (
    <div
      className={`flex w-full min-w-0 flex-col rounded-[10px] border px-2 py-1.5 text-left shadow-sm ${
        isGrand ? "border-purple-300 bg-purple-50" : "border-gray-200 bg-white"
      }`}>
      <div
        role="button"
        tabIndex={isGrand ? -1 : 0}
        onClick={() => !isGrand && apply("all")}
        onKeyDown={(e) => {
          if (isGrand) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            apply("all");
          }
        }}
        className={`mb-2 flex w-full min-h-[40px] items-start gap-1.5 rounded-md border-b pb-2 ${
          isGrand
            ? "cursor-default border-purple-200"
            : `cursor-pointer border-gray-100 hover:bg-purple-50/80 focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                headerActive
                  ? "border-purple-300 bg-purple-100/70 ring-1 ring-purple-300"
                  : ""
              }`
        }`}        title={
          isGrand
            ? "Totals across all primary SOP rows shown in the registry."
            : `Show all ${label} SOPs in the registry`
        }>
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-600" />
        <span className="min-w-0 flex-1 text-[11px] font-bold leading-tight text-gray-800 break-words">
          {label}
        </span>
      </div>
      <div className="flex flex-col gap-0 border-t border-transparent pt-0.5">
        <CapsuleMetric
          label="SOPs"
          value={stat.totalSOPs}
          onClick={() => apply("all")}
          isActive={capsuleMetricMatches(deptForFilter, "all", filterSnapshot)}
          title={
            isGrand
              ? `${stat.totalSOPs} primary SOP rows across all departments (excludes folder-only artifact rows).`
              : `Primary SOP rows in ${label} (main registry records).`
          }
        />
        <CapsuleMetric
          label="Dual"
          value={stat.dualLangRows}
          onClick={() => apply("dual")}
          isActive={capsuleMetricMatches(deptForFilter, "dual", filterSnapshot)}
          title={
            isGrand
              ? "All departments: SOP rows that expect two language document slots (English + Gujarati), including bilingual pairs detected from files or version flags—not only the DB dual-language flag."
              : "Rows that expect English + Gujarati document slots (two-slot bilingual rows)."
          }
        />
        <CapsuleMetric
          label="w/ EN"
          value={stat.eng}
          onClick={() => apply("eng")}
          isActive={capsuleMetricMatches(deptForFilter, "eng", filterSnapshot)}
          title={
            isGrand
              ? "All departments: total English SOPs (English-only + Dual)."
              : `Total English SOPs in ${label} (English-only + Dual)`
          }
        />
        <CapsuleMetric
          label="w/ GU"
          value={stat.guj}
          onClick={() => apply("guj")}
          isActive={capsuleMetricMatches(deptForFilter, "guj", filterSnapshot)}
          title={
            isGrand
              ? "All departments: total Gujarati SOPs (Gujarati-only + Dual)."
              : `Total Gujarati SOPs in ${label} (Gujarati-only + Dual)`
          }
        />
        {/* Expiry metrics: always render in one horizontal row for alignment */}
        <div className="flex w-full gap-0.5">
          <div className="flex-1 min-w-0">
            <CapsuleMetric
              label="Expired"
              value={stat.expired}
              valueClass={stat.expired > 0 ? "text-red-600" : "text-gray-700"}
              onClick={() => apply("expired")}
              isActive={capsuleMetricMatches(
                deptForFilter,
                "expired",
                filterSnapshot,
              )}
              title={
                isGrand ? "All departments: expired." : `Expired in ${scopeHint}`
              }
            />
          </div>
          <div className="flex-1 min-w-0">
            <CapsuleMetric
              label="Near"
              value={stat.nearExpiry}
              valueClass={stat.nearExpiry > 0 ? "text-amber-600" : "text-gray-700"}
              onClick={() => apply("near")}
              isActive={capsuleMetricMatches(deptForFilter, "near", filterSnapshot)}
              title={
                isGrand
                  ? "All departments: near expiry (≤30 days)."
                  : `Near expiry in ${scopeHint}`
              }
            />
          </div>
          <div className="flex-1 min-w-0">
            <CapsuleMetric
              label="No Dt"
              value={stat.missingExpiry}
              valueClass={stat.missingExpiry > 0 ? "text-slate-700" : "text-gray-700"}
              onClick={() => apply("nodate")}
              isActive={capsuleMetricMatches(
                deptForFilter,
                "nodate",
                filterSnapshot,
              )}
              title={
                isGrand
                  ? "All departments: SOPs with null/empty expiry date."
                  : `SOPs with no expiry date in ${scopeHint}`
              }
            />
          </div>
        </div>
        {/* DOCX Section — slot-level totals. A Dual SOP expects 2 DOCX slots (EN + GU),
            single-language SOPs expect 1. Found = filled slots, Missing = empty slots,
            so Found+Missing always equals expectedDocx (e.g. 427 SOPs + 46 dual = 473). */}
        <CapsuleMetricAvailMissing
          label="DOCX"
          totalExpected={stat.expectedDocx}
          available={
            (stat.langDocx.get("EN")?.found ?? 0) +
            (stat.langDocx.get("GJ")?.found ?? 0)
          }
          missingCount={
            (stat.langDocx.get("EN")?.missing ?? 0) +
            (stat.langDocx.get("GJ")?.missing ?? 0)
          }
          onFilterClick={() => apply("docx")}
          onAvailableClick={() =>
            applyCapsuleAvailMiss(deptForFilter, "docx", "available")
          }
          onMissingClick={() =>
            applyCapsuleAvailMiss(deptForFilter, "docx", "missing")
          }
          highlightAvailable={capsuleAvailMissMatches(
            deptForFilter,
            "docx",
            "available",
            filterSnapshot,
          )}
          highlightMissing={capsuleAvailMissMatches(
            deptForFilter,
            "docx",
            "missing",
            filterSnapshot,
          )}
          filterRowActive={
            capsuleAvailMissMatches(
              deptForFilter,
              "docx",
              "available",
              filterSnapshot,
            ) ||
            capsuleAvailMissMatches(
              deptForFilter,
              "docx",
              "missing",
              filterSnapshot,
            )
          }
          titleSummary={
            isGrand
              ? `${stat.docxFiles} DOCX slots filled out of ${stat.expectedDocx} expected (dual rows count 2 — EN + GU separately).`
              : `${stat.docxFiles} of ${stat.expectedDocx} DOCX slots filled in ${label} (EN+GU counted separately).`
          }
        />
        {/* DOCX Language Sub-rows (EN and GUJ side-by-side) — mirrors the PDF layout. */}
        <div className="mt-0.5">
          <CompactLanguagePairRow
            langDataMap={new Map(
              ["EN", "GJ"].map((lang) => [
                lang,
                {
                  found: stat.langDocx.get(lang)?.found ?? 0,
                  missing: stat.langDocx.get(lang)?.missing ?? 0,
                  filter: (lang === "EN" ? "ENG" : "GUJ") as "ENG" | "GUJ",
                },
              ])
            )}
            onAvailableClick={(langFilter) => {
              applyCapsuleAvailMiss(deptForFilter, "docx", "available", langFilter);
            }}
            onMissingClick={(langFilter) => {
              applyCapsuleAvailMiss(deptForFilter, "docx", "missing", langFilter);
            }}
            filterSnapshot={filterSnapshot}
            deptScope={deptForFilter}
            metric="docx"
          />
        </div>
        {/* PDF Section — slot-level totals (mirrors DOCX). Dual rows expect 2 PDF
            slots, single-language rows expect 1. Found+Missing = expectedPdf. */}
        <CapsuleMetricAvailMissing
          label="PDF"
          totalExpected={stat.expectedPdf}
          available={
            (stat.langPdf.get("EN")?.found ?? 0) +
            (stat.langPdf.get("GJ")?.found ?? 0)
          }
          missingCount={
            (stat.langPdf.get("EN")?.missing ?? 0) +
            (stat.langPdf.get("GJ")?.missing ?? 0)
          }
          onFilterClick={() => apply("pdf")}
          onAvailableClick={() =>
            applyCapsuleAvailMiss(deptForFilter, "pdf", "available")
          }
          onMissingClick={() =>
            applyCapsuleAvailMiss(deptForFilter, "pdf", "missing")
          }
          highlightAvailable={capsuleAvailMissMatches(
            deptForFilter,
            "pdf",
            "available",
            filterSnapshot,
          )}
          highlightMissing={capsuleAvailMissMatches(
            deptForFilter,
            "pdf",
            "missing",
            filterSnapshot,
          )}
          filterRowActive={
            capsuleAvailMissMatches(
              deptForFilter,
              "pdf",
              "available",
              filterSnapshot,
            ) ||
            capsuleAvailMissMatches(
              deptForFilter,
              "pdf",
              "missing",
              filterSnapshot,
            )
          }
          titleSummary={
            isGrand
              ? `${stat.pdfFiles} PDF slots filled out of ${stat.expectedPdf} expected (dual rows count 2 — EN + GU separately).`
              : `${stat.pdfFiles} of ${stat.expectedPdf} PDF slots filled in ${label} (EN+GU counted separately).`
          }
        />
        {/* PDF Language Sub-rows (EN and GUJ side-by-side) — always show both */}
        <div className="mt-0.5">
          <CompactLanguagePairRow
            langDataMap={new Map(
              ["EN", "GJ"].map((lang) => [
                lang,
                {
                  found: stat.langPdf.get(lang)?.found ?? 0,
                  missing: stat.langPdf.get(lang)?.missing ?? 0,
                  filter: (lang === "EN" ? "ENG" : "GUJ") as "ENG" | "GUJ",
                },
              ])
            )}
            onAvailableClick={(langFilter) => {
              applyCapsuleAvailMiss(deptForFilter, "pdf", "available", langFilter);
            }}
            onMissingClick={(langFilter) => {
              applyCapsuleAvailMiss(deptForFilter, "pdf", "missing", langFilter);
            }}
            filterSnapshot={filterSnapshot}
            deptScope={deptForFilter}
            metric="pdf"
          />
        </div>

        {/* Versions Section — with spacing */}
        <div className="h-1" />
        <CapsuleMetricVersionPair
          totalSOPs={stat.totalSOPs}
          allTwoFoundV={stat.versionAllTwoFound}
          notFoundV={stat.versionNotFound}
          onLabelClick={() =>
            applyCapsuleVersionSegment(deptForFilter, "notFoundv")
          }
          onGreenClick={() =>
            applyCapsuleVersionSegment(deptForFilter, "allTwov")
          }
          onRedClick={() =>
            applyCapsuleVersionSegment(deptForFilter, "notFoundv")
          }
          highlightGreen={capsuleVersionSegmentMatches(
            deptForFilter,
            "allTwov",
            filterSnapshot,
            { requireAnyFormat: true },
          )}
          highlightRed={capsuleVersionSegmentMatches(
            deptForFilter,
            "notFoundv",
            filterSnapshot,
            { requireAnyFormat: true },
          )}
          filterRowActive={
            capsuleVersionSegmentMatches(deptForFilter, "allTwov", filterSnapshot, { requireAnyFormat: true }) ||
            capsuleVersionSegmentMatches(deptForFilter, "notFoundv", filterSnapshot, { requireAnyFormat: true })
          }
          titleSummary={
            isGrand
              ? "Green = All Two Found (version-0 or all prior versions present); red = Not Found"
              : `Version in ${scopeHint} · green = All Two Found, red = Not Found`
          }
        />
        {/* DOCX Versions Sub-section (EN and GUJ side-by-side) — DOCX-scoped per-language */}
        <div className="mt-0.5 flex w-full min-h-[20px] items-center justify-between gap-1 px-1 py-0 text-[9px]">
          <span className="text-gray-400 font-medium inline-block w-[30px] shrink-0">DOCX</span>
          <CompactLanguageVersionPairRow
            langVersionDataMap={new Map(
              ["EN", "GJ"].map((lang) => [
                lang,
                {
                  allTwoFound: stat.langDocxVersion.get(lang)?.allTwoFound ?? 0,
                  notFound: stat.langDocxVersion.get(lang)?.notFound ?? 0,
                  filter: (lang === "EN" ? "ENG" : "GUJ") as "ENG" | "GUJ",
                },
              ])
            )}
            onGreenClick={(langFilter) => applyCapsuleVersionSegment(deptForFilter, "allTwov", langFilter, "docx")}
            onRedClick={(langFilter) => applyCapsuleVersionSegment(deptForFilter, "notFoundv", langFilter, "docx")}
            filterSnapshot={filterSnapshot}
            deptScope={deptForFilter}
            format="docx"
          />
        </div>
        {/* PDF Versions Sub-section (EN and GUJ side-by-side) — PDF-scoped per-language */}
        <div className="mt-0.5 flex w-full min-h-[20px] items-center justify-between gap-1 px-1 py-0 text-[9px]">
          <span className="text-gray-400 font-medium inline-block w-[30px] shrink-0">PDF</span>
          <CompactLanguageVersionPairRow
            langVersionDataMap={new Map(
              ["EN", "GJ"].map((lang) => [
                lang,
                {
                  allTwoFound: stat.langPdfVersion.get(lang)?.allTwoFound ?? 0,
                  notFound: stat.langPdfVersion.get(lang)?.notFound ?? 0,
                  filter: (lang === "EN" ? "ENG" : "GUJ") as "ENG" | "GUJ",
                },
              ])
            )}
            onGreenClick={(langFilter) => applyCapsuleVersionSegment(deptForFilter, "allTwov", langFilter, "pdf")}
            onRedClick={(langFilter) => applyCapsuleVersionSegment(deptForFilter, "notFoundv", langFilter, "pdf")}
            filterSnapshot={filterSnapshot}
            deptScope={deptForFilter}
            format="pdf"
          />
        </div>

        {/* Version Date Section — green = both reviewDate AND effectiveDate present
            for the (lang × version) slot; red = at least one missing. Mirrors the
            Versions section layout: row-level capsule + EN/GU sub-row. */}
        <div className="h-1" />
        <CapsuleMetricVersionPair
          totalSOPs={stat.totalSOPs}
          allTwoFoundV={stat.versionDateFound}
          notFoundV={stat.versionDateNotFound}
          label="Version Date"
          onLabelClick={() => applyCapsuleVersionDateSegment(deptForFilter, "dateNotFoundv")}
          onGreenClick={() => applyCapsuleVersionDateSegment(deptForFilter, "dateFoundv")}
          onRedClick={() => applyCapsuleVersionDateSegment(deptForFilter, "dateNotFoundv")}
          highlightGreen={capsuleVersionDateSegmentMatches(deptForFilter, "dateFoundv", filterSnapshot)}
          highlightRed={capsuleVersionDateSegmentMatches(deptForFilter, "dateNotFoundv", filterSnapshot)}
          filterRowActive={
            capsuleVersionDateSegmentMatches(deptForFilter, "dateFoundv", filterSnapshot) ||
            capsuleVersionDateSegmentMatches(deptForFilter, "dateNotFoundv", filterSnapshot)
          }
          titleSummary={
            isGrand
              ? "Green = (lang × version) slots with BOTH reviewDate AND effectiveDate stored; red = at least one date missing."
              : `Version Date in ${scopeHint} · green = Date Found (both dates), red = Date Not Found (one or both missing)`
          }
        />
        {/* Per-language Version Date sub-row (EN, GU) */}
        <div className="mt-0.5 flex w-full min-h-[20px] items-center justify-between gap-1 px-1 py-0 text-[9px]">
          <span className="text-gray-400 font-medium inline-block w-[30px] shrink-0">DATE</span>
          <div className="flex w-full min-h-[22px] items-center justify-between gap-1 px-1 py-0 text-[9px]">
            {(["EN", "GJ"] as const).map((lang) => {
              const data = stat.langVersionDate.get(lang) ?? { found: 0, notFound: 0 };
              const langFilter = (lang === "EN" ? "ENG" : "GUJ") as "ENG" | "GUJ";
              const highlightGreen = capsuleVersionDateSegmentMatches(
                deptForFilter,
                "dateFoundv",
                filterSnapshot,
                { requireLanguage: langFilter },
              );
              const highlightRed = capsuleVersionDateSegmentMatches(
                deptForFilter,
                "dateNotFoundv",
                filterSnapshot,
                { requireLanguage: langFilter },
              );
              return (
                <CompactVersionPairForLang
                  key={lang}
                  lang={lang}
                  allTwoFoundV={data.found}
                  notFoundV={data.notFound}
                  onGreenClick={() => applyCapsuleVersionDateSegment(deptForFilter, "dateFoundv", langFilter)}
                  onRedClick={() => applyCapsuleVersionDateSegment(deptForFilter, "dateNotFoundv", langFilter)}
                  highlightGreen={highlightGreen}
                  highlightRed={highlightRed}
                />
              );
            })}
          </div>
        </div>

        {/* Videos Section — with spacing */}
        <div className="h-1" />
        <CapsuleMetricAvailMissing
          label={
            <>
              <Video className="mr-0.5 inline h-3 w-3" aria-hidden />
              Videos
            </>
          }
          totalExpected={stat.videoRequired}
          available={stat.videoAvailable}
          missingCount={stat.videoRequired - stat.videoAvailable}
          onFilterClick={() => apply("video")}
          onAvailableClick={() =>
            applyCapsuleAvailMiss(deptForFilter, "video", "available")
          }
          onMissingClick={() =>
            applyCapsuleAvailMiss(deptForFilter, "video", "missing")
          }
          highlightAvailable={capsuleAvailMissMatches(
            deptForFilter,
            "video",
            "available",
            filterSnapshot,
          )}
          highlightMissing={capsuleAvailMissMatches(
            deptForFilter,
            "video",
            "missing",
            filterSnapshot,
          )}
          filterRowActive={
            capsuleAvailMissMatches(
              deptForFilter,
              "video",
              "available",
              filterSnapshot,
            ) ||
            capsuleAvailMissMatches(
              deptForFilter,
              "video",
              "missing",
              filterSnapshot,
            )
          }
          titleSummary={
            isGrand
              ? `${stat.videoAvailable} of ${stat.videoRequired} required video slots filled · green = filled, red = missing`
              : `Videos in ${scopeHint} · ${stat.videoAvailable} of ${stat.videoRequired} slots · green = filled, red = missing`
          }
        />

        {/* SOP Video Status (Found vs Not Found) — displayed only in Total capsule */}
        {isGrand && (sopsWithVideos !== undefined || sopsWithoutVideos !== undefined) && (
          <>
            <div className="h-1" />
            <CapsuleMetricAvailMissing
              label="SOP Videos"
              totalExpected={stat.totalSOPs}
              available={sopsWithVideos ?? 0}
              missingCount={sopsWithoutVideos ?? 0}
              onFilterClick={() => apply("video")}
              onAvailableClick={() => applyCapsuleAvailMiss(deptForFilter, "video", "available")}
              onMissingClick={() => applyCapsuleAvailMiss(deptForFilter, "video", "missing")}
              highlightAvailable={capsuleAvailMissMatches(deptForFilter, "video", "available", filterSnapshot)}
              highlightMissing={capsuleAvailMissMatches(deptForFilter, "video", "missing", filterSnapshot)}
              filterRowActive={
                capsuleAvailMissMatches(deptForFilter, "video", "available", filterSnapshot) ||
                capsuleAvailMissMatches(deptForFilter, "video", "missing", filterSnapshot)
              }
              titleSummary={`${sopsWithVideos ?? 0} SOPs with both · ${sopsWithoutVideos ?? 0} incomplete`}
            />
            <div className="h-0.5" />
            {(sopsWithBrief !== undefined || sopsWithoutBrief !== undefined) && (
              <CapsuleMetricAvailMissing
                label="Brief Video"
                totalExpected={stat.totalSOPs}
                available={sopsWithBrief ?? 0}
                missingCount={sopsWithoutBrief ?? 0}
                onFilterClick={() => apply("brief")}
                onAvailableClick={() => applyCapsuleAvailMiss(deptForFilter, "brief", "available")}
                onMissingClick={() => applyCapsuleAvailMiss(deptForFilter, "brief", "missing")}
                highlightAvailable={capsuleAvailMissMatches(deptForFilter, "brief", "available", filterSnapshot)}
                highlightMissing={capsuleAvailMissMatches(deptForFilter, "brief", "missing", filterSnapshot)}
                filterRowActive={
                  capsuleAvailMissMatches(deptForFilter, "brief", "available", filterSnapshot) ||
                  capsuleAvailMissMatches(deptForFilter, "brief", "missing", filterSnapshot)
                }
                titleSummary={`${sopsWithBrief ?? 0} SOPs with brief video · ${sopsWithoutBrief ?? 0} missing`}
              />
            )}
            <div className="h-0.5" />
            {(sopsWithExplainer !== undefined || sopsWithoutExplainer !== undefined) && (
              <CapsuleMetricAvailMissing
                label="Explainer Video"
                totalExpected={stat.totalSOPs}
                available={sopsWithExplainer ?? 0}
                missingCount={sopsWithoutExplainer ?? 0}
                onFilterClick={() => apply("explainer")}
                onAvailableClick={() => applyCapsuleAvailMiss(deptForFilter, "explainer", "available")}
                onMissingClick={() => applyCapsuleAvailMiss(deptForFilter, "explainer", "missing")}
                highlightAvailable={capsuleAvailMissMatches(deptForFilter, "explainer", "available", filterSnapshot)}
                highlightMissing={capsuleAvailMissMatches(deptForFilter, "explainer", "missing", filterSnapshot)}
                filterRowActive={
                  capsuleAvailMissMatches(deptForFilter, "explainer", "available", filterSnapshot) ||
                  capsuleAvailMissMatches(deptForFilter, "explainer", "missing", filterSnapshot)
                }
                titleSummary={`${sopsWithExplainer ?? 0} SOPs with explainer video · ${sopsWithoutExplainer ?? 0} missing`}
              />
            )}
          </>
        )}

        {/* Slides Section — with spacing */}
        <div className="h-1" />
        <CapsuleMetricAvailMissing
          label={
            <>
              <Presentation className="mr-0.5 inline h-3 w-3" aria-hidden />
              Slides
            </>
          }
          totalExpected={stat.slideRequired}
          available={stat.slideAvailable}
          missingCount={stat.slideRequired - stat.slideAvailable}
          onFilterClick={() => apply("slides")}
          onAvailableClick={() =>
            applyCapsuleAvailMiss(deptForFilter, "slides", "available")
          }
          onMissingClick={() =>
            applyCapsuleAvailMiss(deptForFilter, "slides", "missing")
          }
          highlightAvailable={capsuleAvailMissMatches(
            deptForFilter,
            "slides",
            "available",
            filterSnapshot,
          )}
          highlightMissing={capsuleAvailMissMatches(
            deptForFilter,
            "slides",
            "missing",
            filterSnapshot,
          )}
          filterRowActive={
            capsuleAvailMissMatches(
              deptForFilter,
              "slides",
              "available",
              filterSnapshot,
            ) ||
            capsuleAvailMissMatches(
              deptForFilter,
              "slides",
              "missing",
              filterSnapshot,
            )
          }
          titleSummary={
            isGrand
              ? `${stat.slideAvailable} of ${stat.slideRequired} required slide sets filled · green = filled, red = missing`
              : `Slides in ${scopeHint} · ${stat.slideAvailable} of ${stat.slideRequired} sets · green = filled, red = missing`
          }
        />
      </div>
    </div>
  );
}

export default function DepartmentCapsules({
  data,
  showTotalCapsule = true,
  applyCapsuleFilter,
  applyCapsuleAvailMiss,
  applyCapsuleVersionSegment,
  applyCapsuleVersionDateSegment,
  filterSnapshot,
  sopsWithVideos,
  sopsWithoutVideos,
  sopsWithBrief,
  sopsWithoutBrief,
  sopsWithExplainer,
  sopsWithoutExplainer,
}: {
  data: any[];
  showTotalCapsule?: boolean;
  applyCapsuleFilter: (dept: string, mode: CapsuleFilterMode) => void;
  applyCapsuleAvailMiss: (
    dept: string,
    metric: CapsuleAvailMetric,
    side: "available" | "missing",
    lang?: "ENG" | "GUJ",
  ) => void;
  applyCapsuleVersionSegment: (
    dept: string,
    segment: SopVersionFilterSegment,
    lang?: "ENG" | "GUJ",
    format?: "docx" | "pdf",
  ) => void;
  applyCapsuleVersionDateSegment: (
    dept: string,
    segment: VersionDateSegment,
    lang?: "ENG" | "GUJ",
  ) => void;
  filterSnapshot: CapsuleFilterSnapshot;
  sopsWithVideos?: number;
  sopsWithoutVideos?: number;
  sopsWithBrief?: number;
  sopsWithoutBrief?: number;
  sopsWithExplainer?: number;
  sopsWithoutExplainer?: number;
}) {
  const stats = useMemo(() => computeDepartmentStats(data), [data]);

  /** Sum of department capsules skipped “Other” rows; grand total uses every primary registry row. */
  const totalStats = useMemo(
    () => computeCapsuleGrandTotalStat(data),
    [data],
  );

  return (
    <div className="w-full px-1 py-2 sm:px-2">
      <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 2xl:grid-cols-8">
        {showTotalCapsule ? (
          <DepartmentCapsuleCard
            key="grand-total-capsule"
            stat={totalStats}
            applyCapsuleFilter={applyCapsuleFilter}
            applyCapsuleAvailMiss={applyCapsuleAvailMiss}
            applyCapsuleVersionSegment={applyCapsuleVersionSegment}
            applyCapsuleVersionDateSegment={applyCapsuleVersionDateSegment}
            filterSnapshot={filterSnapshot}
            variant="grand"
            sopsWithVideos={sopsWithVideos}
            sopsWithoutVideos={sopsWithoutVideos}
            sopsWithBrief={sopsWithBrief}
            sopsWithoutBrief={sopsWithoutBrief}
            sopsWithExplainer={sopsWithExplainer}
            sopsWithoutExplainer={sopsWithoutExplainer}
          />
        ) : null}
        {stats.map((s, idx) => (
          <DepartmentCapsuleCard
            key={`dept-capsule-${idx}-${s.department}`}
            stat={s}
            applyCapsuleFilter={applyCapsuleFilter}
            applyCapsuleAvailMiss={applyCapsuleAvailMiss}
            applyCapsuleVersionSegment={applyCapsuleVersionSegment}
            applyCapsuleVersionDateSegment={applyCapsuleVersionDateSegment}
            filterSnapshot={filterSnapshot}
            sopsWithVideos={sopsWithVideos}
            sopsWithoutVideos={sopsWithoutVideos}
            sopsWithBrief={sopsWithBrief}
            sopsWithoutBrief={sopsWithoutBrief}
            sopsWithExplainer={sopsWithExplainer}
            sopsWithoutExplainer={sopsWithoutExplainer}
          />
        ))}
      </div>
    </div>
  );
}
