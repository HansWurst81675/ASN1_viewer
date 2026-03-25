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
# Hinweis: Neuere Ubuntu/Mint-Varianten (ab Ubuntu 24 / Mint 22+) verwenden die "t64"-ABI,
# daher existieren z.B. libgtk-3-0 und libasound2 nicht mehr. Installiere stattdessen:
sudo apt update
sudo apt install -y libasound2t64 libgtk-3-0t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libfuse2t64 libgbm-dev libnss3

# Das Paket libgconf-2-4 ist auf neueren Distributionen oft nicht mehr verfügbar.
# In den meisten Fällen kann es ignoriert werden (moderne Apps benötigen es nicht).
# Wenn nötig, versuche:
#   sudo apt install libgconf-2-4t64

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
    ├── renderer.js        ← UI, Tree-Rendering, Edit-Dialog, SMS-Decoder
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

### Zuletzt geöffnete Dateien

`Datei → Zuletzt geöffnet` — beim Wechsel fragt der Viewer bei ungespeicherten Änderungen nach.

---

## SMS-Decoder

Rechtsklick auf ein `content [4]`-Feld in `sMS-Contents` → **📱 SMS dekodieren**.

> ✅ **Fix:** SMS-SUBMIT messages now decode correctly (TP-MR + TP-VP are handled so the text is read from the right offset).

| Typ | Unterstützung |
|---|---|
| SMS-DELIVER | Absender, Zeitstempel, Text |
| SMS-SUBMIT | Empfänger, Text |
| SMS-STATUS-REPORT | Sendezeit, Zustellzeit, Statuscode |
| GSM 7-Bit | Standardzeichensatz (Deutsch, Englisch …) |
| 8-Bit (Latin-1) | Erweiterter Zeichensatz |
| UCS-2 | Unicode (Arabisch, Chinesisch …) |
| Multipart (UDH) | Teil- und Gesamtanzahl werden angezeigt |

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

### Gemessene Label-Abdeckung (30 Testdateien)

| Dateityp | Felder | Labelquote |
|---|---|---|
| 5G PS-PDU (`li_ps_pdu_5G`) | ~60 | **92–96 %** |
| EPS PS-PDU (`li_ps_pdu_Not5G`) | ~34–61 | **88–95 %** |
| LI PS-PDU (`li_ps_pdu`) | ~64–75 | **92–96 %** |
| UmtsCS IRI (`D2AE`, `D2DE`, `E2AG`, `E2GG`) | ~37–56 | **64–95 %** |
| CC-Payload/Messaging (`DT*`) | ~26 | **85 %** |
| **Gesamt (1549 Knoten)** | — | **≥ 99 %** |

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

### v1.2.40 (2026-03-25)
- **HI4 Support** — LI_HI4 Notification Payload (ETSI TS 102 232-1 §5.6 / 3GPP TS 33.128) vollständig dekodiert: `threeGPP-LI-Notification` → `LINotification` mit `notificationType`, `appliedTargetID` (MSISDN, IMSI, SUPI …), `appliedDeliveryInformation`, Start-/Endzeit
- **IP-Adressen** — IPv4 (4 Bytes) und IPv6 (16 Bytes) werden jetzt in lesbarer Form angezeigt (z. B. `80.149.242.97` statt `0x5095f261`)
- **Interaktive OSM-Karte** — Klick auf `latitude`/`longitude`, `geoCoordinates` oder `geographicalCoordinates` öffnet eine scrollbare und zoombare OpenStreetMap-Karte direkt im Detail-Panel (Mausrad = Zoom, Drag = Pan, Doppelklick = Zoom-in); der Button „🗺 In OpenStreetMap öffnen" zeigt den aktuellen Kartenausschnitt
- **Koordinatenformate** — GSM-Format (`N510344.38`) und Dezimalgrad (`50.964444`) werden beide erkannt und korrekt in die Karte übertragen
- **Spec-Anzeige** — Die verwendete ETSI/3GPP-Norm und Version werden aus der eingebetteten Domain-OID ermittelt und in der Statuszeile rechts angezeigt (z. B. `ETSI TS 102 232-1 v3.6 | v1.2.40 | Schema: 542 types`)
- **SMS-Dekodierung erweitert** — `sMSTPDUData`- und `sMSTPDU`-Felder (TS 33.128) lösen ebenfalls den SMS-Decoder aus

### v1.2.x (2026-02-xx)
- **Hex-Viewer** — integrierter Hex-Dump mit klickbaren Bytes; Klick auf ein Byte markiert das zugehörige Feld im Baum
- **Label-Abdeckung auf ≥ 99 %** gesteigert (1 577 Knoten über 31 Testdateien): vollständige Typ-Ketten für MessagingCC, SNSSAI/TAI, HI2CommunicationIdentifier, UmtsHI2PartyIdentity, CCContents, LIAppliedDeliveryInformation, TargetIdentifier
- **5G Slice/TAI** — `allowedNSSAI`, `fiveGSTAIList`, `TAIList`, `PLMNID` vollständig beschriftet
- **IPMMIRI** — IPv6-Adressfelder in SIP-Nachrichten korrekt aufgelöst
- **SMSTPDUData** — Container-Knoten mit einem Kind werden automatisch dekodiert
- **Statuszeile** — App-Version aus `package.json` live eingeblendet
- Drag-and-Drop von BER-Dateien direkt ins Fenster

### v1.1.x (2025-12-xx)
- **Erste stabile Version**
- BER-Parser mit automatischer Typ-Erkennung (PS-PDU, EPS HI2, UmtsCS HI2, 5G NR)
- ENUMERATED-Werte als Text (> 210 Typen aus ASN.1-Schemas)
- MSISDN/IMSI/IMEI BCD-Dekodierung
- Timestamps in lesbares Datum
- Rechtsklick-Kontextmenü: Bearbeiten, Kopieren, SMS dekodieren
- Save As (BER re-serialisiert), Export TXT (Format 1 + 2)
- Recent Files, ungespeicherte Änderungen werden abgefragt
- Dark Theme
