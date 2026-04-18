# Voice Command — Design Spec

**Date:** 2026-04-18  
**Status:** Approved

---

## Résumé

Ajout d'une commande vocale dans GlassForge activée par `Super+V`. L'utilisateur peut dicter des messages à Claude ou énoncer des commandes système. Claude répond à voix haute via piper-tts. Une fenêtre HUD flottante en haut au centre de l'écran affiche la transcription en temps réel et la réponse.

---

## Architecture

```
GlassForge (Tauri 2)
├── tauri-plugin-global-shortcut  → détecte Super+V (configurable)
├── Sidecar Python (src-tauri/sidecar/voice_sidecar.py)
│   ├── faster-whisper            → micro → texte (transcription locale)
│   ├── piper-tts                 → texte → audio (synthèse vocale locale)
│   └── Protocole JSON via stdin/stdout avec Tauri
├── Fenêtre HUD (src/voice-hud/)
│   └── Fenêtre Tauri secondaire, always-on-top, positionnée top-center
└── Settings (onglet "Voix" dans le panneau existant)
```

Le sidecar Python démarre avec GlassForge et reste en mémoire. Le modèle faster-whisper est chargé une fois au démarrage pour éviter la latence à chaque appui.

---

## Flux de données

1. **Super+V pressé**
   - Tauri ouvre la fenêtre HUD (top-center, always-on-top, ~420×120px)
   - Tauri envoie `{"cmd": "start_listen"}` au sidecar via stdin

2. **L'utilisateur parle**
   - Le sidecar enregistre le microphone par défaut du système
   - faster-whisper transcrit en temps réel
   - Le sidecar envoie `{"event": "transcript", "text": "..."}` à Tauri
   - Le HUD affiche le texte au fur et à mesure

3. **Fin de l'écoute** (2e appui sur Super+V ou silence détecté >1.5s)
   - Le sidecar envoie la transcription finale

4. **Analyse de la phrase**
   - Si commande système reconnue → GlassForge exécute l'action, piper-tts annonce le résultat
   - Sinon → texte envoyé à la session Claude active (comme une saisie clavier)
     - La réponse de Claude est lue par piper-tts
     - Le HUD affiche la réponse textuelle pendant la lecture

5. **Fermeture du HUD**
   - Le HUD disparaît automatiquement après N secondes (configurable, défaut 4s)

---

## Protocole Sidecar (JSON via stdin/stdout)

### Tauri → Sidecar
```json
{"cmd": "start_listen"}
{"cmd": "stop_listen"}
{"cmd": "speak", "text": "Voici la réponse de Claude."}
{"cmd": "shutdown"}
```

### Sidecar → Tauri
```json
{"event": "transcript", "text": "texte partiel...", "final": false}
{"event": "transcript", "text": "texte final", "final": true}
{"event": "speak_done"}
{"event": "error", "message": "..."}
```

---

## Fenêtre HUD

**Dimensions :** ~420×120px  
**Position :** top-center de l'écran principal  
**Style :** glass dark (cohérent avec le thème GlassForge existant)  
**Always-on-top :** oui  

### États visuels

| État | Icône | Couleur bordure | Texte |
|---|---|---|---|
| Écoute | Micro animé (pulse) | Violet | "Écoute..." |
| Enregistrement | Point rouge | Rouge | Transcription en direct |
| Réponse | Icône audio | Vert | Réponse de Claude |

---

## Commandes système reconnues

| Phrase détectée | Action GlassForge |
|---|---|
| "nouvelle session" | Crée une nouvelle session Claude |
| "ferme la session" | Ferme la session active |
| "session suivante" | Passe à l'onglet suivant |
| "session précédente" | Passe à l'onglet précédent |
| "copie la réponse" | Copie le dernier message Claude dans le presse-papiers |
| "arrête" | Coupe la lecture piper-tts en cours |

Toute autre phrase est transmise à la session Claude active comme message texte.

---

## Paramètres (onglet "Voix")

| Paramètre | Type | Défaut |
|---|---|---|
| Raccourci | Champ texte configurable | `Super+V` |
| Modèle Whisper | Sélecteur (tiny/base/small/medium) | `base` |
| Voix piper | Sélecteur des voix installées | Première disponible |
| Langue | Sélecteur | Français |
| Lecture auto des réponses | Toggle | Activé |
| Durée avant fermeture HUD | Slider 2–8s | 4s |

---

## Dépendances

### Python (sidecar)
- `faster-whisper` — transcription
- `piper-tts` — synthèse vocale
- `sounddevice` — capture microphone
- `numpy` — traitement audio

### Rust/Tauri
- `tauri-plugin-global-shortcut` — raccourci global Super+V
- Nouvelle fenêtre Tauri secondaire pour le HUD

### Modèles à télécharger
- Modèle Whisper (ex: `base` ≈ 150 MB) — téléchargé au premier lancement
- Modèle piper pour la langue sélectionnée (≈ 50 MB)

GlassForge guide l'installation au premier usage si les modèles sont absents.

---

## Ce qui n'est PAS dans le scope

- Reconnaissance de mots-clés sans appui clavier ("Hey GlassForge")
- TTS cloud ou reconnaissance vocale cloud
- Support Wayland pour le raccourci global (X11 uniquement pour l'instant, cohérent avec le reste du projet)
