"""Server-only coaching configuration; .env is data, never executed as shell."""
import os
from pathlib import Path
import shlex
from urllib.parse import urlparse

ENV_PATH = Path(__file__).resolve().parents[1] / '.env'
JOY_BASE = 'https://modelservice.jdcloud.com/v1'
JOY_MODEL = 'Qwen3.6-35B-A3B'


def config():
    values = {}
    if ENV_PATH.is_file():
        for line in ENV_PATH.read_text().splitlines():
            name, sep, value = line.strip().removeprefix('export ').partition('=')
            if not sep or name.strip() not in {
                f'CLIMBCUE_{scope}_{key}' for scope in ('COACH', 'LLM')
                for key in ('BASE_URL', 'MODEL', 'API_KEY')
            }:
                continue
            try:
                parts = shlex.split(value, comments=True)
            except ValueError:
                continue
            if len(parts) <= 1:
                values[name.strip()] = parts[0] if parts else ''
    def read(key):
        return os.environ.get(key, values.get(key, '')).strip()
    base = read('CLIMBCUE_COACH_BASE_URL') or read('CLIMBCUE_LLM_BASE_URL') or JOY_BASE
    model = read('CLIMBCUE_COACH_MODEL') or read('CLIMBCUE_LLM_MODEL') or JOY_MODEL
    key = read('CLIMBCUE_COACH_API_KEY') or read('CLIMBCUE_LLM_API_KEY')
    if key in ('{{API_KEY}}', '你的密钥', 'your-api-key'):
        key = ''
    return base.rstrip('/'), model, key


def is_joymaas(base):
    return urlparse(base).hostname == 'modelservice.jdcloud.com'


def configured():
    base, model, key = config()
    return bool(base and model and (key or not is_joymaas(base)))
