/* renderer.js — BER Viewer UI */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let allNodes      = [];
let selectedRow   = null;
let searchResults = [];
let searchIdx     = 0;
let currentNodes  = [];       // top-level parsed nodes (for save/export)
let currentFile   = null;     // current file path
let hasChanges    = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropOverlay  = document.getElementById('drop-overlay');
const splitterCont = document.getElementById('splitter-container');
const treeBody     = document.getElementById('tree-body');
const fileInfo     = document.getElementById('file-info');
const statusLeft   = document.getElementById('status-left');
const statusRight  = document.getElementById('status-right');
const searchInput  = document.getElementById('search-input');
const treePanel    = document.getElementById('tree-panel');
const resizeHandle = document.getElementById('resize-handle');

// ── Schema info ───────────────────────────────────────────────────────────────
window.berApi.getSchemaInfo().then(info => {
  const typeStr = info.typeCount > 0 ? `Schema: ${info.typeCount} types` : 'Schema: not loaded';
  const verStr  = info.version ? `v${info.version}` : '';
  statusRight.textContent = [verStr, typeStr].filter(Boolean).join('  |  ');
});

// ── Spec detection from domain OID ────────────────────────────────────────────
function specFromOid(oid) {
  if (!oid) return null;
  const p = oid.split('.');
  // All LI OIDs start with 0.4.0.2.2
  if (p[0]==='0'&&p[1]==='4'&&p[2]==='0'&&p[3]==='2'&&p[4]==='2') {
    const domain=p[5], sub=p[6], rel=p[7], ver=p[8];
    if (domain === '5') {
      // ETSI TS 102 232 series — 0.4.0.2.2.5.[sub].[version]
      // version byte: e.g. 24="v2.4", 29="v2.9", 36="v3.6", 40="v4.0"
      const specMap = {'1':'ETSI TS 102 232-1','2':'ETSI TS 102 232-2',
        '3':'ETSI TS 102 232-3','5':'ETSI TS 102 232-5','6':'ETSI TS 102 232-6'};
      const spec = specMap[sub] || `ETSI TS 102 232 (li-ps/${sub})`;
      const vn = Number(rel);  // rel = p[7] = version byte
      const vstr = rel ? ` v${Math.floor(vn/10)}.${vn%10}` : '';
      return `${spec}${vstr}`;
    }
    if (domain === '4') {
      // 3GPP — 0.4.0.2.2.4.[sub].[release].[version]
      const subNum = Number(sub);
      if (subNum === 1)  return `ETSI TS 101 671 / 3GPP TS 33.108 (HI2)`;
      if (subNum === 3)  return `3GPP TS 33.108 r${rel||'?'} (UmtsCS HI2)`;
      if (subNum === 8)  return `3GPP TS 33.108 r${rel||'?'} (EPS HI2)`;
      if (subNum === 9)  return `3GPP TS 33.108 r${rel||'?'} (EPS HI3)`;
      if (subNum === 19) return `3GPP TS 33.128 r${rel||'?'} v${ver||'?'} (5G NR)`;
      return `3GPP TS 33.108 (sub=${sub})`;
    }
  }
  return null;
}

function findDomainOid(nodes) {
  for (const n of nodes) {
    if (n.fieldName && n.fieldName.toLowerCase().includes('domainid') && n.displayValue)
      return String(n.displayValue);
    if (n.fieldName === 'iPMMIRIObjId' && n.displayValue)
      return String(n.displayValue);
    const r = findDomainOid(n.children);
    if (r) return r;
  }
  return null;
}

// ── File loading ──────────────────────────────────────────────────────────────
window.berApi.onFileLoaded(data => {
  if(!data.nodes||data.nodes.length===0){ statusLeft.textContent=`Error: no nodes`; return; }
  // Ensure any previous detail/map state is cleared immediately
  clearDetail();
  currentNodes = data.nodes;
  currentFile  = data.filePath;
  hasChanges   = false;
  buildTree(data.nodes);
  fileInfo.textContent = `${data.fileName}  —  ${data.size} bytes`;
  statusLeft.textContent = `${data.fileName}  |  ${data.size} bytes  |  ${countNodes(data.nodes)} fields`;

  // Detect spec from embedded domain OID and update right status
  const domainOid = findDomainOid(data.nodes);
  const spec = specFromOid(domainOid);
  window.berApi.getSchemaInfo().then(info => {
    const typeStr = info.typeCount > 0 ? `Schema: ${info.typeCount} types` : 'Schema: not loaded';
    const verStr  = info.version ? `v${info.version}` : '';
    const parts   = [spec, verStr, typeStr].filter(Boolean);
    statusRight.textContent = parts.join('  |  ');
  });

  dropOverlay.classList.add('hidden');
  splitterCont.classList.remove('hidden');
  clearDetail();
  updateTitle();
});

window.berApi.onFileError(msg => { statusLeft.textContent = `Error: ${msg}`; });

function countNodes(nodes) {
  return nodes.reduce((s,n) => s+1+countNodes(n.children), 0);
}
function updateTitle() {
  document.title = `BER Viewer${hasChanges?' *':''} — ${currentFile ? currentFile.split(/[/\\]/).pop() : ''}`;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

// Intercept open to check for unsaved changes first
async function checkUnsavedAndOpen(openFn) {
  if (hasChanges) {
    const save = await confirmUnsaved();
    if (save === 'cancel') return;
    if (save === 'save') { await saveAs(); if (hasChanges) return; } // save failed
  }
  openFn();
}

function confirmUnsaved() {
  return new Promise(resolve => {
    const existing = document.getElementById('edit-dialog');
    if (existing) existing.remove();
    const dlg = document.createElement('div');
    dlg.id = 'edit-dialog';
    dlg.innerHTML = `
      <div id="edit-overlay"></div>
      <div id="edit-box" style="width:380px">
        <div id="edit-title">Ungespeicherte Änderungen</div>
        <div style="margin:12px 0;color:var(--text)">
          Die aktuelle Datei hat ungespeicherte Änderungen.<br>
          Möchten Sie sie vor dem Öffnen speichern?
        </div>
        <div id="edit-buttons" style="justify-content:space-between">
          <button id="dlg-cancel" class="btn-tool" style="border:1px solid var(--border)">Abbrechen</button>
          <div style="display:flex;gap:8px">
            <button id="dlg-discard" class="btn-tool" style="border:1px solid var(--border)">Verwerfen</button>
            <button id="dlg-save" style="padding:5px 16px;background:var(--accent);border:none;border-radius:4px;color:#fff;font-family:inherit;font-weight:bold;cursor:pointer">Speichern</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#dlg-cancel').onclick  = () => { dlg.remove(); resolve('cancel'); };
    dlg.querySelector('#dlg-discard').onclick = () => { dlg.remove(); resolve('discard'); };
    dlg.querySelector('#dlg-save').onclick    = () => { dlg.remove(); resolve('save'); };
    dlg.querySelector('#edit-overlay').onclick = () => { dlg.remove(); resolve('cancel'); };
  });
}

document.getElementById('btn-open').addEventListener('click', () =>
  checkUnsavedAndOpen(() => window.berApi.openFileDialog()));
document.getElementById('btn-expand').addEventListener('click', expandAll);
document.getElementById('btn-collapse').addEventListener('click', collapseAll);
document.getElementById('btn-search').addEventListener('click', searchNext);
document.getElementById('btn-save').addEventListener('click', saveAs);
document.getElementById('btn-export').addEventListener('click', exportTxt);

searchInput.addEventListener('keydown', e => { if(e.key==='Enter') searchNext(); });

window.berApi.onExpandAll(expandAll);
window.berApi.onCollapseAll(collapseAll);
window.berApi.onSaveAs(saveAs);
window.berApi.onExportTxt(exportTxt);
window.berApi.onRecentFilesUpdated(() => {}); // menu handles it
window.berApi.onOpenRecent(filePath =>
  checkUnsavedAndOpen(() => window.berApi.openFilePath(filePath)));

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey||e.metaKey;
  if(ctrl&&e.key==='o')      { e.preventDefault(); checkUnsavedAndOpen(() => window.berApi.openFileDialog()); }
  if(ctrl&&e.key==='f')      { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  if(ctrl&&e.shiftKey&&e.key==='S'){ e.preventDefault(); saveAs(); }
  if(ctrl&&e.shiftKey&&e.key==='E'){ e.preventDefault(); exportTxt(); }
  if(e.key==='F3')           { e.preventDefault(); searchNext(); }
  if(ctrl&&e.key==='e')      { e.preventDefault(); expandAll(); }
  if(ctrl&&e.key==='w')      { e.preventDefault(); collapseAll(); }
  if(e.key==='ArrowDown'&&selectedRow) moveSelection(1);
  if(e.key==='ArrowUp'  &&selectedRow) moveSelection(-1);
  if(e.key==='ArrowRight'&&selectedRow) toggleNode(selectedRow._node,true);
  if(e.key==='ArrowLeft' &&selectedRow) toggleNode(selectedRow._node,false);
});

// ── Drag & drop ───────────────────────────────────────────────────────────────
document.addEventListener('dragover', e => { e.preventDefault(); dropOverlay.classList.add('drop-active'); });
document.addEventListener('dragleave', () => dropOverlay.classList.remove('drop-active'));
document.addEventListener('drop', e => {
  e.preventDefault(); dropOverlay.classList.remove('drop-active');
  const file = e.dataTransfer.files[0];
  if (file) checkUnsavedAndOpen(() => window.berApi.openFilePath(file.path));
});

// ── Save As ───────────────────────────────────────────────────────────────────
async function saveAs() {
  if(!currentNodes.length){ statusLeft.textContent='No file loaded'; return; }
  const base = currentFile ? currentFile.replace(/(\.[^.]+)$/, '_modified$1') : 'modified.hi2';
  const savePath = await window.berApi.saveFileDialog(base);
  if(!savePath) return;

  const buf = serializeNodes(currentNodes);
  const result = await window.berApi.saveFile(savePath, Array.from(buf));
  if(result.ok){
    hasChanges = false;
    currentFile = savePath;
    fileInfo.textContent = savePath.split(/[/\\]/).pop() + `  —  ${buf.length} bytes`;
    statusLeft.textContent = `Saved: ${savePath}`;
    updateTitle();
  } else {
    statusLeft.textContent = `Save error: ${result.error}`;
  }
}

// ── Export TXT ────────────────────────────────────────────────────────────────
async function exportTxt() {
  if(!currentNodes.length){ statusLeft.textContent='No file loaded'; return; }
  // Show format picker dialog
  const dlg = document.createElement('div');
  dlg.id = 'edit-dialog';
  dlg.innerHTML = `
    <div id="edit-overlay"></div>
    <div id="edit-box" style="width:360px">
      <div id="edit-title">Export TXT — Choose Format</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin:12px 0">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="radio" name="fmt" value="1" checked>
          <span><b>Format 1</b> — Eingerückt (wie li_decoder.py)<br>
            <span style="color:var(--text-muted);font-size:11px">pSHeader:\n  li-psDomainId: 0.4.0.2.2.5...</span>
          </span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="radio" name="fmt" value="2">
          <span><b>Format 2</b> — Offset + Tag + Wert<br>
            <span style="color:var(--text-muted);font-size:11px">0004   pSHeader [1] ::= SEQUENCE (size=5a)</span>
          </span>
        </label>
      </div>
      <div id="edit-buttons">
        <button id="edit-cancel">Cancel</button>
        <button id="edit-ok">Export…</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('#edit-cancel').onclick = () => dlg.remove();
  dlg.querySelector('#edit-overlay').onclick = () => dlg.remove();
  dlg.querySelector('#edit-ok').onclick = async () => {
    const fmt = dlg.querySelector('input[name=fmt]:checked').value;
    dlg.remove();
    const base = currentFile ? currentFile.replace(/\.[^.]+$/, '.txt') : 'export.txt';
    let result;
    if (fmt === '1') {
      const txt = currentNodes.map(n => nodeToTxt(n, 0)).join('\n') + '\n';
      result = await window.berApi.exportTxt(base, txt);
    } else {
      result = await window.berApi.exportTxtFmt2(base, currentNodes);
    }
    if (result.ok) statusLeft.textContent = `Exported: ${result.path}`;
    else if (result.error) statusLeft.textContent = `Export error: ${result.error}`;
  };
}

function nodeToTxt(node, indent) {
  const pad='  '.repeat(indent);
  const name=node.fieldName||node.typeName||node.tagLabel;
  if(node.children&&node.children.length){
    return`${pad}${name}:\n${node.children.map(c=>nodeToTxt(c,indent+1)).join('\n')}`;
  }
  return`${pad}${name}: ${node.displayValue??''}`;
}

// ── BER serializer (client-side) ──────────────────────────────────────────────
function encodeLength(len) {
  if(len<128) return [len];
  const arr=[];let n=len;while(n>0){arr.unshift(n&0xff);n>>=8;}
  return [0x80|arr.length,...arr];
}
function serializeNode(node) {
  let tagBytes;
  if(node.tag<=30){
    tagBytes=[(node.cls<<6)|(node.cons<<5)|node.tag];
  }else{
    const t=[];let tv=node.tag;while(tv>0){t.unshift(tv&0x7f);tv>>=7;}
    for(let i=0;i<t.length-1;i++)t[i]|=0x80;
    tagBytes=[(node.cls<<6)|(node.cons<<5)|0x1f,...t];
  }
  let valueBytes;
  if(node.children&&node.children.length){
    valueBytes=node.children.flatMap(serializeNode);
  }else{
    valueBytes=node.rawValue||[];
  }
  return [...tagBytes,...encodeLength(valueBytes.length),...valueBytes];
}
function serializeNodes(nodes) {
  return new Uint8Array(nodes.flatMap(serializeNode));
}

// ── Context menu ──────────────────────────────────────────────────────────────
function showContextMenu(x, y, node, row) {
  const old = document.getElementById('ctx-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.id = 'ctx-menu';

  const items = [];
  if (!node.children.length) {
    items.push({ label: '✏️  Bearbeiten',   action: () => openEditDialog(node, row) });
    items.push({ label: '📋  Wert kopieren', action: () => navigator.clipboard.writeText(String(node.displayValue??'')) });
  }
  items.push({ label: '📋  Hex kopieren', action: () => {
    const hex = (node.rawValue||[]).map(b=>b.toString(16).padStart(2,'0')).join(' ');
    navigator.clipboard.writeText(hex);
  }});
  // SMS PDU decode: offer for content fields and sMSTPDU/sMSTPDUData fields
  const smsFieldNames = new Set(['content', 'national-SM-Content', 'sIPContent',
    'sMSTPDU', 'truncatedSMSTPDU']);
  const smsTpduNode = (() => {
    // Direct OCTET field (sMSTPDU, content, …)
    if (!node.children.length && node.rawValue && node.rawValue.length >= 8) {
      if (smsFieldNames.has(node.fieldName||'')) return node;
    }
    // Container node (sMSTPDUData) with one child that is the actual OCTET
    if (node.children.length === 1) {
      const child = node.children[0];
      if (!child.children.length && child.rawValue && child.rawValue.length >= 8 &&
          smsFieldNames.has(child.fieldName||'')) return child;
    }
    return null;
  })();
  if (smsTpduNode) {
    items.push({ type: 'sep' });
    items.push({ label: '📱  SMS dekodieren', action: () => showSmsDecode(smsTpduNode) });
  }
  if (node.children.length) {
    items.push({ label: '⊞  Aufklappen',   action: () => setExpanded(row, node, true) });
    items.push({ label: '⊟  Zuklappen',    action: () => setExpanded(row, node, false) });
  }

  for (const item of items) {
    if (item.type === 'sep') {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0';
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item';
    el.textContent = item.label;
    el.onclick = () => { menu.remove(); item.action(); };
    menu.appendChild(el);
  }

  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = (x + mw > window.innerWidth  ? x - mw : x) + 'px';
  menu.style.top  = (y + mh > window.innerHeight ? y - mh : y) + 'px';

  const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ── SMS PDU Decoder ───────────────────────────────────────────────────────────
const GSM7_ALPHABET =
  '@£$¥èéùìòÇ\nØø\rÅå' +
  'Δ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ' +
  ' !"#¤%&\'()*+,-./' +
  '0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNO' +
  'PQRSTUVWXYZÄÖÑÜ§' +
  '¿abcdefghijklmno' +
  'pqrstuvwxyzäöñüà';

function decodeBcdGsm(bcd, len) {
  let s = '';
  for (const b of bcd) {
    s += (b & 0xf).toString();
    const hi = (b >> 4) & 0xf;
    if (hi !== 0xf && s.length < len) s += hi.toString();
  }
  return s.slice(0, len);
}

function decodeGsm7(data, numSeptets, shift) {
  shift = shift || 0;
  let buf = 0, bits = shift, result = '';
  for (const byte of data) {
    buf |= byte << bits; bits += 8;
    while (bits >= 7) {
      const idx = buf & 0x7f;
      if (result.length < numSeptets)
        result += idx < GSM7_ALPHABET.length ? GSM7_ALPHABET[idx] : '\uFFFD';
      buf >>= 7; bits -= 7;
    }
  }
  return result;
}

function decodeSmsPdu(rawBytes) {
  const raw = rawBytes;
  let pos = 0;
  const result = {};
  const errors = [];

  try {
    // Detect SMSC prefix: only skip it if second byte looks like a valid TON/NPI
    // (common values: 0x91=international, 0x81=national, 0xa1, 0x11, 0x01)
    // Avoids misinterpreting the TP byte as SMSC length
    const VALID_TON_NPI = new Set([0x91, 0x81, 0xa1, 0x11, 0x01, 0xd0]);
    const smscLen = raw[0];
    if (smscLen > 0 && smscLen <= 12 && raw.length > smscLen + 1 && VALID_TON_NPI.has(raw[1])) {
      const smscTon = raw[1];
      const smscBcd = raw.slice(2, 1 + smscLen);
      const smscDigits = decodeBcdGsm(smscBcd, smscBcd.length * 2);
      const smscIntl = ((smscTon >> 4) & 0x7) === 1 ? '+' : '';
      result.smsc = smscIntl + smscDigits.replace(/f/gi, '');
      pos = 1 + smscLen;
    }

    if (pos >= raw.length) throw new Error('Too short after SMSC');

    const bcd2 = b => (b & 0xf) * 10 + ((b >> 4) & 0xf);

    // TP byte
    const tp = raw[pos++];
    const mti = tp & 0x03;
    const udhi = (tp >> 6) & 1;
    const mtiNames = ['SMS-DELIVER', 'SMS-SUBMIT', 'SMS-STATUS-REPORT', 'reserved'];
    result.type = mtiNames[mti];

    // SMS-STATUS-REPORT has completely different structure (no PID/DCS/text)
    if (mti === 2) {
      result.messageRef = raw[pos++]; // TP-MR
      // TP-RA (Recipient Address)
      const raLen = raw[pos++]; const raTon = raw[pos++];
      const raBcd = raw.slice(pos, pos + Math.ceil(raLen / 2)); pos += Math.ceil(raLen / 2);
      const raIntl = ((raTon >> 4) & 0x7) === 1 ? '+' : '';
      result.to = raIntl + decodeBcdGsm(raBcd, raLen);
      // TP-SCTS (send time)
      if (pos + 7 <= raw.length) {
        const s = raw.slice(pos, pos + 7); pos += 7;
        const tz = bcd2(s[6] & ~0x08) * 15;
        result.timestamp = `20${bcd2(s[0]).toString().padStart(2,'0')}-${bcd2(s[1]).toString().padStart(2,'0')}-${bcd2(s[2]).toString().padStart(2,'0')} ` +
          `${bcd2(s[3]).toString().padStart(2,'0')}:${bcd2(s[4]).toString().padStart(2,'0')}:${bcd2(s[5]).toString().padStart(2,'0')} ` +
          `${s[6]&0x08?'-':'+'}${Math.floor(tz/60).toString().padStart(2,'0')}:${(tz%60).toString().padStart(2,'0')}`;
      }
      // TP-DT (delivery time)
      if (pos + 7 <= raw.length) {
        const d = raw.slice(pos, pos + 7); pos += 7;
        const tz = bcd2(d[6] & ~0x08) * 15;
        result.deliveryTime = `20${bcd2(d[0]).toString().padStart(2,'0')}-${bcd2(d[1]).toString().padStart(2,'0')}-${bcd2(d[2]).toString().padStart(2,'0')} ` +
          `${bcd2(d[3]).toString().padStart(2,'0')}:${bcd2(d[4]).toString().padStart(2,'0')}:${bcd2(d[5]).toString().padStart(2,'0')} ` +
          `${d[6]&0x08?'-':'+'}${Math.floor(tz/60).toString().padStart(2,'0')}:${(tz%60).toString().padStart(2,'0')}`;
      }
      // TP-ST (status)
      if (pos < raw.length) {
        const st = raw[pos++];
        const stMap = {0:'Zugestellt', 1:'Weitergeleitet', 2:'Ersetzt',
          0x20:'Netz überlastet', 0x21:'Empfänger beschäftigt', 0x22:'Keine Antwort',
          0x24:'Dienst abgelehnt', 0x40:'Ungültiges Ziel'};
        result.status = stMap[st] ?? `0x${st.toString(16).padStart(2,'0')}`;
      }
      result.text = ''; // no text body
      return { ...result, errors };
    }

    // SMS-SUBMIT adds a Message Reference (TP-MR) and optional Validity Period (TP-VP)
    if (mti === 1) {
      result.messageRef = raw[pos++];
    }

    // SMS-DELIVER / SMS-SUBMIT: address
    const addrLen = raw[pos++];
    const addrTon = raw[pos++];
    const addrBcd = raw.slice(pos, pos + Math.ceil(addrLen / 2)); pos += Math.ceil(addrLen / 2);
    const addrIntl = ((addrTon >> 4) & 0x7) === 1 ? '+' : '';
    result[mti === 1 ? 'to' : 'from'] = addrIntl + decodeBcdGsm(addrBcd, addrLen);

    result.pid = `0x${raw[pos++].toString(16).padStart(2,'0')}`;

    const dcs = raw[pos++];
    const cg = (dcs >> 4) & 0xf;
    let alpha = 0;
    if (cg < 4) alpha = (dcs >> 2) & 0x03;
    else if (cg === 0xf) alpha = (dcs >> 2) & 1;
    result.dcs = `0x${dcs.toString(16).padStart(2,'0')} (${['GSM7','8-bit','UCS2','reserved'][alpha]})`;

    // SMS-DELIVER has SCTS, SMS-SUBMIT has TP-VP (validity period)
    if (mti === 0) {
      const s = raw.slice(pos, pos + 7); pos += 7;
      const tz = bcd2(s[6] & ~0x08) * 15;
      result.timestamp = `20${bcd2(s[0]).toString().padStart(2,'0')}-${bcd2(s[1]).toString().padStart(2,'0')}-${bcd2(s[2]).toString().padStart(2,'0')} ` +
        `${bcd2(s[3]).toString().padStart(2,'0')}:${bcd2(s[4]).toString().padStart(2,'0')}:${bcd2(s[5]).toString().padStart(2,'0')} ` +
        `${s[6]&0x08?'-':'+'}${Math.floor(tz/60).toString().padStart(2,'0')}:${(tz%60).toString().padStart(2,'0')}`;
    } else if (mti === 1) {
      const vpf = (tp >> 3) & 0x03;
      if (vpf === 1) pos += 1;             // relative validity period
      else if (vpf === 2 || vpf === 3) pos += 7; // absolute/enhanced validity period
    }

    const udl = raw[pos++];
    const ud = raw.slice(pos);

    let udhLen = 0;
    if (udhi && ud.length > 0) {
      udhLen = ud[0] + 1;
      let ui = 1;
      while (ui < udhLen && ui + 1 < ud.length) {
        const iei = ud[ui]; const iel = ud[ui + 1];
        if (iei === 0x00 && iel >= 3 && ui + 4 < ud.length) {
          result.fragment = `Teil ${ud[ui+4]}/${ud[ui+3]} (Ref=${ud[ui+2]})`;
        }
        ui += 2 + iel;
      }
    }

    if (alpha === 0) {
      result.text = decodeGsm7(ud.slice(udhLen), udl - (udhi ? Math.ceil(udhLen * 8 / 7) : 0),
        udhi ? (udhLen * 8) % 7 : 0);
    } else if (alpha === 1) {
      result.text = new TextDecoder('latin1').decode(new Uint8Array(ud.slice(udhLen)));
    } else if (alpha === 2) {
      result.text = new TextDecoder('utf-16-be').decode(new Uint8Array(ud.slice(udhLen)));
    } else {
      result.text = '';
    }
  } catch (e) {
    errors.push(e.message);
  }

  return { ...result, errors };
}

function showSmsDecode(node) {
  const raw = node.rawValue || [];
  const decoded = decodeSmsPdu(raw);

  const existing = document.getElementById('edit-dialog');
  if (existing) existing.remove();

  const rows = [];
  if (decoded.type)         rows.push(['Typ',            decoded.type]);
  if (decoded.smsc)         rows.push(['SMSC',           decoded.smsc]);
  if (decoded.from)         rows.push(['Von',            decoded.from]);
  if (decoded.to)           rows.push(['An',             decoded.to]);
  if (decoded.messageRef !== undefined) rows.push(['Ref', decoded.messageRef]);
  if (decoded.timestamp)    rows.push(['Sendezeit',      decoded.timestamp]);
  if (decoded.deliveryTime) rows.push(['Zustellzeit',    decoded.deliveryTime]);
  if (decoded.status)       rows.push(['Status',         decoded.status]);
  if (decoded.pid)          rows.push(['PID',            decoded.pid]);
  if (decoded.dcs)          rows.push(['DCS',            decoded.dcs]);
  if (decoded.fragment)     rows.push(['Fragment',       decoded.fragment]);
  if (decoded.text)         rows.push(['Text',           decoded.text]);
  if (decoded.errors?.length) rows.push(['⚠ Fehler',    decoded.errors.join(', ')]);

  const tableHtml = rows.map(([k,v]) =>
    `<tr><td style="color:var(--text-muted);padding:3px 12px 3px 0;white-space:nowrap">${k}</td>`+
    `<td style="color:var(--green);word-break:break-all">${v}</td></tr>`
  ).join('');

  const dlg = document.createElement('div');
  dlg.id = 'edit-dialog';
  dlg.innerHTML = `
    <div id="edit-overlay"></div>
    <div id="edit-box" style="width:500px;max-height:80vh;overflow-y:auto">
      <div id="edit-title">📱 SMS Inhalt
        <span id="edit-type">${(node.fieldName||'')} · ${raw.length} B</span>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:12px">
        ${tableHtml}
      </table>
      <div style="margin-top:8px;background:var(--bg-alt);border-radius:4px;padding:10px;font-size:13px;color:var(--green);word-break:break-all;white-space:pre-wrap">${decoded.text ?? '(kein Text)'}</div>
      <div id="edit-buttons" style="margin-top:12px">
        <button id="edit-cancel">Schließen</button>
        <button id="edit-ok" onclick="navigator.clipboard.writeText(${JSON.stringify(decoded.text??'')})">Text kopieren</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('#edit-cancel').onclick = () => dlg.remove();
  dlg.querySelector('#edit-overlay').onclick = () => dlg.remove();
  dlg.querySelector('#edit-ok').onclick = () => {
    navigator.clipboard.writeText(decoded.text ?? '');
    statusLeft.textContent = 'SMS-Text kopiert';
    dlg.remove();
  };
}

// ── Edit dialog ───────────────────────────────────────────────────────────────
function openEditDialog(node, row) {
  // Remove any existing dialog
  const existing = document.getElementById('edit-dialog');
  if(existing) existing.remove();

  const isHex = node.rawValue && !isTextPrimitive(node);
  const currentVal = isHex
    ? Array.from(node.rawValue).map(b => b.toString(16).padStart(2,'0')).join(' ')
    : (node.displayValue ?? '');

  const dlg = document.createElement('div');
  dlg.id = 'edit-dialog';
  dlg.innerHTML = `
    <div id="edit-overlay"></div>
    <div id="edit-box">
      <div id="edit-title">${node.fieldName||node.tagLabel}
        <span id="edit-type">${node.typeName||''}</span>
      </div>
      <div id="edit-hint">${isHex ? 'Hex bytes (space-separated)' : 'Text value'}</div>
      <textarea id="edit-input" spellcheck="false">${currentVal}</textarea>
      <div id="edit-buttons">
        <button id="edit-cancel">Cancel</button>
        <button id="edit-ok">Apply</button>
      </div>
      <div id="edit-error"></div>
    </div>
  `;
  document.body.appendChild(dlg);

  const input  = dlg.querySelector('#edit-input');
  const errDiv = dlg.querySelector('#edit-error');
  input.focus(); input.select();

  dlg.querySelector('#edit-cancel').onclick = () => dlg.remove();
  dlg.querySelector('#edit-overlay').onclick = () => dlg.remove();

  dlg.querySelector('#edit-ok').onclick = () => {
    const raw = applyEdit(node, input.value.trim(), isHex, errDiv);
    if(raw === null) return;
    node.rawValue = raw;
    node.displayValue = recomputeDisplayValue(node);
    // Mark as changed
    node._modified = true;
    hasChanges = true;
    updateTitle();
    // Update row value cell
    const valCell = row.querySelector('.col-value');
    if(valCell){
      valCell.textContent = String(node.displayValue).slice(0,120);
      valCell.style.color = 'var(--orange)';
    }
    row.classList.add('modified');
    dlg.remove();
    statusLeft.textContent = `Modified: ${node.fieldName||node.tagLabel}`;
  };

  // Enter to confirm (Shift+Enter for newline in textarea)
  input.addEventListener('keydown', e => {
    if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); dlg.querySelector('#edit-ok').click(); }
    if(e.key==='Escape') dlg.remove();
  });
}

function isTextPrimitive(node) {
  // UNIVERSAL string/time tags
  if (node.cls === 0 && [12,19,22,26,30,23,24].includes(node.tag)) return true;
  // Check raw bytes: if all printable ASCII → treat as text
  if (node.rawValue && node.rawValue.length > 0) {
    const allPrintable = node.rawValue.every(b => b >= 0x20 && b <= 0x7e);
    if (allPrintable) return true;
  }
  // Fallback: displayValue looks like readable text (no leading 0x)
  const s = node.displayValue;
  if (typeof s === 'string' && !s.startsWith('0x') && !/^\d+,\s+0x/.test(s)) return true;
  return false;
}

function applyEdit(node, inputVal, isHex, errDiv) {
  errDiv.textContent = '';
  if(isHex){
    // Parse hex string
    const hexStr = inputVal.replace(/\s+/g,'');
    if(!/^[0-9a-fA-F]*$/.test(hexStr)||hexStr.length%2!==0){
      errDiv.textContent='Invalid hex — use pairs like: 30 31 32 or 303132';
      return null;
    }
    const bytes=[];
    for(let i=0;i<hexStr.length;i+=2) bytes.push(parseInt(hexStr.slice(i,i+2),16));
    return bytes;
  } else {
    // Text → encode as UTF-8 bytes
    return Array.from(new TextEncoder().encode(inputVal));
  }
}

function recomputeDisplayValue(node) {
  const raw = node.rawValue || [];
  const buf = new Uint8Array(raw);
  if(node.cls===0){
    if(node.tag===2){ // INTEGER
      let v=0n; for(const b of buf)v=(v<<8n)|BigInt(b);
      if(buf[0]&0x80)v-=(1n<<BigInt(buf.length*8));
      const vn=Number(v); return`${vn},  0x${vn.toString(16)}`;
    }
    if([12,19,22,26,30,23,24].includes(node.tag)) return new TextDecoder().decode(buf);
    if(node.tag===6){ // OID – simplified
      return '0x'+Array.from(buf).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  }
  // Default: printable string or hex
  const s=new TextDecoder().decode(buf);
  if([...s].every(c=>{const cc=c.charCodeAt(0);return cc>=32&&cc<127;})) return s;
  const hex=Array.from(buf).map(b=>b.toString(16).padStart(2,'0')).join('');
  return raw.length<=16?'0x'+hex:`0x${hex.slice(0,32)}… (${raw.length} B)`;
}

// ── Tree building ─────────────────────────────────────────────────────────────
function buildTree(nodes) {
  treeBody.innerHTML = '';
  allNodes = [];
  renderNodes(nodes, treeBody, 0);
  allNodes.forEach(({row,node}) => {
    if(node._depth<=2&&node.children.length) setExpanded(row,node,true);
  });
}

function renderNodes(nodes, container, depth) {
  for(const node of nodes){
    node._depth = depth; node._expanded = false;
    const row = document.createElement('div');
    row.className = 'tree-row' + (node._modified?' modified':'');
    const indent = document.createElement('div');
    indent.style.cssText=`width:${depth*16+4}px;flex-shrink:0;display:flex;align-items:center`;
    const arrow = document.createElement('span');
    arrow.className='expand-arrow'+(node.children.length?'':' leaf');
    arrow.textContent=node.children.length?'▶':' ';
    arrow.onclick=e=>{e.stopPropagation();toggleNode(node);};
    indent.appendChild(arrow); row.appendChild(indent);

    row.appendChild(makeCell('col-offset', node.offset.toString(16).padStart(6,'0')));
    const tc=makeCell('col-tag',node.tagLabel); if(node.cls===0)tc.classList.add('univ'); row.appendChild(tc);
    row.appendChild(makeCell('col-name', node.fieldName||node.typeName||node.tagLabel));
    let vt='',dim=false;
    if(node.displayValue!=null) vt=String(node.displayValue).slice(0,120);
    else if(node.children.length){vt=`${node.typeName||'CONSTRUCTED'} (${node.length} B)`;dim=true;}
    const vc=makeCell('col-value',vt); if(dim)vc.classList.add('dim');
    if(node._modified) vc.style.color='var(--orange)';
    row.appendChild(vc);
    row.appendChild(makeCell('col-size',node.length.toString(16)));

    // Single click = select, Double click = edit (primitives only)
    row.onclick = () => selectRow(row, node);
    if(!node.children.length){
      row.ondblclick = e => { e.stopPropagation(); openEditDialog(node, row); };
      row.title = 'Double-click to edit';
    }

    // Right-click context menu
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      selectRow(row, node);
      showContextMenu(e.clientX, e.clientY, node, row);
    });

    const cc=document.createElement('div'); cc.style.display='none'; cc.dataset.children='true';
    row._node=node; row._arrow=arrow; row._childContainer=cc;
    container.appendChild(row); container.appendChild(cc);
    allNodes.push({row,node});
    if(node.children.length) renderNodes(node.children,cc,depth+1);
  }
}

function makeCell(cls,text){
  const el=document.createElement('span');
  el.className=cls; el.textContent=text; el.title=text; return el;
}

// ── Expand / collapse ─────────────────────────────────────────────────────────
function toggleNode(node, forceTo) {
  if(!node.children.length) return;
  const {row} = allNodes.find(x=>x.node===node)||{};
  if(!row) return;
  const expand = forceTo!==undefined ? forceTo : !node._expanded;
  setExpanded(row, node, expand);
}
function setExpanded(row, node, expand) {
  node._expanded=expand;
  row._arrow.textContent=expand?'▾':'▶';
  row._childContainer.style.display=expand?'block':'none';
}
function expandAll()  { allNodes.forEach(({row,node})=>{ if(node.children.length) setExpanded(row,node,true); }); }
function collapseAll(){ allNodes.forEach(({row,node})=>{ if(node.children.length) setExpanded(row,node,false); });
  allNodes.filter(({node})=>node._depth===0).forEach(({row,node})=>{ if(node.children.length) setExpanded(row,node,true); }); }

// ── Selection ─────────────────────────────────────────────────────────────────
function selectRow(row, node) {
  if(selectedRow) selectedRow.classList.remove('selected');
  selectedRow=row; row.classList.add('selected');
  showDetail(node);
}
function moveSelection(dir) {
  const visible=allNodes.filter(({row})=>row.offsetParent!==null).map(({row})=>row);
  const idx=visible.indexOf(selectedRow); if(idx===-1)return;
  const next=visible[idx+dir]; if(next){next.click();next.scrollIntoView({block:'nearest'});}
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function showDetail(node) {
  const infobar = document.getElementById('detail-infobar');
  const valDiv  = document.getElementById('detail-value');
  const hexDiv  = document.getElementById('detail-hex');
  const cls=['Universal','Application','Context','Private'][node.cls];
  infobar.textContent =
    `Offset: 0x${node.offset.toString(16).padStart(4,'0')}  │  Tag: ${node.tagLabel}  │  ${cls}  │  `+
    `${node.cons?'Constructed':'Primitive'}  │  Length: ${node.length} (0x${node.length.toString(16)})  │  `+
    `Field: ${node.fieldName||'—'}  │  Type: ${node.typeName||'—'}`+
    (node._modified ? '  │  ⚠ MODIFIED' : '');

  valDiv.textContent = node.displayValue!=null ? String(node.displayValue)
    : (node.children.length ? `${node.typeName||'CONSTRUCTED'} — ${node.children.length} field(s)` : '');
  if(node._modified) valDiv.style.color='var(--orange)'; else valDiv.style.color='';

  hexDiv.innerHTML='';
  if(node.hexDump){
    for(const {offset,hex,ascii} of node.hexDump){
      const line=document.createElement('div'); line.className='hex-line';
      const o=document.createElement('span');o.className='hex-offset';o.textContent=offset;
      const h=document.createElement('span');h.className='hex-bytes'; h.textContent=hex;
      const a=document.createElement('span');a.className='hex-ascii'; a.textContent=ascii;
      line.appendChild(o);line.appendChild(h);line.appendChild(a);hexDiv.appendChild(line);
    }
  }

  // Show map if this is a geo coordinate field
  showMapForNode(node);
}
function clearDetail() {
  document.getElementById('detail-infobar').textContent='Select a field to inspect';
  document.getElementById('detail-value').textContent='';
  document.getElementById('detail-hex').innerHTML='';
  const section = document.getElementById('map-section');
  const canvas  = document.getElementById('map-canvas');
  // Hide map section and clear coords
  if (section) section.classList.add('hidden');
  if (document.getElementById('map-coords')) document.getElementById('map-coords').textContent='';
  // Dispose interactive state and remove handlers to avoid stale rendering
  disposeMapState();
  if (canvas) {
    try {
      const ctx = canvas.getContext('2d');
      ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
    } catch (e) {}
    canvas.onwheel = null; canvas.onmousedown = null; canvas.onmousemove = null;
    canvas.onmouseup = null; canvas.onmouseleave = null; canvas.ondblclick = null;
  }
  // Clear any selected row reference so stale DOM nodes don't trigger detail updates
  if (selectedRow) selectedRow.classList.remove('selected');
  selectedRow = null;
}

// ── Map / Coordinates ─────────────────────────────────────────────────────────
let mapState = null;  // { lat, lon, zoom, centerX, centerY, dragging, active }

// Parse any coordinate string format → decimal degrees (null if unrecognised)
function parseCoordValue(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();

  // 1. GSM DDMMSS format: N505723 / E0070202 / N510344.38
  const gsmM = s.match(/^([NSEWnsew])(\d{2,3})(\d{2})(\d{2}(?:[.,]\d+)?)$/);
  if (gsmM) {
    const [, dir, deg, min, sec] = gsmM;
    let dd = parseInt(deg) + parseInt(min)/60 + parseFloat(sec.replace(',','.'))/3600;
    if (dir.toUpperCase() === 'S' || dir.toUpperCase() === 'W') dd = -dd;
    return dd;
  }

  // 2. Decimal degrees: "50.964444" / "-6.806111" / "+50.964444"
  const decM = s.match(/^([+-]?\d{1,3}(?:\.\d+)?)$/);
  if (decM) {
    const v = parseFloat(decM[1]);
    if (!isNaN(v) && v >= -180 && v <= 180) return v;
  }

  return null;
}
// Keep old name as alias for backward compatibility
const parseGsmCoord = parseCoordValue;

function latLonToTileExact(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  const x = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1/Math.cos(latRad)) / Math.PI) / 2 * n;
  return { x, y };
}

function tileToLatLon(tx, ty, zoom) {
  const n = Math.pow(2, zoom);
  const lon = tx / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n)));
  return { lat: latRad * 180 / Math.PI, lon };
}

// Tile image cache
const tileCache = new Map();
async function getTileImage(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const dataUrl = await window.berApi.fetchOsmTile(z, x, y);
  if (!dataUrl) return null;
  const img = new Image();
  await new Promise(res => { img.onload = res; img.onerror = res; img.src = dataUrl; });
  tileCache.set(key, img.complete && img.naturalWidth > 0 ? img : null);
  return tileCache.get(key);
}

function renderMap(canvas, state) {
  if (!state || !state.active) return;
  const ctx = canvas.getContext('2d');

  // Use CSS pixels for layout (avoids blurring / distortion on HiDPI screens)
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const TILE_SIZE = 256;

  // Current tile position (fractional)
  const { x: cx, y: cy } = latLonToTileExact(state.lat, state.lon, state.zoom);

  // Pixel offset of the center point on canvas
  const centerPixX = W / 2 + state.offsetX;
  const centerPixY = H / 2 + state.offsetY;

  // Which tiles to draw
  const tilePixX0 = centerPixX - cx * TILE_SIZE;  // pixel x of tile (0,0)
  const tilePixY0 = centerPixY - cy * TILE_SIZE;

  const xMin = Math.floor(-tilePixX0 / TILE_SIZE) - 1;
  const xMax = Math.ceil((W - tilePixX0) / TILE_SIZE) + 1;
  const yMin = Math.floor(-tilePixY0 / TILE_SIZE) - 1;
  const yMax = Math.ceil((H - tilePixY0) / TILE_SIZE) + 1;
  const maxTile = Math.pow(2, state.zoom) - 1;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, W, H);

  const needed = [];
  for (let tx = xMin; tx <= xMax; tx++) {
    for (let ty = yMin; ty <= yMax; ty++) {
      const tileX = tilePixX0 + tx * TILE_SIZE;
      const tileY = tilePixY0 + ty * TILE_SIZE;
      if (tileX + TILE_SIZE < 0 || tileX > W) continue;
      if (tileY + TILE_SIZE < 0 || tileY > H) continue;
      if (tx < 0 || ty < 0 || tx > maxTile || ty > maxTile) continue;
      needed.push({ tx, ty, px: tileX, py: tileY });
    }
  }

  // Draw cached tiles immediately, queue missing
  const toFetch = [];
  for (const { tx, ty, px, py } of needed) {
    const key = `${state.zoom}/${tx}/${ty}`;
    if (tileCache.has(key)) {
      const img = tileCache.get(key);
      if (img) ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
    } else {
      toFetch.push({ tx, ty, px, py });
    }
  }

  // Draw pin at target location
  const pinX = centerPixX;
  const pinY = centerPixY;
  ctx.font = '22px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText('📍', pinX, pinY + 4);
  ctx.shadowBlur = 0;

  // Zoom level indicator
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(4, H-20, 44, 16);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`z=${state.zoom}`, 7, H-12);

  // Fetch missing tiles and re-render
  if (toFetch.length > 0 && state.active) {
    Promise.all(toFetch.map(({tx,ty}) => getTileImage(state.zoom, tx, ty)))
      .then(() => { if (state.active) renderMap(canvas, state); });
  }
}

function setupMapInteraction(canvas, state) {
  // Mouse wheel: zoom
  canvas.onwheel = e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    const newZoom = Math.max(2, Math.min(18, state.zoom + delta));
    if (newZoom === state.zoom) return;

    // Keep the cursor position stable while zooming
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;

    // Current fractional tile of cursor
    const { x: cx, y: cy } = latLonToTileExact(state.lat, state.lon, state.zoom);
    const cursorTileX = cx + (mx - W/2 - state.offsetX) / 256;
    const cursorTileY = cy + (my - H/2 - state.offsetY) / 256;

    // After zoom, same cursor tile should stay at same pixel
    const zoomFactor = Math.pow(2, newZoom - state.zoom);
    const newCx = cursorTileX * zoomFactor;
    const newCy = cursorTileY * zoomFactor;
    const { x: newCenterX, y: newCenterY } = latLonToTileExact(state.lat, state.lon, newZoom);
    state.offsetX = mx - W/2 - (newCx - newCenterX) * 256;
    state.offsetY = my - H/2 - (newCy - newCenterY) * 256;
    state.zoom = newZoom;
    renderMap(canvas, state);
  };

  // Mouse drag: pan
  let dragStart = null;
  canvas.onmousedown = e => {
    dragStart = { mx: e.clientX, my: e.clientY, ox: state.offsetX, oy: state.offsetY };
  };
  canvas.onmousemove = e => {
    if (!dragStart) return;
    state.offsetX = dragStart.ox + (e.clientX - dragStart.mx);
    state.offsetY = dragStart.oy + (e.clientY - dragStart.my);
    renderMap(canvas, state);
  };
  canvas.onmouseup = canvas.onmouseleave = () => { dragStart = null; };

  // Double-click: zoom in on click point
  canvas.ondblclick = e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    // Compute lat/lon of clicked point
    const { x: cx, y: cy } = latLonToTileExact(state.lat, state.lon, state.zoom);
    const clickTileX = cx + (mx - W/2 - state.offsetX) / 256;
    const clickTileY = cy + (my - H/2 - state.offsetY) / 256;
    const { lat: newLat, lon: newLon } = tileToLatLon(clickTileX, clickTileY, state.zoom);
    state.lat = newLat;
    state.lon = newLon;
    state.offsetX = 0;
    state.offsetY = 0;
    state.zoom = Math.min(18, state.zoom + 1);
    renderMap(canvas, state);
  };
}

// Coordinate container types — clicking any of these (or their lat/lon children) shows map
const COORD_CONTAINERS = new Set([
  'geoCoordinates', 'geographicalCoordinates', 'GeographicalCoordinates',
  'GsmGeoCoordinates', 'wGS84Coordinates', 'WGS84CoordinateDecimal', 'WGS84CoordinateAngular',
  'geoInfo', 'geodeticInformation', 'geographicalInformation'
]);

// Extract lat/lon from a node's children
function extractLatLon(node) {
  let latVal = null, lonVal = null;
  for (const c of node.children) {
    if ((c.fieldName === 'latitude'  || c.fieldName === 'latitudeSign') && c.displayValue)
      latVal = (latVal === null ? '' : latVal) + String(c.displayValue);
    if (c.fieldName === 'latitude'  && c.displayValue) latVal = String(c.displayValue);
    if (c.fieldName === 'longitude' && c.displayValue) lonVal = String(c.displayValue);
  }
  if (!latVal || !lonVal) return null;
  const lat = parseCoordValue(latVal);
  const lon = parseCoordValue(lonVal);
  if (lat === null || lon === null) return null;
  return { lat, lon, latStr: latVal, lonStr: lonVal };
}

function findCoordPair(node, allNodes) {
  const fn = node.fieldName || node.typeName || '';

  // Case 1: clicked directly on a coordinate container (geoCoordinates, geographicalCoordinates…)
  if (COORD_CONTAINERS.has(fn) && node.children.length >= 2) {
    const c = extractLatLon(node);
    if (c) return c;
  }

  // Case 2: clicked on latitude or longitude leaf — look for a local sibling pair
  // Walk up the tree from the clicked node and only consider parents that directly
  // contain both `latitude` and `longitude` children. This avoids picking up
  // unrelated coordinate fields elsewhere in the file.
  if (fn === 'latitude' || fn === 'longitude') {
    function findParent(ns, target) {
      for (const n of ns) {
        if (n.children && n.children.includes(target)) return n;
        const p = findParent(n.children, target);
        if (p) return p;
      }
      return null;
    }

    let parent = findParent(allNodes, node);
    while (parent) {
      const latNode = parent.children.find(c => c.fieldName === 'latitude' && c.displayValue);
      const lonNode = parent.children.find(c => c.fieldName === 'longitude' && c.displayValue);
      if (latNode && lonNode) {
        const latVal = String(latNode.displayValue);
        const lonVal = String(lonNode.displayValue);
        const lat = parseCoordValue(latVal);
        const lon = parseCoordValue(lonVal);
        if (lat !== null && lon !== null) return { lat, lon, latStr: latVal, lonStr: lonVal };
      }
      parent = findParent(allNodes, parent);
    }
    return null;
  }

  return null;
}

function showMapForNode(node) {
  const coords = findCoordPair(node, currentNodes);
  if (!coords) {
    document.getElementById('map-section').classList.add('hidden');
    disposeMapState();
    return;
  }
  showMap(coords.lat, coords.lon, coords.latStr, coords.lonStr);
}

function updateMapCanvasSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
}

function disposeMapState() {
  if (!mapState) return;
  mapState.active = false;
  if (mapState.resizeObserver) mapState.resizeObserver.disconnect();
  if (mapState.resizeHandleCleanup) mapState.resizeHandleCleanup();
  mapState = null;
}

function setupMapResizeHandle(state) {
  const handle = document.getElementById('map-resize-handle');
  const wrap   = document.getElementById('map-canvas-wrap');
  if (!handle || !wrap) return;

  let dragging = false;
  let startY = 0;
  let startH = 0;

  const onMove = e => {
    if (!dragging) return;
    const delta = e.clientY - startY;
    const newH = Math.max(80, startH - delta);
    wrap.style.height = `${newH}px`;
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  handle.onmousedown = e => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = wrap.getBoundingClientRect().height;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  state.resizeHandleCleanup = () => {
    handle.onmousedown = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
}

function showMap(lat, lon, latStr, lonStr) {
  const section = document.getElementById('map-section');
  const coordDiv = document.getElementById('map-coords');
  const canvas   = document.getElementById('map-canvas');
  const openBtn  = document.getElementById('map-open-btn');

  // Format coordinates
  const latDeg = Math.abs(lat).toFixed(6);
  const lonDeg = Math.abs(lon).toFixed(6);
  coordDiv.innerHTML =
    `<span style="color:var(--text-muted)">Lat:</span> ${latStr}  →  ${lat>=0?'N':'S'}${latDeg}°<br>` +
    `<span style="color:var(--text-muted)">Lon:</span> ${lonStr}  →  ${lon>=0?'E':'W'}${lonDeg}°`;

  // Deactivate previous map
  if (mapState) disposeMapState();

  mapState = { lat, lon, zoom: 14, offsetX: 0, offsetY: 0, active: true, resizeObserver: null, resizeHandleCleanup: null };
  setupMapInteraction(canvas, mapState);
  setupMapResizeHandle(mapState);

  // Keep canvas size in sync with layout (re-render on resize)
  const ro = new ResizeObserver(() => {
    updateMapCanvasSize(canvas);
    renderMap(canvas, mapState);
  });
  ro.observe(canvas);
  mapState.resizeObserver = ro;

  updateMapCanvasSize(canvas);
  renderMap(canvas, mapState);

  const osmUrl = () => `https://www.openstreetmap.org/?mlat=${mapState.lat.toFixed(6)}&mlon=${mapState.lon.toFixed(6)}&zoom=${mapState.zoom}`;
  openBtn.onclick = () => window.berApi.openExternal(osmUrl());

  section.classList.remove('hidden');
}

// ── Search ────────────────────────────────────────────────────────────────────
function searchNext() {
  const q=searchInput.value.trim().toLowerCase(); if(!q)return;
  const matches=allNodes.filter(({node})=>{
    const name=(node.fieldName||node.typeName||node.tagLabel||'').toLowerCase();
    const val=String(node.displayValue??'').toLowerCase();
    return name.includes(q)||val.includes(q);
  });
  allNodes.forEach(({row})=>row.classList.remove('search-match'));
  if(!matches.length){statusLeft.textContent=`No results for "${q}"`;return;}
  matches.forEach(({row})=>row.classList.add('search-match'));
  searchIdx=searchIdx%matches.length;
  const {row,node}=matches[searchIdx];
  ensureVisible(row); row.scrollIntoView({block:'center'}); selectRow(row,node);
  statusLeft.textContent=`Match ${searchIdx+1}/${matches.length} for "${q}"`;
  searchIdx=(searchIdx+1)%matches.length;
}
function ensureVisible(targetRow) {
  let el=targetRow.parentElement;
  while(el&&el!==treeBody){
    if(el.dataset.children==='true'){
      el.style.display='block';
      const prev=el.previousElementSibling;
      if(prev&&prev._node) setExpanded(prev,prev._node,true);
    }
    el=el.parentElement;
  }
}

// ── Resizable splitter ────────────────────────────────────────────────────────
let resizing=false,resizeStartX=0,resizeStartW=0;
resizeHandle.addEventListener('mousedown',e=>{
  resizing=true;resizeStartX=e.clientX;resizeStartW=treePanel.getBoundingClientRect().width;
  resizeHandle.classList.add('dragging');document.body.style.cursor='col-resize';document.body.style.userSelect='none';
});
document.addEventListener('mousemove',e=>{
  if(!resizing)return;
  const newW=Math.max(200,Math.min(window.innerWidth-200,resizeStartW+(e.clientX-resizeStartX)));
  treePanel.style.width=newW+'px';
});
document.addEventListener('mouseup',()=>{
  if(!resizing)return;resizing=false;resizeHandle.classList.remove('dragging');
  document.body.style.cursor='';document.body.style.userSelect='';
});
