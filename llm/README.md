# Local Assistant files

Put the two files the Assistant needs here. They are not part of the Atlas repository.

1. **llama.cpp** for Windows, from https://github.com/ggml-org/llama.cpp/releases
   - NVIDIA graphics card: the `llama-...-bin-win-cuda-...-x64.zip` file **and** the matching `cudart-llama-bin-win-cuda-...-x64.zip`.
   - Other graphics cards: `llama-...-bin-win-vulkan-x64.zip`.
   - No graphics card: `llama-...-bin-win-cpu-x64.zip` (slower).

   Unzip into this folder, so that `llm\llama-server.exe` (or `llm\<any folder>\llama-server.exe`) exists.
2. **One model file** (`.gguf`). For an 8 GB graphics card:
   - `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` (about 2.5 GB, fast; from huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF), or
   - `Qwen3-8B-Q4_K_M.gguf` (about 5 GB, more careful; from huggingface.co/Qwen/Qwen3-8B-GGUF).

Atlas finds both files here by itself. See docs/local-assistant.md.
