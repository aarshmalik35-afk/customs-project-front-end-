import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, Check, CheckCircle2,
  ChevronDown, CircleHelp, Clock3, CloudUpload, Command, FileCheck2, FileImage,
  FileSearch, FileText, Fingerprint, Gauge, LayoutDashboard, LoaderCircle, LockKeyhole,
  Menu, MoreHorizontal, PackageCheck, PanelLeftClose, Plus, RefreshCw, Search,
  Settings2, ShieldAlert, ShieldCheck, Sparkles, Upload, X, Zap
} from 'lucide-react';
import './styles.css';

const DEFAULT_API = (import.meta.env.VITE_API_URL || 'https://customs-project-backend.onrender.com').replace(/\/$/, '');
const PROCESS_PATH = '/process-invoice-base64';
const STORAGE_KEY = 'customs-twin-history-v1';

function readHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function formatDate(value) {
  try { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
  catch { return 'Just now'; }
}
function prettyLabel(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, s => s.toUpperCase());
}
function isPrimitive(value) { return value == null || ['string', 'number', 'boolean'].includes(typeof value); }
function normalizeFields(payload) {
  // The API currently returns { success, filename, data: {...} }. Be tolerant of wrappers.
  let data = payload?.data ?? payload?.result ?? payload?.fields ?? payload;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return { 'OCR response': data }; }
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const nested = data.extracted_fields ?? data.fields ?? data.extraction;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) data = nested;
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, isPrimitive(value) ? (value == null || value === '' ? '—' : String(value)) : JSON.stringify(value, null, 2)]));
  }
  if (Array.isArray(data)) return { 'Extracted data': JSON.stringify(data, null, 2) };
  return { 'OCR response': data == null ? 'No extracted fields returned.' : String(data) };
}
function normalizedKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findField(source, aliases) {
  if (!source || typeof source !== 'object') return undefined;
  const wanted = new Set(aliases.map(normalizedKey));
  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(normalizedKey(key)) && value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function riskFrom(payload, fields) {
  const sources = [fields, payload?.data, payload?.result, payload?.fields, payload];
  let raw;
  for (const source of sources) {
    raw = findField(source, ['Risk Score', 'risk_score', 'riskScore', 'risk']);
    if (raw !== undefined) break;
  }
  if (raw === undefined) return null;
  const numeric = Number(String(raw).replace('%', '').trim());
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : null;
}

function displayField(fields, aliases, fallback = '—') {
  const value = findField(fields, aliases);
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function App() {
  const fileInput = useRef(null);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(readHistory);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [showSettings, setShowSettings] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 30))); }, [history]);
  useEffect(() => () => { if (preview.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  const filteredHistory = useMemo(() => history.filter(item => `${item.filename} ${item.status}`.toLowerCase().includes(query.toLowerCase())), [history, query]);
  const fields = result ? normalizeFields(result.payload) : {};
  const risk = result ? riskFrom(result.payload, fields) : null;
  const fieldEntries = Object.entries(fields).filter(([key]) => !['success', 'filename', 'status'].includes(key.toLowerCase()));

  function selectFile(nextFile) {
    if (!nextFile) return;
    setError(''); setNotice(''); setResult(null);
    if (!/^image\/(jpeg|png|webp|tiff|bmp)$/i.test(nextFile.type) && !/\.(jpe?g|png|webp|tiff?|bmp)$/i.test(nextFile.name)) {
      setError('Choose an image file such as JPG, PNG, WEBP or TIFF.'); return;
    }
    if (nextFile.size > 15 * 1024 * 1024) { setError('This image is over 15 MB. Please choose a smaller image.'); return; }
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    setActiveTab('overview');
  }
  function onDrop(event) { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0]); }

  async function processInvoice() {
    if (!file) { setError('Upload an invoice image first.'); return; }
    const base = apiUrl.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(base)) { setError('Enter a valid backend URL in Settings.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const imageBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read this image. Please try again.'));
        reader.readAsDataURL(file);
      });
      const response = await fetch(`${base}${PROCESS_PATH}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, image_base64: imageBase64 })
      });
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { response_text: raw }; }
      if (!response.ok) {
        const detail = payload?.detail || payload?.message || payload?.error || raw || `HTTP ${response.status}`;
        throw new Error(`Backend returned ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
      }
      const fieldsNow = normalizeFields(payload);
      const record = { id: crypto?.randomUUID?.() || `${Date.now()}`, filename: file.name, createdAt: new Date().toISOString(), status: payload?.success === false ? 'Review needed' : 'Processed', payload, fields: fieldsNow };
      setResult(record); setHistory(prev => [record, ...prev].slice(0, 30));
      setNotice(payload?.success === false ? 'The API responded, but marked this invoice unsuccessful. Review the returned details.' : 'Invoice processed. Review the extracted fields below.');
      setActiveTab('overview');
    } catch (err) {
      const message = err instanceof TypeError && /fetch/i.test(err.message)
        ? 'Could not reach the API. Check the backend URL and make sure the Render service allows this frontend origin through CORS.'
        : (err?.message || 'Something went wrong while processing the invoice.');
      setError(message);
    } finally { setBusy(false); }
  }
  function loadRecord(record) { setResult(record); setFile(null); setPreview(''); setError(''); setNotice('Loaded saved browser history.'); setActiveTab('overview'); }
  function resetWorkspace() { setFile(null); setPreview(''); setResult(null); setError(''); setNotice(''); if (fileInput.current) fileInput.current.value = ''; }
  function exportResult() {
    if (!result) return;
    const rows = [['Field', 'Extracted value'], ...Object.entries(result.fields || normalizeFields(result.payload)).map(([key, value]) => [key, value])];
    const csv = rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${(result.filename || 'invoice').replace(/\.[^.]+$/, '')}-extracted.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand-row"><div className="brand-mark"><Command size={19}/></div><div><div className="brand-name">CUSTOMS<span>TWIN</span></div><div className="brand-sub">INTELLIGENCE PLATFORM</div></div><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={17}/></button></div>
      <div className="workspace-switch"><div className="workspace-icon">CT</div><div className="workspace-copy"><b>Customs Operations</b><span>Workspace · Free tier</span></div><ChevronDown size={15}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="main-nav">
        <button className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => { setActiveTab('overview'); setMobileNav(false); }}><LayoutDashboard size={17}/><span>Overview</span><span className="nav-pill">01</span></button>
        <button className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => { setActiveTab('history'); setMobileNav(false); }}><FileSearch size={17}/><span>Invoice history</span><span className="nav-count">{history.length}</span></button>
      </nav>
      <div className="nav-label nav-label-spaced">SYSTEM</div>
      <nav className="main-nav"><button className="nav-item" onClick={() => setShowSettings(true)}><Settings2 size={17}/><span>API settings</span></button><button className="nav-item" onClick={() => setNotice('Security note: API calls are made directly from this browser to your configured backend.')}><LockKeyhole size={17}/><span>Security & privacy</span></button></nav>
      <div className="sidebar-spacer"/>
      <div className="sidebar-status"><span className="status-dot"/><div><b>Backend configured</b><small>API endpoint ready to test</small></div><button className="tiny-icon" onClick={() => setShowSettings(true)} aria-label="Configure API"><Settings2 size={14}/></button></div>
      <div className="profile-row"><div className="avatar">AM</div><div className="profile-copy"><b>Operations Analyst</b><span>Local workspace</span></div><MoreHorizontal size={18} className="muted-icon"/></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={19}/></button><div className="breadcrumb">Workspace <span>/</span> <b>{activeTab === 'history' ? 'Invoice history' : 'Invoice intelligence'}</b></div></div><div className="topbar-actions"><div className="environment-chip"><span className="status-dot"/> API workspace</div><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice('You’re all caught up.')}><Bell size={17}/><i/></button><div className="top-avatar">AM</div></div></header>
      <div className="content-wrap">
        <div className="page-heading"><div><div className="eyebrow"><Sparkles size={13}/> AI-ASSISTED DOCUMENT INTELLIGENCE</div><h1>{activeTab === 'history' ? 'Invoice history' : 'Invoice intelligence'}</h1><p>{activeTab === 'history' ? 'Review invoices processed in this browser.' : 'Turn customs paperwork into structured, reviewable data.'}</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => setShowSettings(true)}><Settings2 size={16}/> API settings</button><button className="button button-primary" onClick={() => { resetWorkspace(); setActiveTab('overview'); }}><Plus size={17}/> New invoice</button></div></div>
        {error && <div className="alert alert-error"><ShieldAlert size={18}/><div><b>Couldn’t process invoice</b><p>{error}</p></div><button className="alert-close" onClick={() => setError('')} aria-label="Dismiss"><X size={16}/></button></div>}
        {notice && !error && <div className="alert alert-success"><CheckCircle2 size={18}/><div><b>Update</b><p>{notice}</p></div><button className="alert-close" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16}/></button></div>}
        {activeTab === 'history' ? <section className="history-panel panel"><div className="panel-heading"><div><div className="section-kicker">RECORDS</div><h2>Recent processing activity</h2><p>History is stored locally in this browser, not in a shared database.</p></div><div className="search-box"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search invoices…"/></div></div>{filteredHistory.length ? <div className="history-list">{filteredHistory.map(item => <button className="history-row" key={item.id} onClick={() => loadRecord(item)}><div className="history-file-icon"><FileText size={19}/></div><div className="history-file"><b>{item.filename}</b><span>{formatDate(item.createdAt)}</span></div><span className={`status-tag ${item.status === 'Processed' ? 'tag-success' : 'tag-warning'}`}><span/> {item.status}</span><ArrowUpRight size={16} className="muted-icon"/></button>)}</div> : <EmptyState title="No invoices found" text="Process an invoice or change your search."/>}</section> : <>
          <section className="metrics-grid"><Metric icon={<FileCheck2 size={18}/>} label="Processed in this browser" value={String(history.length).padStart(2, '0')} detail="Local session history" tint="blue"/><Metric icon={<ShieldCheck size={18}/>} label="API connection" value="Ready to test" detail="Render · FastAPI endpoint" tint="green"/><Metric icon={<Gauge size={18}/>} label="Risk assessment" value={risk == null ? '—' : `${risk}%`} detail={risk == null ? 'No risk score returned' : 'From API response'} tint="violet"/><Metric icon={<Activity size={18}/>} label="Latest activity" value={result ? 'Complete' : 'Waiting'} detail={result ? formatDate(result.createdAt) : 'Upload an invoice to begin'} tint="amber"/></section>
          <div className="work-grid">
            <section className="panel upload-panel"><div className="panel-heading"><div><div className="section-kicker">01 / INPUT DOCUMENT</div><h2>Upload invoice</h2><p>Submit an invoice image for OCR and field extraction.</p></div><span className="step-icon"><Upload size={17}/></span></div>
              {!file ? <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}><div className="upload-orbit"><CloudUpload size={26}/><span><Plus size={12}/></span></div><h3>Drop your invoice here</h3><p>or <b>browse files</b> from your device</p><div className="file-rules"><span><FileImage size={13}/> JPG, PNG, WEBP</span><i/><span>Up to 15 MB</span></div><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/tiff,image/bmp,.jpg,.jpeg,.png,.webp,.tif,.tiff,.bmp" hidden onChange={e => selectFile(e.target.files?.[0])}/></div> : <div className="selected-file"><div className="preview-wrap">{preview ? <img src={preview} alt="Invoice preview"/> : <FileImage size={24}/>}<span className="preview-badge"><Check size={12}/></span></div><div className="selected-file-copy"><b title={file.name}>{file.name}</b><span>{(file.size / 1024).toFixed(file.size < 1024 * 1024 ? 0 : 1)} {file.size < 1024 * 1024 ? 'KB' : 'MB'} · Image ready</span><div className="file-ready"><span className="status-dot"/> Ready to process</div></div><button className="icon-button" onClick={resetWorkspace} aria-label="Remove image"><X size={16}/></button></div>}
              <div className="upload-note"><LockKeyhole size={14}/><span>Image is sent to your configured backend for processing. Avoid uploading sensitive documents unless your deployment is approved for that data.</span></div>
              <div className="process-divider"><span>PROCESSING PIPELINE</span><div/></div><div className="pipeline"><PipelineStep n="01" title="Image ingestion" subtitle="Read invoice image" done={!!file}/><div className="pipeline-line"/><PipelineStep n="02" title="OCR & extraction" subtitle="FastAPI · Tesseract" done={!!result} loading={busy}/><div className="pipeline-line"/><PipelineStep n="03" title="Field review" subtitle="Validate extracted values" done={!!result}/></div>
              <button className="button button-primary process-button" disabled={!file || busy} onClick={processInvoice}>{busy ? <><LoaderCircle className="spin" size={17}/> Processing invoice…</> : <><Zap size={17}/> Process invoice <ArrowRight size={16}/></>}</button><div className="process-footnote"><span><ShieldCheck size={13}/> Secure API request</span><span><Clock3 size={13}/> Processing time varies</span></div>
            </section>
            <section className="panel results-panel"><div className="panel-heading"><div><div className="section-kicker">02 / EXTRACTION OUTPUT</div><h2>Extracted data</h2><p>Review the values returned by the OCR backend.</p></div><span className={`result-status ${result ? 'result-status-done' : ''}`}><span/>{result ? 'Response received' : 'Awaiting input'}</span></div>
              {!result ? <div className="empty-results"><div className="empty-illustration"><div className="empty-doc"><FileText size={29}/><span><Sparkles size={13}/></span></div><div className="empty-orbit orbit-one"/><div className="empty-orbit orbit-two"/></div><h3>Your results will appear here</h3><p>Upload an invoice and run extraction to view the fields returned by your backend.</p><div className="empty-feature-list"><span><CheckCircle2 size={15}/> Structured field response</span><span><CheckCircle2 size={15}/> Review before export</span><span><CheckCircle2 size={15}/> CSV download</span></div></div> : <><div className="result-file-strip"><div className="result-file-icon"><FileCheck2 size={17}/></div><div className="result-file-copy"><b>{result.filename}</b><span>Processed {formatDate(result.createdAt)}</span></div><span className="status-tag tag-success"><span/>{result.status}</span></div><section className="risk-summary" aria-label="Risk assessment results" style={{ margin: '18px 0', padding: '16px', border: '1px solid var(--border, #e5e7eb)', borderRadius: '14px', background: 'var(--panel, #fff)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <div><div className="section-kicker">RISK ENGINE</div><h3 style={{ margin: '4px 0 0', fontSize: '17px' }}>Customs risk assessment</h3></div>
                    <span style={{ padding: '6px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, background: /high|critical/i.test(displayField(fields, ['Risk Level'])) ? '#fee2e2' : /medium|moderate/i.test(displayField(fields, ['Risk Level'])) ? '#fef3c7' : '#dcfce7', color: /high|critical/i.test(displayField(fields, ['Risk Level'])) ? '#991b1b' : /medium|moderate/i.test(displayField(fields, ['Risk Level'])) ? '#92400e' : '#166534' }}>
                      {displayField(fields, ['Risk Level'], 'Risk level unavailable')}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '10px' }}>
                    {[
                      { label: 'Risk Score', value: risk == null ? displayField(fields, ['Risk Score']) : `${risk}%` },
                      { label: 'Confidence Score', value: displayField(fields, ['Confidence Score', 'confidence_score', 'confidenceScore']) },
                      { label: 'Decision', value: displayField(fields, ['Decision', 'Final Decision']) },
                      { label: 'Country Risk', value: displayField(fields, ['Country Risk Level', 'Country Risk', 'country_risk_level']) },
                    ].map(item => <div key={item.label} style={{ padding: '12px', borderRadius: '10px', background: 'var(--surface, #f8fafc)', minWidth: 0 }}>
                      <div style={{ fontSize: '12px', color: 'var(--muted, #64748b)', marginBottom: '7px' }}>{item.label}</div>
                      <div style={{ fontSize: '15px', fontWeight: 700, overflowWrap: 'anywhere' }}>{item.value}</div>
                    </div>)}
                  </div>
                  <div style={{ marginTop: '12px', padding: '12px', borderRadius: '10px', background: 'var(--surface, #f8fafc)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--muted, #64748b)', marginBottom: '6px' }}>Risk Reason</div>
                    <div style={{ fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayField(fields, ['Risk Reason', 'risk_reason', 'riskReason'], 'No risk reason returned by the backend.')}</div>
                  </div>
                </section>
                <div className="fields-heading"><b>Extracted fields</b><span>{fieldEntries.length} values</span></div><div className="field-grid">{fieldEntries.map(([key, value]) => <div className="field-card" key={key}><span>{prettyLabel(key)}</span><b title={String(value)}>{String(value).length > 130 ? `${String(value).slice(0, 127)}…` : String(value)}</b></div>)}</div><div className="raw-response"><details><summary><span><Command size={14}/> Raw API response</span><ChevronDown size={15}/></summary><pre>{JSON.stringify(result.payload, null, 2)}</pre></details></div><div className="result-actions"><button className="button button-secondary" onClick={exportResult}><ArrowDownToLine size={16}/> Export CSV</button><button className="button button-primary" onClick={() => { setFile(null); setPreview(''); setResult(null); setError(''); setNotice(''); fileInput.current && (fileInput.current.value = ''); }}><Plus size={16}/> Process another</button></div></>}
              <div className="result-footer"><span><Fingerprint size={14}/> Values are returned by your API</span><button onClick={() => setShowSettings(true)}>Endpoint details <ArrowUpRight size={13}/></button></div>
            </section>
          </div>
          <section className="bottom-grid"><div className="panel recent-panel"><div className="compact-panel-heading"><div><div className="section-kicker">ACTIVITY</div><h2>Recent invoices</h2></div><button className="text-button" onClick={() => setActiveTab('history')}>View history <ArrowRight size={14}/></button></div>{history.length ? history.slice(0, 3).map(item => <button className="recent-row" key={item.id} onClick={() => loadRecord(item)}><div className="recent-icon"><FileText size={16}/></div><div className="recent-copy"><b>{item.filename}</b><span>{formatDate(item.createdAt)}</span></div><span className="status-tag tag-success"><span/>{item.status}</span><ArrowUpRight size={15} className="muted-icon"/></button>) : <div className="mini-empty"><Clock3 size={17}/><span>Your processed invoices will appear here.</span></div>}</div><div className="insight-card"><div className="insight-glow"/><div className="insight-top"><div className="insight-icon"><Sparkles size={18}/></div><span>WORKFLOW NOTE</span></div><h3>From document to decision.</h3><p>This interface displays the fields returned by your current API. Persistence, risk rules, and shared team history can be added as separate backend capabilities.</p><div className="insight-bottom"><span><PackageCheck size={15}/> Built for review</span><span>v1.0.0</span></div></div></section>
        </>}
        <footer className="footer"><span>© {new Date().getFullYear()} Customs Twin <i/> Invoice intelligence workspace</span><span><span className="status-dot"/> Frontend ready <i/> <button onClick={() => setShowSettings(true)}><CircleHelp size={13}/> Help & configuration</button></span></footer>
      </div>
    </main>
    {showSettings && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowSettings(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="modal-heading"><div className="modal-icon"><Settings2 size={20}/></div><button className="icon-button" onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={18}/></button></div><div className="section-kicker">CONFIGURATION</div><h2 id="settings-title">Backend API settings</h2><p className="modal-description">Set the base URL for your deployed FastAPI service. The app calls the Base64 invoice endpoint.</p><label className="input-label" htmlFor="api-url">Backend base URL</label><input id="api-url" className="text-input" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://your-service.onrender.com"/><div className="endpoint-preview"><span>POST endpoint</span><code>{apiUrl.trim().replace(/\/$/, '') || 'https://your-service.onrender.com'}{PROCESS_PATH}</code></div><div className="modal-warning"><ShieldAlert size={16}/><span>The backend must allow requests from this frontend origin through CORS. Keep secrets out of frontend code.</span></div><div className="modal-actions"><button className="button button-secondary" onClick={() => setApiUrl(DEFAULT_API)}>Reset default</button><button className="button button-primary" onClick={() => { setApiUrl(apiUrl.trim().replace(/\/$/, '')); setShowSettings(false); setNotice('API URL saved for this session. Set VITE_API_URL in .env for a deployment default.'); }}>Save settings</button></div></section></div>}
  </div>;
}
function Metric({ icon, label, value, detail, tint }) { return <div className="metric-card"><div className={`metric-icon ${tint}`}>{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>; }
function PipelineStep({ n, title, subtitle, done, loading }) { return <div className={`pipeline-step ${done ? 'step-done' : ''}`}><div className="pipeline-number">{loading ? <LoaderCircle className="spin" size={14}/> : done ? <Check size={14}/> : n}</div><div className="pipeline-copy"><b>{title}</b><span>{subtitle}</span></div>{done && <CheckCircle2 className="pipeline-check" size={16}/>}</div>; }
function EmptyState({ title, text }) { return <div className="table-empty"><div><FileSearch size={22}/></div><b>{title}</b><span>{text}</span></div>; }

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
