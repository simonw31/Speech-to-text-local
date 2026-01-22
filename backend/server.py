import os
import sys
import io
import threading
import time
import wave
import tempfile
import pathlib
import pyautogui
import keyboard
import uvicorn
import pyaudio
import pyperclip
import json
import concurrent.futures
import huggingface_hub
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from collections import deque
from contextlib import asynccontextmanager

# --- FIX ENCODAGE & PATHS ---
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def setup_nvidia_paths():
    if os.name != 'nt': return
    try:
        base_path = pathlib.Path(sys.executable).parent
        site_packages = base_path.parent / "Lib" / "site-packages"
        nvidia_path = site_packages / "nvidia"
        if nvidia_path.exists():
            for path in nvidia_path.rglob("bin"):
                os.add_dll_directory(str(path))
                os.environ["PATH"] = str(path) + ";" + os.environ["PATH"]
            for path in nvidia_path.rglob("lib"):
                try: os.add_dll_directory(str(path))
                except: pass
                os.environ["PATH"] = str(path) + ";" + os.environ["PATH"]
    except: pass

setup_nvidia_paths()
from faster_whisper import WhisperModel

# --- CONFIGURATION (PERSISTANCE) ---
BASE_DIR = pathlib.Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.json"

DEFAULT_CONFIG = {
    "mic_index": 0,
    "model_size": "large-v3",
    "hotkey": "ctrl+space"
}

# Chargement initial
CONFIG = DEFAULT_CONFIG.copy()
if CONFIG_FILE.exists():
    try:
        with open(CONFIG_FILE, "r") as f:
            saved = json.load(f)
            CONFIG.update(saved) # On met à jour pour garder les clés manquantes éventuelles
            print(f"--> Config chargée : {CONFIG}")
    except Exception as e:
        print(f"--> Erreur lecture config: {e}")

def save_config():
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(CONFIG, f, indent=4)
        print("--> Config sauvegardée sur le disque.")
    except Exception as e:
        print(f"--> Erreur écriture config: {e}")

# --- LIFESPAN ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Important : On charge le modèle défini dans la CONFIG chargée
    threading.Thread(target=lambda: load_model(CONFIG["model_size"])).start()
    threading.Thread(target=keyboard_monitor, daemon=True).start()
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

class Settings(BaseModel):
    mic_index: int
    model_size: str
    hotkey: str

GLOBAL_STATE = { "status": "idle", "text": "" }
HISTORY = deque(maxlen=10)
model = None
p = pyaudio.PyAudio()

# --- MOTEUR IA ---
def load_model(size):
    global model
    print(f"--- Chargement IA ({size})... ---")
    try:
        import faster_whisper
        model = WhisperModel(size, device="cuda", compute_type="float16")
        print("✅ GPU Ready")
    except Exception as e:
        print(f"⚠️ Erreur GPU: {e}")
        try:
            model = WhisperModel(size, device="cpu", compute_type="int8")
            print("✅ CPU Ready")
        except: pass

def write_text_safe(text):
    try:
        pyperclip.copy(text + " ")
        pyautogui.hotkey('ctrl', 'v')
    except: pass

def transcribe_audio(frames):
    if not frames: 
        GLOBAL_STATE["status"] = "idle"
        return
    GLOBAL_STATE["status"] = "processing"
    
    try:
        temp_file = os.path.join(tempfile.gettempdir(), "handy_temp.wav")
        wf = wave.open(temp_file, 'wb')
        wf.setnchannels(1)
        wf.setsampwidth(p.get_sample_size(pyaudio.paInt16))
        wf.setframerate(16000)
        wf.writeframes(b''.join(frames))
        wf.close()

        if model:
            segments, _ = model.transcribe(temp_file, beam_size=5, language="fr", vad_filter=True)
            text = " ".join([s.text for s in segments]).strip()
            print(f"📝 {text}")
            if text:
                GLOBAL_STATE["text"] = text
                GLOBAL_STATE["status"] = "success"
                HISTORY.appendleft({"time": time.strftime("%H:%M"), "text": text})
                write_text_safe(text)
            else: GLOBAL_STATE["status"] = "error"
        else: GLOBAL_STATE["status"] = "error"

        try: os.remove(temp_file)
        except: pass
    except: GLOBAL_STATE["status"] = "error"

    time.sleep(1.5)
    GLOBAL_STATE["status"] = "idle"

# --- CLAVIER ---
def keyboard_monitor():
    print("👀 Clavier Actif")
    was_pressed = False
    frames = []
    stream = None
    
    while True:
        time.sleep(0.02)
        if model is None: continue

        current_hotkey = CONFIG.get("hotkey", "ctrl+space")
        try:
            try: is_pressed = keyboard.is_pressed(current_hotkey)
            except: is_pressed = False

            if is_pressed and not was_pressed:
                if GLOBAL_STATE["status"] in ["idle", "success", "error"]:
                    print("🎙️ Rec...")
                    GLOBAL_STATE["status"] = "recording"
                    frames = []
                    try: stream = p.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True, input_device_index=CONFIG["mic_index"], frames_per_buffer=1024)
                    except: stream = p.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True, frames_per_buffer=1024)
            
            elif is_pressed and was_pressed:
                if stream and GLOBAL_STATE["status"] == "recording":
                    try: frames.append(stream.read(1024, exception_on_overflow=False))
                    except: pass

            elif not is_pressed and was_pressed:
                if GLOBAL_STATE["status"] == "recording":
                    print("🛑 Stop")
                    if stream: stream.stop_stream(); stream.close(); stream = None
                    threading.Thread(target=transcribe_audio, args=(frames,)).start()

            was_pressed = is_pressed
        except: pass

# --- API ---
@app.get("/state")
def get_state(): return GLOBAL_STATE
@app.get("/history")
def get_history(): return list(HISTORY)
@app.get("/config")
def get_config(): return CONFIG
@app.get("/devices")
def get_devices():
    devices = []
    try:
        info = p.get_host_api_info_by_index(0)
        for i in range(0, info.get('deviceCount')):
            if (p.get_device_info_by_host_api_device_index(0, i).get('maxInputChannels')) > 0:
                devices.append({"index": i, "name": p.get_device_info_by_host_api_device_index(0, i).get('name')})
    except: pass
    return devices

@app.post("/settings")
def update_settings(s: Settings):
    # Si on change de modèle, on recharge
    if s.model_size != CONFIG["model_size"]:
        threading.Thread(target=load_model, args=(s.model_size,)).start()
    
    CONFIG["mic_index"] = s.mic_index
    CONFIG["model_size"] = s.model_size
    CONFIG["hotkey"] = s.hotkey.lower()
    
    save_config() # Sauvegarde immédiate
    return {"status": "updated"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")