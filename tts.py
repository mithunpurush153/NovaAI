import os
import wave
from piper.voice import PiperVoice

# -----------------------------
# Configuration
# -----------------------------
VOICE_MODEL = "piper_models/en_US-lessac-medium.onnx"
OUTPUT_FILE = "static/audio/response.wav"

# Create output folder if it doesn't exist
os.makedirs("static/audio", exist_ok=True)

# Load Piper model only once when the server starts
voice = PiperVoice.load(VOICE_MODEL)


def speak(text: str): 
    """
    Convert text to speech and save it as static/audio/response.wav
    """

    try:
        with wave.open(OUTPUT_FILE, "wb") as wav_file:
            voice.synthesize_wav(text, wav_file)

        return OUTPUT_FILE

    except Exception as e:
        print(f"TTS Error: {e}")
        return None