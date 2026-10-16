r"""Install the llama-cpp-python library for the Local Assistant: no llama-server.exe and no compiler.

Run Install-Assistant.bat. It installs ready-built packages only (pip --only-binary):
- with an NVIDIA graphics card: llama-cpp-python 0.3.4 built for CUDA 12.4, plus NVIDIA's CUDA 12.4
  runtime and cuBLAS from pip (about 600 MB), so the CUDA toolkit is not needed;
- otherwise: llama-cpp-python 0.3.19 for the processor.
The ready-built CUDA package is older and cannot read Qwen3 models: use Qwen2.5-7B-Instruct with it.

If your network blocks abetlen.github.io (a company package mirror usually has only the source code),
download the package file in your browser from GitHub (the link is printed) and save it in Atlas\llm:
the installer then installs that file, and NVIDIA's runtime from your normal package mirror.

Options: --cpu or --gpu to choose, --dry-run to print the commands only, --try-anyway to run pip even when
the download site looks blocked.
"""
import argparse
import os
import shutil
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

INDEX = 'https://abetlen.github.io/llama-cpp-python/whl/'
RELEASES = 'https://github.com/abetlen/llama-cpp-python/releases/download/'
NVIDIA = ['nvidia-cuda-runtime-cu12==12.4.127', 'nvidia-cublas-cu12==12.4.5.8']
CHOICES = {
    'gpu': {'index': INDEX + 'cu124', 'packages': ['llama-cpp-python==0.3.4', *NVIDIA],
            'file': RELEASES + 'v0.3.4-cu124/llama_cpp_python-0.3.4-cp312-cp312-win_amd64.whl',
            'model': 'Qwen2.5-7B-Instruct-Q4_K_M.gguf (4.7 GB) from huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF'},
    'cpu': {'index': INDEX + 'cpu', 'packages': ['llama-cpp-python==0.3.19'],
            'file': RELEASES + 'v0.3.19/llama_cpp_python-0.3.19-cp312-cp312-win_amd64.whl',
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


def memory_gb(card):
    """Graphics memory from nvidia-smi's "Quadro P620, 4096 MiB", in GB (0 when unknown)."""
    match = re.search(r'(\d+)\s*MiB', card or '')
    return round(int(match.group(1)) / 1024, 1) if match else 0


def model_for(choice, card):
    if choice == 'gpu' and 0 < memory_gb(card) < 6:
        # 4 GB cards: the 7B model does not fit; the CUDA package cannot read Qwen3.
        return 'Qwen2.5-3B-Instruct-Q4_K_M.gguf (1.9 GB) from huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF'
    return CHOICES[choice]['model']


def reachable(url, timeout=15):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=timeout):
            return True
    except Exception:
        return False


BLOCKED = '''
pip cannot reach {site} from this PC, where the ready-built llama-cpp-python packages are listed.
(Your company package mirror has only its source code, which would need a C++ compiler and the CUDA toolkit.)

Download this one file in your browser ({size}) and save it in the Atlas\\llm folder, keeping its name:
  {url}
Then run Install-Assistant.bat again: it installs that file, and gets NVIDIA's runtime from your package mirror.'''


def local_package(folders=None):
    """A llama-cpp-python .whl downloaded in the browser: Atlas\\llm first, then Downloads."""
    tag = f'cp{sys.version_info.major}{sys.version_info.minor}'
    folders = folders or [Path(__file__).parent / 'llm', Path.home() / 'Downloads']
    for folder in folders:
        found = sorted(Path(folder).glob(f'llama_cpp_python-*-{tag}-{tag}-win_amd64.whl')) if Path(folder).is_dir() else []
        if found:
            return found[-1]
    return None


def commands(choice, package=None, card=''):
    spec = CHOICES[choice]
    if package:  # a downloaded file: no extra index, so only the normal (company) package mirror is used
        return [[sys.executable, '-m', 'pip', 'install', '--only-binary=:all:', str(package), *(NVIDIA if card else [])]]
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
    parser.add_argument('--try-anyway', action='store_true', help='run pip even if the download site looks blocked')
    args = parser.parse_args(argv)
    card = nvidia_card()
    choice = 'cpu' if args.cpu else 'gpu' if args.gpu or card else 'cpu'
    print(f'NVIDIA graphics card: {card or "none found"}')
    print(f'Installing the {"graphics card (CUDA 12.4)" if choice == "gpu" else "processor"} build of llama-cpp-python.')
    package = local_package()
    if package:
        print(f'Using the downloaded package {package}.')
    elif not args.dry_run and not args.try_anyway and not reachable(CHOICES[choice]['index'] + '/llama-cpp-python/'):
        print(BLOCKED.format(site='abetlen.github.io', url=CHOICES[choice]['file'], size='about 440 MB' if choice == 'gpu' else 'about 5 MB'))
        return 1
    for command in commands(choice, package, card):
        print('>', ' '.join(command))
        if not args.dry_run and subprocess.run(command).returncode != 0:
            print('\nInstallation failed. If pip could not download a package, download the llama-cpp-python file in your browser:\n  '
                  + CHOICES[choice]['file'] + '\nsave it in Atlas\\llm and run Install-Assistant.bat again, or use llama-server.exe (see llm\\README.md).')
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
    print('Model to put in the Atlas\\llm folder:', model_for(choice, card))
    if 0 < memory_gb(card) < 6:
        print(f'Your graphics card has {memory_gb(card):g} GB: in Assistant settings set Context size to 4096.')
    print('Leave llama-server.exe out of the llm folder: Atlas then uses this library. Restart Atlas, then open Assistant settings.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
