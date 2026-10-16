"""Install the llama-cpp-python library for the Local Assistant: no llama-server.exe and no compiler.

Run Install-Assistant.bat. It installs ready-built packages only (pip --only-binary):
- with an NVIDIA graphics card: llama-cpp-python 0.3.4 built for CUDA 12.4, plus NVIDIA's CUDA 12.4
  runtime and cuBLAS from pip (about 600 MB), so the CUDA toolkit is not needed;
- otherwise: llama-cpp-python 0.3.19 for the processor.
The ready-built CUDA package is older and cannot read Qwen3 models: use Qwen2.5-7B-Instruct with it.
Options: --cpu or --gpu to choose, --dry-run to print the commands only.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

INDEX = 'https://abetlen.github.io/llama-cpp-python/whl/'
CHOICES = {
    'gpu': {'index': INDEX + 'cu124', 'packages': ['llama-cpp-python==0.3.4', 'nvidia-cuda-runtime-cu12==12.4.127', 'nvidia-cublas-cu12==12.4.5.8'],
            'model': 'Qwen2.5-7B-Instruct-Q4_K_M.gguf (4.7 GB) from huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF'},
    'cpu': {'index': INDEX + 'cpu', 'packages': ['llama-cpp-python==0.3.19'],
            'model': 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf (2.5 GB) from huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF'},
}


def nvidia_card():
    """Name and memory of the NVIDIA card, or '' when there is none (nvidia-smi comes with the driver)."""
    tool = shutil.which('nvidia-smi') or str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'nvidia-smi.exe')
    try:
        result = subprocess.run([tool, '--query-gpu=name,memory.total', '--format=csv,noheader'], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return ''
    return result.stdout.strip().splitlines()[0] if result.returncode == 0 and result.stdout.strip() else ''


def commands(choice):
    spec = CHOICES[choice]
    return [[sys.executable, '-m', 'pip', 'install', '--only-binary=:all:', '--extra-index-url', spec['index'], *spec['packages']]]


def check():
    """Load the library the way the Assistant will, and report whether it can use the graphics card."""
    script = ('import assistant_worker, llama_cpp; assistant_worker.add_cuda_dlls(); '
              'print(llama_cpp.__version__, bool(llama_cpp.llama_supports_gpu_offload()))')
    result = subprocess.run([sys.executable, '-c', script], cwd=str(Path(__file__).parent), capture_output=True, text=True, timeout=120)
    return result.returncode == 0, (result.stdout or result.stderr).strip().splitlines()[-1:] or ['']


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--cpu', action='store_true', help='install the processor build even with an NVIDIA card')
    group.add_argument('--gpu', action='store_true', help='install the CUDA build')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    card = nvidia_card()
    choice = 'cpu' if args.cpu else 'gpu' if args.gpu or card else 'cpu'
    print(f'NVIDIA graphics card: {card or "none found"}')
    print(f'Installing the {"graphics card (CUDA 12.4)" if choice == "gpu" else "processor"} build of llama-cpp-python.')
    for command in commands(choice):
        print('>', ' '.join(command))
        if not args.dry_run and subprocess.run(command).returncode != 0:
            print('\nInstallation failed. If pip cannot reach abetlen.github.io or pypi.org, ask for those two sites to be allowed,\n'
                  'or use llama-server.exe instead (see llm\\README.md).')
            return 1
    if args.dry_run:
        return 0
    ok, detail = check()
    if not ok:
        print('\nThe library is installed but does not load:', detail[0])
        if choice == 'gpu':
            print('Update the NVIDIA driver (CUDA 12.4 needs driver 550 or later), or run Install-Assistant.bat --cpu.')
        return 1
    version, gpu = (detail[0].split() + ['', ''])[:2]
    print(f'\nReady: llama-cpp-python {version}, graphics card {"in use" if gpu == "True" else "not used"}.')
    print('Model to put in the Atlas\\llm folder:', CHOICES[choice]['model'])
    print('Leave llama-server.exe out of the llm folder: Atlas then uses this library. Restart Atlas, then open Assistant settings.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
