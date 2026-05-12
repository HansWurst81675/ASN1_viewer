# BER Viewer

Desktop-Anwendung zum Anzeigen und Bearbeiten von BER/ASN.1-Dateien, spezialisiert auf **ETSI LI PS-PDU** und **3GPP Lawful Intercept** Formate.

---

## Voraussetzungen

- **Node.js** ≥ 18 (inkl. npm)
- **ASN.1-Schema-Verzeichnis** `asn1_patched/` — muss im selben Ordner wie `package.json` liegen (31 `.asn`/`.asn1`-Dateien)

---

## Installation & Start

```bash
# Abhängigkeiten installieren (einmalig)
npm install

# Anwendung starten
npm start
```

---

## Build

### Windows Installer

```cmd
npm run build:win
```

→ `dist\BER Viewer Setup x.x.x.exe`  
Oder ohne Installation: `dist\win-unpacked\BER Viewer.exe`

### Linux AppImage (Ubuntu / Linux Mint)

```bash
# Node.js 20 LTS installieren (falls noch nicht vorhanden)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# System-Abhängigkeiten für Electron
sudo apt update
sudo apt install -y libasound2t64 libgtk-3-0t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libfuse2t64 libgbm-dev libnss3

# Build
npm install
npm run build:linux
```

→ `dist/BER Viewer-x.x.x.AppImage`

```bash
chmod +x "dist/BER Viewer-x.x.x.AppImage"
./"dist/BER Viewer-x.x.x.AppImage"

# Falls FUSE-Fehler:
./"dist/BER Viewer-x.x.x.AppImage" --no-sandbox
```

---

## Projektstruktur

```
ber_viewer_electron/
├── package.json
├── asn1_patched/          ← 31 ASN.1-Schemadateien (neben package.json!)
└── src/
    ├── main.js            ← Electron-Hauptprozess, BER-Parser, IPC
    ├── preload.js         ← IPC-Bridge zwischen Main und Renderer
    ├── renderer.js        ← UI, Tree-Rendering, Edit-Dialog, SMS-Decoder, SIP-Decoder
    ├── index.html         ← Toolbar, Suchfeld, Baumansicht
    └── style.css          ← Dark Theme
```

---

## Unterstützte Dateiformate

Der Viewer erkennt den Dateityp automatisch anhand der ersten BER-Bytes und der eingebetteten OID:

| Dateiformat | Erkennung | Beispiel-Dateiname |
|---|---|---|
| **5G PS-PDU** (TS 33.128) | `0x30` + OID `0.4.0.2.2.5.x` | `*.li_ps_pdu_5G.hi2` |
| **EPS PS-PDU** (HI2 r14/r15) | `0xa1` + OID `0.4.0.2.2.4.8.x` | `*.li_ps_pdu_Not5G.hi2` |
| **LI PS-PDU** (ETSI 102 232) | `0x30` + OID `0.4.0.2.2.5.x` | `*.li_ps_pdu.hi2` |
| **UmtsCS IRI** iRI-Begin | `0xa1` + OID `0.4.0.2.2.4.3.x` | `D2AE*`, `E2GG*` |
| **UmtsCS IRI** iRI-Continue | `0xa3` + OID `0.4.0.2.2.4.3.x` | `D2AE*` (Continue) |
| **UmtsCS IRI** iRI-Report | `0xa4` + OID `0.4.0.2.2.4.3.x` | `E2AG*` |
| **UmtsCS IRI** (wrapped) | `0xa0` | — |

---

## Bedienung

### Toolbar

| Schaltfläche | Tastenkürzel | Funktion |
|---|---|---|
| **Open** | `Ctrl+O` | Datei öffnen (auch per Drag & Drop) |
| **Expand** | — | Alle Knoten aufklappen |
| **Collapse** | — | Alle Knoten zuklappen |
| **Save As** | `Ctrl+S` | Als BER-Datei speichern (re-serialisiert) |
| **Export TXT** | — | Baum als Text exportieren (Format 1 oder 2) |
| **Suche** | — | Feldname oder Wert filtern |

### Navigation

- **Klick** auf einen Knoten → Details rechts (Decoded Value + Hex Dump)
- **Klick** auf `▶ / ▼` → Knoten auf-/zuklappen
- **Doppelklick** auf einen Blattwert → Wert bearbeiten (Text oder Hex)
- **Rechtsklick** → Kontextmenü

### Kontextmenü

| Eintrag | Beschreibung |
|---|---|
| ✏️ Bearbeiten | Wert direkt editieren |
| 📋 Wert kopieren | Decoded Value in Zwischenablage |
| 📋 Hex kopieren | Rohdaten als Hex-String |
| ⊞ Aufklappen | Teilbaum aufklappen |
| ⊟ Zuklappen | Teilbaum zuklappen |
| 📱 SMS dekodieren | SMS-PDU-Inhalt anzeigen (nur bei `content`-Feldern) |
| 📞 SIP dekodieren | SIP/VoIP-Nachricht anzeigen (bei `sIPContent` und automatisch erkannten SIP-Payloads) |

### Zuletzt geöffnete Dateien

`Datei → Zuletzt geöffnet` — beim Wechsel fragt der Viewer bei ungespeicherten Änderungen nach.

---

## SIP/VoIP-Decoder

Rechtsklick auf ein `sIPContent`-Feld oder jeden anderen Knoten mit erkanntem SIP-Inhalt → **📞 SIP dekodieren**.  
Alternativ: **Doppelklick** direkt auf den Knoten (SIP-Knoten werden im Baum mit einem `SIP`-Badge markiert).

### Automatische Erkennung

Der Decoder erkennt SIP-Payloads auf zwei Wegen:

1. **Feldname** — `sIPContent`, `sip-Content`, `sipContent`, `uRIorFQDN`, `sIPStartLine`, `SIPMessage`
2. **Content-Sniffing** — die ersten 20 Bytes beginnen mit einer bekannten SIP-Methode (`INVITE`, `BYE`, `ACK`, `CANCEL`, `OPTIONS`, `REGISTER`, `PRACK`, `UPDATE`, `NOTIFY`, `SUBSCRIBE`, `PUBLISH`, `INFO`, `REFER`, `MESSAGE`) oder mit `SIP/2.0` (Response)

### Dialog-Inhalt

| Bereich | Inhalt |
|---|---|
| **Request-/Status-Line** | Methode + Request-URI oder Statuscode + Reason |
| **Schlüsselfelder** | Von, An, Call-ID, P-Asserted-Identity, IMSI, IMEI, User-Agent, Via |
| **Alle SIP-Header** | Vollständige Tabelle; wichtige Header (From, To, Call-ID, P-Asserted-Identity, P-Mav-Extension-IMSI/IMEI, P-Called-Party-ID, Contact) grün hervorgehoben |
| **SDP** | Falls vorhanden: alle SDP-Zeilen (`v=`, `o=`, `c=`, `m=`, `a=` …) mit Typ-Beschriftung |

### Kopier-Funktionen

- **⧉-Button** neben jedem Wert → einzelnen Wert in Zwischenablage
- **Von / An / Call-ID kopieren** — Footer-Buttons für die wichtigsten Identitäten
- **Alle Header kopieren** — vollständige SIP-Nachricht als Text (Request-Line + alle Header, CRLF-getrennt)

---

## SMS-Decoder

Rechtsklick auf ein `content [4]`-Feld in `sMS-Contents` → **📱 SMS dekodieren**. Auch über den SIP-Dialog erreichbar wenn `Content-Type: application/vnd.3gpp.sms`.

**Dialog-Funktionen:** Tabelle mit Typ, Absender/Empfänger, Zeitstempel, PID, DCS, Text; roher PDU-Hex-Dump (erste 24 Bytes) zur Diagnose; **📥 PDU speichern** lädt die Roh-Bytes als `.bin` herunter; **Text kopieren** legt den dekodierten SMS-Text in die Zwischenablage.

**SMSC-Erkennung:** Scoring-Heuristik testet beide Varianten (mit/ohne SMSC-Präfix) und wählt die plausiblere — funktioniert für direkte BER-Knoten und für SIP-Body-SMS mit oder ohne SMSC-Präfix.

| Typ | Unterstützung |
|---|---|
| SMS-DELIVER | Absender, Zeitstempel, Text |
| SMS-SUBMIT | Empfänger, Text |
| SMS-STATUS-REPORT | Sendezeit, Zustellzeit, Statuscode |
| GSM 7-Bit | Standardzeichensatz (Deutsch, Englisch …) |
| 8-Bit (Latin-1) | Erweiterter Zeichensatz |
| UCS-2 | Unicode (Arabisch, Chinesisch …) |
| Multipart (UDH) | Teil- und Gesamtanzahl werden angezeigt |
| **SIP-Body SMS** | `application/vnd.3gpp.sms` im SIP-`MESSAGE`-Body → Button „📱 SMS dekodieren" im SIP-Dialog; SMSC-Präfix automatisch per Scoring erkannt |

---

## Bearbeitung & Speichern

- Geänderte Felder werden **orange** markiert; der Fenstertitel zeigt `*`.
- **Save As** re-serialisiert den vollständigen Baum als korrektes BER mit aktualisierten Längenfeldern.
- **Export TXT** bietet zwei Formate:
  - **Format 1** — eingerückte Baumdarstellung
  - **Format 2** — tabellarisch mit Offset, Tag und Wert

---

## ASN.1-Schema-Auflösung

Beim Start werden alle `*.asn` / `*.asn1`-Dateien aus `asn1_patched/` geladen und zu Tag-Maps verarbeitet. Zusätzlich gibt es hartcodierte **virtuelle Typen** für Felder, die in der ASN.1 als anonyme Inline-SEQUENCEs definiert sind:

| Virtueller Typ | Felder |
|---|---|
| `EpsPartyIdentity` | `imei`, `imsi`, `msISDN`, `sip-uri`, `nai` |
| `UmtsHI2PartyIdentity` | `imei`, `imsi`, `callingPartyNumber`, `msISDN`, `e164-Format` |
| `GsmGeoCoordinates` | `latitude`, `longitude`, `mapDatum`, `azimuth` |
| `UtmCoordinates` | `utm-East`, `utm-North` |
| `SmsContents` | `initiator`, `transfer-status`, `other-message`, `content` |
| `MessagingCC` | `event-identifier`, `content-type`, `content` |
| `IPMMIRILocation` | `umtsHI2Location`, `epsLocation`, `wlanLocation` |
| `SNSSAI` | `sliceServiceType`, `sliceDifferentiator` |
| `TAI` | `pLMNID`, `tAC`, `nID` |
| `CCContents` | `payloadDirection`, `messagingCC`, `iPCC`, … |
| `UmtsCS-IRIsContent` | `iRI-Begin-record`, `iRI-End-record`, … |
| `UmtsIRIsContent` | `iRI-Begin-record`, `iRI-End-record`, … |
| `TS33128CCPayload` | `cCPayloadOID`, `pDU` |

### Gemessene Label-Abdeckung (729 Testdateien, v1.3.build_48)

| Dateityp | Felder | Labelquote |
|---|---|---|
| LI PS-PDU (2G/UMTS IRI, eingebettet) | ~50–80 | **≥ 99 %** |
| LI PS-PDU mit 5G CC-Payload | ~40–70 | **≥ 99 %** |
| EPS PS-PDU (`li_ps_pdu_Not5G`) | ~34–61 | **≥ 99 %** |
| 5G PS-PDU (`li_ps_pdu_5G`) | ~60 | **≥ 99 %** |
| UmtsCS IRI (direkt, `0xa1`–`0xa4`) | ~37–56 | **≥ 99 %** |
| **Gesamt (410 887 Knoten, 729 Dateien)** | — | **99,8 %** |

---

## Bekannte Einschränkungen

- Felder ohne ASN.1-Kontextmarkierung (manche SEQUENCE-OF-Elemente) werden mit generischem `SEQUENCE`-Label angezeigt — die Daten sind vollständig sichtbar.
- Sehr große Dateien (> 50 kB) können das Rendern verlangsamen.
- Code-Signierung ist deaktiviert (`CSC_IDENTITY_AUTO_DISCOVERY=false` in `package.json`).

---

## Entwicklung (ohne Build)

```bash
# Direkt starten ohne Installer
npm start
```

---

## Changelog

### v1.4.build_53 (2026-05-12)
- **RP-DATA Wrapper-Erkennung** — SMS-PDUs im SIP-Body sind per 3GPP TS 24.011 in einem RP-DATA-Frame gekapselt (RP-MTI → RP-MR → RP-OA → RP-DA → RP-UD → TPDU). Der Decoder erkennt das automatisch und schneidet das TPDU heraus.
- **Alphanumerischer Absender** — TON=5 (0xd0): Adresse ist GSM7-gepackt, Zeichenanzahl = `floor(addrLen × 4 / 7)`. Vorher: BCD-Müll, jetzt z.B. `TINDER`.
- **DCS-Alpha-Fix** — Alphabet-Bits sind Bits 1–0 (`dcs & 0x03`), nicht Bits 3–2 (`(dcs>>2)&0x03`). DCS=0x04 wird jetzt korrekt als GSM7 erkannt.
- **Inner-MIME-Header-Strip** — SIP-Body enthält vor der PDU oft `sms\r\nContent-Length: N\r\n\r\n`. Wird jetzt automatisch abgeschnitten.
- **SMSC-Scoring** — SMSC-Präfix-Erkennung per Heuristik: beide Varianten (mit/ohne Skip) werden bewertet, die plausiblere gewinnt.
- **📥 PDU speichern** — Download-Button im SMS-Dialog speichert Roh-PDU als `.bin`.
- **PDU Hex-Dump** — erste 24 Bytes der PDU werden im SMS-Dialog zur Diagnose angezeigt.
- **SIP-SMS-Body-Decoder** — `Content-Type: application/vnd.3gpp.sms` im SIP-Dialog → Button „📱 SMS dekodieren".

### v1.4.build_49 (2026-04-21)
- **SIP/VoIP-Decoder** — Rechtsklick oder Doppelklick auf SIP-Payloads öffnet einen dedizierten Decode-Dialog mit Request-/Status-Line, allen Headern (wichtige grün hervorgehoben), SDP-Block und ⧉-Kopier-Buttons für jeden Wert.
- **Automatische SIP-Erkennung** — Knoten werden per Feldname (`sIPContent` u.a.) und Content-Sniffing der ersten 20 Bytes als SIP erkannt; unabhängig vom ASN.1-Label.
- **SIP-Badge im Baum** — SIP-Knoten zeigen ein grünes `SIP`-Badge in der Value-Spalte.
- **Doppelklick auf SIP-Knoten** öffnet direkt den SIP-Decoder statt des Edit-Dialogs.
- **Footer-Kopier-Buttons** im SIP-Dialog: Von, An, Call-ID, alle Header auf einmal.

### v1.3.build_48 (2026-04-09)
- **2G/UMTS IRI Label-Fix (eingebettete IRIs)** — Wenn UMTS- oder UmtsCS-IRIs innerhalb eines LI-PS-PDU-Wrappers (0x30) vorkommen, wurden alle Felder wie `lawfulInterceptionIdentifier`, `communicationIdentifier`, `timeStamp`, `locationOfTheTarget`, `partyInformation` als unlabeled `[n]` angezeigt. Ursache: `UmtsCS-IRIsContent` und `UmtsIRIsContent` sind reine CHOICE-Wrapper ohne eigene Context-Tags — ihre tagMaps hatten keine Einträge für [1..4], sodass der Parser mit falschem `typeHint` rekursierte. Fix: manuelle Maps für beide Typen mit korrektem `recurseHint` → `UmtsCS-IRI-Parameters` / `UmtsIRI-Parameters`.
- **CCPayload-Konflikt behoben** — TS33128 und LI-PS-PDU definieren beide einen Typ `CCPayload` mit unterschiedlichen Tags. Die TS33128-Version (5G, `[1]=cCPayloadOID, [2]=pDU`) überschrieb die LI-PS-PDU-Version (`[0]=payloadDirection, [1]=timeStamp, [2]=cCContents`). Fix: LI-PS-PDU-Version als `CCPayload` beibehalten, TS33128-Version als `TS33128CCPayload`.
- **TS33128 5G CC-Payload vollständig dekodiert** — `CCContents[23]` (`threeGPP33128DefinedCC`) rekursiert jetzt in `TS33128CCPayload` → `CCPDU` → `ExtendedUPFCCPDU` / `UPFCCPDU` / `IMSCCPDU` etc. mit vollständigen Feldnamen.
- **Label-Abdeckung: 99,8 %** — gemessen über 729 Testdateien / 410 887 Context-Tagged-Knoten (vorher: ~80 %).
- **Neue EXTRA_HINTS** — `UmtsIRI-Parameters,9`, `UmtsCS-IRI-Parameters,8/13/14`, `UmtsIRI-Parameters,8/13/14`, CCPDU-Kette.

### v1.3.build_47 (2026-04-09)
- Vorstufe der build_48-Fixes (unvollständig).

### v1.2.40 (2026-03-25)
- **HI4 Support** — LI_HI4 Notification Payload vollständig dekodiert
- **IP-Adressen** — IPv4/IPv6 in lesbarer Form
- **Interaktive OSM-Karte** — Koordinaten öffnen OpenStreetMap direkt im Detail-Panel
- **Spec-Anzeige** — ETSI/3GPP-Norm und Version in der Statuszeile

### v1.2.x (2026-02-xx)
- Hex-Viewer mit klickbaren Bytes
- Label-Abdeckung auf ≥ 99 % (vorherige Testbasis) gesteigert
- 5G Slice/TAI, IPMMIRI, SMSTPDUData
- Statuszeile, Drag-and-Drop

### v1.1.x (2025-12-xx)
- Erste stabile Version
- BER-Parser mit automatischer Typ-Erkennung
- ENUMERATED, MSISDN/IMSI/IMEI BCD-Dekodierung, Timestamps
- Save As, Export TXT, Recent Files, Dark Theme
