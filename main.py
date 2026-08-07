from transformers import pipeline

pipe = pipeline(
    "text-generation",
    model="gpt2"
)

def generate_text(prompt):
    result = pipe(
        prompt,
        max_new_tokens=100,
        do_sample=True,
        temperature=0.8,
        top_p=0.95
    )
    return result[0]["generated_text"]

prompt = input("Enter your text: ")

generated_text = generate_text(prompt)

print("\nAI Generated Response:\n")
print(generated_text)