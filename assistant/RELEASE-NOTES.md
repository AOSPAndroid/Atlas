Optional model package for **Ask Atlas**, available through the shared **Ctrl+K command palette** in Atlas and IT Console.

This release contains **Qwen3 4B**, using ONNX Community's INT4 KLD export for CPU inference through the ONNX Runtime GenAI Python package. The model runs on the Atlas host through process pipes, with no Ollama, llama.cpp, additional AI server or listening port.

The assistant explains existing information and offers IT troubleshooting guidance. Its answers are suggestions to review against the available evidence. It cannot run commands, launch machine scans or change database records. **Every machine scan still requires its Scan button.** Opening the palette does not load the model.

To install, download and extract the Atlas project, then run `Install_Atlas_Assistant.bat`. Setup installs the optional Python environment, downloads these model assets and verifies their SHA-256 checksums. Allow approximately **2.9 GB** for the model download, plus Python dependencies and temporary installation space. No cloud AI account or API key is required; answering questions works offline after setup.

For an offline transfer, include all release assets and the required Python wheels in a `wheels` subfolder, then pass that folder to `Install_Atlas_Assistant.bat`. The model data is split into three parts to fit GitHub's per-file limit; the installer joins and verifies them automatically. GitHub's source-code ZIP contains the integration and installer; model weights are the separate assets attached to this release.

The included `model-manifest.json` records every filename, size, checksum and upstream revision. The original model is licensed under **Apache 2.0**, with its complete license and Alibaba Cloud copyright notice included as `LICENSE`. License provenance is pinned separately because the ONNX export repository links to the original model but does not include its license file.

The distributed ONNX model, tokenizer and template files are unchanged from the pinned export. Atlas applies a template compatibility adjustment in memory and selects the model's non-thinking response mode; it does not modify the weights.

Sources: [ONNX export at revision 98ddba15d05dede4435afb63f13280abcdbc2a48](https://huggingface.co/onnx-community/Qwen3-4B-ONNX/tree/98ddba15d05dede4435afb63f13280abcdbc2a48/onnxruntime/cpu_and_mobile/cpu-int4-kld-block-128/), [original Qwen3-4B license at revision 1cfa9a7208912126459214e8b04321603b3df60c](https://huggingface.co/Qwen/Qwen3-4B/blob/1cfa9a7208912126459214e8b04321603b3df60c/LICENSE).

This optional model package has its own release tag and does not replace Atlas's latest application release.
