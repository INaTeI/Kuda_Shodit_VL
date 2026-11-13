"""Save Qwen from a local cache, or download on request."""
import argparse
from pathlib import Path
from sentence_transformers import SentenceTransformer

parser = argparse.ArgumentParser()
parser.add_argument('--cache-dir', help='Existing Hugging Face cache directory')
parser.add_argument('--download', action='store_true', help='Allow model download')
args = parser.parse_args()
model = SentenceTransformer(
    'Qwen/Qwen3-Embedding-0.6B', device='cpu', cache_folder=args.cache_dir,
    local_files_only=not args.download,
)
target = Path(__file__).resolve().parent / 'models' / 'qwen'
model.save_pretrained(str(target))
print(f'Saved Qwen: {target}')
