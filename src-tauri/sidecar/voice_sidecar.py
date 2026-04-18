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
import time
import queue
import subprocess
import glob
import os
import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000
CHANNELS = 1
BLOCK_SIZE = 1024
SILENCE_THRESHOLD = 0.01
SILENCE_SECONDS = 1.5
# Partial transcript cadence: every 0.8s of captured audio. The
# transcription thread re-runs Whisper on the growing buffer at this
# cadence and emits the latest text.
PARTIAL_INTERVAL_S = 0.8
# Biases Whisper toward conversational French and reduces hallucinated
# boilerplate on very short utterances.
INITIAL_PROMPT_FR = "Bonjour, je vais dicter un message."
INITIAL_PROMPT_EN = "Hello, I'm going to dictate a message."


def emit(event: dict):
    print(json.dumps(event), flush=True)


def _detect_device():
    """Pick the best device/compute_type available.

    faster-whisper runs on CTranslate2. CUDA gives a 5-10x speedup on
    modern GPUs; on CPU, int8 quantization is the fastest path.
    """
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def load_whisper(model_name: str):
    from faster_whisper import WhisperModel
    device, compute_type = _detect_device()
    try:
        return WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as e:
        # cuda can fail at load time even after get_cuda_device_count says >0
        # (missing libs, driver mismatch). Fall back to CPU int8.
        if device == "cuda":
            emit({
                "event": "error",
                "message": f"cuda load failed, falling back to cpu: {e}",
            })
            return WhisperModel(model_name, device="cpu", compute_type="int8")
        raise


class VoiceSidecar:
    def __init__(self):
        self.model = None
        self.model_name = "tiny"
        self.listening = False
        self.audio_queue: queue.Queue = queue.Queue()
        self.listen_thread: threading.Thread | None = None

    def set_model(self, model_name: str):
        self.model_name = model_name
        self.model = load_whisper(model_name)

    def ensure_model(self):
        if self.model is None:
            self.model = load_whisper(self.model_name)

    def _transcribe(self, audio: np.ndarray, lang: str):
        # Speed-tuned: greedy decoding, VAD pre-filter, no timestamps, no
        # carry-over context (each call stands alone since we re-transcribe
        # the growing audio buffer on every partial).
        prompt = INITIAL_PROMPT_EN if lang == "en" else INITIAL_PROMPT_FR
        segs, _ = self.model.transcribe(
            audio,
            language=lang,
            beam_size=1,
            vad_filter=True,
            without_timestamps=True,
            condition_on_previous_text=False,
            initial_prompt=prompt,
        )
        return " ".join(s.text for s in segs).strip()

    def start_listen(self, lang: str = "fr"):
        if self.listening:
            return
        self.listening = True
        audio_queue = queue.Queue()
        self.audio_queue = audio_queue
        self.listen_thread = threading.Thread(
            target=self._record_and_transcribe,
            args=(audio_queue, lang),
            daemon=True,
        )
        self.listen_thread.start()

    def stop_listen(self):
        self.listening = False

    def _record_and_transcribe(self, audio_queue: queue.Queue, lang: str = "fr"):
        self.ensure_model()
        chunks: list = []
        chunks_lock = threading.Lock()
        # Shared state mutated by the transcription worker and read by this
        # thread after the worker stops (so no lock needed on read-after-join).
        worker_state = {"last_partial": "", "last_chunk_count": 0}
        worker_stop = threading.Event()

        def transcription_worker():
            while not worker_stop.is_set():
                time.sleep(0.1)
                with chunks_lock:
                    count = len(chunks)
                    if count == 0:
                        continue
                    if count - worker_state["last_chunk_count"] < int(
                        PARTIAL_INTERVAL_S * SAMPLE_RATE / BLOCK_SIZE
                    ):
                        continue
                    audio = np.concatenate(chunks).flatten()
                try:
                    partial = self._transcribe(audio, lang)
                except Exception as e:
                    emit({"event": "error", "message": f"transcribe failed: {e}"})
                    continue
                worker_state["last_chunk_count"] = count
                if partial and partial != worker_state["last_partial"]:
                    worker_state["last_partial"] = partial
                    emit({"event": "transcript", "text": partial, "final": False})

        worker = threading.Thread(target=transcription_worker, daemon=True)
        worker.start()

        silence_frames = 0
        silence_limit = int(SILENCE_SECONDS * SAMPLE_RATE / BLOCK_SIZE)

        def audio_callback(indata, frames, time_info, status):
            if self.listening:
                audio_queue.put(indata.copy())

        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            blocksize=BLOCK_SIZE,
            callback=audio_callback,
        ):
            while self.listening or not audio_queue.empty():
                try:
                    chunk = audio_queue.get(timeout=0.1)
                except queue.Empty:
                    continue

                with chunks_lock:
                    chunks.append(chunk)

                rms = float(np.sqrt(np.mean(chunk ** 2)))
                if rms < SILENCE_THRESHOLD:
                    silence_frames += 1
                else:
                    silence_frames = 0

                if silence_frames >= silence_limit and not self.listening:
                    break

        worker_stop.set()
        worker.join(timeout=2.0)

        # Final pass: if new audio arrived since the worker's last partial,
        # run one more transcribe. Otherwise reuse the last partial so the
        # user doesn't wait on a redundant full-audio retranscribe.
        with chunks_lock:
            final_count = len(chunks)
            audio_final = (
                np.concatenate(chunks).flatten()
                if chunks and final_count > worker_state["last_chunk_count"]
                else None
            )
        if audio_final is not None:
            try:
                text = self._transcribe(audio_final, lang)
            except Exception as e:
                emit({"event": "error", "message": f"transcribe failed: {e}"})
                text = worker_state["last_partial"]
        else:
            text = worker_state["last_partial"]

        if text:
            emit({"event": "transcript", "text": text, "final": True})

    def speak(self, text: str, lang: str = "fr", volume: float = 1.0):
        try:
            if not text.strip():
                emit({"event": "speak_done"})
                return
            # Detect first available piper model in ~/.local/share/piper/
            model_dir = os.path.expanduser("~/.local/share/piper/")
            models = glob.glob(f"{model_dir}*.onnx")
            if not models:
                emit({"event": "error", "message": f"no piper model in {model_dir}"})
                return
            model_path = models[0]

            # Prefer the piper binary next to the running interpreter (venv/bin/piper);
            # fall back to PATH. subprocess doesn't inherit venv activation, so plain
            # "piper" fails when the sidecar is launched from a venv.
            piper_bin = os.path.join(os.path.dirname(sys.executable), "piper")
            if not os.path.exists(piper_bin):
                piper_bin = "piper"

            proc = subprocess.run(
                [piper_bin, "--model", model_path, "--output-raw"],
                input=text.encode(),
                capture_output=True,
            )
            if proc.returncode != 0:
                stderr = proc.stderr.decode(errors="replace").strip()
                emit({"event": "error", "message": f"piper exited {proc.returncode}: {stderr}"})
                return

            # Read the actual sample rate from the model config instead of assuming 22050.
            sample_rate = 22050
            try:
                with open(f"{model_path}.json", "r", encoding="utf-8") as fh:
                    cfg = json.load(fh)
                    sample_rate = int(cfg.get("audio", {}).get("sample_rate", sample_rate))
            except Exception:
                pass

            audio = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
            gain = max(0.0, min(1.0, float(volume)))
            audio = audio * gain
            sd.play(audio, samplerate=sample_rate, blocking=True)
            emit({"event": "speak_done"})
        except Exception as e:
            emit({"event": "error", "message": f"speak failed: {e}"})

    def run(self):
        # Preload whisper so the first turn doesn't pay the model-load cost.
        # Errors are non-fatal — we still enter the command loop so the user
        # can retry via set_model.
        try:
            self.ensure_model()
        except Exception as e:
            emit({"event": "error", "message": f"whisper preload failed: {e}"})
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
                self.start_listen(cmd.get("lang", "fr"))
            elif name == "stop_listen":
                self.stop_listen()
            elif name == "speak":
                text = cmd.get("text", "")
                lang = cmd.get("lang", "fr")
                volume = float(cmd.get("volume", 1.0))
                threading.Thread(
                    target=self.speak, args=(text, lang, volume), daemon=True
                ).start()
            elif name == "set_model":
                self.set_model(cmd.get("model", "base"))
            elif name == "shutdown":
                self.stop_listen()
                break


if __name__ == "__main__":
    VoiceSidecar().run()
