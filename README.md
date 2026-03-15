# BER Viewer

Grafischer Viewer und Editor für ETSI LI PS-PDU / 3GPP Lawful Intercept BER-Dateien.

Unterstützte Dateiformate: `*.hi2`, `*.ber`

---

## Installation & Start

### Voraussetzungen

- **Node.js** ≥ 18 → https://nodejs.org (LTS empfohlen)
- **npm** (kommt mit Node.js)

### Entwicklungsmodus (direkt starten, kein Build)

```cmd
cd ber_viewer_electron
npm install        ← nur beim ersten Mal nötig
npm start
```

### Windows Installer bauen

```cmd
npm run build:win
```
→ `dist\BER Viewer Setup x.x.x.exe`

Oder direkt ohne Installation:
```
dist\win-unpacked\BER Viewer.exe
```

### Linux AppImage bauen (Ubuntu / Linux Mint)

```bash
# Node.js 20 LTS installieren
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# System-Abhängigkeiten
sudo apt install -y libgconf-2-4 libatk1.0-0 libatk-bridge2.0-0 \
    libgdk-pixbuf2.0-0 libgtk-3-0 libgbm-dev libnss3 libasound2 \
    fuse libfuse2

# Build
npm install
npm run build:linux
```
→ `dist/BER Viewer-x.x.x.AppImage`

```bash
chmod +x "dist/BER Viewer-x.x.x.AppImage"
./"dist/BER Viewer-x.x.x.AppImage"
# Falls FUSE-Fehler: ./"dist/BER Viewer-x.x.x.AppImage" --no-sandbox
```

---

## Projektstruktur

```
ber_viewer_electron/
├── package.json
├── asn1_patched/        ← 31 gepatchte ASN.1-Schemadateien (eingebettet)
└── src/
    ├── main.js          ← Electron Hauptprozess: BER-Parser, Datei-I/O
    ├── preload.js       ← IPC-Bridge zwischen Main und Renderer
    ├── index.html       ← App-Fenster
    ├── style.css        ← Dark Theme
    └── renderer.js      ← UI-Logik
```

**Wichtig:** `asn1_patched/` muss direkt neben `package.json` liegen.

---

## Features

### Dekodierung

- **Automatische Typerkennung** anhand des ersten BER-Tags:
  - `0x30` (UNIVERSAL SEQUENCE) → PS-PDU (5G, 4G, VoIP/SIP, Messaging)
  - `0xa0` (CONTEXT [0]) → UmtsCS-IRIsContent (nicht-5G CS-Domain)
  - `0xa2` (CONTEXT [2]) → ETSI HI2 IRIsContent
- **531 Typkarten** aus den ASN.1-Schemas für vollständige Feldnamen — inkl. EPS-Kette für nicht-5G Dateien (`EPSIRI → EpsIRIContent → EpsIRI-Parameters`)
- **210 ENUMERATED-Typen** → Werte als Text (`timeOfInterception`, `nR`, `modificationRequest`, `bearerActivation` …)
- **Timestamps** → lesbar (`2026-02-06 09:44:01.608Z`)
- **Unix-Timestamps** (`seconds`-Feld in `MicroSecondTimeStamp`) → lesbares Datum (`2025-10-30 16:30:36Z`)
- **MSISDN / IMSI / IMEI** → BCD-dekodiert bei 4G/Umts-Formaten
- **Nested BER** → `threeGPP33128DefinedIRI`-Payload wird rekursiv aufgelöst bis zur Location (Lat/Lon), SUPI, GPSI usw.

### Anzeige

- **Baumansicht** mit 5 Spalten: Offset · Tag · Feld/Typ · Wert · Größe
- **Rechte Seite**: Feld-Info + dekodierter Wert + farbiger Hex-Dump
- Expand / Collapse einzelner Knoten oder alles (Strg+E / Strg+W)
- Navigation per Pfeiltasten (↑ ↓ ← →)
- **Suche** (Strg+F, F3) in Feldnamen und Werten

### Editieren

- **Doppelklick** auf ein primitives Feld öffnet den Editor:
  - Text-Eingabe für Strings (IA5String, UTF8String, PrintableString …)
  - Hex-Eingabe für Binärfelder (`30 31 32` oder `303132`)
- **Rechtsklick** auf jeden Knoten öffnet ein Kontextmenü:
  - *Bearbeiten* — öffnet den Editor (nur bei primitiven Feldern)
  - *Wert kopieren* — kopiert den dekodierten Wert in die Zwischenablage
  - *Hex kopieren* — kopiert die rohen Bytes als Hex-String
  - *Aufklappen / Zuklappen* — für konstruierte Knoten
- **Längenänderungen erlaubt** — alle BER-Längenfelder werden beim Speichern automatisch neu berechnet
- Geänderte Felder werden **orange** markiert, Titelzeile zeigt `*`

### Speichern

- **Strg+Shift+S** / Menü → *Save As* → BER-Datei unter neuem Namen speichern
- Alle Änderungen werden korrekt re-serialisiert (korrekte Tag/Length/Value-Struktur)
- Beim Öffnen einer neuen Datei mit ungespeicherten Änderungen erscheint ein Dialog:
  **Speichern / Verwerfen / Abbrechen** — gilt für Toolbar-Button, Strg+O und Drag & Drop

### Export TXT

- **Strg+Shift+E** / Menü → *Export TXT* → Formatauswahl:

  **Format 1** — Eingerückt (wie `li_decoder.py`):
  ```
  pSHeader:
    li-psDomainId: 0.4.0.2.2.5.1.36
    lawfulInterceptionIdentifier: 003082225001
    timeStamp: 2026-02-06 09:44:01.608Z
    timeStampQualifier: timeOfInterception ( 1, 0x1 )
  ```

  **Format 2** — Offset + Tag + Wert:
  ```
  0004   pSHeader                         [ 1] ::= SEQUENCE (size = 5a)
  0008     li-psDomainId                  [ 0] ::= 0.4.0.2.2.5.1.36 (size = 7)
  0011     lawfulInterceptionIdentifier   [ 1] ::= 003082225001 (size = c)
  004a     timeStamp                      [ 5] ::= 2026-02-06 09:44:01.608Z (size = 13)
  ```

### Zuletzt geöffnete Dateien

- Bis zu 10 Dateien im **Menü → File** gespeichert
- Persistent zwischen App-Starts (gespeichert in `AppData/Local`)

### Drag & Drop

- BER-Datei direkt ins Fenster ziehen

---

## Tastenkürzel

| Aktion | Tastenkürzel |
|--------|-------------|
| Datei öffnen | `Ctrl+O` |
| Speichern unter | `Ctrl+Shift+S` |
| Export TXT | `Ctrl+Shift+E` |
| Suchen | `Ctrl+F` |
| Nächster Treffer | `F3` |
| Alle aufklappen | `Ctrl+E` |
| Alle zuklappen | `Ctrl+W` |
| Navigation | `↑ ↓ ← →` |
| Feld editieren | `Doppelklick` oder `Rechtsklick → Bearbeiten` |
| DevTools | `View → Toggle DevTools` |
