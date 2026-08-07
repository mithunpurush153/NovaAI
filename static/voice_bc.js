const socket = new WebSocket(`ws://${window.location.host}/ws`);

let recorder;
let stream;
let recording = false;

const conversation = document.getElementById("conversation");
const status = document.getElementById("voice-status");
const btn = document.getElementById("voiceBtn");

// ----------------------------
// WebSocket Connected
// ----------------------------

socket.onopen = () => {
    console.log("✅ Connected");
    status.innerText = "🟢 Ready";
};

// ----------------------------
// Add User Chat
// ----------------------------

function addUserMessage(text) {

    conversation.innerHTML += `
        <div class="user-message">
            <div>${text}</div>
        </div>
    `;

    conversation.scrollTop = conversation.scrollHeight;
}

// ----------------------------
// Add AI Chat
// ----------------------------

function addAIMessage(text) {

    conversation.innerHTML += `
        <div class="ai-message">
            <div>${text}</div>
        </div>
    `;

    conversation.scrollTop = conversation.scrollHeight;
}

// ----------------------------
// Start Recording
// ----------------------------

async function startRecording() {

    if (recording) return;

    stream = await navigator.mediaDevices.getUserMedia({
        audio: true
    });

    recorder = new MediaRecorder(stream);

    recorder.ondataavailable = (event) => {

        if (event.data.size > 0) {

            console.log("Sending audio chunk:", event.data.size);

            socket.send(event.data);

        }

    };

    recorder.onstop = () => {

        socket.send("END");

        console.log("Recording finished");

        stream.getTracks().forEach(track => track.stop());

    };

    recorder.start(1000);

    recording = true;

    btn.innerText = "🛑 Stop Voice Conversation";

    status.innerText = "🎤 Listening...";

}

// ----------------------------
// Receive Messages
// ----------------------------

socket.onmessage = async (event) => {

    console.log("Server:", event.data);

    if (event.data.startsWith("USER:")) {

        addUserMessage(event.data.substring(5));

    }

    else if (event.data.startsWith("AI:")) {

        addAIMessage(event.data.substring(3));

        status.innerText = "🔊 Speaking...";

        // Small delay so user can read the response
        setTimeout(async () => {

            status.innerText = "🎤 Listening...";

            await startRecording();

        }, 1000);

    }

    else {

        status.innerText = event.data;

    }

};

// ----------------------------
// Button Click
// ----------------------------

btn.onclick = async () => {

    if (!recording) {

        await startRecording();

    }

    else {

        recording = false;

        status.innerText = "🧠 Thinking...";

        recorder.stop();

    }

};