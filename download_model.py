from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="Systran/faster-whisper-small.en",
    local_dir="./whisper-small-en",
)

print("✅ Download completed!")