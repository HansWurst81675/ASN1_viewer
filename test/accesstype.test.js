#!/usr/bin/env node
/**
 * Schema-resolution and access-type tests.
 *
 * Covers two things that belong together:
 *
 *  1. src/main.js  — "SEQUENCE OF <Type>" fields must resolve their element type,
 *     so that e.g. LocationInfo.additionalCellIDs → CellInformation → rANCGI →
 *     nCGI → pLMNID / nRCellID gets real field names instead of bare [n] tags.
 *
 *  2. src/renderer.js — detectAccessType() must report 5G NSA for an EPS/MME
 *     record that carries an NR cell alongside the E-UTRA anchor (EN-DC), and
 *     plain LTE for the same record without it.
 *
 * Both are exercised against the *shipping* source (loaded/extracted by text),
 * so the tests cannot silently drift from the code.
 *
 * Run with:  node test/accesstype.test.js
 * Exit code 0 = all green, 1 = at least one failure.
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const os   = require('os');

// ── Test fixtures ─────────────────────────────────────────────────────────────
// ETSI TS 102 232-1 PS-PDU, payload = 3GPP TS 33.128 r17 IRIPayload.
//  · 5G SA  : IRIEvent = registration [1]  (AMFRegistration) with nRLocation
//  · 5G NSA : IRIEvent = mMEAttach   [87] (MMEAttach) with eUTRALocation
//             plus the EN-DC NR cell in LocationInfo.additionalCellIDs
//  · LTE    : same MMEAttach without additionalCellIDs
const FIX = {
  sa:  '308201e5a176800704000202050124810d3132333435363738393030303182024445a317a01580053439303539810c3137322e32382e32392e3339840100a70b80046aa02693810303468588010189103137322e32382e32382e33392d414d468a1a65616d6662657233312e6265722e656173742e64656661756c74a2820169a082016530820161800104a2820157938201533082014f81050413110a03a281e7a181e4810102820101a30ca10a30088101018203000001a411810f323632303331323334353637383930a610810e3335313337393837363534333231a70f810d34393137363330303030303030a81a81033236328202303383013084020101850102860500f55e263ca966a164a162a260a10fa10981033236328202303382028d74a213a1098103323632820230338206041c1ccc0710830100841332303236303930383135313533312e3231345aa820a11a81074e3531303434378208453030363337313983055747533834820200f0ab11300fa10981033236328202303382028d74920101a35c3015a110840e33353133373237373636373732338201013016a111820f3236323033313233343536373839308201023015a110840e33353133373938373635343332318201023014a10f860d34393137363330303030303030820102860100',
  nsa: '308201eaa176800704000202050124810d3132333435363738393030303182024445a317a01580053439303539810c3137322e32382e32392e3339840100a70b80046aa02693810303468588010189103137322e32382e32382e33392d4d4d458a1a656d6d6562657233312e6265722e656173742e64656661756c74a282016ea082016a30820166800104a282015c938201583082015481050413110a03a281ecbf5781e8810102820101830f323632303331323334353637383930840e3335313337393837363534333231850d34393137363330303030303030a616810332363282023033830201018401028504f55e263ca78184a18181a161a15fa10fa10981033236328202303382028d74a212a1098103323632820230338205041ccc0710830100841332303236303930383135313533312e3231345aa820a11a81074e3531303434378208453030363337313983055747533834820200f0840102a6193017a115a213a1098103323632820230338206041c1ccc0710a811300fa10981033236328202303382028d74a35c3015a110840e33353133373237373636373732338201013016a111820f3236323033313233343536373839308201023015a110840e33353133373938373635343332318201023014a10f860d34393137363330303030303030820102860100',
  lte: '308201cda176800704000202050124810d3132333435363738393030303182024445a317a01580053439303539810c3137322e32382e32392e3339840100a70b80046aa02693810303468588010189103137322e32382e32382e33392d4d4d458a1a656d6d6562657233312e6265722e656173742e64656661756c74a2820151a082014d30820149800104a282013f9382013b3082013781050413110a03a281cfbf5781cb810102820101830f323632303331323334353637383930840e3335313337393837363534333231850d34393137363330303030303030a616810332363282023033830201018401028504f55e263ca768a166a161a15fa10fa10981033236328202303382028d74a212a1098103323632820230338205041ccc0710830100841332303236303930383135313533312e3231345aa820a11a81074e3531303434378208453030363337313983055747533834820200f0840102a811300fa10981033236328202303382028d74a35c3015a110840e33353133373237373636373732338201013016a111820f3236323033313233343536373839308201023015a110840e33353133373938373635343332318201023014a10f860d34393137363330303030303030820102860100',
};

// ── Load src/main.js in a sandbox with Electron stubbed out ───────────────────
function loadMain() {
  const mainPath = path.join(__dirname, '..', 'src', 'main.js');
  const src = fs.readFileSync(mainPath, 'utf8');
  const noop = () => {};
  const electronStub = {
    app: {
      commandLine: { appendSwitch: noop },
      getPath: () => os.tmpdir(),
      getAppPath: () => path.join(__dirname, '..'),
      getVersion: () => '0.0.0-test',
      whenReady: () => ({ then: () => ({ catch: noop }) }),
      on: noop, quit: noop, isPackaged: false,
    },
    BrowserWindow: class { static getAllWindows() { return []; } },
    ipcMain: { handle: noop, on: noop },
    dialog: { showOpenDialog: noop, showSaveDialog: noop, showMessageBox: noop },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: noop },
  };
  const sandbox = {
    require: id => (id === 'electron' ? electronStub : require(id.startsWith('.')
      ? path.join(path.dirname(mainPath), id) : id)),
    module: { exports: {} }, exports: {},
    __dirname: path.dirname(mainPath), __filename: mainPath,
    console, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, URL,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: mainPath });
  return sandbox;
}

/** Extract a top-level `function name(...) { ... }` from source by brace-matching. */
function extractFunction(src, name) {
  const sig = 'function ' + name + '(';
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found in source`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function loadDetectAccessType() {
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const box = {};
  vm.createContext(box);
  vm.runInContext(extractFunction(rendererSrc, 'detectAccessType') + '\nthis.fn = detectAccessType;', box);
  return box.fn;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function findNode(nodes, pred) {
  for (const n of nodes) {
    if (pred(n)) return n;
    const r = findNode(n.children || [], pred);
    if (r) return r;
  }
  return null;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else      { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}

// ── Run ───────────────────────────────────────────────────────────────────────
const main = loadMain();
const asn1Dir = main.getAsn1Dir();
if (!asn1Dir) { console.error('asn1_patched directory not found — cannot run'); process.exit(1); }
const tagMaps = main.buildTagMaps(asn1Dir);
const detectAccessType = loadDetectAccessType();

const parse = hex => {
  const buf = Buffer.from(hex, 'hex');
  return main.parseBer(buf, 0, main.detectTypeHint(buf), tagMaps);
};

console.log('\nSchema: SEQUENCE OF element types');
check('LocationInfo[6] → SEQUENCE OF CellInformation',
  tagMaps.LocationInfo && tagMaps.LocationInfo[6] && tagMaps.LocationInfo[6][1] === 'SEQUENCE OF CellInformation',
  JSON.stringify(tagMaps.LocationInfo && tagMaps.LocationInfo[6]));
check('IRIPayload[3] → SEQUENCE OF IRITargetIdentifier',
  tagMaps.IRIPayload && tagMaps.IRIPayload[3] && tagMaps.IRIPayload[3][1] === 'SEQUENCE OF IRITargetIdentifier',
  JSON.stringify(tagMaps.IRIPayload && tagMaps.IRIPayload[3]));

console.log('\nParsing: EN-DC secondary cell resolves to named fields');
const nsaNodes = parse(FIX.nsa);
for (const [field, type] of [['additionalCellIDs', 'SEQUENCE OF CellInformation'],
                             ['rANCGI', 'RANCGI'], ['nCGI', 'NCGI'],
                             ['pLMNID', 'PLMNID'], ['nRCellID', 'NRCellID']]) {
  const n = findNode(nsaNodes, x => x.fieldName === field);
  check(`${field} resolved (type ${type})`, !!n && n.typeName === type,
    n ? `typeName=${n.typeName}` : 'node not found');
}
const nrCell = findNode(nsaNodes, x => x.fieldName === 'nRCellID');
check('nRCellID is the 36-bit NR cell identity 0x1C1CCC071',
  !!nrCell && Buffer.from(nrCell.rawValue).toString('hex') === '041c1ccc0710',
  nrCell ? Buffer.from(nrCell.rawValue).toString('hex') : '—');

console.log('\nParsing: MMEAttach event resolves');
const attach = findNode(nsaNodes, x => x.fieldName === 'mMEAttach' || x.typeName === 'MMEAttach');
check('IRIEvent [87] → mMEAttach / MMEAttach', !!attach,
  attach ? '' : 'not found');

console.log('\nAccess-type detection');
check("5G SA record → '5G SA'",  (detectAccessType(parse(FIX.sa))  || {}).label === '5G SA',
  JSON.stringify(detectAccessType(parse(FIX.sa))));
check("EN-DC record → '5G NSA'", (detectAccessType(nsaNodes)        || {}).label === '5G NSA',
  JSON.stringify(detectAccessType(nsaNodes)));
check("EPS record without NR cell → 'LTE'", (detectAccessType(parse(FIX.lte)) || {}).label === 'LTE',
  JSON.stringify(detectAccessType(parse(FIX.lte))));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
