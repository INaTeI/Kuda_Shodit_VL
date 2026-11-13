"""Train an experimental retrieval projection; never modify Qwen weights."""
import argparse
import hashlib
import json
from pathlib import Path
from uuid import uuid4

import numpy as np

from app import Recommender
from query_adapter import QueryAdapter
from search_rules import candidates, rank_indices

ROOT = Path(__file__).resolve().parent


def relevant(place, label):
    field, value = label['field'], label['value']
    types = {value.strip().casefold() for value in str(place['values'][6] or '').split(';')}
    tags = {tag.strip().casefold() for tag in str(place['values'][7] or '').split(';')}
    if field == 'tag':
        return value in tags
    needles = [value] if field == 'type' else value
    return any(needle in types or (needle == 'виртуальной реальности'
               and any(needle in kind for kind in types)) for needle in needles)


def evaluate(engine, examples, vectors, adapter=None, use_filters=True):
    if adapter:
        vectors = adapter.transform(vectors)
    rows = []
    for example, vector in zip(examples, vectors):
        allowed = candidates(engine.catalog, example['query'])[0] if use_filters else range(len(engine.catalog))
        labels = np.array([relevant(place, example['label']) for place in engine.catalog])
        scores = vector @ engine.vectors.T
        top = rank_indices(engine.catalog, example['query'], allowed, scores)[:5]
        ideal_count = min(5, int(labels.sum()))
        discounts = 1 / np.log2(np.arange(2, 7))
        ndcg = float(sum(labels[i] * discounts[n] for n, i in enumerate(top))
                     / discounts[:ideal_count].sum()) if ideal_count else 0
        rows.append(dict(query=example['query'], ndcg_at_5=ndcg,
                         relevant_count=int(labels.sum()),
                         places=[dict(name=engine.catalog[i]['values'][0],
                                      relevant=bool(labels[i])) for i in top]))
    return dict(ndcg_at_5=float(np.mean([row['ndcg_at_5'] for row in rows])), queries=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='New version file; existing paths are never replaced')
    parser.add_argument('--report', type=Path, default=ROOT/'data/adapter_report_v2.json')
    args = parser.parse_args()
    source = ROOT/'data/retrieval_examples.json'
    dataset = json.loads(source.read_text())
    examples = dataset['examples']
    queries = [example['query'] for example in examples]
    if len(queries) != len(set(queries)):
        raise ValueError('Duplicate queries across training/evaluation sets')
    # Training must be independent of any serving adapter configured in the shell.
    import os
    os.environ['QUERY_ADAPTER_MODE'] = 'base'
    engine = Recommender()
    # No adapter is applied here: encode always uses original frozen Qwen weights.
    query_key = hashlib.sha256(json.dumps([engine.embedding_signature, queries,
                                           engine.query_prompt], ensure_ascii=False).encode()).hexdigest()
    cache = ROOT/'cache'/('training-'+query_key+'.npz')
    if cache.exists():
        with np.load(cache, allow_pickle=False) as data:
            vectors = data['vectors'].copy()
    else:
        vectors = engine.model.encode(queries, prompt=engine.query_prompt,
                                      normalize_embeddings=True, batch_size=4,
                                      show_progress_bar=True)
        np.savez_compressed(cache, vectors=vectors)
    splits = {split: [i for i, example in enumerate(examples) if example['split'] == split]
              for split in ('train', 'validation', 'test')}
    train = splits['train']
    x = vectors[train].astype(np.float32)
    targets = []
    for index in train:
        mask = [relevant(place, examples[index]['label']) for place in engine.catalog]
        if not any(mask):
            raise ValueError('No relevant places: '+examples[index]['intent'])
        centroid = engine.vectors[mask].mean(axis=0)
        targets.append(centroid / np.linalg.norm(centroid))
    y = np.array(targets, dtype=np.float32)

    def measure(split, adapter=None, use_filters=True):
        indices = splits[split]
        return evaluate(engine, [examples[i] for i in indices], vectors[indices], adapter, use_filters)

    baseline_val = measure('validation')
    best_score = baseline_val['ndcg_at_5']
    best = None
    settings = None
    # Closed-form ridge regression learns a residual query projection. Only validation
    # selects hyperparameters; test is evaluated once after that choice is fixed.
    for regularization in (0.01, 0.1, 1.0, 10.0):
        coefficients = np.linalg.solve(x @ x.T + regularization*np.eye(len(x)), y-x)
        for alpha in (0.1, 0.25, 0.5, 0.75, 1.0):
            adapter = QueryAdapter(x, coefficients, alpha)
            score = measure('validation', adapter)['ndcg_at_5']
            if score > best_score + 1e-8:
                best_score, best = score, adapter
                settings = dict(regularization=regularization, alpha=alpha)
    baseline_test = measure('test')
    adapted_test = measure('test', best)
    regressions = json.loads((ROOT/'data/retrieval_regressions.json').read_text())['examples']
    regression_vectors = engine.model.encode([e['query'] for e in regressions],
                                             prompt=engine.query_prompt, normalize_embeddings=True)
    base_regressions = evaluate(engine, regressions, regression_vectors)
    adapted_regressions = evaluate(engine, regressions, regression_vectors, best)
    regressions_passed = all(new['ndcg_at_5'] + 1e-8 >= old['ndcg_at_5']
                             for old, new in zip(base_regressions['queries'], adapted_regressions['queries']))
    eligible = (best is not None and best_score >= baseline_val['ndcg_at_5'] + 0.02
                and adapted_test['ndcg_at_5'] >= baseline_test['ndcg_at_5']
                and regressions_passed)
    report = dict(provenance=dataset['provenance'], method='Frozen Qwen + learned ridge query projection',
                  dataset_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                  embedding_signature=engine.embedding_signature,
                  split_sizes={key: len(value) for key, value in splits.items()},
                  settings=settings, eligible_for_experiment=eligible,
                  baseline_validation=baseline_val, adapted_validation=measure('validation', best),
                  baseline_test=baseline_test, adapted_test=adapted_test,
                  unfiltered_baseline_test=measure('test', use_filters=False),
                  unfiltered_adapted_test=measure('test', best, use_filters=False),
                  baseline_regressions=base_regressions, adapted_regressions=adapted_regressions,
                  regressions_passed=regressions_passed,
                  regression_dataset_sha256=hashlib.sha256((ROOT/'data/retrieval_regressions.json').read_bytes()).hexdigest(),
                  limitation='Synthetic metadata labels, same fixed catalog; not evidence of user satisfaction or generalization to new places.')
    if best is not None:
        output = args.output or ROOT/'models/adapters'/f'{uuid4().hex}.npz'
        best.save(output, engine.embedding_signature, approved=bool(eligible))
        report['adapter_file'] = str(output.relative_to(ROOT)) if output.is_relative_to(ROOT) else str(output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({key: report[key] for key in ('split_sizes', 'settings', 'eligible_for_experiment')}, ensure_ascii=False))
    print('Validation NDCG@5:', baseline_val['ndcg_at_5'], '->', best_score)
    print('Test NDCG@5:', baseline_test['ndcg_at_5'], '->', adapted_test['ndcg_at_5'])
    print('Report:', args.report)
    return 0 if eligible else 2


if __name__ == '__main__':
    raise SystemExit(main())
