FROM python:3.12-slim
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
ENV PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN python -m pip install --no-cache-dir torch==2.11.0 --index-url ${TORCH_INDEX} && python -m pip install --no-cache-dir -r requirements.txt
COPY app.py search_rules.py query_adapter.py model_identity.py ./
COPY data ./data
# PyTorch resolves the runtime UID through /etc/passwd, even with a read-only root FS.
RUN groupadd --gid 10001 qwen && useradd --uid 10001 --gid qwen --no-create-home --shell /usr/sbin/nologin qwen
EXPOSE 8000
CMD ["python","-m","uvicorn","app:app","--host","0.0.0.0","--port","8000","--workers","1"]
