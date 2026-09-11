#!/usr/bin/env node
/**
 * Tests für die Batch-Bearbeitung (src/batch.js).
 *
 * Die reinen Funktionen aus src/batch.js werden direkt geladen (das Modul hat
 * keine electron-/DOM-Abhängigkeit). Für den End-to-End-Test wird serializeNode
 * per Quelltext aus src/renderer.js extrahiert (identisch zum Serializer in
 * main.js) und die erzeugten Bytes werden mit einem unabhängigen Mini-BER-Decoder
 * gegengeprüft.
 *
 * Run:  node test/batch.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const B = require('../src/batch');

// ── serializeNode aus renderer.js extrahieren (wie in roundtrip.test.js) ───────
const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
function extractFunction(src, name) {
  const sig = 'function ' + name + '(';
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
const sandbox = { Buffer, String, Number, Array };
vm.createContext(sandbox);
vm.runInContext(extractFunction(rendererSrc, 'encodeLength'), sandbox);
vm.runInContext(extractFunction(rendererSrc, 'serializeNode'), sandbox);
const { serializeNode } = sandbox;

// ── Mini-BER-Decoder (unabhängig, nur für die Verifikation) ────────────────────
function readTag(buf, pos) {
  const b = buf[pos++]; const cls = (b >> 6) & 3; const cons = (b >> 5) & 1; let tag = b & 0x1f;
  if (tag === 0x1f) { tag = 0; while (true) { const nb = buf[pos++]; tag = (tag << 7) | (nb & 0x7f); if (!(nb & 0x80)) break; } }
  return { cls, cons, tag, pos };
}
function readLen(buf, pos) {
  const b = buf[pos++];
  if (b & 0x80) { const n = b & 0x7f; let len = 0; for (let i = 0; i < n; i++) len = (len << 8) | buf[pos++]; return { len, pos }; }
  return { len: b, pos };
}
// Flache TLV-Liste der obersten Kinder eines SEQUENCE-Inhalts.
function tlvChildren(buf) {
  const out = []; let pos = 0;
  while (pos < buf.length) {
    const t = readTag(buf, pos); const l = readLen(buf, t.pos);
    out.push({ cls: t.cls, cons: t.cons, tag: t.tag, value: buf.slice(l.pos, l.pos + l.len) });
    pos = l.pos + l.len;
  }
  return out;
}
// Äußere SEQUENCE auspacken → TLV-Liste ihrer Kinder.
function decodeSeqChildren(buf) {
  const t = readTag(buf, 0); const l = readLen(buf, t.pos);
  return tlvChildren(buf.slice(l.pos, l.pos + l.len));
}

// ── Test-Harness ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
const hex = a => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join(' ');
const D = 24 * 3600 * 1000, H = 3600 * 1000, MIN = 60 * 1000, S = 1000;

// ── 1. GeneralizedTime-Delta ───────────────────────────────────────────────────
console.log('\nGeneralizedTime shift:');
check('+5d4h10m',            B.shiftGeneralizedTimeStr('20240101120000Z', 5*D+4*H+10*MIN) === '20240106161000Z');
check('Sekunden-Überlauf',   B.shiftGeneralizedTimeStr('20241231235959Z', 1*S) === '20250101000000Z');
check('negatives Delta',     B.shiftGeneralizedTimeStr('20240101000000Z', -1*S) === '20231231235959Z');
check('Bruchteil bleibt',    B.shiftGeneralizedTimeStr('20240101120000.500Z', 1*S) === '20240101120001.500Z');
check('ohne Z',              B.shiftGeneralizedTimeStr('20240101120000', 60*MIN) === '20240101130000');
check('ungültig → null',     B.shiftGeneralizedTimeStr('kein datum', 1000) === null);

// ── 2. UTCTime-Delta (2-stelliges Jahr) ────────────────────────────────────────
console.log('\nUTCTime shift:');
check('+5 Tage',             B.shiftUtcTimeStr('240101120000Z', 5*D) === '240106120000Z');
check('Jahrhundert-Überlauf (1999→2000)', B.shiftUtcTimeStr('991231235959Z', 1*S) === '000101000000Z');
check('negativ',             B.shiftUtcTimeStr('240101000000Z', -1*S) === '231231235959Z');

// ── 3. Unix-Sekunden (INTEGER-Bytes) ───────────────────────────────────────────
console.log('\nUnix seconds shift:');
function decInt(bytes) { let v = 0n; for (const b of bytes) v = (v << 8n) | BigInt(b); if (bytes.length && (bytes[0] & 0x80)) v -= (1n << BigInt(bytes.length * 8)); return v; }
const ts = B.encodeBerIntegerBatch(1700000000n);          // korrekte Bytes für 1700000000
check('+1h auf 1700000000',  decInt(B.shiftUnixSecondsBytes(ts, 3600)) === 1700003600n);
check('negativer Versatz',   decInt(B.shiftUnixSecondsBytes(ts, -3600)) === 1699996400n);
// 2038-Grenze: 2147483647 (+1) → 2147483648, braucht führendes 0x00 gegen Vorzeichenflip
check('post-2038 kein Vorzeichenflip',
      hex(B.shiftUnixSecondsBytes(B.encodeBerIntegerBatch(2147483647n), 1)) === '00 80 00 00 00');

// ── 4. IP-Parsing ──────────────────────────────────────────────────────────────
console.log('\nIP parse:');
check('IPv4',        hex(B.parseIpToBytesBatch('192.168.0.1')) === 'c0 a8 00 01');
check('IPv4 Grenze', hex(B.parseIpToBytesBatch('255.255.255.255')) === 'ff ff ff ff');
check('IPv4 >255 → null', B.parseIpToBytesBatch('300.1.1.1') === null);
check('IPv6 ::1',    (B.parseIpToBytesBatch('::1') || []).length === 16 && hex(B.parseIpToBytesBatch('::1')).endsWith('00 01'));
check('IPv6 voll',   hex(B.parseIpToBytesBatch('2001:db8:0:0:0:0:0:1')).startsWith('20 01 0d b8'));
check('Müll → null', B.parseIpToBytesBatch('nope') === null);

// ── 5. deltaToMs ────────────────────────────────────────────────────────────────
console.log('\ndeltaToMs:');
check('+1d1h1m1s', B.deltaToMs({ sign: 1, days: 1, hours: 1, minutes: 1, seconds: 1 }) === (D + H + MIN + S));
check('Vorzeichen negativ', B.deltaToMs({ sign: -1, days: 1 }) === -D);

// ── 6. classifyEditableNode ─────────────────────────────────────────────────────
console.log('\nclassifyEditableNode:');
const cl = (n) => (B.classifyEditableNode(n) || {}).kind || null;
check('UNIVERSAL GeneralizedTime', cl({ cls:0, tag:24, children:[], rawValue:[0x32], fieldName:'timeStamp' }) === 'gtime');
check('ctx GeneralizedTime',       cl({ cls:2, tag:1, origChildType:'GeneralizedTime', children:[], rawValue:[0x32] }) === 'gtime');
check('UNIVERSAL UTCTime',         cl({ cls:0, tag:23, children:[], rawValue:[0x32] }) === 'utctime');
check('Unix seconds INTEGER',      cl({ cls:2, tag:0, origChildType:'INTEGER', fieldName:'seconds', displayValue:'2025-12-17 09:53:26Z  (1765965206, 0x...)', children:[], rawValue:[0x69] }) === 'unixtime');
check('IPv4 iPBinaryAddress',      cl({ cls:2, tag:5, origChildType:'IPAddress', fieldName:'iPBinaryAddress', children:[], rawValue:[10,0,0,1] }) === 'ipv4');
check('IPv6 iPBinaryAddress',      cl({ cls:2, tag:6, fieldName:'iPBinaryAddress', children:[], rawValue:new Array(16).fill(0) }) === 'ipv6');
check('SEQUENCE (Kinder) → null',  cl({ cls:0, tag:16, children:[{}], rawValue:[] }) === null);
check('UNIVERSAL INTEGER → int',   cl({ cls:0, tag:2, children:[], rawValue:[0x05], displayValue:'5,  0x05' }) === 'int');
check('ctx INTEGER → int',         cl({ cls:2, tag:3, origChildType:'INTEGER', children:[], rawValue:[0x05], displayValue:'5,  0x05' }) === 'int');
check('ENUMERATED → enum',         cl({ cls:0, tag:10, children:[], rawValue:[0x01] }) === 'enum');
check('BOOLEAN → bool',            cl({ cls:0, tag:1, children:[], rawValue:[0xff] }) === 'bool');
check('PrintableString → string',  cl({ cls:0, tag:19, children:[], rawValue:B.asciiToBytes('ABC'), displayValue:'ABC' }) === 'string');
check('ctx UTF8String → string',   cl({ cls:2, tag:4, origChildType:'UTF8String', children:[], rawValue:[0x4d], displayValue:'M' }) === 'string');
check('OID (dekodiert) → hex',     cl({ cls:0, tag:6, children:[], rawValue:[0x2b,0x06], displayValue:'1.3.6' }) === 'hex');
check('NULL (kein Wert) → null',   cl({ cls:0, tag:5, children:[], rawValue:[] }) === null);
check('LIID → string',             cl({ cls:2, tag:1, origChildType:'LawfulInterceptionIdentifier', children:[], rawValue:B.asciiToBytes('DE-LIID-001'), displayValue:'DE-LIID-001' }) === 'string');

// ── 6c. collectFields: Struktur-Reihenfolge + Labels ────────────────────────────
console.log('\ncollectFields (Reihenfolge/Labels):');
const structTree = [{ cls:0, cons:1, tag:16, children:[
  { cls:0, cons:0, tag:24, fieldName:'timeStamp', typeName:'GeneralizedTime', tagLabel:'GeneralizedTime', origChildType:'GeneralizedTime', children:[], rawValue:B.asciiToBytes('20240101120000Z') },
  { cls:2, cons:0, tag:1, fieldName:'liid', typeName:'LawfulInterceptionIdentifier', tagLabel:'[1]', origChildType:'LawfulInterceptionIdentifier', children:[], rawValue:B.asciiToBytes('AB'), displayValue:'AB' },
  { cls:2, cons:0, tag:5, fieldName:'iPBinaryAddress', typeName:'IPAddress', tagLabel:'[5]', origChildType:'IPAddress', children:[], rawValue:[10,0,0,1] },
]}];
const cf = B.collectFields(structTree);
check('Reihenfolge = Baumreihenfolge', cf.map(f=>f.name).join(',') === 'timeStamp,liid,iPBinaryAddress', cf.map(f=>f.name).join(','));
check('order fortlaufend 0,1,2',       cf.map(f=>f.order).join(',') === '0,1,2');
check('tagLabel mitgeliefert',          cf[0].tagLabel === 'GeneralizedTime');
check('typeName mitgeliefert',          cf[1].typeName === 'LawfulInterceptionIdentifier');
// editValue: aktueller Wert, wieder-eingebbar
check('editValue LIID = Text',          cf[1].editValue === 'AB');
check('editValue IP = 10.0.0.1',        cf[2].editValue === '10.0.0.1');
check('editValue Zeit leer (Delta)',    cf[0].editValue === '');

// ── 6d. nodeEditValue round-trip mit encodeValueForKind ────────────────────────
console.log('\nnodeEditValue ↔ encodeValueForKind:');
const rt = (kind, rawValue, extra={}) => {
  const node = { rawValue, children: [], ...extra };
  const ev = B.nodeEditValue(node, kind);
  const enc = B.encodeValueForKind(kind, ev);
  return { ev, bytes: enc.bytes, err: enc.error };
};
let r;
r = rt('ipv4', [127,0,0,1]);      check('ipv4 127.0.0.1 round-trip', r.ev === '127.0.0.1' && hex(r.bytes) === '7f 00 00 01');
r = rt('ipv6', [0x20,0x01,0x0d,0xb8,0,0,0,0,0,0,0,0,0,0,0,1]); check('ipv6 round-trip', hex(r.bytes) === '20 01 0d b8 00 00 00 00 00 00 00 00 00 00 00 01');
r = rt('int',  [0x00,0x80]);      check('int 128 round-trip', r.ev === '128' && hex(r.bytes) === '00 80');
r = rt('int',  [0xff]);           check('int -1 round-trip', r.ev === '-1' && hex(r.bytes) === 'ff');
r = rt('bool', [0xff]);           check('bool TRUE round-trip', r.ev === 'TRUE' && hex(r.bytes) === 'ff');
r = rt('hex',  [0x30,0x31,0x32]); check('hex round-trip', r.ev === '30 31 32' && hex(r.bytes) === '30 31 32');
r = rt('string', B.asciiToBytes('DE-LIID-9')); check('string round-trip', r.ev === 'DE-LIID-9' && B.bytesToAscii(r.bytes) === 'DE-LIID-9');
check('utf8Decode Umlaut', B.utf8Decode([0x4d,0xc3,0xbc,0x6c,0x6c,0x65,0x72]) === 'Müller');

// ── 6b. encodeValueForKind ──────────────────────────────────────────────────────
console.log('\nencodeValueForKind:');
const ev = (k, v) => B.encodeValueForKind(k, v);
check('int dezimal',   hex(ev('int','42').bytes) === '2a');
check('int hex',       hex(ev('int','0x80').bytes) === '00 80');
check('int negativ',   hex(ev('int','-1').bytes) === 'ff');
check('int Müll→Fehler', !!ev('int','abc').error);
check('enum Zahl',     hex(ev('enum','1').bytes) === '01');
check('enum negativ→Fehler', !!ev('enum','-1').error);
check('bool TRUE',     hex(ev('bool','TRUE').bytes) === 'ff');
check('bool 0',        hex(ev('bool','0').bytes) === '00');
check('string UTF8',   hex(ev('string','Müller').bytes) === '4d c3 bc 6c 6c 65 72');
check('hex Paare',     hex(ev('hex','30 31 32').bytes) === '30 31 32');
check('hex ungerade→Fehler', !!ev('hex','303').error);
check('ipv4',          hex(ev('ipv4','192.168.1.1').bytes) === 'c0 a8 01 01');
check('ipv4 zu lang→Fehler', !!ev('ipv4','2001:db8::1').error);

// ── 7. End-to-End: Baum → applyToTree → serializeNode → unabhängig dekodieren ──
console.log('\nEnd-to-End (Baum → Batch → Serialize → Decode):');
function buildTree() {
  return [{
    cls:0, cons:1, tag:16, children:[
      { cls:0, cons:0, tag:24, origChildType:'GeneralizedTime', fieldName:'timeStamp',
        children:[], rawValue: B.asciiToBytes('20240101120000Z') },
      { cls:2, cons:0, tag:5, origChildType:'IPAddress', fieldName:'iPBinaryAddress',
        children:[], rawValue:[10,0,0,1] },
      { cls:0, cons:0, tag:2, fieldName:'count', children:[], rawValue:[0x05] },   // Sibling, bleibt unverändert
    ]
  }];
}

// collectFields sieht beide Felder
const fields = B.collectFields(buildTree());
check('collectFields findet timeStamp/gtime', fields.some(f => f.name==='timeStamp' && f.kind==='gtime'));
check('collectFields findet iPBinaryAddress/ipv4', fields.some(f => f.name==='iPBinaryAddress' && f.kind==='ipv4'));

// Zeitstempel verschieben
let tree = buildTree();
let changed = B.applyToTree(tree, { name:'timeStamp', kind:'gtime', deltaMs: 5*D+4*H+10*MIN });
check('applyToTree: 1 Zeit-Knoten geändert', changed === 1, `changed=${changed}`);
let seq = decodeSeqChildren(serializeNode(tree[0]));
check('Zeit im Output = 20240106161000Z', Buffer.from(seq[0].value).toString('ascii') === '20240106161000Z',
      Buffer.from(seq[0].value).toString('ascii'));
check('IP-Sibling unverändert (10.0.0.1)', hex(seq[1].value) === '0a 00 00 01');
check('INTEGER-Sibling unverändert (05)', hex(seq[2].value) === '05');

// IP fest setzen (setBytes)
tree = buildTree();
changed = B.applyToTree(tree, { name:'iPBinaryAddress', kind:'ipv4', setBytes:[192,168,1,1] });
check('applyToTree: 1 IP-Knoten geändert', changed === 1, `changed=${changed}`);
seq = decodeSeqChildren(serializeNode(tree[0]));
check('IP im Output = 192.168.1.1', hex(seq[1].value) === 'c0 a8 01 01');
check('Zeit-Sibling unverändert', Buffer.from(seq[0].value).toString('ascii') === '20240101120000Z');

// Feld nicht vorhanden → 0 Änderungen (Datei würde übersprungen)
tree = buildTree();
changed = B.applyToTree(tree, { name:'nichtDa', kind:'gtime', deltaMs: 1000 });
check('unbekanntes Feld → 0 Änderungen (skip)', changed === 0);

// IP mit falscher Bytelänge (IPv6 in IPv4-Feld) → nicht angewandt
tree = buildTree();
changed = B.applyToTree(tree, { name:'iPBinaryAddress', kind:'ipv4', setBytes:new Array(16).fill(1) });
check('IP mit falscher Länge → nicht angewandt', changed === 0);

// INTEGER-Feld auf festen Wert setzen
tree = buildTree();
changed = B.applyToTree(tree, { name:'count', kind:'int', setBytes: B.encodeValueForKind('int','0x2a').bytes });
seq = decodeSeqChildren(serializeNode(tree[0]));
check('INTEGER count → 0x2a', changed === 1 && hex(seq[2].value) === '2a');

// ── 8. Mehrere Regeln gleichzeitig (applyRules) ─────────────────────────────────
console.log('\napplyRules (mehrere Felder auf einmal):');
tree = buildTree();
const sels = [
  { name:'timeStamp',       kind:'gtime', deltaMs: 1*D },
  { name:'iPBinaryAddress', kind:'ipv4',  setBytes:[8,8,8,8] },
  { name:'count',           kind:'int',   setBytes: B.encodeValueForKind('int','99').bytes },
];
const rr = B.applyRules(tree, sels);
check('applyRules total = 3',      rr.total === 3, `total=${rr.total}`);
check('applyRules perRule = 1,1,1', JSON.stringify(rr.perRule) === '[1,1,1]');
seq = decodeSeqChildren(serializeNode(tree[0]));
check('Regel1 Zeit +1T',  Buffer.from(seq[0].value).toString('ascii') === '20240102120000Z');
check('Regel2 IP 8.8.8.8', hex(seq[1].value) === '08 08 08 08');
check('Regel3 count = 99', hex(seq[2].value) === '63');

// Datei, in der nur ein Teil der Regeln greift
tree = [{ cls:0, cons:1, tag:16, children:[
  { cls:0, cons:0, tag:2, fieldName:'count', children:[], rawValue:[0x01] },  // nur 'count' vorhanden
]}];
const rr2 = B.applyRules(tree, sels);
check('Teiltreffer: total = 1',        rr2.total === 1, `total=${rr2.total}`);
check('Teiltreffer: perRule = 0,0,1',  JSON.stringify(rr2.perRule) === '[0,0,1]');

// ── Summary ─────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
