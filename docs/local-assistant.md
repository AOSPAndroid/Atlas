# Local Assistant

A small language model that runs on your own PC and helps with three jobs:

- **Notes → Knowledge Base article.** In Knowledge Base, choose **New article… → Draft from notes with the Assistant…**, paste rough notes and/or tick files from your notes folders, then **Draft article**. The draft opens in the normal article editor. Nothing is saved until you click **Create article**.
- **Reading a request.** In Live Inbox (and under **Read from screen**), click **Read with Assistant** on the Assistant card. It gives a one-line summary, what the user asks for, the details they mention, up to three questions to ask, and steps taken from your own articles and note files, each with a link to its source.
- **Your notes in Search everything.** Files in the folders you choose (a whole drive such as `F:\` works) are searched together with articles, requests, deployments and diagrams. Open one to read it or to draft an article from it.
- **Importing a whole drive.** **New article… → Import knowledge from folders…** turns years of notes into a review queue of drafts. See [Import a drive of notes](#import-a-drive-of-notes).

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

### Without llama-server.exe: the Python library

If downloaded programs are blocked, or you prefer pip packages, use the **llama-cpp-python** library instead. Double-click **Install-Assistant.bat**. It installs ready-built packages only (no compiler, no CUDA toolkit) into the same Python 3.12 as Atlas:

| Your PC | What it installs | Model to use |
| --- | --- | --- |
| NVIDIA graphics card (found with `nvidia-smi`) | llama-cpp-python 0.3.4 for CUDA 12.4, plus NVIDIA's CUDA runtime and cuBLAS from pip (about 600 MB) | `Qwen2.5-7B-Instruct-Q4_K_M.gguf` (4.7 GB, huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF) |
| No NVIDIA card, or `Install-Assistant.bat --cpu` | llama-cpp-python 0.3.19 for the processor | `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` (2.5 GB) |

The ready-built graphics-card package is an older release (December 2024) and **cannot read Qwen3 models**: use Qwen2.5-7B-Instruct with it. It needs an NVIDIA driver that supports CUDA 12.4 (version 550 or later). The processor build reads Qwen3 but is several times slower than a graphics card.

Then put the model in `llm` and leave `llama-server.exe` out of that folder: when there is no `llama-server.exe`, Atlas runs the model with the library in a separate Python process (`assistant_worker.py`), on `127.0.0.1` only, stopped when idle like llama-server. Everything else (checks, drafts, import) is the same. pip needs to reach `pypi.org` and `abetlen.github.io` (where the ready-built packages are published).

If you already run an OpenAI-compatible server on this PC, put its address (for example `http://127.0.0.1:8080`) under **Graphics card and advanced → Existing model server**. Only addresses on this PC are accepted.

Speed, as a guide: on an 8 GB NVIDIA card a 4B model writes a draft in about 10–20 seconds; on a 4-core processor alone it takes about 2 minutes.

## Import a drive of notes

1. Add the drive or folder (for example `F:\`) under **Notes folders** in Assistant settings and save. Atlas starts indexing it for Search everything straight away, in the background: system, program, recycle-bin and code folders are skipped, files over 5 MB are skipped, and only new or changed files are read again later (every 10 minutes). Settings shows how far it is. Search works without the model.
2. **Knowledge Base → New article… → Import knowledge from folders…** Choose the folder (or a folder inside it), optionally a date ("changed since") and the file types, then **Count files**: Atlas shows how many files there are, how many are new, and an estimate of the time.
3. **Start import.** The Assistant goes through the files one at a time:
   - very short files (under 80 characters) are skipped;
   - copies of a file already imported (same text, any name) are skipped;
   - logs and data exports are recognised in code (mostly timestamped lines, or mostly rows of values) and skipped; `.log`, `.csv`, `.json` and `.xml` files also start unticked;
   - the model then answers one short question about the beginning of the file: what kind of document is it? Only a fix or how-to, a known issue and workaround, a procedure or checklist, or an IT reference (contacts, settings, escalation rules) goes on; invoices, orders, meeting notes, personal and unrelated documents are skipped with its reason;
   - everything else becomes a **draft**, checked line by line exactly like **Draft from notes**. A draft that has no steps, symptoms, cause, commands or escalation (only a summary) is flagged, so it is never published by **Publish clean drafts**.

   Progress, time left and the current file are shown; **Pause**, **Resume** and **Stop** work at any time. Your own Assistant requests (reading a request, drafting from notes) go first: the import waits for them. Progress is saved, so a stopped or interrupted import continues where it left off, and files already imported are skipped unless they changed. Leave it running overnight for a large drive: at 10–20 seconds per file on an 8 GB graphics card, 1,000 knowledge files take 3–6 hours.
4. **Review.** The **Review imported drafts (N)** button above the article list opens the queue, clean drafts first. For each draft: **Publish**, **Edit, then publish** (the full editor, with the check panel), **Reject** (not drafted again unless the file changes) or **Open the file**. **Publish N clean drafts** publishes every draft whose lines all passed the checks, except drafts made from shortened text.

Published articles are normal articles: searchable, suggested in Live Inbox for their issue types, and editable.

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

- The Assistant reads only the folders you list, read-only: `.txt .md .log .csv .json .ps1 .bat .cmd .xml .ini .yaml .reg .sql .py .html .eml .docx .pptx .xlsx`, and `.pdf` if `pypdf` is installed (`pip install pypdf`). Old `.doc`, `.xls` and Outlook `.msg` files are not read: save them as `.docx`, `.xlsx` or `.eml`. Files over 5 MB are skipped. Paths outside the chosen folders are refused. Up to 50,000 files are indexed (`"max_files"` under `"assistant"` in `config.json` changes it).
- Import progress and drafts are kept in `knowledge.sqlite3` (tables `import_files` and `article_drafts`).
- Text goes from Atlas to the model server on `127.0.0.1` and nowhere else. Nothing is stored except the article you save and the search index (`search-index.sqlite3`, a cache that is safe to delete).
- The model server's output is logged to `data\assistant-server.log` (startup messages only, not your text).
- Settings are saved under `"assistant"` in `config.json`: `server`, `model`, `url`, `gpu_layers`, `context`, `idle_minutes`, `folders`.

## Troubleshooting

| Message | What to do |
| --- | --- |
| No model file | Put a `.gguf` file in `llm`, or choose it in settings. |
| No model server found | Put `llama-server.exe` (and the cudart DLLs for NVIDIA) in `llm`, or run `Install-Assistant.bat`. |
| failed to load … with llama-cpp-python 0.3.4 | That model is newer than the graphics-card library (Qwen3): use Qwen2.5-7B-Instruct, or llama-server.exe. |
| cannot load llama-cpp-python | Run `Install-Assistant.bat` again; for the graphics-card build, update the NVIDIA driver, or use `Install-Assistant.bat --cpu`. |
| The model server stopped while loading: … out of memory | Use a smaller model or quantisation (Q4_K_M), lower **Context size** to 4096, or lower **GPU layers** (for example 28). |
| The model is still loading | The first start reads the whole model from disk; try again in a few seconds. |
| The Assistant is busy | One request at a time; wait for the current draft or reading to finish. |
| Long notes were shortened | Raise **Context size** (8192 → 16384 needs more video memory) or draft from fewer files. |
