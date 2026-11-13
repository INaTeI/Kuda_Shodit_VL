#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo 'Сначала создайте окружение по инструкции recommender/README.md.' >&2
  exit 1
fi
export DEVICE="${DEVICE:-cpu}"
export HF_HUB_OFFLINE=1
export TOKENIZERS_PARALLELISM=false
exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port "${PORT:-8001}" --workers 1
