async function loadConversations() {

    try {

        const response = await fetch("/conversations");
        const conversations = await response.json();

        const list = document.getElementById("conversation-list");

        if (!list) return;

        list.innerHTML = "";

        if (conversations.length === 0) {

            list.innerHTML = `
                <div class="conversation-item">
                    No Chats Yet
                </div>
            `;

            return;
        }

        conversations.forEach(conversation => {

            const item = document.createElement("div");

            item.className = "conversation-item";
            item.innerText = "💬 " + conversation.title;

            item.onclick = () => loadConversation(conversation.id);

            list.appendChild(item);

        });

    }

    catch (error) {

        console.error(error);

    }

}

async function loadConversation(id) {

    try {

        const response = await fetch(`/conversation/${id}`);
        const messages = await response.json();

        const chatBox = document.getElementById("chat-box");

        chatBox.innerHTML = "";

        messages.forEach(message => {

            const div = document.createElement("div");

            if (message.sender === "User") {

                div.className = "user-message";
                div.innerHTML = "👤 " + message.message;

            }

            else {

                div.className = "ai-message";
                div.innerHTML = "🤖 " + message.message;

            }

            chatBox.appendChild(div);

        });

        chatBox.scrollTop = chatBox.scrollHeight;

    }

    catch (error) {

        console.error(error);

    }

}

async function generateText() {

    const input = document.getElementById("prompt");

    const prompt = input.value.trim();

    if (prompt === "") return;

    const chatBox = document.getElementById("chat-box");

    const user = document.createElement("div");

    user.className = "user-message";
    user.innerHTML = "👤 " + prompt;

    chatBox.appendChild(user);

    input.value = "";

    const loading = document.createElement("div");

    loading.className = "ai-message";
    loading.id = "loading";
    loading.innerHTML = "✨ Thinking...";

    chatBox.appendChild(loading);

    chatBox.scrollTop = chatBox.scrollHeight;

    try {

        const response = await fetch("/generate", {

            method: "POST",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify({

                text: prompt

            })

        });

        const data = await response.json();

        loading.remove();

        const ai = document.createElement("div");

        ai.className = "ai-message";
        ai.innerHTML = "🤖 " + data.response;

        chatBox.appendChild(ai);

        chatBox.scrollTop = chatBox.scrollHeight;
        // Play the latest TTS audio 
        const audio = new Audio("/static/audio/response.wav?t=" + new Date().getTime());

        audio.onended = () => {

             if (voiceMode) {

                 startVoiceMode();

             }

        };

        audio.play().catch(error => {
         console.error("Audio playback failed:", error);
        });

        loadConversations();

    }

    catch (error) {

        console.error(error);

    }

}

window.addEventListener("DOMContentLoaded", () => {

    const prompt = document.getElementById("prompt");
    const send = document.getElementById("send-btn");
    const newChat = document.getElementById("new-chat");
    const mic = document.getElementById("mic-btn");
    const voice = document.getElementById("voice-btn");

    if (prompt) {

        prompt.addEventListener("keydown", e => {

            if (e.key === "Enter") {

                e.preventDefault();
                generateText();

            }

        });

    }

    if (send) {

        send.addEventListener("click", generateText);

    }

    if (newChat) {

        newChat.addEventListener("click", async () => {

            await fetch("/new_chat", {

                method: "POST"

            });

            document.getElementById("chat-box").innerHTML = `
                <div class="welcome">
                    <div class="ai-message">
                        ✨ Hello! I am <strong>Nova AI</strong><br><br>
                        How can I help you today?
                    </div>
                </div>
            `;

            loadConversations();

        });

    }

    if (mic) {

        mic.addEventListener("click", toggleRecording);

    }

    // if (voice) {

       // voice.addEventListener("click", toggleVoiceMode);

   // }

    loadConversations();

});

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentStream = null;

async function toggleRecording() {

    if (!isRecording) {

        startRecording();

    }

    else {

        stopRecording();

    }

}

async function startRecording() {

    try {

        currentStream = await navigator.mediaDevices.getUserMedia({

            audio: true

        });

        audioChunks = [];

        mediaRecorder = new MediaRecorder(currentStream);

        mediaRecorder.ondataavailable = event => {

            if (event.data.size > 0) {

                audioChunks.push(event.data);

            }

        };

        mediaRecorder.onstop = uploadRecording;

        mediaRecorder.start();

        isRecording = true;

        document.getElementById("mic-btn").innerHTML = "⏹ Stop";

    }

    catch (error) {

        console.error(error);

        alert("Unable to access microphone.");

    }

}

function stopRecording() {

    if (!mediaRecorder) return;

    if (mediaRecorder.state === "recording") {
        mediaRecorder.stop();
    }

    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    isRecording = false;

    document.getElementById("mic-btn").innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg"
width="20"
height="20"
viewBox="0 0 24 24"
fill="none"
stroke="currentColor"
stroke-width="2"
stroke-linecap="round"
stroke-linejoin="round">
<rect x="9" y="2" width="6" height="12" rx="3"></rect>
<path d="M5 10a7 7 0 0 0 14 0"></path>
<line x1="12" y1="19" x2="12" y2="22"></line>
<line x1="8" y1="22" x2="16" y2="22"></line>
</svg>`;
}

async function uploadRecording() {

    try {

        const audioBlob = new Blob(audioChunks, {
            type: "audio/webm"
        });

        const formData = new FormData();

        formData.append(
            "audio",
            audioBlob,
            "recording.webm"
        );

        const response = await fetch("/transcribe", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        document.getElementById("prompt").value = data.text;

        isRecording = false;

        if (data.text && data.text.trim() !== "") {
            generateText();
        }

    } catch (error) {

        console.error(error);

        alert("Failed to transcribe audio.");

        isRecording = false;

    }

}

let voiceMode = false;
let socket = null;

let voiceStream = null;
let voiceRecorder = null;
let voiceChunks = [];

function toggleVoiceMode() {

    const voiceBtn = document.getElementById("voice-btn");

    voiceMode = !voiceMode;

     if (voiceMode) {

     voiceBtn.classList.add("active");

     console.log("🎧 Voice Mode Enabled");

     startVoiceMode();

} 

    else {

        voiceBtn.classList.remove("active");

        if (voiceRecorder && voiceRecorder.state === "recording") {

            voiceRecorder.stop();

        }

        if (voiceStream) {

            voiceStream.getTracks().forEach(track => track.stop());

        }

        

    }

}

async function startVoiceMode() {

    try {

        voiceStream = await navigator.mediaDevices.getUserMedia({

            audio: true

        });

        voiceRecorder = new MediaRecorder(voiceStream);

        voiceChunks = [];

        voiceRecorder.ondataavailable = (event) => {

            if (event.data.size > 0) {

                voiceChunks.push(event.data);

            }

        };

         voiceRecorder.onstop = () => {

         sendVoiceChunk();

        };

        voiceRecorder.onstart = () => {

            console.log("🎤 Voice Mode Recording...");

        };

        voiceRecorder.start();

         setTimeout(() => {

            if (voiceRecorder.state === "recording") {

                 voiceRecorder.stop();

                 voiceStream.getTracks().forEach(track => track.stop());

           }

        }, 4000);

    }

    catch (error) {

        console.error(error);

    }

}

async function sendVoiceChunk() {

    console.log("✅ sendVoiceChunk() called");

    try {

        const blob = new Blob(voiceChunks, {
            type: "audio/webm"
        });

        console.log("Blob size:", blob.size);

        voiceChunks = [];

        const formData = new FormData();
        formData.append("audio", blob, "voice.webm");

        console.log("Sending to /transcribe...");

        const response = await fetch("/transcribe", {
            method: "POST",
            body: formData
        });

        console.log("Response status:", response.status);

        const data = await response.json();

        if (data.text && data.text.trim() !== "") {

        
            console.log("Text received:", data.text);

            document.getElementById("prompt").value = data.text;

            console.log("Calling generateText()");

            generateText();

        }

    }
    catch (error) {

        console.error("sendVoiceChunk Error:", error);

    }

}