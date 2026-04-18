#!/usr/bin/env python3
"""
Voice sidecar for GlassForge.
Reads JSON commands from stdin, writes JSON events to stdout.

Commands (stdin, one JSON per line):
  {"cmd": "start_listen"}
  {"cmd": "stop_listen"}
  {"cmd": "speak", "text": "...", "lang": "fr"}
  {"cmd": "set_model", "model": "base"}
  {"cmd": "shutdown"}

Events (stdout, one JSON per line):
  {"event": "ready"}
  {"event": "transcript", "text": "...", "final": false}
  {"event": "transcript", "text": "...", "final": true}
  {"event": "speak_done"}
  {"event": "error", "message": "..."}
"""

import json
import sys
import threading
import queue
import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000
CHANNELS = 1
BLOCK_SIZE = 1024
SILENCE_THRESHOLD = 0.01
SILENCE_SECONDS = 1.5


def emit(event: dict):
    print(json.dumps(event), flush=True)


def load_whisper(model_name: str):
    from faster_whisper import WhisperModel
    return WhisperModel(model_name, device="cpu", compute_type="int8")


class VoiceSidecar:
    def __init__(self):
        self.model = None
        self.model_name = "base"
        self.listening = False
        self.audio_queue: queue.Queue = queue.Queue()
        self.listen_thread: threading.Thread | None = None
        self.piper_voice = None

    def set_model(self, model_name: str):
        self.model_name = model_name
        self.model = load_whisper(model_name)

    def ensure_model(self):
        if self.model is None:
            self.model = load_whisper(self.model_name)

    def start_listen(self):
        if self.listening:
            return
        self.listening = True
        self.audio_queue = queue.Queue()
        self.listen_thread = threading.Thread(
            target=self._record_and_transcribe, daemon=True
        )
        self.listen_thread.start()

    def stop_listen(self):
        self.listening = False

    def _audio_callback(self, indata, frames, time, status):
        if self.listening:
            self.audio_queue.put(indata.copy())

    def _record_and_transcribe(self):
        self.ensure_model()
        chunks = []
        silence_frames = 0
        silence_limit = int(SILENCE_SECONDS * SAMPLE_RATE / BLOCK_SIZE)

        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            blocksize=BLOCK_SIZE,
            callback=self._audio_callback,
        ):
            while self.listening or not self.audio_queue.empty():
                try:
                    chunk = self.audio_queue.get(timeout=0.1)
                except queue.Empty:
                    continue

                chunks.append(chunk)
                rms = float(np.sqrt(np.mean(chunk ** 2)))

                if rms < SILENCE_THRESHOLD:
                    silence_frames += 1
                else:
                    silence_frames = 0

                # Stream partial transcript every ~2 seconds of audio
                if len(chunks) % 32 == 0 and len(chunks) > 0:
                    audio = np.concatenate(chunks).flatten()
                    segs, _ = self.model.transcribe(audio, language=None)
                    partial = " ".join(s.text for s in segs).strip()
                    if partial:
                        emit({"event": "transcript", "text": partial, "final": False})

                if silence_frames >= silence_limit and not self.listening:
                    break

        if chunks:
            audio = np.concatenate(chunks).flatten()
            segs, _ = self.model.transcribe(audio, language=None)
            text = " ".join(s.text for s in segs).strip()
            emit({"event": "transcript", "text": text, "final": True})

    def speak(self, text: str, lang: str = "fr"):
        try:
            from piper.voice import PiperVoice
            import wave, io, subprocess

            # Detect first available piper model in ~/.local/share/piper/
            import glob as _glob, os as _os
            model_dir = _os.path.expanduser("~/.local/share/piper/")
            models = _glob.glob(f"{model_dir}*.onnx")
            model_path = models[0] if models else f"{model_dir}fr_FR-upmc-medium.onnx"
            proc = subprocess.run(
                ["piper", "--model", model_path, "--output-raw"],
                input=text.encode(),
                capture_output=True,
            )
            if proc.returncode == 0:
                audio = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
                sd.play(audio, samplerate=22050, blocking=True)
            emit({"event": "speak_done"})
        except Exception as e:
            emit({"event": "error", "message": f"speak failed: {e}"})

    def run(self):
        emit({"event": "ready"})
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError:
                continue

            name = cmd.get("cmd")
            if name == "start_listen":
                self.start_listen()
            elif name == "stop_listen":
                self.stop_listen()
            elif name == "speak":
                text = cmd.get("text", "")
                lang = cmd.get("lang", "fr")
                threading.Thread(
                    target=self.speak, args=(text, lang), daemon=True
                ).start()
            elif name == "set_model":
                self.set_model(cmd.get("model", "base"))
            elif name == "shutdown":
                self.stop_listen()
                break


if __name__ == "__main__":
    VoiceSidecar().run()
