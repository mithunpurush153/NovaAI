import psycopg2

connection = psycopg2.connect(
    host="postgres",
    database="nova_ai",
    user="postgres",
    password="postgres",
    port="5432"
)

cursor = connection.cursor()

# Users Table
cursor.execute("""
CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL
)
""")

# Conversations Table
cursor.execute("""
CREATE TABLE IF NOT EXISTS conversations(
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
)
""")

# Chats Table
cursor.execute("""
CREATE TABLE IF NOT EXISTS chats(
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER,
    user_id INTEGER,
    sender VARCHAR(20),
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
)
""")


# Survey Answers Table
cursor.execute("""
CREATE TABLE IF NOT EXISTS survey_answers(
    id SERIAL PRIMARY KEY,
    mobile_number VARCHAR(20) NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
""")


connection.commit()

cursor.close()
connection.close()

print("PostgreSQL Database Ready!")