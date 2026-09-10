"""One offline answer, then exit. Called only by an explicit Ask submission.

No HTTP server, model downloading, remote tools, SQL or generated-code execution.
"""
import json
from pathlib import Path
import re
import sys

CONTEXT = 4096
OUTPUT = 512


def main():
    import onnxruntime
    onnxruntime.disable_telemetry_events()
    import onnxruntime_genai as og

    directory = Path(sys.argv[1]).resolve()
    payload = json.loads(sys.stdin.read(100000))
    messages = payload['messages']
    if not isinstance(messages, list) or not messages or len(messages) > 16:
        raise ValueError('Invalid conversation.')
    cleaned = []
    for message in messages:
        role = message['role']
        if role not in ('system', 'user', 'assistant') or not isinstance(message['content'], str):
            raise ValueError('Invalid message.')
        cleaned.append({'role': role, 'content': re.sub(r'<\|[^>]*\|>', '[special token removed]', message['content'])})
    config = og.Config(str(directory))
    config.clear_providers()
    config.overlay(json.dumps({
        'model': {'decoder': {'session_options': {
            'intra_op_num_threads': 4, 'inter_op_num_threads': 1,
            'session.intra_op.allow_spinning': '0', 'session.inter_op.allow_spinning': '0'}}},
        'search': {'max_length': CONTEXT}}))
    model = og.Model(config)
    tokenizer = og.Tokenizer(model)
    # Keep the pinned model files unchanged. GenAI's mini-Jinja needs the
    # equivalent equality test; non-thinking mode keeps answers short.
    template = (directory / 'chat_template.jinja').read_text(encoding='utf-8')
    template = '{% set enable_thinking = false %}' + template.replace(
        'enable_thinking is false', 'enable_thinking == false')
    def encode():
        prompt = tokenizer.apply_chat_template(messages=json.dumps(cleaned, ensure_ascii=False),
            template_str=template, add_generation_prompt=True)
        return tokenizer.encode(prompt)
    tokens = encode()
    while len(tokens) > CONTEXT - OUTPUT and len(cleaned) > 2:
        # Preserve system instructions and the latest question/context.
        del cleaned[1:min(3, len(cleaned)-1)]
        tokens = encode()
    if len(tokens) > CONTEXT - OUTPUT:
        print(json.dumps({'kind': 'context', 'error': 'Too much context for the offline model. Shorten the question or omit the saved scan report.'}))
        return 2
    parameters = og.GeneratorParams(model)
    # Qwen's recommended non-thinking settings; greedy decoding can degenerate.
    parameters.set_search_options(max_length=len(tokens)+OUTPUT, do_sample=True,
        temperature=0.7, top_p=0.8, top_k=20, repetition_penalty=1.0)
    generator = og.Generator(model, parameters)
    generator.append_tokens(tokens)
    stream = tokenizer.create_stream()
    pieces = []
    last_token = None
    while not generator.is_done():
        generator.generate_next_token()
        last_token = int(generator.get_next_tokens()[0])
        pieces.append(stream.decode(last_token))
    answer = re.sub(r'<think>.*?</think>', '', ''.join(pieces), flags=re.S)
    if '<think>' in answer:
        raise ValueError('The model did not finish a user-facing answer.')
    answer = re.sub(r'<\|[^>]*\|>', '', answer).strip()
    eos = json.loads((directory / 'genai_config.json').read_text(encoding='utf-8'))['model']['eos_token_id']
    eos = eos if isinstance(eos, list) else [eos]
    print(json.dumps({'answer': answer, 'input_tokens': len(tokens), 'output_tokens': len(pieces),
                     'truncated': len(pieces) >= OUTPUT and last_token not in eos}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # Details are local stderr only; do not expose local paths/prompts via HTTP.
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        print(json.dumps({'kind': 'runtime', 'error': 'The local model could not load or generate an answer. Re-run the optional assistant setup.'}))
        raise SystemExit(1)
