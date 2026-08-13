'use strict';
/**
 * Batch-Bearbeitung mehrerer BER-Dateien.
 *
 * Dieses Modul enthält NUR reine Funktionen (kein fs / kein electron), damit sie
 * — genau wie renderer.js — vom Testharness per Quelltext extrahiert und in einer
 * VM-Sandbox ausgeführt werden können. Die eigentliche Datei-Ein-/Ausgabe und der
 * Aufruf von parseBer/serializeNodes bleiben in main.js.
 *
 * Unterstützte Feldarten (kind):
 *   'gtime'    — GeneralizedTime  (Zeichenkette YYYYMMDDHHmmSS[.frac][Z])
 *   'utctime'  — UTCTime          (Zeichenkette YYMMDDHHmmSS[Z])
 *   'unixtime' — INTEGER als Unix-Sekunden (z.B. Feld „seconds")
 *   'ipv4'     — 4-Byte iPBinaryAddress / IPv4Address
 *   'ipv6'     — 16-Byte iPBinaryAddress / IPv6Address
 *
 * Zeitstempel werden um ein festes Delta (in Millisekunden) verschoben, IP-Felder
 * auf einen festen neuen Wert gesetzt.
 */

// ── Byte-Hilfen (ohne Buffer, damit im Test-Sandbox lauffähig) ────────────────
function bytesToAscii(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b & 0xff);
  return s;
}
function asciiToBytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
  return out;
}

// BER-INTEGER-Kodierung (minimal, signed) — identisch zu encodeBerInteger in renderer.js.
function encodeBerIntegerBatch(v) {
  if (v === 0n) return [0x00];
  const bytes = [];
  if (v > 0n) {
    let n = v;
    while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
    if (bytes[0] & 0x80) bytes.unshift(0x00);
  } else {
    let len = 1;
    while (v < -(1n << BigInt(8 * len - 1))) len++;
    let mod = (1n << BigInt(8 * len)) + v;
    for (let i = len - 1; i >= 0; i--) { bytes[i] = Number(mod & 0xffn); mod >>= 8n; }
  }
  return bytes;
}

// ── IP-Zeichenkette → Bytes (Spiegel von parseIpToBytes in renderer.js) ───────
// Akzeptiert IPv4 in Punktnotation und IPv6 in Doppelpunktnotation (auch „::").
// Gibt ein Byte-Array oder null zurück.
function parseIpToBytesBatch(s) {
  s = String(s).trim();
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const b = m.slice(1).map(Number);
    return b.every(x => x >= 0 && x <= 255) ? b : null;
  }
  if (s.includes(':')) {
    const parts = s.split('::');
    if (parts.length > 2) return null;
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts.length === 2 ? (parts[1] ? parts[1].split(':') : []) : null;
    let groups;
    if (tail === null) {
      groups = head;
      if (groups.length !== 8) return null;
    } else {
      const fill = 8 - head.length - tail.length;
      if (fill < 1) return null;
      groups = [...head, ...Array(fill).fill('0'), ...tail];
    }
    const bytes = [];
    for (const grp of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(grp)) return null;
      const v = parseInt(grp, 16);
      bytes.push(v >> 8, v & 0xff);
    }
    return bytes.length === 16 ? bytes : null;
  }
  return null;
}

// ── Zeitstempel-Verschiebung ──────────────────────────────────────────────────

// GeneralizedTime „YYYYMMDDHHmmSS[.frac][Z]" um deltaMs verschieben.
// Bruchteil-Sekunden und ein evtl. vorhandenes „Z" bleiben erhalten.
// Gibt die neue Zeichenkette oder null (Parse-Fehler) zurück.
function shiftGeneralizedTimeStr(s, deltaMs) {
  const clean = String(s).trim();
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(\.\d+)?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sc, frac, tz] = m;
  const base = Date.UTC(+y, +mo - 1, +d, +h, +mi, sc ? +sc : 0);
  if (isNaN(base)) return null;
  const nd = new Date(base + deltaMs);
  const p2 = n => String(n).padStart(2, '0');
  const yy = String(nd.getUTCFullYear()).padStart(4, '0');
  const stamp = `${yy}${p2(nd.getUTCMonth() + 1)}${p2(nd.getUTCDate())}` +
                `${p2(nd.getUTCHours())}${p2(nd.getUTCMinutes())}${p2(nd.getUTCSeconds())}`;
  return stamp + (frac || '') + (tz || '');
}

// UTCTime „YYMMDDHHmmSS[Z]" um deltaMs verschieben (2-stelliges Jahr).
// Jahrhundert-Regel wie RFC 5280: 00–49 → 20xx, 50–99 → 19xx.
function shiftUtcTimeStr(s, deltaMs) {
  const clean = String(s).trim();
  const m = clean.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, yy, mo, d, h, mi, sc, tz] = m;
  const year = (+yy) < 50 ? 2000 + (+yy) : 1900 + (+yy);
  const base = Date.UTC(year, +mo - 1, +d, +h, +mi, sc ? +sc : 0);
  if (isNaN(base)) return null;
  const nd = new Date(base + deltaMs);
  const p2 = n => String(n).padStart(2, '0');
  const y2 = p2(nd.getUTCFullYear() % 100);
  return `${y2}${p2(nd.getUTCMonth() + 1)}${p2(nd.getUTCDate())}` +
         `${p2(nd.getUTCHours())}${p2(nd.getUTCMinutes())}${p2(nd.getUTCSeconds())}` + (tz || '');
}

// Unix-Sekunden (signed BER-INTEGER, big-endian) um deltaSeconds verschieben.
function shiftUnixSecondsBytes(bytes, deltaSeconds) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b & 0xff);
  if (bytes.length && (bytes[0] & 0x80)) v -= (1n << BigInt(bytes.length * 8));
  v += BigInt(deltaSeconds);
  return encodeBerIntegerBatch(v);
}

// Delta-Objekt {sign:+1|-1, days, hours, minutes, seconds} → Millisekunden.
function deltaToMs(delta) {
  const sign = delta.sign < 0 ? -1 : 1;
  const d = Number(delta.days || 0);
  const h = Number(delta.hours || 0);
  const mi = Number(delta.minutes || 0);
  const se = Number(delta.seconds || 0);
  return sign * ((((d * 24 + h) * 60 + mi) * 60 + se) * 1000);
}

// ── Knoten-Klassifikation ─────────────────────────────────────────────────────
// Bestimmt, ob ein Blatt-Knoten ein editierbares Zeit- oder IP-Feld ist.
// Gibt { kind, name } oder null zurück. Spiegelt die Erkennung aus main.js/renderer.js.
function classifyEditableNode(node) {
  if (node.children && node.children.length) return null;
  const name = node.fieldName || node.typeName || node.tagLabel || '?';
  const oct = node.origChildType;

  // GeneralizedTime (UNIVERSAL 24 oder kontext-getaggt)
  if ((node.cls === 0 && node.tag === 24) || (node.cls === 2 && oct === 'GeneralizedTime'))
    return { kind: 'gtime', name };
  // UTCTime (UNIVERSAL 23 oder kontext-getaggt)
  if ((node.cls === 0 && node.tag === 23) || (node.cls === 2 && oct === 'UTCTime'))
    return { kind: 'utctime', name };
  // Unix-Zeitstempel: kontext-getaggtes INTEGER, das als Datum angezeigt wird
  // (die App macht das für das Feld „seconds").
  if (node.cls === 2 && oct === 'INTEGER') {
    const dv = node.displayValue == null ? '' : String(node.displayValue);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(dv) || node.fieldName === 'seconds')
      return { kind: 'unixtime', name };
  }

  // IP-Adressen (Spiegel von isIpField)
  const raw = node.rawValue;
  if (raw) {
    const fn = node.fieldName || '';
    if (raw.length === 4 && (
        /[iI][pP]v?4[Aa]ddress|[iI][pP][Bb]inary[Aa]ddress|[Dd]elivery[Ii][Pp][Aa]ddress/.test(fn) ||
        oct === 'IPv4Address' || oct === 'IPAddress'))
      return { kind: 'ipv4', name };
    if (raw.length === 16 && (
        /[iI][pP]v?6[Aa]ddress|[iI][pP][Bb]inary[Aa]ddress/.test(fn) ||
        oct === 'IPv6Address' || oct === 'IPAddress'))
      return { kind: 'ipv6', name };
  }
  return null;
}

const TIME_KINDS = new Set(['gtime', 'utctime', 'unixtime']);

// Alle editierbaren Felder eines Knotenbaums einsammeln, gruppiert nach (name, kind).
// Rückgabe: [{ name, kind, count, sample }]
function collectFields(nodes) {
  const map = new Map();
  const walk = (arr) => {
    for (const node of arr) {
      const c = classifyEditableNode(node);
      if (c) {
        const key = c.name + '|' + c.kind;
        if (!map.has(key)) {
          const sample = node.displayValue != null ? String(node.displayValue) : bytesToAscii(node.rawValue || []);
          map.set(key, { name: c.name, kind: c.kind, count: 0, sample });
        }
        map.get(key).count++;
      }
      if (node.children && node.children.length) walk(node.children);
    }
  };
  walk(nodes);
  return Array.from(map.values());
}

// Auswahl auf einen Knotenbaum anwenden (mutiert die Knoten).
// sel = { name, kind, deltaMs?, ipBytes? }
// Rückgabe: Anzahl geänderter Knoten.
function applyToTree(nodes, sel) {
  let changed = 0;
  const walk = (arr) => {
    for (const node of arr) {
      const c = classifyEditableNode(node);
      if (c && c.name === sel.name && c.kind === sel.kind) {
        if (sel.kind === 'gtime') {
          const ns = shiftGeneralizedTimeStr(bytesToAscii(node.rawValue || []), sel.deltaMs);
          if (ns !== null) { node.rawValue = asciiToBytes(ns); node.displayValue = ns; changed++; }
        } else if (sel.kind === 'utctime') {
          const ns = shiftUtcTimeStr(bytesToAscii(node.rawValue || []), sel.deltaMs);
          if (ns !== null) { node.rawValue = asciiToBytes(ns); node.displayValue = ns; changed++; }
        } else if (sel.kind === 'unixtime') {
          node.rawValue = shiftUnixSecondsBytes(node.rawValue || [], Math.round(sel.deltaMs / 1000));
          changed++;
        } else if (sel.kind === 'ipv4' || sel.kind === 'ipv6') {
          if (sel.ipBytes && node.rawValue && sel.ipBytes.length === node.rawValue.length) {
            node.rawValue = sel.ipBytes.slice();
            changed++;
          }
        }
      }
      if (node.children && node.children.length) walk(node.children);
    }
  };
  walk(nodes);
  return changed;
}

// In Node (main.js) exportieren; im Browser/Sandbox ignoriert.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    bytesToAscii, asciiToBytes, encodeBerIntegerBatch, parseIpToBytesBatch,
    shiftGeneralizedTimeStr, shiftUtcTimeStr, shiftUnixSecondsBytes, deltaToMs,
    classifyEditableNode, collectFields, applyToTree, TIME_KINDS,
  };
}
