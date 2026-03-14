#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
로컬 예측 결과(JSON)를 Supabase public.model_probability_exports 테이블에 적재하는 스크립트.

현재 확인된 테이블 스키마:
- id bigint
- target_round integer
- model_version text
- feature_version text
- number integer
- probability double precision
- meta jsonb
- created_at timestamptz

기본 사용:
    python ml/export/publish_model_probability_exports.py

명시 실행:
    python ml/export/publish_model_probability_exports.py ^
      --input public/prediction_snapshot.json ^
      --replace ^
      --pretty-log

입력 포맷:
1) prediction_snapshot.json 형태
{
  "prediction": {
    "targetRound": 1211,
    "modelVersion": "v0.1.0",
    "featureVersion": "fv1",
    "numbers": [
      {"number": 1, "probability": 0.12, "rank": 1}
    ]
  },
  "metadata": {...}
}

2) 배열 형태
[
  {"number": 1, "probability": 0.12, "rank": 1},
  ...
]
이 경우 --target-round, --model-version, --feature-version 필수.

환경변수(.env.local 자동 로드):
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_TABLE = "model_probability_exports"
DEFAULT_INPUT = "public/prediction_snapshot.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def resolve_repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_env_file_if_exists(env_path: Path) -> None:
    if not env_path.exists() or env_path.is_dir():
        return

    try:
        text = env_path.read_text(encoding="utf-8")
    except OSError:
        return

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key:
            continue

        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]

        if key not in os.environ:
            os.environ[key] = value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish model probability exports to Supabase")
    parser.add_argument("--input", default=DEFAULT_INPUT, help="입력 JSON 파일 경로")
    parser.add_argument("--table", default=DEFAULT_TABLE)
    parser.add_argument("--supabase-url", default="")
    parser.add_argument("--supabase-key", default="")
    parser.add_argument("--target-round", type=int, default=None)
    parser.add_argument("--model-version", default="")
    parser.add_argument("--feature-version", default="")
    parser.add_argument("--replace", action="store_true", help="같은 target_round/model_version/feature_version 기존 row 삭제 후 재적재")
    parser.add_argument("--append", action="store_true", help="기존 row 유지하고 추가 적재")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--pretty-log", action="store_true")
    return parser.parse_args()


def read_json(path: Path) -> Any:
    if not path.exists():
        raise RuntimeError(f"입력 파일이 없습니다: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def parse_int(value: Any, field_name: str) -> int:
    try:
        return int(value)
    except Exception:
        raise RuntimeError(f"{field_name} 값을 정수로 해석할 수 없습니다: {value}")


def parse_float(value: Any, field_name: str) -> float:
    try:
        return float(value)
    except Exception:
        raise RuntimeError(f"{field_name} 값을 실수로 해석할 수 없습니다: {value}")


def normalize_from_snapshot(data: Dict[str, Any], args: argparse.Namespace) -> Tuple[int, str, str, List[Dict[str, Any]], Dict[str, Any]]:
    prediction = data.get("prediction")
    if not isinstance(prediction, dict):
        raise RuntimeError("prediction_snapshot 형식이 아닙니다. 'prediction' 객체가 없습니다.")

    target_round = args.target_round or prediction.get("targetRound")
    model_version = args.model_version or prediction.get("modelVersion")
    feature_version = args.feature_version or prediction.get("featureVersion")
    numbers = prediction.get("numbers")
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}

    if target_round is None:
        raise RuntimeError("targetRound 이 없습니다. --target-round 또는 prediction.targetRound 필요")
    if not model_version:
        raise RuntimeError("modelVersion 이 없습니다. --model-version 또는 prediction.modelVersion 필요")
    if not feature_version:
        raise RuntimeError("featureVersion 이 없습니다. --feature-version 또는 prediction.featureVersion 필요")
    if not isinstance(numbers, list) or not numbers:
        raise RuntimeError("prediction.numbers 배열이 비어 있습니다.")

    rows: List[Dict[str, Any]] = []
    for item in numbers:
        if not isinstance(item, dict):
            continue

        number = parse_int(item.get("number"), "number")
        probability = parse_float(item.get("probability"), "probability")
        rank = item.get("rank")
        extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}

        meta = {
            "source": "prediction_snapshot",
            "rank": int(rank) if rank is not None else None,
            "snapshotGeneratedAt": data.get("generatedAt"),
        }
        if metadata:
            meta["snapshotMetadata"] = metadata
        if extra:
            meta["extra"] = extra

        rows.append(
            {
                "target_round": parse_int(target_round, "target_round"),
                "model_version": str(model_version),
                "feature_version": str(feature_version),
                "number": number,
                "probability": probability,
                "meta": meta,
                "created_at": utc_now_iso(),
            }
        )

    return parse_int(target_round, "target_round"), str(model_version), str(feature_version), rows, metadata


def normalize_from_array(data: List[Any], args: argparse.Namespace) -> Tuple[int, str, str, List[Dict[str, Any]], Dict[str, Any]]:
    if args.target_round is None:
        raise RuntimeError("배열 입력 형식에서는 --target-round 가 필요합니다.")
    if not args.model_version:
        raise RuntimeError("배열 입력 형식에서는 --model-version 이 필요합니다.")
    if not args.feature_version:
        raise RuntimeError("배열 입력 형식에서는 --feature-version 이 필요합니다.")

    rows: List[Dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue

        number = parse_int(item.get("number"), "number")
        probability = parse_float(item.get("probability"), "probability")
        rank = item.get("rank")
        extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}

        meta = {
            "source": "raw_array",
            "rank": int(rank) if rank is not None else None,
        }
        if extra:
            meta["extra"] = extra

        rows.append(
            {
                "target_round": int(args.target_round),
                "model_version": str(args.model_version),
                "feature_version": str(args.feature_version),
                "number": number,
                "probability": probability,
                "meta": meta,
                "created_at": utc_now_iso(),
            }
        )

    if not rows:
        raise RuntimeError("적재할 row가 없습니다.")

    return int(args.target_round), str(args.model_version), str(args.feature_version), rows, {}


def normalize_input(data: Any, args: argparse.Namespace) -> Tuple[int, str, str, List[Dict[str, Any]], Dict[str, Any]]:
    if isinstance(data, dict):
        return normalize_from_snapshot(data, args)
    if isinstance(data, list):
        return normalize_from_array(data, args)
    raise RuntimeError("지원하지 않는 입력 JSON 형식입니다.")


def chunked(items: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def encode_filter_value(value: Any) -> str:
    return urllib.parse.quote(str(value), safe="")


def request_json(url: str, headers: Dict[str, str], method: str = "GET", payload: Optional[Any] = None) -> Any:
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, headers=headers, method=method, data=data)

    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
        if not body:
            return None
        return json.loads(body)


def build_headers(supabase_key: str, prefer: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def delete_existing_rows(supabase_url: str, supabase_key: str, table: str, target_round: int, model_version: str, feature_version: str) -> None:
    endpoint = supabase_url.rstrip("/") + f"/rest/v1/{urllib.parse.quote(table)}"
    query = (
        f"target_round=eq.{encode_filter_value(target_round)}&"
        f"model_version=eq.{encode_filter_value(model_version)}&"
        f"feature_version=eq.{encode_filter_value(feature_version)}"
    )
    url = f"{endpoint}?{query}"
    request_json(url, build_headers(supabase_key), method="DELETE", payload=None)


def insert_rows(supabase_url: str, supabase_key: str, table: str, rows: List[Dict[str, Any]], batch_size: int) -> int:
    endpoint = supabase_url.rstrip("/") + f"/rest/v1/{urllib.parse.quote(table)}"
    headers = build_headers(supabase_key, prefer="return=representation")
    inserted = 0

    for batch in chunked(rows, batch_size):
        result = request_json(endpoint, headers, method="POST", payload=batch)
        if isinstance(result, list):
            inserted += len(result)
        else:
            inserted += len(batch)

    return inserted


def main() -> int:
    args = parse_args()

    repo_root = resolve_repo_root()
    load_env_file_if_exists(repo_root / ".env.local")

    supabase_url = (args.supabase_url or os.getenv("SUPABASE_URL", "")).strip()
    supabase_key = (args.supabase_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip()

    if not supabase_url:
        print("[ERROR] SUPABASE_URL이 비어 있습니다.", file=sys.stderr)
        return 1
    if not supabase_key:
        print("[ERROR] SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다.", file=sys.stderr)
        return 1
    if args.replace and args.append:
        print("[ERROR] --replace 와 --append 는 동시에 사용할 수 없습니다.", file=sys.stderr)
        return 1

    input_path = Path(args.input)
    if not input_path.is_absolute():
        input_path = repo_root / input_path

    try:
        data = read_json(input_path)
        target_round, model_version, feature_version, rows, metadata = normalize_input(data, args)

        print(f"[INFO] input file      : {input_path}")
        print(f"[INFO] target_round    : {target_round}")
        print(f"[INFO] model_version   : {model_version}")
        print(f"[INFO] feature_version : {feature_version}")
        print(f"[INFO] rows prepared   : {len(rows)}")

        if args.pretty_log and rows:
            preview = rows[: min(3, len(rows))]
            print(f"[INFO] sample rows     : {json.dumps(preview, ensure_ascii=False, indent=2)}")

        if args.replace:
            delete_existing_rows(
                supabase_url=supabase_url,
                supabase_key=supabase_key,
                table=args.table,
                target_round=target_round,
                model_version=model_version,
                feature_version=feature_version,
            )
            print("[INFO] existing rows deleted for same target/model/feature set")

        inserted = insert_rows(
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            table=args.table,
            rows=rows,
            batch_size=max(1, int(args.batch_size)),
        )

        print("[OK] publish completed")
        print(f" - inserted        : {inserted}")
        print(f" - target_round    : {target_round}")
        print(f" - model_version   : {model_version}")
        print(f" - feature_version : {feature_version}")
        if metadata:
            print(f" - metadata keys   : {sorted(metadata.keys())}")
        return 0

    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        print(f"[ERROR] HTTP {e.code}: {body}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
