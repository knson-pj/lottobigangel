from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests


def load_snapshot(filepath: Path) -> dict:
    if not filepath.exists():
        raise FileNotFoundError(f'snapshot not found: {filepath}')
    with filepath.open('r', encoding='utf-8') as f:
        data = json.load(f)
    return data


def validate_snapshot(data: dict) -> list[dict]:
    target_round = int(data['target_round'])
    model_version = str(data['model_version'])
    feature_version = str(data['feature_version'])
    probabilities = data['probabilities']

    if not isinstance(probabilities, list) or len(probabilities) != 45:
        raise ValueError('probabilities must be a list of 45 items')

    rows: list[dict] = []
    seen = set()
    for item in probabilities:
        number = int(item['number'])
        probability = float(item['probability'])
        if number < 1 or number > 45:
            raise ValueError(f'invalid number: {number}')
        if number in seen:
            raise ValueError(f'duplicate number: {number}')
        seen.add(number)
        rows.append(
            {
                'target_round': target_round,
                'model_version': model_version,
                'feature_version': feature_version,
                'number': number,
                'probability': probability,
                'meta': item.get('meta', {}),
            }
        )

    return rows


def upsert_rows(supabase_url: str, service_role_key: str, rows: list[dict]) -> None:
    url = f"{supabase_url}/rest/v1/model_probability_exports"
    headers = {
        'apikey': service_role_key,
        'Authorization': f'Bearer {service_role_key}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation',
    }
    params = {
        'on_conflict': 'target_round,model_version,feature_version,number'
    }

    resp = requests.post(url, headers=headers, params=params, json=rows, timeout=30)
    main()
