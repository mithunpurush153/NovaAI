const socket = new WebSocket(`ws://${window.location.host}/survey_ws`);

const conversation = document.getElementById("conversation");
const status = document.getElementById("voice-status");
const btn = document.getElementById("voiceBtn");
const voiceCircle = document.getElementById("voice-circle");

const progressWrap = document.getElementById("survey-progress-wrap");
const progressBar = document.getElementById("survey-progress-bar");
const stepLabel = document.getElementById("survey-step-label");
const completeCard = document.getElementById("complete-card");
const voiceMain = document.getElementById("voice-main");
const voiceChat = document.getElementById("voice-chat");
const currentQuestionEl = document.getElementById("survey-voice-question");

// ----------------------------
// Mobile number comes in from the survey.html redirect
// ----------------------------

const mobile = new URLSearchParams(window.location.search).get("mobile");

if (!mobile) {
    window.location.href = "/survey";
}

// ----------------------------
// Session / recording state (same VAD approach as voice.js)
// ----------------------------

let sessionActive = false;
let stream = null;
let recorder = null;

let audioContext = null;
let analyser = null;
let vadInterval = null;
let hasSpeech = false;
let silenceStart = null;

const SPEECH_THRESHOLD = 12;
const SILENCE_DURATION = 900;

// ----------------------------
// WebSocket Connected
// ----------------------------

socket.onopen = () => {
    console.log("✅ Connected to survey");
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

    voiceCircle.className = "voice-circle listening";

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
            voiceCircle.className = "voice-circle thinking";
            status.innerText = "🧠 Processing your answer...";
        }
    };

    recorder.start(1000);
    startVAD();

    status.innerText = "🎤 Listening... please answer";
}

// ----------------------------
// Start the voice survey
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

    btn.style.display = "none";
    progressWrap.style.display = "block";
    stepLabel.style.display = "block";

    status.innerText = "Starting survey...";

    socket.send(JSON.stringify({
        type: "start",
        mobile: mobile
    }));
}

function endSession() {

    sessionActive = false;

    stopVAD();

    if (recorder && recorder.state === "recording") {
        recorder.stop();
    }

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
}

// ----------------------------
// Receive Messages
// ----------------------------

socket.onmessage = async (event) => {

    const data = JSON.parse(event.data);

    console.log("Server:", data);

    if (data.type === "question") {

        if (data.user_text) {
            addUserMessage(data.user_text);
        }

        addAIMessage(data.text);

        const current = data.index + 1;
        const total = data.total;

        stepLabel.innerText = `Question ${current} of ${total}`;
        progressBar.style.width = `${(current / total) * 100}%`;

        currentQuestionEl.innerText = data.text;
        currentQuestionEl.style.display = "block";

        voiceCircle.className = "voice-circle speaking";
        status.innerText = "🔊 Speaking...";

        const audio = new Audio(data.audio);

        audio.onended = () => {
            if (sessionActive) listenForUtterance();
        };

        audio.onerror = () => {
            if (sessionActive) listenForUtterance();
        };

        audio.play().catch(err => {
            console.error("Audio playback failed:", err);
            if (sessionActive) listenForUtterance();
        });

    } else if (data.type === "retry") {

        status.innerText = data.message;

        // Resume listening for the SAME question, no need to replay audio.
        if (sessionActive) listenForUtterance();

    } else if (data.type === "complete") {

        if (data.user_text) {
            addUserMessage(data.user_text);
        }

        addAIMessage(data.message);

        voiceCircle.className = "voice-circle speaking";
        status.innerText = "🔊 Speaking...";

        const audio = new Audio(data.audio);

        const finish = () => {
            endSession();
            voiceMain.style.display = "none";
            voiceChat.style.display = "none";
            completeCard.style.display = "flex";
        };

        audio.onended = finish;
        audio.onerror = finish;

        audio.play().catch(err => {
            console.error("Audio playback failed:", err);
            finish();
        });

    } else if (data.type === "error") {

        alert(data.message);
        endSession();
        window.location.href = "/survey";
    }
};

// ----------------------------
// Button click
// ----------------------------

btn.onclick = async () => {
    await startSession();
};

// ----------------------------
// Release the mic if the user navigates away mid-survey
// ----------------------------

window.addEventListener("beforeunload", () => {
    if (sessionActive) endSession();
});