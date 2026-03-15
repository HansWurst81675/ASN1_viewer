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
  statusRight.textContent = info.typeCount > 0
    ? `Schema: ${info.typeCount} types` : 'Schema: not loaded';
});

// ── File loading ──────────────────────────────────────────────────────────────
window.berApi.onFileLoaded(data => {
  if(!data.nodes||data.nodes.length===0){ statusLeft.textContent=`Error: no nodes`; return; }
  currentNodes = data.nodes;
  currentFile  = data.filePath;
  hasChanges   = false;
  buildTree(data.nodes);
  fileInfo.textContent = `${data.fileName}  —  ${data.size} bytes`;
  statusLeft.textContent = `${data.fileName}  |  ${data.size} bytes  |  ${countNodes(data.nodes)} fields`;
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
document.getElementById('btn-open').addEventListener('click', () => window.berApi.openFileDialog());
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

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey||e.metaKey;
  if(ctrl&&e.key==='o')      { e.preventDefault(); window.berApi.openFileDialog(); }
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
  if(file) window.berApi.openFilePath(file.path);
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

// ── Edit dialog ───────────────────────────────────────────────────────────────
function openEditDialog(node, row) {
  // Remove any existing dialog
  const existing = document.getElementById('edit-dialog');
  if(existing) existing.remove();

  const isHex = node.rawValue && !isTextPrimitive(node);
  const currentVal = isHex
    ? Buffer.from(node.rawValue).toString('hex').replace(/../g, '$& ').trim()
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
  // Treat as text if it's a string type or if current value looks like readable text
  if(node.cls===0 && [12,19,22,26,30,23,24].includes(node.tag)) return true;
  const s = node.displayValue;
  return typeof s==='string' && s.startsWith("'") && s.endsWith("'");
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
}
function clearDetail() {
  document.getElementById('detail-infobar').textContent='Select a field to inspect';
  document.getElementById('detail-value').textContent='';
  document.getElementById('detail-hex').innerHTML='';
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
