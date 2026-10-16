# Local Assistant

A small language model that runs on your own PC and helps with three jobs:

- **Notes → Knowledge Base article.** In Knowledge Base, choose **New article… → Draft from notes with the Assistant…**, paste rough notes and/or tick files from your notes folders, then **Draft article**. The draft opens in the normal article editor. Nothing is saved until you click **Create article**.
- **Reading a request.** In Live Inbox (and under **Read from screen**), click **Read with Assistant** on the Assistant card. It gives a one-line summary, what the user asks for, the details they mention, up to three questions to ask, and steps taken from your own articles and note files, each with a link to its source.
- **Your notes in Search everything.** Files in the folders you choose are searched together with articles, requests, deployments and diagrams. Open one to read it or to draft an article from it.

No cloud service, no Ollama. Atlas starts llama.cpp's `llama-server` itself, listening on `127.0.0.1` only, and stops it after 30 idle minutes to free the graphics card. The Demo viewer and Preview have no Assistant.

## Setup (about 10 minutes)

1. Download llama.cpp for Windows from <https://github.com/ggml-org/llama.cpp/releases> (latest release):
   - NVIDIA graphics card: `llama-<version>-bin-win-cuda-<cuda>-x64.zip` **and** the matching `cudart-llama-bin-win-cuda-<cuda>-x64.zip`;
   - other graphics cards: `llama-<version>-bin-win-vulkan-x64.zip`;
   - no graphics card: `llama-<version>-bin-win-cpu-x64.zip` (much slower).

   Unzip everything into the **`llm`** folder of Atlas (next to `backend`), so that `llm\llama-server.exe` exists. A subfolder is fine.
2. Download **one** model file (`.gguf`) into the same `llm` folder. With 8 GB of video memory:

   | Model | File size | Notes |
   | --- | --- | --- |
   | Qwen3-4B-Instruct-2507, `Q4_K_M` | 2.5 GB | Recommended start: fast, follows the format well. huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF |
   | Qwen3-8B, `Q4_K_M` | 5.0 GB | More careful wording, about half the speed. huggingface.co/Qwen/Qwen3-8B-GGUF |

   Larger models (12B and up) do not fit in 8 GB with room for the text. With 64 GB of RAM they can still run with **GPU layers** lowered (part on the processor), but slowly.
3. In Atlas: **Knowledge Base → New article… → Draft from notes with the Assistant… → Assistant settings**. Leave the two paths empty (Atlas finds them in `llm`), add your notes folders (one per line), **Save**, then **Start**. The first start loads the model (10–60 seconds); later requests start it by themselves.

If your PC blocks downloaded programs, the Python route works too: `pip install "llama-cpp-python[server]"` (a CUDA build is needed for the graphics card). Atlas uses it automatically when no `llama-server.exe` is present. If you already run an OpenAI-compatible server on this PC, put its address (for example `http://127.0.0.1:8080`) under **Graphics card and advanced → Existing model server**. Only addresses on this PC are accepted.

Speed, as a guide: on an 8 GB NVIDIA card a 4B model writes a draft in about 10–20 seconds; on a 4-core processor alone it takes about 2 minutes.

## How it avoids making things up

Small models invent details. Atlas does not trust the model; it checks every line in code:

1. **The model only sees your text.** Notes, the email or screen text, and (for requests) at most three of your own articles or note files that share distinctive words with it. It is told not to use outside knowledge, and it runs at temperature 0.
2. **Fixed answer format.** The answer must match a JSON schema (enforced by llama.cpp while it writes), so there is no free-form chat to go wrong. Issue types can only be ones Atlas knows.
3. **Every line carries a quote.** Each summary line, step, fact or ask comes with the exact words it is based on. Atlas checks that the quote really is in your text, and that the line says roughly what its quote says.
4. **Details are checked one by one.** Machine names, ticket numbers, error codes, IP and email addresses, paths, links, AD group names and numbers in a line must appear in the source. `LT-PAR-0043` is not `LT-PAR-0042`; `30` is not `3`.
5. **Commands are never rewritten.** A command must be in your notes as written. If the model garbled it, Atlas uses the line from your notes instead, or leaves it out and says so.
6. **Steps must cite a source.** When reading a request, each step names the article or note it came from, and its quote must be in that source.
7. **Issue types and tags come from your words.** An issue type is kept only when one of its keywords is in the notes, and a tag only when it appears in them.

What fails a check is **flagged** in a draft (a yellow panel lists each line and why, with **Remove from draft**), or **hidden** on the request card (listed under "N lines hidden" with the reason). Lines that quote your notes with small differences (typos, OCR) are noted but kept.

The checks cannot tell whether your notes are right, whether steps are in the best order, or whether a rephrased sentence still means the same thing. Read the draft before saving it, as you would a colleague's.

## Files and privacy

- The Assistant reads only the folders you list, read-only: `.txt .md .log .csv .json .ps1 .bat .cmd .xml .ini .yaml .reg .sql .py .html .eml .docx .pptx`, and `.pdf` if `pypdf` is installed. Files over 5 MB are skipped. Paths outside the chosen folders are refused.
- Text goes from Atlas to the model server on `127.0.0.1` and nowhere else. Nothing is stored except the article you save and the search index (`search-index.sqlite3`, a cache that is safe to delete).
- The model server's output is logged to `data\assistant-server.log` (startup messages only, not your text).
- Settings are saved under `"assistant"` in `config.json`: `server`, `model`, `url`, `gpu_layers`, `context`, `idle_minutes`, `folders`.

## Troubleshooting

| Message | What to do |
| --- | --- |
| No model file | Put a `.gguf` file in `llm`, or choose it in settings. |
| No model server found | Put `llama-server.exe` (and the cudart DLLs for NVIDIA) in `llm`. |
| The model server stopped while loading: … out of memory | Use a smaller model or quantisation (Q4_K_M), lower **Context size** to 4096, or lower **GPU layers** (for example 28). |
| The model is still loading | The first start reads the whole model from disk; try again in a few seconds. |
| The Assistant is busy | One request at a time; wait for the current draft or reading to finish. |
| Long notes were shortened | Raise **Context size** (8192 → 16384 needs more video memory) or draft from fewer files. |
