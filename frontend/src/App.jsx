import React, { useState, useRef, useCallback } from "react";

/**
 * Document Extraction UI
 * ------------------------------------------------------------------
 * Talks to the FastAPI + LangGraph backend at POST {API_BASE}/extract.
 *
 * Set API_BASE below to your running backend
 * (default assumes `uvicorn app.main:app --port 8000` locally).
 *
 * If the backend is unreachable, the app falls back to a clearly-labeled
 * DEMO MODE using mock data, so the UI can always be previewed.
 * ------------------------------------------------------------------
 */
const API_BASE = "http://localhost:8000";

const DOC_TYPES = [
  {
    key: "passport",
    label: "Passport",
    hint: "passport",
    icon: PassportIcon,
    fieldOrder: [
      ["surname", "Surname"],
      ["given_names", "Given names"],
      ["date_of_birth", "Date of birth"],
      ["nationality", "Nationality"],
      ["sex", "Sex"],
      ["passport_number", "Passport number"],
      ["place_of_birth", "Place of birth"],
      ["issuing_country", "Issuing country"],
      ["date_of_issue", "Date of issue"],
      ["date_of_expiry", "Date of expiry"],
      ["mrz_raw", "MRZ"],
    ],
  },
  {
    key: "driver_license",
    label: "Driver license",
    hint: "driver_license",
    icon: LicenseIcon,
    fieldOrder: [
      ["surname", "Surname"],
      ["given_names", "Given names"],
      ["date_of_birth", "Date of birth"],
      ["nationality", "Nationality"],
      ["license_number", "License number"],
      ["address", "Address"],
      ["vehicle_categories", "Categories"],
      ["issuing_authority", "Issuing authority"],
      ["date_of_issue", "Date of issue"],
      ["date_of_expiry", "Date of expiry"],
    ],
  },
  {
    key: "national_id",
    label: "National ID",
    hint: "national_id",
    icon: IdCardIcon,
    fieldOrder: [
      ["surname", "Surname"],
      ["given_names", "Given names"],
      ["date_of_birth", "Date of birth"],
      ["nationality", "Nationality"],
      ["sex", "Sex"],
      ["id_number", "ID number"],
      ["place_of_birth", "Place of birth"],
      ["date_of_issue", "Date of issue"],
      ["date_of_expiry", "Date of expiry"],
    ],
  },
  {
    key: "bank_card",
    label: "Bank card",
    hint: "bank_card",
    icon: CardIcon,
    fieldOrder: [
      ["cardholder_name", "Cardholder name"],
      ["bank_name", "Bank"],
      ["card_network", "Network"],
      ["card_number_masked", "Card number"],
      ["iban", "IBAN"],
      ["expiry_date", "Expiry"],
    ],
  },
];

const MOCK_RESULTS = {
  passport: {
    document_type: "passport",
    classification_confidence: 0.98,
    fields: {
      surname: "MUSTERMANN",
      given_names: "ERIKA",
      date_of_birth: "1988-04-12",
      nationality: "DEUTSCH",
      sex: "F",
      passport_number: "C01X00T47",
      place_of_birth: "BERLIN",
      issuing_country: "DEU",
      date_of_issue: "2019-06-01",
      date_of_expiry: "2029-05-31",
      mrz_raw: "P<DEUMUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<\nC01X00T47DEU8804122F2905317<<<<<<<<<<<<<<08",
    },
    warnings: [],
    raw_model_notes: "Demo data — connect the backend to see live extraction.",
  },
  driver_license: {
    document_type: "driver_license",
    classification_confidence: 0.95,
    fields: {
      surname: "MUSTERMANN",
      given_names: "ERIKA",
      date_of_birth: "1988-04-12",
      nationality: "DEUTSCH",
      license_number: "Z021AB37X9",
      address: "HEIDESTRASSE 17, 51147 KOELN",
      vehicle_categories: "A, B, B1, AM",
      issuing_authority: "STADT KOELN",
      date_of_issue: "2020-01-15",
      date_of_expiry: "2035-01-14",
    },
    warnings: [],
    raw_model_notes: "Demo data — connect the backend to see live extraction.",
  },
  national_id: {
    document_type: "national_id",
    classification_confidence: 0.93,
    fields: {
      surname: "MUSTERMANN",
      given_names: "ERIKA",
      date_of_birth: "1988-04-12",
      nationality: "DEUTSCH",
      sex: "F",
      id_number: "T220001293",
      place_of_birth: "BERLIN",
      date_of_issue: "2021-02-02",
      date_of_expiry: "2031-02-01",
    },
    warnings: [],
    raw_model_notes: "Demo data — connect the backend to see live extraction.",
  },
  bank_card: {
    document_type: "bank_card",
    classification_confidence: 0.97,
    fields: {
      cardholder_name: "ERIKA MUSTERMANN",
      bank_name: "Deutsche Musterbank",
      card_network: "Mastercard",
      card_number_masked: "**** **** **** 4832",
      iban: "DE89370400440532013000",
      expiry_date: "09/29",
    },
    warnings: [],
    raw_model_notes: "Demo data — connect the backend to see live extraction.",
  },
};

export default function App() {
  const [selectedType, setSelectedType] = useState(DOC_TYPES[0]);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | scanning | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const reset = useCallback(() => {
    setFile(null);
    setPreviewUrl(null);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  }, []);

  const handleTypeChange = (dt) => {
    setSelectedType(dt);
    reset();
  };

  const handleFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setErrorMsg("Please upload an image file (JPG, PNG, or WEBP).");
      setStatus("error");
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    handleFile(f);
  };

  const runExtraction = async () => {
    if (!file) return;
    setStatus("scanning");
    setErrorMsg("");

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("hint", selectedType.hint);

      const res = await fetch(`${API_BASE}/extract`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `Server responded ${res.status}`);
      }

      const data = await res.json();
      setResult(data);
      setDemoMode(false);
      setStatus("done");
    } catch (err) {
      // Backend not reachable or errored — fall back to demo data so the
      // UI remains explorable, but say so clearly.
      await new Promise((r) => setTimeout(r, 900));
      setResult(MOCK_RESULTS[selectedType.key]);
      setDemoMode(true);
      setStatus("done");
      setErrorMsg(
        `Couldn't reach the backend (${err.message}). Showing demo data instead.`
      );
    }
  };

  const Icon = selectedType.icon;

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <Header />

        <div style={styles.body}>
          <DocTypeRail
            types={DOC_TYPES}
            selected={selectedType}
            onSelect={handleTypeChange}
          />

          <main style={styles.main}>
            <div style={styles.mainHeader}>
              <div style={styles.mainHeaderIcon}>
                <Icon size={20} />
              </div>
              <div>
                <h1 style={styles.mainTitle}>{selectedType.label}</h1>
                <p style={styles.mainSubtitle}>
                  Upload one {selectedType.label.toLowerCase()} image to extract its fields.
                </p>
              </div>
            </div>

            <div style={styles.workArea}>
              <UploadPane
                previewUrl={previewUrl}
                status={status}
                dragActive={dragActive}
                onDrop={onDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onBrowse={() => fileInputRef.current?.click()}
                onFileInput={(e) => handleFile(e.target.files?.[0])}
                fileInputRef={fileInputRef}
                onClear={reset}
                docLabel={selectedType.label}
              />

              <ResultsPane
                status={status}
                result={result}
                fieldOrder={selectedType.fieldOrder}
                demoMode={demoMode}
                errorMsg={errorMsg}
              />
            </div>

            <div style={styles.actionRow}>
              {file && status !== "scanning" && (
                <button style={styles.secondaryBtn} onClick={reset}>
                  Clear
                </button>
              )}
              <button
                style={{
                  ...styles.primaryBtn,
                  ...(!(file && status !== "scanning") ? styles.primaryBtnDisabled : {}),
                }}
                onClick={runExtraction}
                disabled={!file || status === "scanning"}
              >
                {status === "scanning" ? "Scanning\u2026" : "Extract fields"}
              </button>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header() {
  return (
    <div style={styles.header}>
      <div style={styles.headerLeft}>
        <div style={styles.logoMark}>
          <ScanMarkIcon size={18} />
        </div>
        <div>
          <div style={styles.headerTitle}>Docscan</div>
          <div style={styles.headerSubtitle}>Identity & card field extraction</div>
        </div>
      </div>
      <div style={styles.headerRight}>
        <span style={styles.betaPill}>ONE DOCUMENT AT A TIME</span>
      </div>
    </div>
  );
}

function DocTypeRail({ types, selected, onSelect }) {
  return (
    <nav style={styles.rail}>
      {types.map((t) => {
        const Icon = t.icon;
        const active = t.key === selected.key;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t)}
            style={{
              ...styles.railItem,
              ...(active ? styles.railItemActive : {}),
            }}
          >
            <span
              style={{
                ...styles.railIconWrap,
                ...(active ? styles.railIconWrapActive : {}),
              }}
            >
              <Icon size={18} />
            </span>
            <span style={styles.railLabel}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function UploadPane({
  previewUrl,
  status,
  dragActive,
  onDrop,
  onDragOver,
  onDragLeave,
  onBrowse,
  onFileInput,
  fileInputRef,
  onClear,
  docLabel,
}) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelLabel}>Source image</div>
      <div
        style={{
          ...styles.dropzone,
          ...(dragActive ? styles.dropzoneActive : {}),
          ...(previewUrl ? styles.dropzoneHasImage : {}),
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={!previewUrl ? onBrowse : undefined}
      >
        {previewUrl ? (
          <div style={styles.previewWrap}>
            <img src={previewUrl} alt="Document preview" style={styles.previewImg} />
            {status === "scanning" && <ScanOverlay />}
            {status !== "scanning" && (
              <button
                style={styles.removeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                aria-label="Remove image"
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
        ) : (
          <div style={styles.dropzoneEmpty}>
            <div style={styles.dropzoneIcon}>
              <UploadIcon size={22} />
            </div>
            <div style={styles.dropzoneText}>
              Drop your {docLabel.toLowerCase()} image here
            </div>
            <div style={styles.dropzoneSubtext}>or click to browse &middot; JPG, PNG, WEBP</div>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={onFileInput}
        style={{ display: "none" }}
      />
      <div style={styles.privacyNote}>
        <LockIcon size={13} />
        <span>Processed in memory only. Card numbers are masked before display.</span>
      </div>
    </div>
  );
}

function ScanOverlay() {
  return (
    <div style={styles.scanOverlay}>
      <div style={styles.scanLine} />
      <div style={styles.scanStatusChip}>Reading document&hellip;</div>
    </div>
  );
}

function ResultsPane({ status, result, fieldOrder, demoMode, errorMsg }) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelLabelRow}>
        <div style={styles.panelLabel}>Extracted fields</div>
        {result && (
          <ConfidenceBadge value={result.classification_confidence} />
        )}
      </div>

      <div style={styles.resultsBox}>
        {status === "idle" && !result && (
          <EmptyResults />
        )}

        {status === "scanning" && (
          <div style={styles.resultsLoading}>
            <div style={styles.loadingRows}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={styles.loadingRow}>
                  <div style={{ ...styles.skeletonBar, width: "38%" }} />
                  <div style={{ ...styles.skeletonBar, width: "48%" }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {status === "done" && result && (
          <div>
            {demoMode && (
              <div style={styles.demoNotice}>
                <InfoIcon size={14} />
                <span>{errorMsg || "Showing demo data."}</span>
              </div>
            )}
            <dl style={styles.fieldList}>
              {fieldOrder.map(([key, label]) => {
                const value = result.fields?.[key];
                return (
                  <div key={key} style={styles.fieldRow}>
                    <dt style={styles.fieldLabel}>{label}</dt>
                    <dd
                      style={{
                        ...styles.fieldValue,
                        ...(!value ? styles.fieldValueEmpty : {}),
                        ...(key === "mrz_raw" ? styles.fieldValueMono : {}),
                      }}
                    >
                      {value || "Not detected"}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {result.warnings && result.warnings.length > 0 && (
              <div style={styles.warningsBox}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={styles.warningRow}>
                    <AlertIcon size={14} />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {status === "error" && (
          <div style={styles.errorBox}>
            <AlertIcon size={16} />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyResults() {
  return (
    <div style={styles.emptyResults}>
      <div style={styles.emptyResultsIcon}>
        <ScanMarkIcon size={20} />
      </div>
      <div style={styles.emptyResultsText}>
        Fields will appear here after you upload and extract a document.
      </div>
    </div>
  );
}

function ConfidenceBadge({ value }) {
  const pct = Math.round((value || 0) * 100);
  const level = pct >= 85 ? "high" : pct >= 60 ? "mid" : "low";
  const palette = {
    high: { bg: "#12261c", fg: "#7fd9a8", border: "#1e3a2b" },
    mid: { bg: "#2b2412", fg: "#e0b25c", border: "#453214" },
    low: { bg: "#2c1414", fg: "#e28080", border: "#4a1c1c" },
  }[level];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.03em",
        padding: "3px 8px",
        borderRadius: 20,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {pct}% CONFIDENCE
    </span>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, no external deps)
// ---------------------------------------------------------------------------
function iconProps(size) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
}

function PassportIcon({ size = 18 }) {
  return (
    <svg {...iconProps(size)}>
      <rect x="5" y="2.5" width="14" height="19" rx="1.5" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M9 15.5c0-1.6 1.3-2.4 3-2.4s3 .8 3 2.4" />
      <path d="M8 5.5h8" />
    </svg>
  );
}
function LicenseIcon({ size = 18 }) {
  return (
    <svg {...iconProps(size)}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="1.8" />
      <circle cx="8" cy="12" r="2.1" />
      <path d="M13.5 10h5M13.5 14h3.5" />
    </svg>
  );
}
function IdCardIcon({ size = 18 }) {
  return (
    <svg {...iconProps(size)}>
      <rect x="3" y="4.5" width="18" height="15" rx="1.8" />
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M6 15.5c0-1.3 1.1-2 2.5-2s2.5.7 2.5 2" />
      <path d="M14 9.5h4M14 13h4" />
    </svg>
  );
}
function CardIcon({ size = 18 }) {
  return (
    <svg {...iconProps(size)}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="1.8" />
      <path d="M2.5 9.5h19" />
      <path d="M6 15h5" />
    </svg>
  );
}
function ScanMarkIcon({ size = 18 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M4 12h16" />
    </svg>
  );
}
function UploadIcon({ size = 18 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M12 15V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  );
}
function XIcon({ size = 14 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}
function LockIcon({ size = 14 }) {
  return (
    <svg {...iconProps(size)}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="1.6" />
      <path d="M7.5 10.5V7.2a4.5 4.5 0 0 1 9 0v3.3" />
    </svg>
  );
}
function InfoIcon({ size = 14 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="8" r="0.15" fill="currentColor" stroke="none" />
      <path d="M12 7.7v.1" strokeWidth="2.4" />
    </svg>
  );
}
function AlertIcon({ size = 14 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M10.5 3.5 2 18h17L10.5 3.5Z" />
      <path d="M10.5 9v4" />
      <path d="M10.5 15.7v.1" strokeWidth="2.4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const INK = "#0e1420";
const INK_2 = "#141b2b";
const INK_3 = "#1a2337";
const PAPER = "#f4f1ea";
const AMBER = "#e0a458";
const AMBER_DIM = "#8a6a3d";
const BORDER = "rgba(230, 226, 214, 0.12)";
const BORDER_STRONG = "rgba(230, 226, 214, 0.22)";
const TEXT_PRIMARY = "#eee9dd";
const TEXT_SECONDARY = "#a19d90";
const TEXT_MUTED = "#6b6960";

const styles = {
  page: {
    minHeight: "100vh",
    background: INK,
    color: TEXT_PRIMARY,
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "32px 20px",
    boxSizing: "border-box",
  },
  shell: {
    maxWidth: 1040,
    margin: "0 auto",
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    overflow: "hidden",
    background: INK_2,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 24px",
    borderBottom: `1px solid ${BORDER}`,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  logoMark: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: INK_3,
    border: `1px solid ${BORDER_STRONG}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: AMBER,
  },
  headerTitle: { fontSize: 15, fontWeight: 600, letterSpacing: "0.01em" },
  headerSubtitle: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 1 },
  headerRight: {},
  betaPill: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: AMBER_DIM,
    border: `1px solid ${BORDER_STRONG}`,
    borderRadius: 20,
    padding: "5px 10px",
  },
  body: { display: "flex", minHeight: 520 },
  rail: {
    width: 176,
    flexShrink: 0,
    borderRight: `1px solid ${BORDER}`,
    padding: "16px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  railItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px",
    borderRadius: 8,
    background: "transparent",
    border: "1px solid transparent",
    color: TEXT_SECONDARY,
    fontSize: 13.5,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "left",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  },
  railItemActive: {
    background: INK_3,
    border: `1px solid ${BORDER_STRONG}`,
    color: TEXT_PRIMARY,
  },
  railIconWrap: {
    display: "flex",
    color: TEXT_MUTED,
  },
  railIconWrapActive: {
    color: AMBER,
  },
  railLabel: { flex: 1 },
  main: { flex: 1, padding: "22px 26px 26px", minWidth: 0 },
  mainHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 },
  mainHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 9,
    background: INK_3,
    border: `1px solid ${BORDER_STRONG}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: AMBER,
    flexShrink: 0,
  },
  mainTitle: { fontSize: 17, fontWeight: 600, margin: 0 },
  mainSubtitle: { fontSize: 12.5, color: TEXT_SECONDARY, margin: "3px 0 0" },
  workArea: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 18,
  },
  panel: { display: "flex", flexDirection: "column", minWidth: 0 },
  panelLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: TEXT_MUTED,
    textTransform: "uppercase",
    marginBottom: 9,
  },
  panelLabelRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 9,
  },
  dropzone: {
    position: "relative",
    flex: 1,
    minHeight: 300,
    border: `1.5px dashed ${BORDER_STRONG}`,
    borderRadius: 10,
    background: "rgba(255,255,255,0.015)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    overflow: "hidden",
    transition: "border-color 0.15s, background 0.15s",
  },
  dropzoneActive: {
    borderColor: AMBER,
    background: "rgba(224, 164, 88, 0.06)",
  },
  dropzoneHasImage: {
    cursor: "default",
    border: `1px solid ${BORDER_STRONG}`,
  },
  dropzoneEmpty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: 24,
    color: TEXT_SECONDARY,
  },
  dropzoneIcon: {
    width: 46,
    height: 46,
    borderRadius: "50%",
    background: INK_3,
    border: `1px solid ${BORDER_STRONG}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: AMBER,
    marginBottom: 14,
  },
  dropzoneText: { fontSize: 13.5, fontWeight: 500, color: TEXT_PRIMARY },
  dropzoneSubtext: { fontSize: 11.5, color: TEXT_MUTED, marginTop: 5 },
  previewWrap: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImg: {
    maxWidth: "100%",
    maxHeight: 340,
    objectFit: "contain",
    display: "block",
  },
  removeBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: "50%",
    background: "rgba(14,20,32,0.85)",
    border: `1px solid ${BORDER_STRONG}`,
    color: TEXT_PRIMARY,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  scanOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(14,20,32,0.35)",
    overflow: "hidden",
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    background: AMBER,
    boxShadow: `0 0 12px 2px rgba(224,164,88,0.7)`,
    animation: "scanmove 1.8s ease-in-out infinite",
  },
  scanStatusChip: {
    position: "absolute",
    bottom: 12,
    left: "50%",
    transform: "translateX(-50%)",
    fontSize: 11.5,
    fontWeight: 600,
    color: AMBER,
    background: "rgba(14,20,32,0.9)",
    border: `1px solid ${BORDER_STRONG}`,
    borderRadius: 20,
    padding: "5px 12px",
  },
  privacyNote: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: TEXT_MUTED,
    marginTop: 10,
  },
  resultsBox: {
    flex: 1,
    minHeight: 300,
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    background: "rgba(255,255,255,0.015)",
    padding: 16,
    boxSizing: "border-box",
  },
  emptyResults: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 24,
    minHeight: 268,
  },
  emptyResultsIcon: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: INK_3,
    border: `1px solid ${BORDER}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: TEXT_MUTED,
    marginBottom: 12,
  },
  emptyResultsText: { fontSize: 12.5, color: TEXT_MUTED, maxWidth: 220, lineHeight: 1.6 },
  resultsLoading: { paddingTop: 4 },
  loadingRows: { display: "flex", flexDirection: "column", gap: 16 },
  loadingRow: { display: "flex", justifyContent: "space-between", gap: 12 },
  skeletonBar: {
    height: 11,
    borderRadius: 4,
    background: "linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.1), rgba(255,255,255,0.05))",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.4s infinite",
  },
  demoNotice: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 11.5,
    color: AMBER_DIM,
    background: "rgba(224,164,88,0.08)",
    border: `1px solid rgba(224,164,88,0.25)`,
    borderRadius: 7,
    padding: "7px 10px",
    marginBottom: 14,
  },
  fieldList: { margin: 0 },
  fieldRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 14,
    padding: "8px 0",
    borderBottom: `1px solid ${BORDER}`,
  },
  fieldLabel: {
    fontSize: 11.5,
    color: TEXT_MUTED,
    fontWeight: 500,
    flexShrink: 0,
    minWidth: 108,
  },
  fieldValue: {
    fontSize: 13,
    color: TEXT_PRIMARY,
    fontWeight: 500,
    textAlign: "right",
    wordBreak: "break-word",
  },
  fieldValueEmpty: { color: TEXT_MUTED, fontWeight: 400, fontStyle: "italic" },
  fieldValueMono: {
    fontFamily: "'SF Mono', 'Roboto Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.03em",
    whiteSpace: "pre-line",
    textAlign: "left",
    marginTop: 2,
  },
  warningsBox: { marginTop: 14, display: "flex", flexDirection: "column", gap: 6 },
  warningRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    fontSize: 11.5,
    color: "#e0b25c",
    background: "rgba(224,178,92,0.08)",
    border: "1px solid rgba(224,178,92,0.2)",
    borderRadius: 7,
    padding: "7px 10px",
  },
  errorBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "#e28080",
    padding: 12,
  },
  actionRow: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  secondaryBtn: {
    padding: "10px 18px",
    borderRadius: 8,
    border: `1px solid ${BORDER_STRONG}`,
    background: "transparent",
    color: TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  primaryBtn: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "none",
    background: AMBER,
    color: "#241a0c",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  primaryBtnDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
};

// Keyframes injected once
const styleTag = document.createElement("style");
styleTag.textContent = `
@keyframes scanmove {
  0% { top: 4%; }
  50% { top: 92%; }
  100% { top: 4%; }
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
* { box-sizing: border-box; }
`;
if (!document.getElementById("docscan-keyframes")) {
  styleTag.id = "docscan-keyframes";
  document.head.appendChild(styleTag);
}
