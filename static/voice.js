const socket = new WebSocket(`ws://${window.location.host}/ws`);

const conversation = document.getElementById("conversation");
const status = document.getElementById("voice-status");
const btn = document.getElementById("voiceBtn");

// ----------------------------
// Session / recording state
// ----------------------------

let sessionActive = false;   // true from Start click until user clicks Stop
let stream = null;           // mic stream, kept alive for the whole session
let recorder = null;         // MediaRecorder for the CURRENT utterance only

// VAD (silence detection) state
let audioContext = null;
let analyser = null;
let vadInterval = null;
let hasSpeech = false;
let silenceStart = null;

const SPEECH_THRESHOLD = 12;     // volume level that counts as "speaking" — tune to your mic
const SILENCE_DURATION = 900;    // ms of silence after speech before we consider the turn done

// ----------------------------
// WebSocket Connected
// ----------------------------

socket.onopen = () => {
    console.log("✅ Connected");
    status.innerText = "🟢 Ready";
};

// ----------------------------
// Chat bubbles
// ----------------------------

function addUserMessage(text) {

    conversation.innerHTML += `
        <div class="user-message">
            <div>${text}</div>
        </div>
    `;

    conversation.scrollTop = conversation.scrollHeight;
}

function addAIMessage(text) {

    conversation.innerHTML += `
        <div class="ai-message">
            <div>${text}</div>
        </div>
    `;

    conversation.scrollTop = conversation.scrollHeight;
}

// ----------------------------
// VAD — watches mic volume and auto-stops the recorder on silence
// ----------------------------

function startVAD() {

    audioContext = new AudioContext();
    const micSource = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    micSource.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);

    hasSpeech = false;
    silenceStart = null;

    vadInterval = setInterval(() => {

        analyser.getByteTimeDomainData(data);

        let sumSquares = 0;

        for (let i = 0; i < data.length; i++) {
            const val = data[i] - 128;
            sumSquares += val * val;
        }

        const rms = Math.sqrt(sumSquares / data.length);

        if (rms > SPEECH_THRESHOLD) {

            hasSpeech = true;
            silenceStart = null;

        } else if (hasSpeech) {

            if (silenceStart === null) {

                silenceStart = Date.now();

            } else if (Date.now() - silenceStart > SILENCE_DURATION) {

                // User has gone quiet after speaking — end this turn
                if (recorder && recorder.state === "recording") {
                    recorder.stop();
                }
            }
        }

    }, 100);
}

function stopVAD() {

    if (vadInterval) {
        clearInterval(vadInterval);
        vadInterval = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
}

// ----------------------------
// One turn of listening (auto-starts, auto-stops via VAD)
// ----------------------------

async function listenForUtterance() {

    if (!sessionActive) return;

    recorder = new MediaRecorder(stream);

    recorder.ondataavailable = (event) => {

        if (event.data.size > 0) {
            socket.send(event.data);
        }
    };

    recorder.onstop = () => {

        stopVAD();

        if (sessionActive) {
            socket.send("END");
            status.innerText = "🧠 Thinking...";
        }
    };

    recorder.start(1000);
    startVAD();

    status.innerText = "🎤 Listening...";
}

// ----------------------------
// Start / Stop the whole session
// ----------------------------

async function startSession() {

    if (sessionActive) return;

    try {

        stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

    } catch (error) {

        console.error(error);
        alert("Unable to access microphone.");
        return;
    }

    sessionActive = true;
    btn.innerText = "🛑 Stop Conversation";

    await listenForUtterance();
}

function stopSession() {

    sessionActive = false;

    stopVAD();

    if (recorder && recorder.state === "recording") {
        recorder.stop();
    }

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    btn.innerText = "🎤 Start Conversation";
    status.innerText = "Session ended.";
}

// ----------------------------
// Receive Messages
// ----------------------------

socket.onmessage = async (event) => {

    console.log("Server:", event.data);

    if (event.data.startsWith("USER:")) {

        addUserMessage(event.data.substring(5));

    } else if (event.data.startsWith("AI:")) {

        addAIMessage(event.data.substring(3));
        status.innerText = "🔊 Speaking...";

    } else if (event.data.startsWith("AUDIO:")) {

        const audio = new Audio(event.data.substring(6));

        audio.onended = () => {

            // Nova has actually finished talking — resume listening automatically
            if (sessionActive) {
                listenForUtterance();
            }
        };

        audio.onerror = () => {

            // If playback fails for any reason, don't get stuck — resume listening anyway
            if (sessionActive) {
                listenForUtterance();
            }
        };

        audio.play().catch((err) => {
            console.error("Audio playback failed:", err);
            if (sessionActive) {
                listenForUtterance();
            }
        });

    } else {

        status.innerText = event.data;
    }
};

// ----------------------------
// Button Click
// ----------------------------

btn.onclick = async () => {

    if (!sessionActive) {
        await startSession();
    } else {
        stopSession();
    }
};
