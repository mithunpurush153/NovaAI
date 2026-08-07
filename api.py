from sarvamai import SarvamAI
import os
import json
import psycopg2
import time

from fastapi import FastAPI, Request, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from twilio.rest import Client

from pydantic import BaseModel

from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    pipeline
)

from faster_whisper import WhisperModel

from tts import speak

app = FastAPI() 

app.mount(
    "/static",
    StaticFiles(directory="static"),
    name="static"
)

templates = Jinja2Templates(directory="templates")

client = Client(
    os.getenv("TWILIO_ACCOUNT_SID"),
    os.getenv("TWILIO_AUTH_TOKEN")
)

TWILIO_PHONE = os.getenv("TWILIO_PHONE_NUMBER")

# -----------------------------
# Global Variables
# -----------------------------

conversation_history = []

current_user_id = None

current_conversation_id = None

survey_questions = [
    "What is your name?",
    "Which village are you from?",
    "Which crop are you cultivating?",
    "How many acres of land do you own?",
    "How many years have you been farming?"
]

# Index shortcuts so validation code doesn't rely on magic numbers
Q_NAME, Q_VILLAGE, Q_CROP, Q_ACRES, Q_EXPERIENCE = range(5)


# -----------------------------
# Load Qwen Model
# -----------------------------

model_name = "/models/SmolLM2-360M-Instruct"

tokenizer = AutoTokenizer.from_pretrained(model_name)

model = AutoModelForCausalLM.from_pretrained(model_name)

pipe = pipeline(
    "text-generation",
    model=model,
    tokenizer=tokenizer
)

# -----------------------------
# Load Whisper Model
# -----------------------------

whisper_model = WhisperModel(
    "/models/faster-whisper-base",
    device="cpu",
    compute_type="int8",
    cpu_threads=os.cpu_count(),
    num_workers=1
)

client = SarvamAI(
    api_subscription_key=os.getenv("SARVAM_API_KEY")
)

# -----------------------------
# Request Models
# -----------------------------

class Prompt(BaseModel):
    text: str


class User(BaseModel):
    username: str
    password: str


# -----------------------------
# PostgreSQL Connection
# -----------------------------

def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "nova_ai"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "Mithun153#@"),
        port=os.getenv("DB_PORT", "5432")
    )

# -----------------------------
# AI Response Generator
# -----------------------------

def generate_text(prompt):

    global conversation_history

    if len(conversation_history) == 0:

        conversation_history.append(

            {
                "role": "system",
                "content": "You are a helpful AI assistant. Give complete accurate answers in 4 to 5 complete sentences."
            }

        )

    conversation_history.append(

        {
            "role": "user",
            "content": prompt
        }

    )

    chat = tokenizer.apply_chat_template(

        conversation_history,

        tokenize=False,

        add_generation_prompt=True

    )

    output = pipe(

        chat,

        max_new_tokens=60,

        temperature=0.2,

        top_p=0.8,

        do_sample=False

    )

    generated = output[0]["generated_text"]

    answer = generated[len(chat):].strip()

    conversation_history.append(

        {
            "role": "assistant",
            "content": answer
        } 

    )

    if len(conversation_history) > 21:

        conversation_history = [

            conversation_history[0]

        ] + conversation_history[-20:]

    return answer
import tempfile

@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
            temp_audio.write(await audio.read())
            temp_path = temp_audio.name

        segments, info = whisper_model.transcribe(
            temp_path,
            language="en",
            vad_filter=True,
            beam_size=1,
            condition_on_previous_text=False
        )        
        

        text = " ".join(segment.text for segment in segments).strip()

        os.remove(temp_path)

        return JSONResponse({
            "text": text
        })

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": str(e)
            }
        )


# -----------------------------
# Pages
# -----------------------------

@app.get("/", response_class=HTMLResponse)
def home(request: Request):

    return templates.TemplateResponse(

        request=request,

        name="index.html"

    )

@app.get("/voice", response_class=HTMLResponse)
def voice_page(request: Request):

    return templates.TemplateResponse(
        request=request,
        name="voice.html"
    )


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):

    return templates.TemplateResponse(

        request=request,

        name="login.html"

    )


@app.get("/register", response_class=HTMLResponse)
def register_page(request: Request):

    return templates.TemplateResponse(

        request=request,

        name="register.html"

    )


# -----------------------------
# Register
# -----------------------------

@app.post("/register")
def register(user: User):

    connection = get_connection()

    cursor = connection.cursor()

    try:

        cursor.execute(

            """
            INSERT INTO users(username,password)
            VALUES(%s,%s)
            """,

            (
                user.username,
                user.password
            )

        )

        connection.commit()

        return {

            "message": "Registration Successful!"

        }

    except psycopg2.errors.UniqueViolation:

        connection.rollback()

        return {

            "message": "Username already exists!"

        }

    finally:

        cursor.close()

        connection.close()


# -----------------------------
# Login
# -----------------------------

@app.post("/login")
def login(user: User):

    global current_user_id

    global current_conversation_id

    global conversation_history

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute(

        """
        SELECT id
        FROM users
        WHERE username=%s
        AND password=%s
        """,

        (
            user.username,
            user.password
        )

    )

    account = cursor.fetchone()

    cursor.close()

    connection.close()

    if account:

        current_user_id = account[0]

        current_conversation_id = None

        conversation_history = []

        return {

            "success": True

        }

    return {

        "success": False,

        "message": "Invalid Username or Password"

    }
# -----------------------------
# Generate Response
# -----------------------------

@app.post("/generate")
def generate(prompt: Prompt):

    global current_user_id
    global current_conversation_id

    if current_user_id is None:

        return {
            "response": "Please login first."
        }

    connection = get_connection()
    cursor = connection.cursor()

    # ------------------------------------
    # Create Conversation (Only Once)
    # ------------------------------------

    if current_conversation_id is None:

        title = prompt.text

        if len(title) > 40:
            title = title[:40]

        cursor.execute(
            """
            INSERT INTO conversations(user_id,title)
            VALUES(%s,%s)
            RETURNING id
            """,
            (
                current_user_id,
                title
            )
        )

        current_conversation_id = cursor.fetchone()[0]

        connection.commit()

    # ------------------------------------
    # Store User Message
    # ------------------------------------

    cursor.execute(
        """
        INSERT INTO chats
        (
            conversation_id,
            user_id,
            sender,
            message
        )
        VALUES(%s,%s,%s,%s)
        """,
        (
            current_conversation_id,
            current_user_id,
            "User",
            prompt.text
        )
    )

    connection.commit()

    # ------------------------------------
    # Generate AI Response
    # ------------------------------------

    answer = generate_text(prompt.text)
    speak(answer)

    # ------------------------------------
    # Store AI Message
    # ------------------------------------

    cursor.execute(
        """
        INSERT INTO chats
        (
            conversation_id,
            user_id,
            sender,
            message
        )
        VALUES(%s,%s,%s,%s)
        """,
        (
            current_conversation_id,
            current_user_id,
            "AI",
            answer
        )
    )

    connection.commit()

    cursor.close()
    connection.close()

    return {
        "response": answer
    }
# -----------------------------
# Start New Chat
# -----------------------------

@app.post("/new_chat")
def new_chat():

    global current_conversation_id
    global conversation_history

    current_conversation_id = None
    conversation_history = []

    return {
        "success": True
    }


# -----------------------------
# Get All Conversations
# -----------------------------

@app.get("/conversations")
def get_conversations():

    global current_user_id

    if current_user_id is None:

        return []

    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT id,title,created_at
        FROM conversations
        WHERE user_id=%s
        ORDER BY created_at DESC
        """,
        (current_user_id,)
    )

    rows = cursor.fetchall() 

    cursor.close()
    connection.close()

    conversations = []

    for row in rows:

        conversations.append(
            {
                "id": row[0],
                "title": row[1],
                "created_at": str(row[2])
            }
        )

    return conversations


# -----------------------------
# Load One Conversation
# -----------------------------

@app.get("/conversation/{conversation_id}")
def load_conversation(conversation_id: int):

    global current_user_id
    global current_conversation_id
    global conversation_history

    if current_user_id is None:

        return []

    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT sender,message
        FROM chats
        WHERE conversation_id=%s
        ORDER BY created_at
        """,
        (conversation_id,)
    )

    rows = cursor.fetchall()

    cursor.close()
    connection.close()

    current_conversation_id = conversation_id

    conversation_history = [
        {
            "role": "system",
            "content": "You are a helpful AI assistant. Give complete accurate answers in 4 to 5 complete sentences."
        }
    ]

    for sender, message in rows:

        if sender == "User":

            conversation_history.append(
                {
                    "role": "user",
                    "content": message
                }
            )

        else:

            conversation_history.append(
                {
                    "role": "assistant",
                    "content": message
                }
            )

    messages = []

    for sender, message in rows:

        messages.append(
            {
                "sender": sender,
                "message": message
            }
        )

    return messages

@app.get("/logout")
def logout():

    global current_user_id
    global current_conversation_id
    global conversation_history

    current_user_id = None
    current_conversation_id = None
    conversation_history = []

    return RedirectResponse(url="/login", status_code=302)

@app.get("/survey", response_class=HTMLResponse)
async def survey_page(request: Request):
    return templates.TemplateResponse(
        "survey.html",
        {"request": request}
    )


@app.get("/survey_voice", response_class=HTMLResponse)
async def survey_voice_page(request: Request):
    return templates.TemplateResponse(
        "survey_voice.html",
        {"request": request}
    )

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):

    await websocket.accept()

    print("✅ Voice client connected")

    audio_chunks = []

    try:

        while True:

            message = await websocket.receive()

            if "bytes" in message and message["bytes"] is not None:

                audio_chunks.append(message["bytes"])

                print(f"Chunk received: {len(message['bytes'])} bytes")

            elif "text" in message: 

                 if message["text"] == "END":

                     print("Recording completed")

                     # Save audio chunks into a temporary .webm file
                     with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:

                             for chunk in audio_chunks:
                                  temp_audio.write(chunk)

                             temp_audio_path = temp_audio.name 

                             print("Saved:", temp_audio_path)

                             # Transcribe using Whisper
                             start = time.time()

                             segments, info = whisper_model.transcribe(
                                temp_audio_path,
                                language="en",
                                vad_filter=True,
                                beam_size=1,
                                condition_on_previous_text=False 
                     )

                             print(f"🎤 Whisper Time: {time.time() - start:.2f} sec")

                             user_text = ""

                             for segment in segments:
                              user_text += segment.text + " "

                             user_text = user_text.strip()

                             print("User:", user_text)

                             os.remove(temp_audio_path)

                             # If Whisper heard nothing, don't send an empty turn through
                             # the pipeline — just go back to listening.
                             if user_text == "":

                                 await websocket.send_text("🎤 Listening...")

                                 audio_chunks.clear() 

                                 continue

                             # Send transcript to browser
                             await websocket.send_text(f"USER:{user_text}")

                             # Generate AI response
                             start = time.time()

                             ai_response = generate_text(user_text)

                             print(f"🧠 Qwen Time: {time.time() - start:.2f} sec")

                             print("Nova:", ai_response)

                             # Generate speech for the response
                             # (this was missing before — voice.js had nothing to play)
                             speak(ai_response)

                             # Send AI response text
                             await websocket.send_text(f"AI:{ai_response}")

                             # Tell the client the audio is ready — cache-bust with a timestamp
                             await websocket.send_text(
                                 f"AUDIO:/static/audio/response.wav?t={time.time()}"
                             )

                             audio_chunks.clear()

    except WebSocketDisconnect:

        print("❌ Voice client disconnected")

 
def save_survey_answer(mobile_number, question, answer_text):

    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        INSERT INTO survey_answers
        (mobile_number, question, answer)
        VALUES (%s, %s, %s)
        """,
        (
            mobile_number,
            question,
            answer_text
        )
    )

    connection.commit()

    cursor.close()
    connection.close()


# -----------------------------
# Survey Results — validation
# -----------------------------

import re

ALLOWED_CROPS = {"rice", "wheat", "cotton", "maize", "sugarcane","beans"}

MAX_ACRES = 5
MIN_ACRES = 1
MIN_EXPERIENCE = 1
MAX_EXPERIENCE = 70

_WORD_NUMBERS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100
}


def extract_number(text):
    """
    Pulls a number out of free-text voice-transcribed answers.
    Handles both digits ("7 acres") and spoken words ("seven acres"),
    since Sarvam may or may not normalize numbers to digits.
    """

    if not text:
        return None

    match = re.search(r"\d+(\.\d+)?", text)

    if match:
        return float(match.group())

    words = re.findall(r"[a-zA-Z]+", text.lower())

    total = 0
    found = False

    for word in words:

        if word in _WORD_NUMBERS:

            value = _WORD_NUMBERS[word]
            found = True

            if value == 100:
                total = (total or 1) * 100
            else:
                total += value

    return float(total) if found else None


def validate_farmer(name, village, crop, acres_raw, experience_raw):
    """
    Runs every field through its business rule and returns a structured
    report: per-field pass/fail with a human-readable message, plus the
    parsed numeric values and an overall status.
    """

    issues = []
    all_ok = True

    # --- Name ---
    if not (name or "").strip():
        issues.append({"field": "Name", "ok": False, "message": "Name cannot be empty."})
        all_ok = False
    else:
        issues.append({"field": "Name", "ok": True, "message": "Name provided."})

    # --- Village ---
    if not (village or "").strip():
        issues.append({"field": "Village", "ok": False, "message": "Village not provided."})
        all_ok = False
    else:
        issues.append({"field": "Village", "ok": True, "message": "Village provided."})

    # --- Crop ---
    crop_clean = (crop or "").strip().lower()

    if crop_clean not in ALLOWED_CROPS:
        issues.append({
            "field": "Crop",
            "ok": False,
            "message": f"Invalid crop entered: '{crop}'."
        })
        all_ok = False
    else:
        issues.append({"field": "Crop", "ok": True, "message": "Crop is valid."})

    # --- Acres ---
    acres_value = extract_number(acres_raw)

    if acres_value is None:
        issues.append({
            "field": "Acres",
            "ok": False,
            "message": f"Could not read a number from '{acres_raw}'."
        })
        all_ok = False
    elif acres_value > MAX_ACRES:
        issues.append({
            "field": "Acres",
            "ok": False,
            "message": f"Acre limit exceeded. Allowed: {MAX_ACRES} Acres, Entered: {acres_value:g} Acres."
        })
        all_ok = False
    elif acres_value < MIN_ACRES:
        issues.append({
            "field": "Acres",
            "ok": False,
            "message": f"Acres seems too low: {acres_value:g}."
        })
        all_ok = False
    else:
        issues.append({
            "field": "Acres",
            "ok": True,
            "message": f"Acres valid ({acres_value:g})."
        })

    # --- Farming Experience ---
    experience_value = extract_number(experience_raw)

    if experience_value is None:
        issues.append({
            "field": "Farming Experience",
            "ok": False,
            "message": f"Could not read a number from '{experience_raw}'."
        })
        all_ok = False
    elif experience_value < MIN_EXPERIENCE:
        issues.append({
            "field": "Farming Experience",
            "ok": False,
            "message": "Farmer has less than 1 year of farming experience."
        })
        all_ok = False
    elif experience_value > MAX_EXPERIENCE:
        issues.append({
            "field": "Farming Experience",
            "ok": False,
            "message": "Please verify farming experience."
        })
        all_ok = False
    else:
        issues.append({
            "field": "Farming Experience",
            "ok": True,
            "message": f"Farming experience valid ({experience_value:g} years)."
        })

    return {
        "acres": acres_value,
        "experience": experience_value,
        "issues": issues,
        "status": "OK" if all_ok else "Needs Review"
    }


def get_latest_answers(cursor, mobile_number):
    """
    A farmer may (in theory) redo the survey. This returns only the most
    recent answer for each question, keyed by the exact question text.
    """

    cursor.execute(
        """
        SELECT question, answer
        FROM survey_answers
        WHERE mobile_number = %s
        ORDER BY id DESC
        """,
        (mobile_number,)
    )

    rows = cursor.fetchall()

    answers = {}

    for question, answer in rows:
        if question not in answers:
            answers[question] = answer

    return answers


def build_farmer_record(cursor, mobile_number):

    answers = get_latest_answers(cursor, mobile_number)

    name = answers.get(survey_questions[Q_NAME], "")
    village = answers.get(survey_questions[Q_VILLAGE], "")
    crop = answers.get(survey_questions[Q_CROP], "")
    acres_raw = answers.get(survey_questions[Q_ACRES], "")
    experience_raw = answers.get(survey_questions[Q_EXPERIENCE], "")

    result = validate_farmer(name, village, crop, acres_raw, experience_raw)

    return {
        "mobile": mobile_number,
        "name": name,
        "village": village,
        "crop": crop,
        "acres_raw": acres_raw,
        "experience_raw": experience_raw,
        "acres": result["acres"],
        "experience": result["experience"],
        "issues": result["issues"],
        "status": result["status"]
    }


# -----------------------------
# Survey Results — pages + data
# -----------------------------

@app.get("/survey/results", response_class=HTMLResponse)
async def survey_results_page(request: Request):
    return templates.TemplateResponse(
        "survey_results.html",
        {"request": request}
    )


@app.get("/survey/results/data")
def survey_results_data():

    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT DISTINCT mobile_number
        FROM survey_answers
        ORDER BY mobile_number
        """
    )

    mobiles = [row[0] for row in cursor.fetchall()]

    farmers = [build_farmer_record(cursor, mobile) for mobile in mobiles]

    cursor.close()
    connection.close()

    return farmers


@app.get("/survey/results/{mobile}", response_class=HTMLResponse)
async def survey_result_detail_page(request: Request, mobile: str):
    return templates.TemplateResponse(
        "survey_result_detail.html",
        {"request": request, "mobile": mobile}
    )


@app.get("/survey/results/{mobile}/data")
def survey_result_detail_data(mobile: str):

    connection = get_connection()
    cursor = connection.cursor()

    record = build_farmer_record(cursor, mobile)

    cursor.close()
    connection.close()

    if not record["name"] and not record["village"] and not record["crop"]:
        return JSONResponse(
            status_code=404,
            content={"error": "No survey found for this mobile number."}
        )

    return record


def upsert_survey_answer(cursor, mobile_number, question, answer_text):
    """
    Edits update the existing latest row for that question instead of
    appending a new one, so editing doesn't create duplicate history.
    If no answer exists yet for that question, it's inserted fresh.
    """

    cursor.execute(
        """
        SELECT id
        FROM survey_answers
        WHERE mobile_number = %s AND question = %s
        ORDER BY id DESC
        LIMIT 1
        """,
        (mobile_number, question)
    )

    row = cursor.fetchone()

    if row:
        cursor.execute(
            "UPDATE survey_answers SET answer = %s WHERE id = %s",
            (answer_text, row[0])
        )
    else:
        cursor.execute(
            """
            INSERT INTO survey_answers (mobile_number, question, answer)
            VALUES (%s, %s, %s)
            """,
            (mobile_number, question, answer_text)
        )


class FarmerUpdate(BaseModel):
    name: str
    village: str
    crop: str
    acres: str
    experience: str


@app.put("/survey/results/{mobile}/data")
def update_farmer(mobile: str, data: FarmerUpdate):

    connection = get_connection()
    cursor = connection.cursor()

    upsert_survey_answer(cursor, mobile, survey_questions[Q_NAME], data.name)
    upsert_survey_answer(cursor, mobile, survey_questions[Q_VILLAGE], data.village)
    upsert_survey_answer(cursor, mobile, survey_questions[Q_CROP], data.crop)
    upsert_survey_answer(cursor, mobile, survey_questions[Q_ACRES], data.acres)
    upsert_survey_answer(cursor, mobile, survey_questions[Q_EXPERIENCE], data.experience)

    connection.commit()

    record = build_farmer_record(cursor, mobile)

    cursor.close()
    connection.close()

    return record


@app.delete("/survey/results/{mobile}/data")
def delete_farmer(mobile: str):

    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        "DELETE FROM survey_answers WHERE mobile_number = %s",
        (mobile,)
    )

    deleted_rows = cursor.rowcount

    connection.commit()

    cursor.close()
    connection.close()

    if deleted_rows == 0:
        return JSONResponse(
            status_code=404,
            content={"error": "No survey found for this mobile number."}
        )

    return {"success": True}


@app.websocket("/survey_ws")
async def survey_websocket(websocket: WebSocket):

    await websocket.accept()

    print("✅ Voice survey client connected")

    mobile_number = None
    current_index = 0
    audio_chunks = []

    try:

        while True:

            message = await websocket.receive()

            # ------------------------------------
            # Audio chunk from the mic — buffer it
            # ------------------------------------

            if "bytes" in message and message["bytes"] is not None:

                audio_chunks.append(message["bytes"])
                continue

            if "text" not in message or message["text"] is None:
                continue

            raw_text = message["text"]

            # ------------------------------------
            # "END" marks the end of a spoken answer.
            # Everything else on the text channel is JSON control data.
            # ------------------------------------

            if raw_text == "END":

                if mobile_number is None:

                    audio_chunks.clear()

                    await websocket.send_json({
                        "type": "error",
                        "message": "Survey not started."
                    })

                    continue

                with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:

                    for chunk in audio_chunks:
                        temp_audio.write(chunk)

                    temp_audio_path = temp_audio.name

                audio_chunks.clear()

                start = time.time()

                answer_text = ""

                try:
                    response = client.speech_to_text.transcribe(
                        file=open(temp_audio_path, "rb"),
                        model="saaras:v3",
                        mode="transcribe",
                        language_code="en-IN"

                    )

                    print("========== SARVAM RESPONSE ==========")
                    print(response)
                    print("=====================================")

                    answer_text = (getattr(response, "transcript", None) or "").strip()

                except Exception as e:
                    print("SARVAM ERROR:", e)
                    answer_text = ""

                print(f"🎤 Survey Sarvam Time: {time.time() - start:.2f} sec — '{answer_text}'")

                os.remove(temp_audio_path)

                # Sarvam heard nothing usable — ask the client to listen again
                # for the SAME question, without re-asking it out loud.
                if answer_text == "":

                    await websocket.send_json({
                        "type": "retry",
                        "message": "Sorry, I didn't catch that. Please try again."
                    })

                    continue

                # Save the answer for the question that was just asked
                save_survey_answer(
                    mobile_number,
                    survey_questions[current_index],
                    answer_text
                )

                current_index += 1

                if current_index < len(survey_questions):

                    next_question = survey_questions[current_index]

                    speak(next_question)

                    await websocket.send_json({
                        "type": "question",
                        "index": current_index,
                        "total": len(survey_questions),
                        "is_last": current_index == len(survey_questions) - 1,
                        "text": next_question,
                        "user_text": answer_text,
                        "audio": f"/static/audio/response.wav?t={time.time()}"
                    })

                else:

                    thank_you = "Thank you. Your survey is complete."

                    speak(thank_you)

                    await websocket.send_json({
                        "type": "complete",
                        "message": thank_you,
                        "user_text": answer_text,
                        "audio": f"/static/audio/response.wav?t={time.time()}"
                    })

                    mobile_number = None
                    current_index = 0

                continue

            # ------------------------------------
            # JSON control messages (currently just "start")
            # ------------------------------------

            try:
                data = json.loads(raw_text)
            except ValueError:
                continue

            if data.get("type") == "start":

                mobile_number = data.get("mobile", "").strip()
                current_index = 0
                audio_chunks.clear()

                if mobile_number == "":

                    mobile_number = None

                    await websocket.send_json({
                        "type": "error",
                        "message": "Mobile number is required."
                    })

                    continue

                first_question = survey_questions[current_index]

                speak(first_question)

                await websocket.send_json({
                    "type": "question",
                    "index": current_index,
                    "total": len(survey_questions),
                    "is_last": current_index == len(survey_questions) - 1,
                    "text": first_question,
                    "audio": f"/static/audio/response.wav?t={time.time()}"
                })

    except WebSocketDisconnect:

        print("❌ Voice survey client disconnected")