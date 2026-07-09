#!/usr/bin/env node
/**
 * Round-trip / encoding tests for the BER editor.
 *
 * These tests extract the *real* pure functions straight out of src/renderer.js
 * (by source text, so they can never silently drift from the shipping code) and
 * exercise the encode → decode path for every value type the editor can save.
 *
 * Run with:  npm test   (or)   node test/roundtrip.test.js
 * Exit code 0 = all green, 1 = at least one failure.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

/** Extract a top-level `function name(...) { ... }` from source by brace-matching. */
function extractFunction(src, name) {
  const sig = 'function ' + name + '(';
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found in source`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

/** Extract a top-level `const NAME = new Set([...]);` declaration. */
function extractConstSet(src, name) {
  const re = new RegExp('const ' + name + '\\s*=\\s*new Set\\(\\[[\\s\\S]*?\\]\\);');
  const m = src.match(re);
  if (!m) throw new Error(`const ${name} not found in source`);
  return m[0];
}

// Build a sandbox that contains the real functions from renderer.js.
const sandbox = { rendererEnumMaps: {}, TextEncoder, TextDecoder, String, BigInt, Number, Array, console };
vm.createContext(sandbox);
[
  extractConstSet(rendererSrc, 'STRING_TYPES'),
  extractFunction(rendererSrc, 'encodeLength'),
  extractFunction(rendererSrc, 'encodeBerInteger'),
  extractFunction(rendererSrc, 'berIntegerToDisplay'),
  extractFunction(rendererSrc, 'serializeNode'),
  extractFunction(rendererSrc, 'isoToGeneralizedTime'),
  extractFunction(rendererSrc, 'isoToUtcTime'),
  extractFunction(rendererSrc, 'isTextPrimitive'),
].forEach(code => vm.runInContext(code, sandbox));

const { encodeBerInteger, encodeLength, serializeNode, isoToUtcTime, isoToGeneralizedTime, isTextPrimitive } = sandbox;

// ── tiny test harness ─────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
function decodeSignedBer(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  if (bytes.length && (bytes[0] & 0x80)) v -= (1n << BigInt(bytes.length * 8));
  return v;
}
const hex = a => a.map(b => b.toString(16).padStart(2, '0')).join(' ');

// ── 1. INTEGER / ENUMERATED round-trip (full BigInt precision) ──────────────────
console.log('\nINTEGER encode → decode round-trip:');
for (const v of [0n, 1n, 127n, 128n, 255n, 256n, -1n, -128n, -129n, -256n,
                 1765965206n, 4294967295n,
                 9223372036854775807n, -9223372036854775808n,
                 123456789012345678901234567890n]) {
  const enc = encodeBerInteger(v);
  const back = decodeSignedBer(enc);
  check(`${v} → ${hex(enc)}`, back === v, `decoded ${back}`);
}
// minimal-length property
check('128 uses a leading 0x00 sign byte', hex(encodeBerInteger(128n)) === '00 80');
check('-129 encodes as ff 7f', hex(encodeBerInteger(-129n)) === 'ff 7f');
check('post-2038 timestamp gets 00 sign byte', hex(encodeBerInteger(4294967295n)) === '00 ff ff ff ff');

// ── 2. Length encoding ──────────────────────────────────────────────────────────
console.log('\nBER length encoding:');
check('len 0   → 00',        hex(encodeLength(0))   === '00');
check('len 127 → 7f',        hex(encodeLength(127)) === '7f');
check('len 128 → 81 80',     hex(encodeLength(128)) === '81 80');
check('len 300 → 82 01 2c',  hex(encodeLength(300)) === '82 01 2c');

// ── 3. serializeNode rebuilds correct TLV + recomputed lengths ──────────────────
console.log('\nserializeNode TLV structure:');
const leaf = { cls: 2, cons: 0, tag: 1, rawValue: [0x01, 0x02, 0x03], children: [] };
check('primitive leaf [1] → 81 03 01 02 03', hex(serializeNode(leaf)) === '81 03 01 02 03');
const parent = {
  cls: 0, cons: 1, tag: 16, children: [
    { cls: 2, cons: 0, tag: 0, rawValue: [0xaa], children: [] },
    { cls: 2, cons: 0, tag: 1, rawValue: [0xbb, 0xcc], children: [] },
  ]
};
// SEQUENCE (30) len 7 { 80 01 aa , 81 02 bb cc }
check('SEQUENCE recomputes length', hex(serializeNode(parent)) === '30 07 80 01 aa 81 02 bb cc');
const optional = { cls: 2, cons: 0, tag: 5, rawValue: [0xff], children: [], _deleted: true };
check('_deleted node emits nothing', serializeNode(optional).length === 0);

// ── 4. Date encoding: UTCTime (2-digit year) vs GeneralizedTime (4-digit year) ──
console.log('\nDate encoding:');
check('UTCTime 2-digit year',           isoToUtcTime('2026-04-23 09:44:01Z') === '260423094401Z');
check('UTCTime drops fractional secs',  isoToUtcTime('2026-04-23 09:44:01.608Z') === '260423094401Z');
check('UTCTime from 14-digit form',     isoToUtcTime('20260423094401Z') === '260423094401Z');
check('UTCTime rejects garbage',        isoToUtcTime('not a date') === null);
check('GeneralizedTime 4-digit year',   isoToGeneralizedTime('2026-04-23 09:44:01Z') === '20260423094401Z');
check('GeneralizedTime keeps fraction', isoToGeneralizedTime('2026-04-23 09:44:01.608Z') === '20260423094401.608Z');

// ── 5. isTextPrimitive: decoded-binary fields must NOT be text-editable ─────────
console.log('\nEdit-path classification (regression guard for save corruption):');
const T = (n) => isTextPrimitive(n) === true;
const H = (n) => isTextPrimitive(n) === false;
check('IPv4 → hex',                 H({ cls:2, tag:0, origChildType:'IPv4Address', rawValue:[192,168,0,1], displayValue:'192.168.0.1' }));
check('IPv4 all-printable → hex',   H({ cls:2, tag:0, origChildType:'IPv4Address', rawValue:[50,50,50,50], displayValue:'50.50.50.50' }));
check('OID → hex',                  H({ cls:0, tag:6, rawValue:[0x2b,0x06], displayValue:'1.3.6' }));
check('BIT STRING → hex',           H({ cls:0, tag:3, rawValue:[0x00,0xb8], displayValue:'10111000' }));
check('BCD MSISDN → hex',           H({ cls:2, tag:0, origChildType:'OCTET', rawValue:[0x94,0x71], displayValue:'+4917' }));
check('PLMN → hex',                 H({ cls:2, tag:0, origChildType:'OCTET', rawValue:[0x62,0xf2,0x10], displayValue:'MCC=262, MNC=01' }));
check('INTEGER → hex/int (not text)', H({ cls:0, tag:2, rawValue:[0x05], displayValue:'5,  0x05' }));
check('coordinate PrintableString → text', T({ cls:2, tag:0, origChildType:'PrintableString', rawValue:[0x2b,0x35,0x32], displayValue:'+52' }));
check('UTF8String non-ASCII → text', T({ cls:2, tag:0, origChildType:'UTF8String', rawValue:[0x4d,0xc3,0xbc], displayValue:'Müller' }));
check('plain ASCII OCTET text → text', T({ cls:2, tag:0, origChildType:'OCTET', rawValue:[0x68,0x69], displayValue:'hi' }));

// ── summary ─────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
