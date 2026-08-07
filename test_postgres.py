import psycopg2

connection = psycopg2.connect(
    host="localhost",
    database="nova_ai",
    user="postgres",
    password="Mithun153#@",
    port="5432"
)

print("✅ Connected Successfully!")

connection.close() 