const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Resolve asn1_patched directory ────────────────────────────────────────────
function getAsn1Dir() {
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

// ── Recent files (persisted via electron app userData) ───────────────────────
const RECENT_MAX = 10;
let recentFiles = [];

function recentPath() {
  return path.join(app.getPath('userData'), 'recent.json');
}
function loadRecent() {
  try { recentFiles = JSON.parse(fs.readFileSync(recentPath(), 'utf8')); } catch { recentFiles = []; }
}
function saveRecent() {
  try { fs.writeFileSync(recentPath(), JSON.stringify(recentFiles)); } catch {}
}
function addRecent(filePath) {
  recentFiles = [filePath, ...recentFiles.filter(f => f !== filePath)].slice(0, RECENT_MAX);
  saveRecent();
  rebuildMenu();
  if (mainWindow) mainWindow.webContents.send('recent-files-updated', recentFiles);
}

// ── Build tag maps ────────────────────────────────────────────────────────────
function buildTagMaps(asn1Dir) {
  const maps = {};
  if (!asn1Dir || !fs.existsSync(asn1Dir)) return maps;
  const files = fs.readdirSync(asn1Dir).filter(f => f.endsWith('.asn') || f.endsWith('.asn1')).sort();
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
        if (content[i] === '{') depth++; else if (content[i] === '}') depth--;
        i++;
      }
      const body = content.slice(bodyStart, i - 1);
      const tmap = {};
      // Only parse TOP-LEVEL fields (depth=0) — emit line at '{' and '\n',
      // reset lineStart when entering/leaving nested blocks
      let d = 0, lineStart = 0;
      for (let j = 0; j <= body.length; j++) {
        const ch = j < body.length ? body[j] : null;
        if (ch === '{') {
          if (d === 0) {  // emit line before entering block
            const line = body.slice(lineStart, j).replace(/--.*/, '');
            const fm = fieldRe.exec(line);
            if (fm) tmap[parseInt(fm[2])] = [fm[1], fm[3]];
          }
          d++; lineStart = j + 1; continue;
        }
        if (ch === '}') {
          d--;
          if (d === 0) lineStart = j + 1;  // reset after block
          continue;
        }
        if ((ch === '\n' || ch === null) && d === 0) {
          const line = body.slice(lineStart, j).replace(/--.*/, '');
          const fm = fieldRe.exec(line);
          if (fm) tmap[parseInt(fm[2])] = [fm[1], fm[3]];
          lineStart = j + 1;
        }
      }

      if (Object.keys(tmap).length === 0) continue;
      if (tname === 'IRIPayload' && tmap[0]) maps['LIPSIRIPayload'] = tmap;
      // SIPMessage exists in both IPMultimediaPDU (4G: [0][1][2]) and TS33128 (5G: [1][2][3])
      // Keep 4G version as 'SIPMessage4G', let TS33128 version stay as 'SIPMessage'
      else if (tname === 'SIPMessage' && tmap[0]) maps['SIPMessage4G'] = tmap;
      else maps[tname] = tmap;
    }
  }

  // Hardcoded IRIContents CHOICE tags
  maps['IRIContents'] = {
    1:['emailIRI','EmailIRI'], 2:['iPIRI','IPIRI'], 3:['iPIRIOnly','IPIRIOnly'],
    4:['uMTSIRI','UMTSIRI'], 5:['eTSI671IRI','ETSI671IRI'], 6:['l2IRI','L2IRI'],
    7:['l2IRIOnly','L2IRIOnly'], 8:['tARGETACTIVITYMONITOR-1','TARGETACTIVITYMONITOR-1'],
    9:['tARGETACTIVITYMONITOR-2','TARGETACTIVITYMONITOR'], 10:['pstnIsdnIRI','PstnIsdnIRI'],
    11:['iPMMIRI','IPMMIRI'], 14:['messagingIRI','MessagingIRI'], 15:['ePSIRI','EPSIRI'],
    16:['confIRI','ConfIRI'], 17:['proseIRI','ProSeIRI'], 18:['gcseIRI','GcseIRI'],
    19:['threeGPP33128DefinedIRI','XIRIPayload'], 20:['iPIRIPacketReport','IPIRIPacketReport'],
  };

  // Virtual types for inline SEQUENCE bodies that share a common tag number
  // across multiple ASN.1 versions (EPS, UMTS, HI2)
  maps['EpsPartyIdentity'] = {
    1:['imei','OCTET'], 3:['imsi','OCTET'], 6:['msISDN','OCTET'],
    7:['e164-Format','OCTET'], 8:['sip-uri','OCTET'], 9:['tel-uri','OCTET'],
    10:['nai','OCTET'], 11:['x-3GPP-Asserted-Identity','OCTET'], 13:['iMPI','OCTET'],
  };
  maps['UmtsPartyIdentity'] = {
    1:['imei','OCTET'], 2:['tei','OCTET'], 3:['imsi','OCTET'],
    4:['callingPartyNumber','OCTET'], 5:['calledPartyNumber','OCTET'],
    6:['msISDN','OCTET'], 7:['e164-Format','OCTET'], 8:['sip-uri','OCTET'],
  };

  maps['GsmGeoCoordinates'] = {
    1:['latitude','PrintableString'], 2:['longitude','PrintableString'],
    3:['mapDatum','MapDatum'], 4:['azimuth','INTEGER'],
  };
  maps['UtmCoordinates'] = {
    1:['utm-East','PrintableString'], 2:['utm-North','PrintableString'],
    3:['utm-AltitudeAboveWGS84Ellipsoid','PrintableString'],
  };

  maps['SmsContents'] = {
    1:['initiator',       'ENUMERATED'],
    2:['transfer-status', 'ENUMERATED'],
    3:['other-message',   'ENUMERATED'],
    4:['content',         'OCTET'],
    5:['national-SM-Content', 'OCTET'],
  };

  // IPMultimediaPDU Location (from LI-PS-PDU, not TS33128)
  // Used by IPMMIRI targetLocation
  maps['IPMMIRILocation'] = {
    0:['umtsHI2Location',   'UmtsHI2Location'],
    1:['epsLocation',       'EPSLocation'],
    2:['wlanLocation',      'WlanLocationAttributes'],
    3:['eTSI671HI2Location','ETSI671HI2Location'],
    4:['userLocation',      'UserLocation'],
  };

  // HI2Operations CommunicationIdentifier (different field order than LI-PS-PDU!)
  // [0]=communication-Identity-Number [1]=Network-Identifier
  maps['HI2CommunicationIdentifier'] = {
    0: ['communication-Identity-Number', 'OCTET'],
    1: ['network-Identifier', 'Network-Identifier'],
  };

  // MessagingCC (CCPayload [14]) - email/messaging content
  maps['MessagingCC'] = {
    0: ['messaging-cc-obj-id',          'OBJECT'],
    1: ['event-identifier',             'INTEGER'],
    2: ['content-identifier',           'INTEGER'],
    3: ['sequence-number',              'INTEGER'],
    4: ['end-of-sequence',              'BOOLEAN'],
    5: ['content-type',                 'OCTET'],
    6: ['content',                      'OCTET'],
    7: ['content-transfer-encoding',    'OCTET'],
  };

  // CCContents CHOICE alias for MessagingCC (most common in intercept)
  maps['CCContents'] = {
     1: ['emailCC',              'EmailCC'],
     2: ['iPCC',                 'IPCC'],
     4: ['uMTSCC',               'OCTET'],
     6: ['l2CC',                 'L2CC'],
    12: ['iPMMCC',               'IPMMCC'],
    14: ['messagingCC',          'MessagingCC'],
    15: ['ePSCC',                'OCTET'],
    16: ['uMTSCC-CC-PDU',        'OCTET'],
    17: ['ePSCC-CC-PDU',         'OCTET'],
    23: ['threeGPP33128DefinedCC','OCTET'],
  };

  // SNSSAI (Single Network Slice Selection Assistance Information)
  maps['SNSSAI'] = {
    1: ['sliceServiceType',              'OCTET'],
    2: ['sliceDifferentiator',           'OCTET'],
    3: ['mappedHPLMNSliceServiceType',   'OCTET'],
    4: ['mappedHPLMNSliceDifferentiator','OCTET'],
  };

  // TAI (Tracking Area Identity) — pLMNID must be 'PLMNID' not 'OCTET' to recurse
  maps['TAI'] = {
    1: ['pLMNID', 'PLMNID'],
    2: ['tAC',    'OCTET'],
    3: ['nID',    'OCTET'],
  };

  // MessagingCC (CCPayload [14]) - email/messaging content
  maps['MessagingCC'] = {
    0: ['messaging-cc-obj-id',          'OBJECT'],
    1: ['event-identifier',             'INTEGER'],
    2: ['content-identifier',           'INTEGER'],
    3: ['sequence-number',              'INTEGER'],
    4: ['end-of-sequence',              'BOOLEAN'],
    5: ['content-type',                 'OCTET'],
    6: ['content',                      'OCTET'],
    7: ['content-transfer-encoding',    'OCTET'],
  };

  // CCContents CHOICE — includes payloadDirection [0] from LI-PS-PDU hybrid
  maps['CCContents'] = {
     0: ['payloadDirection',    'ENUMERATED'],
     1: ['emailCC',              'EmailCC'],
     2: ['iPCC',                 'IPCC'],
     4: ['uMTSCC',               'OCTET'],
     6: ['l2CC',                 'L2CC'],
    12: ['iPMMCC',               'IPMMCC'],
    14: ['messagingCC',          'MessagingCC'],
    15: ['ePSCC',                'OCTET'],
    16: ['uMTSCC-CC-PDU',        'OCTET'],
    17: ['ePSCC-CC-PDU',         'OCTET'],
    23: ['threeGPP33128DefinedCC','OCTET'],
  };

  // HI2Operations CommunicationIdentifier (different from LI-PS-PDU!)
  maps['HI2CommunicationIdentifier'] = {
    0: ['communication-Identity-Number', 'OCTET'],
    1: ['network-Identifier',            'Network-Identifier'],
  };

  // UmtsCS partyIdentity (HI2Operations variant with [3]=imsi, [4]=callingPartyNumber)
  maps['UmtsHI2PartyIdentity'] = {
    1: ['imei',                'OCTET'],
    2: ['tei',                 'OCTET'],
    3: ['imsi',                'OCTET'],
    4: ['callingPartyNumber',  'OCTET'],
    5: ['calledPartyNumber',   'OCTET'],
    6: ['msISDN',              'OCTET'],
    7: ['e164-Format',         'OCTET'],
    8: ['sip-uri',             'OCTET'],
    9: ['tel-url',             'OCTET'],
   10: ['party-Validity',      'OCTET'],
  };

  // IPMMIRILocation (from LI-PS-PDU, not TS33128)
  maps['IPMMIRILocation'] = {
    0: ['umtsHI2Location',    'UmtsHI2Location'],
    1: ['epsLocation',        'EPSLocation'],
    2: ['wlanLocation',       'WlanLocationAttributes'],
    3: ['eTSI671HI2Location', 'ETSI671HI2Location'],
    4: ['userLocation',       'UserLocation'],
  };

  return maps;
}

// ── BER helpers ───────────────────────────────────────────────────────────────
const UNIV = {
  1:'BOOLEAN',2:'INTEGER',3:'BIT STRING',4:'OCTET STRING',5:'NULL',6:'OID',
  10:'ENUMERATED',12:'UTF8String',16:'SEQUENCE',17:'SET',19:'PrintableString',
  22:'IA5String',23:'UTCTime',24:'GeneralizedTime',26:'VisibleString',30:'BMPString'
};

function readTag(buf, pos) {
  const b = buf[pos++]; const cls=(b>>6)&3; const cons=(b>>5)&1; let tag=b&0x1f;
  if (tag===0x1f) { tag=0; while(true){const nb=buf[pos++];tag=(tag<<7)|(nb&0x7f);if(!(nb&0x80))break;} }
  return {cls,cons,tag,pos};
}
function readLen(buf, pos) {
  const b=buf[pos++];
  if(b&0x80){const n=b&0x7f;let len=0;for(let i=0;i<n;i++)len=(len<<8)|buf[pos++];return{len,pos};}
  return{len:b,pos};
}
function decodeOID(raw) {
  try {
    const vals=[];let i=0;const first=raw[i++];vals.push(Math.floor(first/40),first%40);let v=0;
    while(i<raw.length){const b=raw[i++];v=(v<<7)|(b&0x7f);if(!(b&0x80)){vals.push(v);v=0;}}
    return vals.join('.');
  } catch { return Buffer.from(raw).toString('hex'); }
}
function isPrintable(raw) {
  try {
    const s=Buffer.from(raw).toString('utf8');
    return s.split('').every(c=>{const cc=c.charCodeAt(0);return(cc>=32&&cc<127)||cc===9||cc===10||cc===13;})?s:null;
  } catch { return null; }
}
function looksLikeBer(raw) {
  if(raw.length<2)return false;
  try{const t=readTag(raw,0);const l=readLen(raw,t.pos);return l.pos+l.len===raw.length&&l.len>0;}catch{return false;}
}
// ── Enhanced scalar decoders ──────────────────────────────────────────────────

// Loaded lazily after createWindow
let enumMaps = null;
function getEnumMaps() {
  if (enumMaps) return enumMaps;
  const asn1Dir = getAsn1Dir();
  if (!asn1Dir) return (enumMaps = {});
  enumMaps = {};
  for (const fname of fs.readdirSync(asn1Dir).filter(f=>f.endsWith('.asn')||f.endsWith('.asn1')).sort()) {
    const content = fs.readFileSync(path.join(asn1Dir, fname), 'utf8');
    for (const m of content.matchAll(/^([A-Z][A-Za-z0-9-]+)\s*::=\s*ENUMERATED\s*\{([\s\S]*?)\}/gm)) {
      const vals = {};
      for (const line of m[2].split('\n')) {
        const em = line.replace(/--.*/, '').trim().match(/^([a-zA-Z][a-zA-Z0-9-]*)\s*\((\d+)\)/);
        if (em) vals[parseInt(em[2])] = em[1];
      }
      if (Object.keys(vals).length) enumMaps[m[1]] = vals;
    }
  }
  return enumMaps;
}

function decodeGeneralizedTime(s) {
  try {
    const clean = s.trim();
    const base  = clean.replace(/[Z.].*/,'');
    const frac  = clean.match(/\.(\d+)/)?.[1] ?? '';
    const tz    = clean.endsWith('Z') ? 'Z' : '';
    const y=base.slice(0,4),mo=base.slice(4,6),d=base.slice(6,8);
    const h=base.slice(8,10),mi=base.slice(10,12),sc=base.slice(12,14)||'00';
    const ms = frac ? '.' + frac.slice(0,3).padEnd(3,'0') : '';
    return `${y}-${mo}-${d} ${h}:${mi}:${sc}${ms}${tz}`;
  } catch { return s; }
}

function decodeBcdMsisdn(raw) {
  if (!raw.length) return '';
  const international = ((raw[0] >> 4) & 0x7) === 1;
  let digits = '';
  for (let i = 1; i < raw.length; i++) {
    const lo = raw[i] & 0x0f, hi = (raw[i] >> 4) & 0x0f;
    if (lo <= 9) digits += lo; else if (lo===0xb) digits+='*'; else if(lo===0xc) digits+='#';
    if (hi === 0xf) break;
    else if (hi <= 9) digits += hi; else if(hi===0xb) digits+='*'; else if(hi===0xc) digits+='#';
  }
  return (international ? '+' : '') + digits;
}

function decodeBcdImsi(raw) {
  let digits = '';
  for (const b of raw) {
    const lo = b & 0x0f, hi = (b >> 4) & 0x0f;
    if (lo <= 9) digits += lo;
    if (hi === 0xf) break;
    if (hi <= 9) digits += hi;
  }
  return digits;
}

// MSISDN/IMSI field names that should get BCD-decode treatment
const BCD_MSISDN_FIELDS = new Set(['msISDN','mSISDN','callingPartyNumber','calledPartyNumber',
  'mSISDN-BCD','serviceCenterAddress','msisdn','imsi','iMSI','imei','iMEI','iMEISV',
  'subscriberIdentity','e164Address']);

function scalarValue(cls, tag, raw, fieldName, origChildType) {
  if (!raw.length) return tag === 5 ? 'NULL' : '';
  const enums = getEnumMaps();

  if (cls === 0) {
    if (tag === 2) {   // INTEGER
      let v = 0n;
      for (const b of raw) v = (v << 8n) | BigInt(b);
      if (raw[0] & 0x80) v -= (1n << BigInt(raw.length * 8));
      const vn = Number(v);
      return `${vn},  0x${vn.toString(16)}`;
    }
    if (tag === 6) return decodeOID(raw);
    if (tag === 10) {  // ENUMERATED — look up by origChildType
      const v = raw[0];
      const label = origChildType && enums[origChildType] ? enums[origChildType][v] : null;
      return label ? `${label} ( ${v}, 0x${v.toString(16)} )` : `${v},  0x${v.toString(16)}`;
    }
    if (tag === 3) {   // BIT STRING
      const unused = raw[0];
      let bits = '';
      for (let i = 1; i < raw.length; i++) bits += raw[i].toString(2).padStart(8,'0');
      return bits.slice(0, Math.max(0, bits.length - unused));
    }
    if ([23, 24].includes(tag)) {  // UTCTime / GeneralizedTime
      return decodeGeneralizedTime(Buffer.from(raw).toString('utf8'));
    }
    if ([12, 19, 22, 26, 30].includes(tag)) {
      return Buffer.from(raw).toString('utf8');
    }
  }

  // Context-tagged: ENUMERATED by child type
  if (cls === 2 && origChildType && enums[origChildType]) {
    const v = raw[0];
    const label = enums[origChildType][v];
    if (label) return `${label} ( ${v}, 0x${v.toString(16)} )`;
  }

  // Context-tagged INTEGER
  if (cls === 2 && origChildType === 'INTEGER') {
    try {
      let v = 0n;
      for (const b of raw) v = (v << 8n) | BigInt(b);
      if (raw[0] & 0x80) v -= (1n << BigInt(raw.length * 8));
      const vn = Number(v);
      // seconds field: show as Unix timestamp + human-readable date
      if (fieldName === 'seconds' && vn > 1000000000 && vn < 2000000000) {
        const d = new Date(vn * 1000);
        return `${d.toISOString().replace('T',' ').replace('.000Z','Z')}  (${vn}, 0x${vn.toString(16)})`;
      }
      return `${vn},  0x${vn.toString(16)}`;
    } catch { /* fall through */ }
  }

  // Context-tagged GeneralizedTime / UTCTime
  if (cls === 2 && (origChildType === 'GeneralizedTime' || origChildType === 'UTCTime')) {
    const s = Buffer.from(raw).toString('utf8');
    return decodeGeneralizedTime(s);
  }

  // MSISDN/IMSI/IMEI: BCD decode only if bytes are non-printable (real BCD)
  // TS33128 stores these as plain UTF-8 strings; older formats use BCD
  if (cls === 2 && raw.length >= 2 && fieldName) {
    const fn = fieldName;
    const isBcd = raw.some(b => b > 0x7f || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d));
    if (isBcd) {
      if (/msisdn|mSISDN|msISDN/i.test(fn) || /callingParty|calledParty/i.test(fn)) {
        return decodeBcdMsisdn(Array.from(raw));
      }
      if (/^i[mM][sS][iI]$/.test(fn) || fn === 'iMSI' || fn === 'imsi') {
        return decodeBcdImsi(Array.from(raw));
      }
      if (/^i[mM][eE][iI]/.test(fn)) {
        return decodeBcdImsi(Array.from(raw));
      }
    }
  }

  // Large binary: hex dump inline
  const s = isPrintable(raw);
  if (s && raw.length <= 64) return s;
  const hex = Buffer.from(raw).toString('hex');
  if (raw.length <= 16) return '0x' + hex;
  return `0x${hex.slice(0,32)}…  (${raw.length} B)`;
}

function hexDump(raw, baseOffset) {
  const lines=[];
  for(let i=0;i<raw.length;i+=16){
    const chunk=raw.slice(i,i+16);
    lines.push({
      offset:(baseOffset+i).toString(16).padStart(6,'0'),
      hex:Array.from(chunk).map(b=>b.toString(16).padStart(2,'0')).join(' ').padEnd(47),
      ascii:Array.from(chunk).map(b=>(b>=32&&b<127)?String.fromCharCode(b):'.').join('')
    });
  }
  return lines;
}
function tagLabel(cls,tag){
  if(cls===0)return UNIV[tag]||`UNIV-${tag}`;
  if(cls===2)return`[${tag}]`;
  return`${['UNIV','APPL','CTXT','PRIV'][cls]}[${tag}]`;
}

const EXTRA_HINTS = {
  // 5G IRI chain
  'Payload,0':                  'iRIPayloadSEQ',
  'LIPSIRIPayload,2':           'IRIContents',
  'IRIContents,19':             'XIRIPayload',
  'XIRIPayload,2':              'XIRIEvent',
  // CC payload chain (4G messaging, VoIP)
  'Payload,1':                  'cCPayloadSEQ',
  // UmtsCS chain - files starting with [0..4] context tag
  'UmtsCS-IRIsContent,0':       'UmtsCS-IRIContent',
  'UmtsCS-IRIContent,1':        'UmtsCS-IRI-Parameters',
  'UmtsCS-IRIContent,2':        'UmtsCS-IRI-Parameters',
  'UmtsCS-IRIContent,3':        'UmtsCS-IRI-Parameters',
  'UmtsCS-IRIContent,4':        'UmtsCS-IRI-Parameters',
  // extendedInterceptionPointID (PSHeader[9]) contains a SET OF PartyInformation
  'PSHeader,9':                 'PartyInformationSEQ',
  // EPSIRI chain (Not5G / EPS)
  'EPSIRI,0':                   'EpsIRI-Parameters',
  'EPSIRI,1':                   'EpsIRIContent',
  'EpsIRIContent,1':            'EpsIRI-Parameters',
  'EpsIRIContent,2':            'EpsIRI-Parameters',
  'EpsIRIContent,3':            'EpsIRI-Parameters',
  'EpsIRIContent,4':            'EpsIRI-Parameters',
  // partyInformation SET OF PartyInformation (EPS, UMTS, UmtsCS)
  'EpsIRI-Parameters,9':        'PartyInformationSEQ',
  'UmtsCS-IRI-Parameters,9':    'PartyInformationSEQ',
  'IRI-Parameters,9':           'PartyInformationSEQ',
  // PartyInformation partyIdentity inline SEQUENCE
  'PartyInformation,1':         'UmtsHI2PartyIdentity',   // HI2 format (UmtsCS/EPS)
  'Party-Information,1':        'UmtsHI2PartyIdentity',   // Umts-HI2Operations variant
  // GSMLocation geoCoordinates inline SEQUENCE
  'GSMLocation,1':              'GsmGeoCoordinates',
  'GSMLocation,2':              'UtmCoordinates',
  // Other IRIContents CHOICE members
  'UMTSIRI,0':                  'UmtsIRI-Parameters',
  'UMTSIRI,1':                  'UmtsIRIsContent',
  // CCPayload content chain
  'CCPayload,2':                'CCContents',
  'CCContents,14':              'MessagingCC',
  // 5G TAI pLMNID -> PLMNID type (enables mCC/mNC labels)
  'TAI,1':                      'PLMNID',
  // 5G slice/NSSAI/TAI inner fields
  'Slice,1':                    'NSSAI',
  'Slice,2':                    'NSSAI',
  'allowedNSSAI,1':             'SNSSAI',
  'fiveGSTAIList,1':            'TAI',
  // UmtsCS-IRI-Parameters uses HI2Operations CommunicationIdentifier (different from LI-PS-PDU!)
  'UmtsCS-IRI-Parameters,2':    'HI2CommunicationIdentifier',
  // HI2CommunicationIdentifier[1] = Network-Identifier (same as Network-Identifier in maps)
  'HI2CommunicationIdentifier,1': 'Network-Identifier',
  // IP address inner encoding (LI-PS-PDU IP-value)
  'IPv6Address,1':              'iPBinaryAddress',
  'IPv6Address,2':              'iPBinaryAddress',
  'IPv4Address,1':              'iPBinaryAddress',
  // EPS-GTPV2-SpecificParameters[23] = ePSlocationOfTheTarget :: EPSLocation
  'EPS-GTPV2-SpecificParameters,23': 'EPSLocation',
  // IPMMIRI SIPMessage chain (4G uses [0][1][2], TS33128 5G uses [1][2][3])
  'IPIRIContents,1':            'SIPMessage4G',
  'IPIRIContents,6':            'SIPMessage4G',
  // IPMMIRI targetLocation uses LI-PS-PDU Location, not TS33128 Location
  'IPMMIRI,2':                  'IPMMIRILocation',
  // SMS-report sMS-Contents inline SEQUENCE
  'SMS-report,3':               'SmsContents',
};

const GENERIC_TYPES = new Set(['SEQUENCE','SET','CHOICE','OCTET','OBJECT','INTEGER','BOOLEAN',
  'PrintableString','IA5String','UTF8String','GeneralizedTime','UTCTime','BIT','ENUMERATED',
  'NULL','REAL','RELATIVE-OID']);

function parseBer(buf, baseOffset, typeHint, tagMaps, depth) {
  depth=depth||0; tagMaps=tagMaps||{}; const nodes=[]; let pos=0;
  while(pos<buf.length){
    const start=pos; let t,l;
    try{t=readTag(buf,pos);l=readLen(buf,t.pos);}catch{break;}
    const valEnd=l.pos+l.len; if(valEnd>buf.length)break;
    const raw=buf.slice(l.pos,valEnd);
    const node={
      offset:baseOffset+start,cls:t.cls,cons:t.cons,tag:t.tag,length:l.len,
      valOffset:baseOffset+l.pos,tagLabel:tagLabel(t.cls,t.tag),
      fieldName:null,typeName:null,origChildType:null,displayValue:null,
      hexDump:hexDump(raw,baseOffset+l.pos),children:[],
      rawValue:Array.from(raw),
    };
    let childType=null;
    if(t.cls===2){
      if(typeHint&&tagMaps[typeHint]){
        const entry=tagMaps[typeHint][t.tag];
        if(entry){
          node.fieldName=entry[0]; childType=entry[1];
          node.typeName=childType; node.origChildType=childType;
          if(GENERIC_TYPES.has(childType)) childType=null;
        }
      }
      // PSHeader has an extension marker (...) — unknown tags fall through to EpsIRI-Parameters
      // This handles EPS files where IRI parameters are embedded directly in PSHeader
      if(!node.fieldName && typeHint==='PSHeader' && tagMaps['EpsIRI-Parameters']) {
        const epsEntry = tagMaps['EpsIRI-Parameters'][t.tag];
        if(epsEntry){
          node.fieldName=epsEntry[0]; childType=epsEntry[1];
          node.typeName=childType; node.origChildType=childType;
          if(GENERIC_TYPES.has(childType)) childType=null;
        }
      }
      const override=EXTRA_HINTS[`${typeHint},${t.tag}`];
      if(override){childType=override;node.typeName=override;}
    }else if(t.cls===0){node.typeName=UNIV[t.tag]||`UNIV-${t.tag}`;}

    let recurseHint=childType;
    if(t.cls===0&&t.tag===16){
      // UNIVERSAL SEQUENCE — special passthroughs for SEQUENCE OF types
      if     (typeHint==='iRIPayloadSEQ')         recurseHint='LIPSIRIPayload';
      else if(typeHint==='cCPayloadSEQ')           recurseHint='CCPayload';
      else if(typeHint==='PartyInformationSEQ')    recurseHint='PartyInformation';
      // SEQUENCE OF types: forward to element type
      else if(typeHint==='NSSAI')                  recurseHint='SNSSAI';
      else if(typeHint==='fiveGSTAIList')           recurseHint='TAI';
      else if(typeHint==='TAIList')                 recurseHint='TAI';
      else if(childType)                            recurseHint=childType;
      else                                          recurseHint=typeHint;
    }else if(t.cls===0&&t.tag===17){
      // UNIVERSAL SET
      if(typeHint==='PartyInformationSEQ') recurseHint='PartyInformation';
      else recurseHint=childType||typeHint;
    }

    // String/simple types that are BER-encoded as constructed should still decode as scalar
    // Only apply forceScalar based on origChildType, NOT fieldName
    // (fieldName regex was too broad: matched 'communicationIdentifier', 'extendedInterceptionPointID' etc.)
    const STRING_TYPES = new Set(['PrintableString','IA5String','UTF8String','VisibleString',
      'BMPString','GeneralizedTime','UTCTime','LawfulInterceptionIdentifier']);
    const forceScalar = t.cls===2 && t.cons && STRING_TYPES.has(node.origChildType);

    if(t.cons && !forceScalar){
      node.children=parseBer(raw,baseOffset+l.pos,recurseHint,tagMaps,depth+1);
    } else if(!forceScalar && looksLikeBer(raw)&&depth<8){
      // Nested BER in OCTET STRING: use childType as hint
      node.children=parseBer(raw,baseOffset+l.pos,childType,tagMaps,depth+1);
    }

    if(!node.children.length){
      if(t.cls===2&&node.origChildType==='OBJECT'){
        const oid=decodeOID(raw); node.displayValue=oid.includes('.')?oid:scalarValue(t.cls,t.tag,raw,node.fieldName,node.origChildType);
      } else {
        node.displayValue=scalarValue(t.cls,t.tag,raw,node.fieldName,node.origChildType);
      }
    }
    nodes.push(node); pos=valEnd;
  }
  return nodes;
}

// ── Auto-detect type hint from first BER tag ─────────────────────────────────
function detectTypeHint(buf) {
  if (!buf.length) return 'PS-PDU';
  const b0  = buf[0];
  const cls = (b0 >> 6) & 3;
  const tag = b0 & 0x1f;

  if (cls === 0 && tag === 16) return 'PS-PDU';   // 0x30 UNIVERSAL SEQUENCE

  if (cls === 2) {
    if (tag === 0) return 'UmtsCS-IRIsContent';   // 0xa0

    // Tags [2][3][4] = UmtsCS iRI-End/Continue/Report-record (no ambiguity)
    if (tag >= 2 && tag <= 4) return 'UmtsCS-IRIContent';

    // Tag [1] = AMBIGUOUS:
    //   PS-PDU without outer SEQUENCE  -> [1]=pSHeader  (li-psDomainId   0.4.0.2.2.5.x)
    //   PS-PDU EPS variant             -> [1]=pSHeader  (hi2epsDomainId  0.4.0.2.2.4.8.x)
    //   UmtsCS-IRIContent iRI-Begin    -> [1]=iRI-Begin (hi2CSDomainId   0.4.0.2.2.4.3.x)
    //
    // Distinguish via OID bytes in first 50 bytes:
    //   04 00 02 02 05        -> li-psDomainId        -> PS-PDU
    //   04 00 02 02 04 [03]   -> hi2CSDomainId (UmtsCS) -> UmtsCS-IRIContent
    //   04 00 02 02 04 [!03]  -> hi2epsDomainId (EPS) -> PS-PDU
    if (tag === 1) {
      const limit = Math.min(buf.length - 5, 50);
      for (let i = 0; i < limit; i++) {
        if (buf[i]===0x04 && buf[i+1]===0x00 && buf[i+2]===0x02 && buf[i+3]===0x02) {
          if (buf[i+4] === 0x05) return 'PS-PDU';            // li-psDomainId
          if (buf[i+4] === 0x04) {
            // Check next byte: 0x03 = UmtsCS, others = EPS PS-PDU
            return (buf[i+5] === 0x03) ? 'UmtsCS-IRIContent' : 'PS-PDU';
          }
        }
      }
      return 'PS-PDU'; // fallback
    }
  }
  return 'PS-PDU';
}


// ── BER serializer (rebuild binary from node tree with edits) ─────────────────
function encodeLength(len) {
  if(len<128)return Buffer.from([len]);
  const hex=len.toString(16).padStart(len>0xffff?6:len>0xff?4:2,'0');
  const bytes=Buffer.from(hex,'hex');
  return Buffer.concat([Buffer.from([0x80|bytes.length]),bytes]);
}

function serializeNode(node) {
  // Rebuild tag byte(s)
  let tagByte;
  if(node.tag<=30){
    tagByte=Buffer.from([(node.cls<<6)|(node.cons<<5)|node.tag]);
  }else{
    const t=[];let tv=node.tag;while(tv>0){t.unshift(tv&0x7f);tv>>=7;}
    for(let i=0;i<t.length-1;i++)t[i]|=0x80;
    tagByte=Buffer.concat([Buffer.from([(node.cls<<6)|(node.cons<<5)|0x1f]),Buffer.from(t)]);
  }
  let valueBytes;
  if(node.children&&node.children.length>0){
    valueBytes=Buffer.concat(node.children.map(serializeNode));
  }else{
    valueBytes=Buffer.from(node.rawValue||[]);
  }
  return Buffer.concat([tagByte, encodeLength(valueBytes.length), valueBytes]);
}

function serializeNodes(nodes) {
  return Buffer.concat(nodes.map(serializeNode));
}

// ── TXT export (li_decoder-style indented output) ─────────────────────────────
function nodeToTxt(node, indent) {
  const pad='  '.repeat(indent);
  const name=node.fieldName||node.typeName||node.tagLabel;
  if(node.children&&node.children.length>0){
    const childStr=node.children.map(c=>nodeToTxt(c,indent+1)).join('\n');
    return`${pad}${name}:\n${childStr}`;
  }
  return`${pad}${name}: ${node.displayValue??''}`;
}

// ── Window & state ────────────────────────────────────────────────────────────
let mainWindow;
let tagMaps = {};
let currentFilePath = null;

function rebuildMenu() {
  const recentItems = recentFiles.length > 0
    ? [
        { type: 'separator' },
        ...recentFiles.map(f => ({
          label: path.basename(f),
          sublabel: f,
          click: () => mainWindow.webContents.send('open-recent', f)
        })),
        { type: 'separator' },
        { label: 'Clear Recent Files', click: () => {
          recentFiles=[]; saveRecent(); rebuildMenu();
          if(mainWindow) mainWindow.webContents.send('recent-files-updated',[]);
        }}
      ]
    : [];

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Open…',       accelerator: 'CmdOrCtrl+O', click: openFile },
        ...recentItems,
        { type: 'separator' },
        { label: 'Save As…',    accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('save-as') },
        { label: 'Export TXT…', accelerator: 'CmdOrCtrl+Shift+E', click: () => mainWindow.webContents.send('export-txt-cmd') },
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 860, minWidth: 900, minHeight: 600,
    title: 'BER Viewer', backgroundColor: '#1a1d23',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  const asn1Dir = getAsn1Dir();
  if(asn1Dir){ tagMaps=buildTagMaps(asn1Dir); console.log(`Loaded ${Object.keys(tagMaps).length} type maps`); }
  loadRecent();
  rebuildMenu();
}

async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open BER file',
    filters: [{ name:'BER files', extensions:['hi2','ber'] },{ name:'All files', extensions:['*'] }],
    properties: ['openFile']
  });
  if(!result.canceled && result.filePaths[0]) loadFile(result.filePaths[0]);
}

function loadFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const typeHint = detectTypeHint(buf);
    const nodes = parseBer(buf, 0, typeHint, tagMaps);
    currentFilePath = filePath;
    addRecent(filePath);
    mainWindow.webContents.send('file-loaded', {
      fileName: path.basename(filePath),
      filePath: filePath,
      size:     buf.length,
      nodes:    nodes,
      typeHint: typeHint,
      hexDump:  hexDump(buf, 0),  // Send pre-computed hex dump instead of buffer
    });
  } catch(e) {
    console.error('loadFile error:', e);
    mainWindow.webContents.send('file-error', e.message);
  }
}

function loadFromBuffer(buf, fileName) {
  try {
    const typeHint = detectTypeHint(buf);
    const nodes = parseBer(buf, 0, typeHint, tagMaps);
    currentFilePath = null; // no path for dragged files
    // do not add to recent
    mainWindow.webContents.send('file-loaded', {
      fileName: fileName,
      filePath: null,
      size:     buf.length,
      nodes:    nodes,
      typeHint: typeHint,
    });
  } catch(e) {
    console.error('loadFile error:', e);
    mainWindow.webContents.send('file-error', e.message);
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('open-file-dialog', openFile);
ipcMain.handle('open-file-path', (_, p) => loadFile(p));
ipcMain.handle('open-file-buffer', (_, buf, name) => loadFromBuffer(Buffer.from(buf), name));
ipcMain.handle('get-schema-info', () => ({ typeCount: Object.keys(tagMaps).length, asn1Dir: getAsn1Dir(), version: app.getVersion() }));
ipcMain.handle('get-recent-files', () => recentFiles);
ipcMain.handle('clear-recent-files', () => { recentFiles=[]; saveRecent(); rebuildMenu(); });

// OSM tile fetching — done in main process to bypass renderer CSP
ipcMain.handle('fetch-osm-tile', async (_, z, x, y) => {
  try {
    const sub = ['a','b','c'][(x + y) % 3];
    const url = `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const { net } = require('electron');
    return await new Promise((resolve, reject) => {
      const req = net.request({ url, method: 'GET' });
      // OSM requires a valid User-Agent identifying the application
      req.setHeader('User-Agent', `BERViewer/${app.getVersion()} (Electron; LI PS-PDU viewer)`);
      req.setHeader('Referer', 'https://www.openstreetmap.org/');
      req.on('response', res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          if (res.statusCode !== 200) { resolve(null); return; }
          const buf = Buffer.concat(chunks);
          resolve('data:image/png;base64,' + buf.toString('base64'));
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  } catch { return null; }
});

ipcMain.handle('save-file-dialog', async (_, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save BER file as…',
    defaultPath: defaultPath || 'modified.hi2',
    filters: [{ name:'BER files', extensions:['hi2','ber'] },{ name:'All files', extensions:['*'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('save-file', (_, filePath, bufArray) => {
  try {
    fs.writeFileSync(filePath, Buffer.from(bufArray));
    currentFilePath = filePath;
    addRecent(filePath);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('export-txt', async (_, defaultPath, txt) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export as TXT',
    defaultPath: defaultPath || 'export.txt',
    filters: [{ name:'Text files', extensions:['txt'] },{ name:'All files', extensions:['*'] }],
  });
  if(result.canceled) return { ok: false };
  try { fs.writeFileSync(result.filePath, txt, 'utf8'); return { ok: true, path: result.filePath }; }
  catch(e) { return { ok: false, error: e.message }; }
});

// Format 2: offset-based  "0000 TypeName [tag] ::= value (size=N)"
ipcMain.handle('export-txt-fmt2', async (_, defaultPath, nodes) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export as TXT (Offset format)',
    defaultPath: defaultPath || 'export.txt',
    filters: [{ name:'Text files', extensions:['txt'] },{ name:'All files', extensions:['*'] }],
  });
  if(result.canceled) return { ok: false };
  try {
    const lines = [];
    function renderNode(node, indent) {
      const pad = ' '.repeat(indent * 3);
      const offset = node.offset.toString(16).padStart(4,'0');
      const name   = (node.fieldName || node.typeName || node.tagLabel).padEnd(40 - indent*3);
      const tag    = node.tagLabel.padStart(4);
      const size   = node.length.toString(16);
      if (node.children && node.children.length) {
        const kind = node.cons ? (node.typeName||'CONSTRUCTED') : 'CHOICE';
        lines.push(`${offset} ${pad}${name} ${tag} ::= ${kind} (size = ${size})`);
        // Hex dump for large raw nodes (non-constructed that have children via nested BER)
        for (const c of node.children) renderNode(c, indent + 1);
      } else {
        let val = node.displayValue ?? '';
        // Hex dump for large binary values
        if (node.rawValue && node.rawValue.length > 8 && typeof val === 'string' && val.includes('…')) {
          lines.push(`${offset} ${pad}${name} ${tag} ::= (size = ${size})`);
          const raw = node.rawValue;
          for (let i = 0; i < raw.length; i += 16) {
            const chunk = raw.slice(i, i+16);
            const hexPart  = chunk.map(b=>b.toString(16).padStart(2,'0')).join(' ').padEnd(47);
            const asciiPart= chunk.map(b=>(b>=32&&b<127)?String.fromCharCode(b):'.').join('');
            lines.push(`${' '.repeat(57)} ${hexPart}  |${asciiPart}|`);
          }
        } else {
          const valStr = String(val);
          lines.push(`${offset} ${pad}${name} ${tag} ::= ${valStr} (size = ${size})`);
        }
      }
    }
    for (const n of nodes) renderNode(n, 0);
    fs.writeFileSync(result.filePath, lines.join('\n') + '\n', 'utf8');
    return { ok: true, path: result.filePath };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if(BrowserWindow.getAllWindows().length===0) createWindow(); });
});
app.on('window-all-closed', () => { if(process.platform!=='darwin') app.quit(); });
