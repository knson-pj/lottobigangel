#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Supabase(PostgREST)의 model_probability_exports 테이블/뷰에서
최신 예측 묶음을 읽어 public/prediction_snapshot.json 으로 내보내는 스크립트.

현재 확인된 실제 스키마 대응:
- id
- target_round
- model_version
- feature_version
- number
- probability
- meta
- created_at

특징
- .env.local 자동 로드
- .env.local 이 없거나, 폴더이거나, 권한 이슈가 있어도 경고만 출력
- 실제 스키마(feature_version, meta, created_at) 반영
- rank 컬럼이 없으면 meta.rank 또는 probability 기준으로 자동 rank 부여
- export_id 가 없어도 target_round + model_version + feature_version 중심으로 최신 묶음 선택
- 디버그 로그 포함
- 외부 패키지 없이 표준 라이브러리만 사용

기본 실행:
    python ml/export/export_prediction_snapshot.py --out public/prediction_snapshot.json --top-k 30 --pretty
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_SOURCE_TABLE = "model_probability_exports"
DEFAULT_OUTPUT_PATH = "public/prediction_snapshot.json"
DEFAULT_FETCH_LIMIT = 5000


FIELD_ALIASES = {
    "export_id": [
        "export_id",
        "snapshot_id",
        "batch_id",
        "run_id",
        "job_id",
    ],
    "target_round": [
        "target_round",
        "prediction_round",
        "round",
        "next_round",
    ],
    "number": [
        "number",
        "num",
        "ball",
        "lotto_number",
    ],
    "probability": [
        "probability",
        "prob",
        "pred_probability",
        "score",
        "prediction_score",
    ],
    "rank": [
        "rank",
        "prob_rank",
        "prediction_rank",
    ],
    "model_key": [
        "model_key",
        "model_name",
        "model",
        "pipeline",
        "stage",
    ],
    "model_version": [
        "model_version",
        "version",
        "model_ver",
    ],
    "feature_version": [
        "feature_version",
        "feature_ver",
    ],
    "generated_at": [
        "generated_at",
        "created_at",
        "exported_at",
        "inserted_at",
        "updated_at",
    ],
    "recent_window": [
        "recent_window",
        "lookback_window",
        "window",
        "lookback",
    ],
    "calibrated": [
        "calibrated",
        "is_calibrated",
    ],
    "metadata": [
        "metadata",
        "meta",
        "payload",
        "extra",
    ],
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export latest model prediction snapshot JSON")
    parser.add_argument("--supabase-url", default="")
    parser.add_argument("--supabase-key", default="")
    parser.add_argument("--table", default=DEFAULT_SOURCE_TABLE)
    parser.add_argument("--out", default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--top-k", type=int, default=30)
    parser.add_argument("--limit", type=int, default=DEFAULT_FETCH_LIMIT)
    parser.add_argument("--target-round", type=int, default=None)
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args()


def resolve_repo_root() -> Path:
    # repo-root/ml/export/export_prediction_snapshot.py 기준
    return Path(__file__).resolve().parents[2]


def load_env_file_if_exists(env_path: Path) -> None:
    if not env_path.exists():
        return

    if env_path.is_dir():
        print(f"[WARN] .env.local 경로가 파일이 아니라 폴더입니다: {env_path}")
        return

    try:
        text = env_path.read_text(encoding="utf-8")
    except PermissionError:
        print(f"[WARN] .env.local 파일을 읽을 권한이 없습니다: {env_path}")
        return
    except OSError as e:
        print(f"[WARN] .env.local 파일을 읽지 못했습니다: {env_path} ({e})")
        return

    for raw_line in text.splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#"):
            continue

        if "=" not in line:
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


def parse_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        try:
            return int(float(value))
        except Exception:
            return None


def parse_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def parse_bool(value: Any) -> Optional[bool]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value

    s = str(value).strip().lower()
    if s in ("1", "true", "t", "yes", "y"):
        return True
    if s in ("0", "false", "f", "no", "n"):
        return False
    return None


def coerce_json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value

    if isinstance(value, str) and value.strip():
        try:
            loaded = json.loads(value)
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            return {}

    return {}


def first_present(row: Dict[str, Any], logical_name: str) -> Any:
    for key in FIELD_ALIASES.get(logical_name, []):
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    metadata = coerce_json_object(first_present(row, "metadata"))

    rank_value = first_present(row, "rank")
    if rank_value in (None, ""):
        rank_value = metadata.get("rank")

    reserved_keys = set()
    for names in FIELD_ALIASES.values():
        reserved_keys.update(names)

    extras = {k: v for k, v in row.items() if k not in reserved_keys}

    return {
        "exportId": first_present(row, "export_id"),
        "targetRound": parse_int(first_present(row, "target_round")),
        "number": parse_int(first_present(row, "number")),
        "probability": parse_float(first_present(row, "probability")),
        "rank": parse_int(rank_value),
        "modelKey": first_present(row, "model_key"),
        "modelVersion": first_present(row, "model_version"),
        "featureVersion": first_present(row, "feature_version"),
        "generatedAt": first_present(row, "generated_at"),
        "recentWindow": parse_int(first_present(row, "recent_window")),
        "calibrated": parse_bool(first_present(row, "calibrated")),
        "metadata": metadata,
        "extra": extras,
        "raw": row,
    }


def group_key(item: Dict[str, Any]) -> Tuple[Any, ...]:
    if item["exportId"] not in (None, ""):
        return ("export_id", str(item["exportId"]))

    # 현재 실제 스키마 기준 fallback
    return (
        "fallback",
        item["targetRound"],
        str(item["modelVersion"] or ""),
        str(item["featureVersion"] or ""),
    )


def choose_latest_group(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: Dict[Tuple[Any, ...], List[Dict[str, Any]]] = defaultdict(list)

    for item in items:
        if item["number"] is None:
            continue
        if item["probability"] is None:
            continue
        groups[group_key(item)].append(item)

    if not groups:
        preview = []
        for item in items[:5]:
            preview.append(
                {
                    "targetRound": item.get("targetRound"),
                    "number": item.get("number"),
                    "probability": item.get("probability"),
                    "rank": item.get("rank"),
                    "modelVersion": item.get("modelVersion"),
                    "featureVersion": item.get("featureVersion"),
                    "generatedAt": item.get("generatedAt"),
                    "rawKeys": sorted(list(item.get("raw", {}).keys()))[:50],
                }
            )

        raise RuntimeError(
            "유효한 export row를 찾지 못했습니다. "
            f"fetched={len(items)}, preview={json.dumps(preview, ensure_ascii=False)}"
        )

    def sort_key(rows: List[Dict[str, Any]]) -> Tuple[Any, ...]:
        best = max(
            rows,
            key=lambda r: (
                r["targetRound"] if r["targetRound"] is not None else -1,
                str(r["generatedAt"] or ""),
                str(r["modelVersion"] or ""),
                str(r["featureVersion"] or ""),
            ),
        )
        return (
            best["targetRound"] if best["targetRound"] is not None else -1,
            str(best["generatedAt"] or ""),
            str(best["modelVersion"] or ""),
            str(best["featureVersion"] or ""),
        )

    return max(groups.values(), key=sort_key)


def assign_rank_if_missing(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items_sorted = sorted(
        items,
        key=lambda r: (
            r["rank"] if r["rank"] is not None else math.inf,
            -(r["probability"] if r["probability"] is not None else -1),
            r["number"] if r["number"] is not None else math.inf,
        ),
    )

    ranked: List[Dict[str, Any]] = []
    next_rank = 1

    for item in items_sorted:
        if item["rank"] is None:
            item = {**item, "rank": next_rank}
        ranked.append(item)
        next_rank += 1

    return ranked


def fetch_rows_from_supabase(
    supabase_url: str,
    supabase_key: str,
    table: str,
    limit: int,
) -> List[Dict[str, Any]]:
    if not supabase_url:
        raise RuntimeError("SUPABASE_URL이 비어 있습니다. .env.local 또는 환경변수를 확인하세요.")
    if not supabase_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다. .env.local 또는 환경변수를 확인하세요.")

    endpoint = supabase_url.rstrip("/") + f"/rest/v1/{urllib.parse.quote(table)}"
    query = urllib.parse.urlencode(
        {
            "select": "*",
            "limit": str(limit),
        }
    )
    url = f"{endpoint}?{query}"

    req = urllib.request.Request(
        url,
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Accept": "application/json",
        },
        method="GET",
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")

    data = json.loads(body)
    if not isinstance(data, list):
        raise RuntimeError("Supabase 응답이 JSON 배열이 아닙니다.")
    return data


def filter_by_target_round(items: List[Dict[str, Any]], target_round: Optional[int]) -> List[Dict[str, Any]]:
    if target_round is None:
        return items

    filtered = [item for item in items if item["targetRound"] == target_round]
    if not filtered:
        raise RuntimeError(f"target_round={target_round} 에 해당하는 row를 찾지 못했습니다.")
    return filtered


def build_snapshot(items: List[Dict[str, Any]], table: str, top_k: int) -> Dict[str, Any]:
    items = assign_rank_if_missing(items)
    items = sorted(
        items,
        key=lambda r: (
            r["rank"] if r["rank"] is not None else math.inf,
            -(r["probability"] if r["probability"] is not None else -1),
            r["number"] if r["number"] is not None else math.inf,
        ),
    )

    if not items:
        raise RuntimeError("스냅샷으로 변환할 데이터가 없습니다.")

    head = items[0]
    probabilities = [item["probability"] for item in items if item["probability"] is not None]
    top_items = items[: max(1, top_k)]

    top_numbers_by_rank = [item["number"] for item in top_items if item["number"] is not None]
    top_numbers_sorted = sorted(top_numbers_by_rank)

    merged_metadata: Dict[str, Any] = {}
    for item in items:
        if item["metadata"]:
            merged_metadata.update(item["metadata"])

    numbers = []
    for item in items:
        row = {
            "number": item["number"],
            "probability": round(float(item["probability"]), 12) if item["probability"] is not None else None,
            "rank": item["rank"],
        }

        if item["recentWindow"] is not None:
            row["recentWindow"] = item["recentWindow"]

        if item["calibrated"] is not None:
            row["calibrated"] = item["calibrated"]

        if item["extra"]:
            row["extra"] = item["extra"]

        numbers.append(row)

    return {
        "snapshotVersion": 1,
        "generatedAt": utc_now_iso(),
        "source": {
            "kind": "supabase",
            "table": table,
            "exportId": head["exportId"],
        },
        "prediction": {
            "targetRound": head["targetRound"],
            "modelKey": str(head["modelKey"] or "stage3-minimal"),
            "modelVersion": str(head["modelVersion"] or "unknown"),
            "featureVersion": str(head["featureVersion"] or "unknown"),
            "topK": int(top_k),
            "topNumbersByRank": top_numbers_by_rank,
            "topNumbersSorted": top_numbers_sorted,
            "numbers": numbers,
        },
        "summary": {
            "candidateCount": len(numbers),
            "probabilitySum": round(sum(probabilities), 12) if probabilities else None,
            "maxProbability": max(probabilities) if probabilities else None,
            "minProbability": min(probabilities) if probabilities else None,
        },
        "metadata": merged_metadata,
    }


def write_json(path: Path, payload: Dict[str, Any], pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    if pretty:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    path.write_text(text + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()

    repo_root = resolve_repo_root()
    env_path = repo_root / ".env.local"
    load_env_file_if_exists(env_path)

    supabase_url = args.supabase_url or os.getenv("SUPABASE_URL", "").strip()
    supabase_key = args.supabase_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    try:
        raw_rows = fetch_rows_from_supabase(
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            table=args.table,
            limit=args.limit,
        )

        print(f"[INFO] fetched rows: {len(raw_rows)}")
        if raw_rows:
            print(f"[INFO] first row keys: {sorted(raw_rows[0].keys())}")
            print(f"[INFO] first row sample: {json.dumps(raw_rows[0], ensure_ascii=False)[:1000]}")

        items = [normalize_row(row) for row in raw_rows]
        items = filter_by_target_round(items, args.target_round)
        latest_group = choose_latest_group(items)

        snapshot = build_snapshot(
            items=latest_group,
            table=args.table,
            top_k=args.top_k,
        )

        out_path = Path(args.out)
        if not out_path.is_absolute():
            out_path = repo_root / out_path

        write_json(out_path, snapshot, pretty=args.pretty)

        print(f"[OK] prediction snapshot written: {out_path}")
        print(f" - targetRound   : {snapshot['prediction']['targetRound']}")
        print(f" - modelVersion  : {snapshot['prediction']['modelVersion']}")
        print(f" - featureVersion: {snapshot['prediction']['featureVersion']}")
        print(f" - candidates    : {snapshot['summary']['candidateCount']}")
        print(f" - topNumbers    : {snapshot['prediction']['topNumbersSorted']}")
        return 0

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
