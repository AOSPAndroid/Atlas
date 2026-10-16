"""Local model worker for the Assistant, using the llama-cpp-python library instead of llama-server.exe.

Atlas starts it as a separate process (python assistant_worker.py --model ... --port ...) so a crash in
the native library cannot stop Atlas, and stopping the process frees the graphics card memory. It
answers the same small part of the OpenAI-style API that Atlas uses, on 127.0.0.1 only. Install the
library with Install-Assistant.bat.
"""
import argparse
import importlib.util
import os
import sys
import threading
from pathlib import Path


def add_cuda_dlls():
    """Windows: use the CUDA runtime from the nvidia-*-cu12 pip packages, so no CUDA toolkit is needed."""
    if os.name != 'nt':
        return
    for package in ('nvidia.cuda_runtime', 'nvidia.cublas'):
        try:
            spec = importlib.util.find_spec(package)
        except ModuleNotFoundError:
            continue
        for location in (spec.submodule_search_locations or []) if spec else []:
            folder = Path(location) / 'bin'
            if folder.is_dir():
                os.add_dll_directory(str(folder))
                os.environ['PATH'] = str(folder) + os.pathsep + os.environ.get('PATH', '')


def response_format(value):
    """OpenAI json_schema format -> llama-cpp-python's json_object with a schema (grammar-constrained)."""
    if not isinstance(value, dict):
        return None
    if value.get('type') == 'json_schema':
        return {'type': 'json_object', 'schema': (value.get('json_schema') or {}).get('schema') or {}}
    return value


def build_app(llm, model_name):
    from fastapi import FastAPI, HTTPException, Request
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    lock = threading.Lock()

    @app.get('/v1/models')
    def models():
        return {'object': 'list', 'data': [{'id': model_name, 'object': 'model'}]}

    @app.get('/health')
    def health():
        return {'status': 'ok'}

    @app.post('/v1/chat/completions')
    async def chat(request: Request):
        body = await request.json()
        messages = body.get('messages')
        if not isinstance(messages, list) or not messages:
            raise HTTPException(400, 'messages are required')
        options = {'temperature': float(body.get('temperature', 0)), 'top_p': float(body.get('top_p', 1)),
                   'max_tokens': int(body.get('max_tokens') or 1024), 'seed': body.get('seed')}
        schema = response_format(body.get('response_format'))
        if schema:
            options['response_format'] = schema
        with lock:  # one answer at a time, like llama-server with one slot
            result = llm.create_chat_completion(messages=messages, **options)
        return result
    return app


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--gpu-layers', type=int, default=99)
    parser.add_argument('--context', type=int, default=8192)
    args = parser.parse_args(argv)
    add_cuda_dlls()
    try:
        import llama_cpp
    except Exception as error:  # missing package or a DLL that will not load
        print(f'error: cannot load llama-cpp-python: {error}. Run Install-Assistant.bat.', flush=True)
        return 2
    gpu = bool(getattr(llama_cpp, 'llama_supports_gpu_offload', lambda: False)())
    print(f'llama-cpp-python {llama_cpp.__version__}, graphics card {"available" if gpu else "not used (CPU build)"}', flush=True)
    try:
        llm = llama_cpp.Llama(model_path=args.model, n_gpu_layers=args.gpu_layers if gpu else 0, n_ctx=args.context, verbose=False)
    except Exception as error:
        detail = str(error) or error.__class__.__name__
        print(f'error: failed to load {Path(args.model).name} with llama-cpp-python {llama_cpp.__version__}: {detail}. '
              'If the model is newer than this library (for example Qwen3 with version 0.3.4), use a Qwen2.5 model '
              'or llama-server.exe.', flush=True)
        return 3
    import uvicorn
    print('model loaded; listening on 127.0.0.1', flush=True)
    uvicorn.run(build_app(llm, Path(args.model).name), host='127.0.0.1', port=args.port, log_level='warning')
    return 0


if __name__ == '__main__':
    sys.exit(main())
