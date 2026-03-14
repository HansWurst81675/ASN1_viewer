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

## Linux AppImage bauen

```bash
cd ber_viewer
npm install
npm run build:linux
```

→ Ergebnis in `dist/`:
- `BER Viewer-1.0.0.AppImage`

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
