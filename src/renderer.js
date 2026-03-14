/* renderer.js — BER Viewer UI logic */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let allNodes       = [];      // flat array of all rendered row elements
let selectedRow    = null;
let searchResults  = [];
let searchIdx      = 0;
let leftWidth      = 780;     // tree panel width in px

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropOverlay   = document.getElementById('drop-overlay');
const splitterCont  = document.getElementById('splitter-container');
const treeBody      = document.getElementById('tree-body');
const detailInfobar = document.getElementById('detail-infobar');
const detailValue   = document.getElementById('detail-value');
const detailHex     = document.getElementById('detail-hex');
const fileInfo      = document.getElementById('file-info');
const statusLeft    = document.getElementById('status-left');
const statusRight   = document.getElementById('status-right');
const searchInput   = document.getElementById('search-input');
const treePanel     = document.getElementById('tree-panel');
const resizeHandle  = document.getElementById('resize-handle');

// ── Schema info ───────────────────────────────────────────────────────────────
window.berApi.getSchemaInfo().then(info => {
  if (info.typeCount > 0) {
    statusRight.textContent = `Schema: ${info.typeCount} types`;
  } else {
    statusRight.textContent = 'Schema: not loaded';
  }
});

// ── File loading ──────────────────────────────────────────────────────────────
window.berApi.onFileLoaded(data => {
  if (!data.nodes || data.nodes.length === 0) {
    statusLeft.textContent = `Error: no nodes parsed from ${data.fileName}`;
    return;
  }
  buildTree(data.nodes);
  fileInfo.textContent = `${data.fileName}  —  ${data.size} bytes`;
  const count = countNodes(data.nodes);
  statusLeft.textContent =
    `${data.fileName}  |  ${data.size} bytes  |  ${count} fields`;

  dropOverlay.classList.add('hidden');
  splitterCont.classList.remove('hidden');
  clearDetail();
});

window.berApi.onFileError(msg => {
  statusLeft.textContent = `Error: ${msg}`;
});

function countNodes(nodes) {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

// ── Toolbar buttons ───────────────────────────────────────────────────────────
document.getElementById('btn-open').addEventListener('click', () => {
  window.berApi.openFileDialog();
});

document.getElementById('btn-expand').addEventListener('click', expandAll);
document.getElementById('btn-collapse').addEventListener('click', collapseAll);
document.getElementById('btn-search').addEventListener('click', searchNext);

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') searchNext();
});

// IPC from menu
window.berApi.onExpandAll(expandAll);
window.berApi.onCollapseAll(collapseAll);

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault(); window.berApi.openFileDialog();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault(); searchInput.focus(); searchInput.select();
  }
  if (e.key === 'F3') { e.preventDefault(); searchNext(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); expandAll(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') { e.preventDefault(); collapseAll(); }
  if (e.key === 'ArrowDown' && selectedRow) moveSelection(1);
  if (e.key === 'ArrowUp'   && selectedRow) moveSelection(-1);
  if (e.key === 'ArrowRight' && selectedRow) toggleNode(selectedRow, true);
  if (e.key === 'ArrowLeft'  && selectedRow) toggleNode(selectedRow, false);
});

// ── Drag & drop ───────────────────────────────────────────────────────────────
document.addEventListener('dragover', e => {
  e.preventDefault();
  dropOverlay.classList.add('drop-active');
});
document.addEventListener('dragleave', () => {
  dropOverlay.classList.remove('drop-active');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  dropOverlay.classList.remove('drop-active');
  const file = e.dataTransfer.files[0];
  if (file) window.berApi.openFilePath(file.path);
});

// ── Tree building ─────────────────────────────────────────────────────────────
function buildTree(nodes) {
  treeBody.innerHTML = '';
  allNodes = [];
  renderNodes(nodes, treeBody, 0);
  // Expand first 3 levels by default
  allNodes.forEach(({row, node}) => {
    if (node._depth <= 2 && node.children.length)
      setExpanded(row, node, true);
  });
}

function renderNodes(nodes, container, depth) {
  for (const node of nodes) {
    node._depth = depth;
    node._expanded = false;

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.depth = depth;

    // Indent
    const indent = document.createElement('div');
    indent.className = 'row-indent';
    indent.style.width = (depth * 16 + 4) + 'px';

    // Arrow
    const arrow = document.createElement('span');
    arrow.className = 'expand-arrow' + (node.children.length ? '' : ' leaf');
    arrow.textContent = node.children.length ? '▶' : ' ';
    arrow.addEventListener('click', e => {
      e.stopPropagation();
      toggleNode(row, node);
    });
    indent.appendChild(arrow);
    row.appendChild(indent);

    // Offset
    row.appendChild(makeCell('col-offset', `${node.offset.toString(16).padStart(6,'0')}`));

    // Tag
    const tagCell = makeCell('col-tag', node.tagLabel);
    if (node.cls === 0) tagCell.classList.add('univ');
    row.appendChild(tagCell);

    // Field / type name
    const nameText = node.fieldName || node.typeName || node.tagLabel;
    row.appendChild(makeCell('col-name', nameText));

    // Value
    let valText = '', valDim = false;
    if (node.displayValue !== null && node.displayValue !== undefined) {
      valText = String(node.displayValue).slice(0, 120);
      if (valText.length < String(node.displayValue).length) valText += '…';
    } else if (node.children.length) {
      const t = node.typeName || (node.cls === 0 ? 'SEQUENCE' : 'CONSTRUCTED');
      valText = `${t}  (${node.length} B)`;
      valDim = true;
    }
    const valCell = makeCell('col-value', valText);
    if (valDim) valCell.classList.add('dim');
    row.appendChild(valCell);

    // Size
    row.appendChild(makeCell('col-size', node.length.toString(16)));

    // Click to select
    row.addEventListener('click', () => selectRow(row, node));

    // Child container (lazy)
    const childContainer = document.createElement('div');
    childContainer.style.display = 'none';   // hidden by default via style, not class
    childContainer.dataset.children = 'true';

    row._node          = node;
    row._arrow         = arrow;
    row._childContainer = childContainer;

    container.appendChild(row);
    container.appendChild(childContainer);
    allNodes.push({row, node});

    // Pre-render children (hidden)
    if (node.children.length)
      renderNodes(node.children, childContainer, depth + 1);
  }
}

function makeCell(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  el.title = text;
  return el;
}

// ── Expand / collapse ─────────────────────────────────────────────────────────
function toggleNode(row, node, forceTo) {
  if (!node.children.length) return;
  const expand = forceTo !== undefined ? forceTo : !node._expanded;
  setExpanded(row, node, expand);
}

function setExpanded(row, node, expand) {
  node._expanded = expand;
  row._arrow.textContent = expand ? '▾' : '▶';
  row._arrow.classList.toggle('open', expand);
  // Use style.display directly — avoids conflict with .hidden { !important }
  row._childContainer.style.display = expand ? 'block' : 'none';
}

function expandAll() {
  allNodes.forEach(({row, node}) => {
    if (node.children.length) setExpanded(row, node, true);
  });
}

function collapseAll() {
  allNodes.forEach(({row, node}) => {
    if (node.children.length) setExpanded(row, node, false);
  });
  // Keep top level open
  allNodes.filter(({node}) => node._depth === 0)
         .forEach(({row, node}) => {
           if (node.children.length) setExpanded(row, node, true);
         });
}

// ── Selection ─────────────────────────────────────────────────────────────────
function selectRow(row, node) {
  if (selectedRow) selectedRow.classList.remove('selected');
  selectedRow = row;
  row.classList.add('selected');
  showDetail(node);
}

function moveSelection(dir) {
  const visible = allNodes
    .filter(({row}) => !row.closest('[data-children].hidden'))
    .map(({row}) => row);
  const idx = visible.indexOf(selectedRow);
  if (idx === -1) return;
  const next = visible[idx + dir];
  if (next) { next.click(); next.scrollIntoView({block:'nearest'}); }
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function showDetail(node) {
  const cls = ['Universal','Application','Context','Private'][node.cls];
  const field = node.fieldName || '—';
  const type  = node.typeName  || '—';
  detailInfobar.textContent =
    `Offset: 0x${node.offset.toString(16).padStart(4,'0')}  │  ` +
    `Tag: ${node.tagLabel}  │  ${cls}  │  ` +
    `${node.cons ? 'Constructed' : 'Primitive'}  │  ` +
    `Length: ${node.length} (0x${node.length.toString(16)})  │  ` +
    `Field: ${field}  │  Type: ${type}`;

  if (node.displayValue !== null && node.displayValue !== undefined) {
    detailValue.textContent = String(node.displayValue);
  } else if (node.children.length) {
    const t = node.typeName || 'CONSTRUCTED';
    detailValue.textContent = `${t} — ${node.children.length} field(s), ${node.length} bytes`;
  } else {
    detailValue.textContent = '';
  }

  // Hex dump
  detailHex.innerHTML = '';
  if (node.hexDump && node.hexDump.length) {
    for (const {offset, hex, ascii} of node.hexDump) {
      const line = document.createElement('div');
      line.className = 'hex-line';

      const o = document.createElement('span'); o.className = 'hex-offset'; o.textContent = offset;
      const h = document.createElement('span'); h.className = 'hex-bytes';  h.textContent = hex;
      const a = document.createElement('span'); a.className = 'hex-ascii';  a.textContent = ascii;
      line.appendChild(o); line.appendChild(h); line.appendChild(a);
      detailHex.appendChild(line);
    }
  }
}

function clearDetail() {
  detailInfobar.textContent = 'Select a field to inspect';
  detailValue.textContent = '';
  detailHex.innerHTML = '';
}

// ── Search ────────────────────────────────────────────────────────────────────
function searchNext() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return;

  // Collect all matching rows
  const matches = allNodes.filter(({row, node}) => {
    const name = (node.fieldName || node.typeName || node.tagLabel || '').toLowerCase();
    const val  = String(node.displayValue ?? '').toLowerCase();
    return name.includes(q) || val.includes(q);
  });

  // Clear previous highlights
  allNodes.forEach(({row}) => row.classList.remove('search-match'));

  if (!matches.length) {
    statusLeft.textContent = `No results for "${q}"`;
    return;
  }

  matches.forEach(({row}) => row.classList.add('search-match'));
  searchIdx = searchIdx % matches.length;
  const {row, node} = matches[searchIdx];

  // Ensure visible: expand parents
  ensureVisible(row);
  row.scrollIntoView({ block: 'center' });
  selectRow(row, node);

  statusLeft.textContent = `Match ${searchIdx + 1}/${matches.length} for "${q}"`;
  searchIdx = (searchIdx + 1) % matches.length;
}

function ensureVisible(targetRow) {
  let el = targetRow.parentElement;
  while (el && el !== treeBody) {
    if (el.dataset.children === 'true') {
      el.style.display = 'block';
      const prev = el.previousElementSibling;
      if (prev && prev._node) {
        setExpanded(prev, prev._node, true);
      }
    }
    el = el.parentElement;
  }
}

// ── Resizable splitter ────────────────────────────────────────────────────────
let resizing = false, resizeStartX = 0, resizeStartW = 0;

resizeHandle.addEventListener('mousedown', e => {
  resizing = true;
  resizeStartX = e.clientX;
  resizeStartW = treePanel.getBoundingClientRect().width;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', e => {
  if (!resizing) return;
  const delta = e.clientX - resizeStartX;
  const newW  = Math.max(300, Math.min(window.innerWidth - 300, resizeStartW + delta));
  treePanel.style.width = newW + 'px';
});

document.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  resizeHandle.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});
