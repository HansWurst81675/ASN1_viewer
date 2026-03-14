const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Resolve asn1_patched directory (works in dev + packaged app) ──────────────
function getAsn1Dir() {
  // In packaged app, resources are in process.resourcesPath
  const candidates = [
    path.join(process.resourcesPath || '', 'asn1_patched'),
    path.join(app.getAppPath(), 'asn1_patched'),
    path.join(__dirname, '..', 'asn1_patched'),
    path.join(__dirname, 'asn1_patched'),
  ];
  for (const d of candidates) {
    if (fs.existsSync(d)) return d;
  }
  return null;
}

// ── Build tag maps from ASN.1 files ──────────────────────────────────────────
function buildTagMaps(asn1Dir) {
  const maps = {};
  if (!asn1Dir || !fs.existsSync(asn1Dir)) return maps;

  const files = fs.readdirSync(asn1Dir)
    .filter(f => f.endsWith('.asn') || f.endsWith('.asn1'))
    .sort();

  const fieldRe = /\b([a-z][A-Za-z0-9-]*)\s+\[(\d+)\]\s+(?:IMPLICIT\s+|OPTIONAL\s+)?([A-Z][A-Za-z0-9-]*)/;

  for (const fname of files) {
    const content = fs.readFileSync(path.join(asn1Dir, fname), 'utf8');
    const typePattern = /^([A-Z][A-Za-z0-9-]+)\s*::=\s*(?:SEQUENCE|SET|CHOICE)\s*\{/gm;
    let m;
    while ((m = typePattern.exec(content)) !== null) {
      const tname = m[1];
      const bodyStart = m.index + m[0].length;
      let depth = 1, i = bodyStart;
      while (i < content.length && depth > 0) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') depth--;
        i++;
      }
      const body = content.slice(bodyStart, i - 1);
      const tmap = {};
      for (const line of body.split('\n')) {
        const code = line.replace(/--.*/, '');
        const fm = fieldRe.exec(code);
        if (fm) tmap[parseInt(fm[2])] = [fm[1], fm[3]];
      }
      if (Object.keys(tmap).length === 0) continue;

      // LI-PS-PDU IRIPayload ([0]=iRIType) stored separately to avoid
      // collision with TS33128 IRIPayload ([1]=iRIPayloadOID)
      if (tname === 'IRIPayload' && tmap[0]) {
        maps['LIPSIRIPayload'] = tmap;
      } else {
        maps[tname] = tmap;
      }
    }
  }

  // IRIContents CHOICE – hardcoded because it's a CHOICE without context tags in ASN.1
  maps['IRIContents'] = {
    1:  ['emailIRI',               'EmailIRI'],
    2:  ['iPIRI',                  'IPIRI'],
    3:  ['iPIRIOnly',              'IPIRIOnly'],
    4:  ['uMTSIRI',                'UMTSIRI'],
    5:  ['eTSI671IRI',             'ETSI671IRI'],
    6:  ['l2IRI',                  'L2IRI'],
    7:  ['l2IRIOnly',              'L2IRIOnly'],
    8:  ['tARGETACTIVITYMONITOR-1','TARGETACTIVITYMONITOR-1'],
    9:  ['tARGETACTIVITYMONITOR-2','TARGETACTIVITYMONITOR'],
    10: ['pstnIsdnIRI',            'PstnIsdnIRI'],
    11: ['iPMMIRI',                'IPMMIRI'],
    14: ['messagingIRI',           'MessagingIRI'],
    15: ['ePSIRI',                 'EPSIRI'],
    16: ['confIRI',                'ConfIRI'],
    17: ['proseIRI',               'ProSeIRI'],
    18: ['gcseIRI',                'GcseIRI'],
    19: ['threeGPP33128DefinedIRI','XIRIPayload'],
    20: ['iPIRIPacketReport',      'IPIRIPacketReport'],
  };

  return maps;
}

// ── BER parser ────────────────────────────────────────────────────────────────
const UNIV = {
  1:'BOOLEAN', 2:'INTEGER', 3:'BIT STRING', 4:'OCTET STRING', 5:'NULL',
  6:'OID', 10:'ENUMERATED', 12:'UTF8String', 16:'SEQUENCE', 17:'SET',
  19:'PrintableString', 22:'IA5String', 23:'UTCTime', 24:'GeneralizedTime',
  26:'VisibleString', 30:'BMPString'
};

function readTag(buf, pos) {
  const b = buf[pos++];
  const cls  = (b >> 6) & 3;
  const cons = (b >> 5) & 1;
  let   tag  = b & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    while (true) {
      const nb = buf[pos++];
      tag = (tag << 7) | (nb & 0x7f);
      if (!(nb & 0x80)) break;
    }
  }
  return { cls, cons, tag, pos };
}

function readLen(buf, pos) {
  const b = buf[pos++];
  if (b & 0x80) {
    const n = b & 0x7f;
    let len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[pos++];
    return { len, pos };
  }
  return { len: b, pos };
}

function decodeOID(raw) {
  try {
    const vals = [];
    let i = 0;
    const first = raw[i++];
    vals.push(Math.floor(first / 40), first % 40);
    let v = 0;
    while (i < raw.length) {
      const b = raw[i++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) { vals.push(v); v = 0; }
    }
    return vals.join('.');
  } catch { return Buffer.from(raw).toString('hex'); }
}

function isPrintable(raw) {
  try {
    const s = Buffer.from(raw).toString('utf8');
    return s.split('').every(c => {
      const cc = c.charCodeAt(0);
      return (cc >= 32 && cc < 127) || cc === 9 || cc === 10 || cc === 13;
    }) ? s : null;
  } catch { return null; }
}

function looksLikeBer(raw) {
  if (raw.length < 2) return false;
  try {
    const t = readTag(raw, 0);
    const l = readLen(raw, t.pos);
    return l.pos + l.len === raw.length && l.len > 0;
  } catch { return false; }
}

function scalarValue(cls, tag, raw) {
  if (!raw.length) return tag === 5 ? 'NULL' : '';
  if (cls === 0) {
    if (tag === 2) { // INTEGER
      let v = 0n;
      for (const b of raw) v = (v << 8n) | BigInt(b);
      // sign-extend
      if (raw[0] & 0x80) v -= (1n << BigInt(raw.length * 8));
      const vn = Number(v);
      return `${vn},  0x${vn.toString(16)}`;
    }
    if (tag === 6)  return decodeOID(raw);                    // OID
    if (tag === 10) { const v = raw[0]; return `${v},  0x${v.toString(16)}`; }
    if (tag === 3) {  // BIT STRING
      const unused = raw[0];
      let bits = '';
      for (let i = 1; i < raw.length; i++) bits += raw[i].toString(2).padStart(8,'0');
      return bits.slice(0, Math.max(0, bits.length - unused));
    }
    if ([12,19,22,26,30,23,24].includes(tag))
      return Buffer.from(raw).toString('utf8');
  }
  // Try printable
  const s = isPrintable(raw);
  if (s && raw.length <= 64) return s;
  const hex = Buffer.from(raw).toString('hex');
  if (raw.length <= 16) return '0x' + hex;
  return `0x${hex.slice(0,32)}…  (${raw.length} B)`;
}

function hexDump(raw, baseOffset) {
  const lines = [];
  for (let i = 0; i < raw.length; i += 16) {
    const chunk = raw.slice(i, i + 16);
    const hexPart   = Array.from(chunk).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const asciiPart = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    lines.push({
      offset: (baseOffset + i).toString(16).padStart(6,'0'),
      hex:    hexPart.padEnd(47),
      ascii:  asciiPart
    });
  }
  return lines;
}

function tagLabel(cls, tag) {
  if (cls === 0) return UNIV[tag] || `UNIV-${tag}`;
  if (cls === 2) return `[${tag}]`;
  return `${['UNIV','APPL','CTXT','PRIV'][cls]}[${tag}]`;
}

// ── Extra type hints (override tag_maps for specific type+tag combinations) ──
const EXTRA_HINTS = {
  'Payload,0':         'iRIPayloadSEQ',   // iRIPayloadSequence → SEQUENCE OF LIPSIRIPayload
  'LIPSIRIPayload,2':  'IRIContents',     // iRIContents CHOICE
  'IRIContents,19':    'XIRIPayload',     // threeGPP33128DefinedIRI → nested BER
  'XIRIPayload,2':     'XIRIEvent',       // event
};

// Generic ASN.1 base-type names that carry no useful child-type info
const GENERIC_TYPES = new Set([
  'SEQUENCE','SET','CHOICE','OCTET','OBJECT','INTEGER','BOOLEAN',
  'PrintableString','IA5String','UTF8String','GeneralizedTime',
  'UTCTime','BIT','ENUMERATED','NULL','REAL'
]);

function parseBer(buf, baseOffset, typeHint, tagMaps, depth) {
  depth = depth || 0;
  tagMaps = tagMaps || {};
  const nodes = [];
  let pos = 0;

  while (pos < buf.length) {
    const start = pos;
    let t, l;
    try {
      t = readTag(buf, pos);
      l = readLen(buf, t.pos);
    } catch { break; }
    const valEnd = l.pos + l.len;
    if (valEnd > buf.length) break;

    const raw = buf.slice(l.pos, valEnd);

    const node = {
      offset:       baseOffset + start,
      cls:          t.cls,
      cons:         t.cons,
      tag:          t.tag,
      length:       l.len,
      valOffset:    baseOffset + l.pos,
      tagLabel:     tagLabel(t.cls, t.tag),
      fieldName:    null,
      typeName:     null,
      origChildType: null,   // pre-filter child type (for scalar decode hints)
      displayValue: null,
      hexDump:      hexDump(raw, baseOffset + l.pos),
      children:     []
    };

    let childType = null;

    if (t.cls === 2) {  // CONTEXT tag
      // 1. Schema lookup
      if (typeHint && tagMaps[typeHint]) {
        const entry = tagMaps[typeHint][t.tag];
        if (entry) {
          node.fieldName = entry[0];
          childType      = entry[1];
          node.typeName  = childType;
          node.origChildType = childType;
          // Strip generic base-type placeholders
          if (GENERIC_TYPES.has(childType)) childType = null;
        }
      }
      // 2. EXTRA_HINTS always override (more specific)
      const override = EXTRA_HINTS[`${typeHint},${t.tag}`];
      if (override) { childType = override; node.typeName = override; }

    } else if (t.cls === 0) {
      node.typeName = UNIV[t.tag] || `UNIV-${t.tag}`;
    }

    // Determine recurse hint
    let recurseHint = childType;
    if (t.cls === 0 && t.tag === 16) {
      // UNIVERSAL SEQUENCE
      if (typeHint === 'iRIPayloadSEQ') recurseHint = 'LIPSIRIPayload';
      else if (childType)              recurseHint = childType;
      else                             recurseHint = typeHint;  // transparent wrapper
    } else if (t.cls === 0 && t.tag === 17) {
      recurseHint = childType || typeHint;
    }

    if (t.cons) {
      node.children = parseBer(raw, baseOffset + l.pos, recurseHint, tagMaps, depth + 1);
    } else if (looksLikeBer(raw) && depth < 8) {
      node.children = parseBer(raw, baseOffset + l.pos, childType, tagMaps, depth + 1);
    }

    if (!node.children.length) {
      // Use origChildType hint for better scalar decoding
      if (t.cls === 2 && node.origChildType === 'OBJECT') {
        const oid = decodeOID(raw);
        node.displayValue = oid.includes('.') ? oid : scalarValue(t.cls, t.tag, raw);
      } else if (t.cls === 2 && node.origChildType === 'INTEGER') {
        try {
          let v = 0n;
          for (const b of raw) v = (v << 8n) | BigInt(b);
          if (raw[0] & 0x80) v -= (1n << BigInt(raw.length * 8));
          const vn = Number(v);
          node.displayValue = `${vn},  0x${vn.toString(16)}`;
        } catch { node.displayValue = scalarValue(t.cls, t.tag, raw); }
      } else {
        node.displayValue = scalarValue(t.cls, t.tag, raw);
      }
    }

    nodes.push(node);
    pos = valEnd;
  }
  return nodes;
}

// ── Electron main window ──────────────────────────────────────────────────────
let mainWindow;
let tagMaps = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'BER Viewer',
    backgroundColor: '#1a1d23',
    webPreferences: {
      preload:         path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Load schema
  const asn1Dir = getAsn1Dir();
  if (asn1Dir) {
    tagMaps = buildTagMaps(asn1Dir);
    console.log(`Loaded ${Object.keys(tagMaps).length} type maps from ${asn1Dir}`);
  }

  // Build menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: openFile },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Expand All',   accelerator: 'CmdOrCtrl+E', click: () => mainWindow.webContents.send('expand-all') },
        { label: 'Collapse All', accelerator: 'CmdOrCtrl+W', click: () => mainWindow.webContents.send('collapse-all') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      'Open BER file',
    filters:    [
      { name: 'BER files', extensions: ['hi2', 'ber'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths[0]) {
    loadFile(result.filePaths[0]);
  }
}

function loadFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const nodes = parseBer(buf, 0, 'PS-PDU', tagMaps);
    mainWindow.webContents.send('file-loaded', {
      fileName: path.basename(filePath),
      size:     buf.length,
      nodes:    nodes
    });
  } catch (e) {
    console.error('loadFile error:', e);
    mainWindow.webContents.send('file-error', e.message);
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('open-file-dialog', openFile);

ipcMain.handle('open-file-path', (_, filePath) => {
  loadFile(filePath);
});

ipcMain.handle('get-schema-info', () => ({
  typeCount: Object.keys(tagMaps).length,
  asn1Dir:   getAsn1Dir()
}));

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
