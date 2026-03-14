# BER Viewer — Build Instructions

## Voraussetzungen

- **Node.js** ≥ 18  →  https://nodejs.org  (LTS empfohlen)
- **npm** (kommt mit Node.js)
- Internetzugang für den ersten `npm install`

## Projektstruktur vorbereiten

```
ber_viewer/
├── package.json
├── asn1_patched/          ← dein bestehendes Verzeichnis hierher kopieren!
│   ├── LI-PS-PDU.asn
│   ├── HI2Operations.asn
│   └── ... (31 Dateien)
└── src/
    ├── main.js
    ├── preload.js
    ├── index.html
    ├── style.css
    └── renderer.js
```

**Wichtig:** Das `asn1_patched/` Verzeichnis muss direkt neben `package.json` liegen.

## Entwicklung (ohne Build, direkt starten)

```cmd
cd ber_viewer
npm install
npm start
```

## Windows .exe bauen

```cmd
cd ber_viewer
npm install
npm run build:win
```

→ Ergebnis in `dist/`:
- `BER Viewer Setup 1.0.0.exe`  (NSIS Installer)

## Linux AppImage bauen (Ubuntu / Linux Mint)

### 1. Node.js installieren

```bash
# Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Versionen prüfen
node --version   # sollte v20.x.x zeigen
npm --version
```

### 2. Abhängigkeiten für electron-builder

```bash
# Benötigt für NSIS und AppImage-Builds unter Linux
sudo apt install -y \
    libgconf-2-4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    libnss3 \
    libasound2 \
    fuse \
    libfuse2
```

### 3. AppImage bauen

```bash
cd ber_viewer_electron
npm install
npm run build:linux
```

→ Ergebnis in `dist/`:
- `BER Viewer-1.0.0.AppImage`

### 4. AppImage starten

```bash
chmod +x "dist/BER Viewer-1.0.0.AppImage"
./"dist/BER Viewer-1.0.0.AppImage"
```

Oder per Doppelklick im Dateimanager (Ausführungsrecht muss gesetzt sein).

> **Hinweis:** Falls AppImage nicht startet mit Fehler `FUSE`:
> ```bash
> sudo apt install libfuse2
> # oder AppImage mit --no-sandbox starten:
> ./"dist/BER Viewer-1.0.0.AppImage" --no-sandbox
> ```

## Hinweise

- Der erste `npm install` lädt ~200 MB (Electron + electron-builder).
- Der Build dauert 2–5 Minuten (Electron wird heruntergeladen).
- Das `asn1_patched/` Verzeichnis wird in die App eingebettet — keine externe Abhängigkeit.

## Bedienung

| Aktion | Tastenkürzel |
|--------|-------------|
| Datei öffnen | `Ctrl+O` |
| Suchen | `Ctrl+F` |
| Nächster Treffer | `F3` |
| Alle aufklappen | `Ctrl+E` |
| Alle zuklappen | `Ctrl+W` |
| Navigation | `↑ ↓ ← →` |
| Drag & Drop | Datei in Fenster ziehen |
