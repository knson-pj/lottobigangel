#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
model_probability_exports(Supabase/PostgREST)에서 최신 예측 묶음을 읽어
프론트/서버가 바로 소비할 수 있는 prediction snapshot JSON으로 내보내는 스크립트.

기본 사용 예:
    python ml/export/export_prediction_snapshot.py

권장 사용 예:
    python ml/export/export_prediction_snapshot.py \
      --out public/prediction_snapshot.json \
      --top-k 30

환경변수:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

기본 동작:
- Supabase REST에서 model_probability_exports 전체(기본 limit 5000)를 읽음
- 컬럼명이 조금 달라도 alias로 최대한 흡수
- 최신 export 묶음(export_id 우선, 없으면 targetRound/model/generatedAt 조합)을 선택
- prediction_snapshot.json 생성

주의:
- 실제 DB 컬럼명이 다르더라도 아래 FIELD_ALIASES만 맞춰주면 대부분 대응 가능
- 외부 라이브러리 없이 표준 라이브러리만 사용
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
DEFAULT_OUTPUT_PATH = "ml/export/prediction_snapshot.json"
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
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL", "").strip())
    parser.add_argument("--supabase-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip())
    parser.add_argument("--table", default=DEFAULT_SOURCE_TABLE)
    parser.add_argument("--out", default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--top-k", type=int, default=30)
    parser.add_argument("--limit", type=int, default=DEFAULT_FETCH_LIMIT)
    parser.add_argument("--target-round", type=int, default=None)
    parser.add_argument(
        "--input-json",
        default="",
        help="Supabase 대신 로컬 JSON 배열 파일을 읽고 싶을 때 사용. 예: tmp/model_probability_exports.json",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="출력 JSON을 보기 좋게 들여쓰기하여 저장",
    )
    return parser.parse_args()


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


def iso_sort_key(value: Optional[str]) -> str:
    if not value:
        return ""
    return str(value)


def first_present(row: Dict[str, Any], logical_name: str) -> Any:
    for key in FIELD_ALIASES.get(logical_name, []):
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    metadata = coerce_json_object(first_present(row, "metadata"))

    export_id = first_present(row, "export_id")
    target_round = parse_int(first_present(row, "target_round"))
    number = parse_int(first_present(row, "number"))
    probability = parse_float(first_present(row, "probability"))
    rank = parse_int(first_present(row, "rank"))
    model_key = first_present(row, "model_key")
    model_version = first_present(row, "model_version")
    generated_at = first_present(row, "generated_at")
    recent_window = parse_int(first_present(row, "recent_window"))
    calibrated = parse_bool(first_present(row, "calibrated"))

    reserved_keys = set()
    for names in FIELD_ALIASES.values():
        reserved_keys.update(names)

    extras = {k: v for k, v in row.items() if k not in reserved_keys}

    return {
        "exportId": export_id,
        "targetRound": target_round,
        "number": number,
        "probability": probability,
        "rank": rank,
        "modelKey": str(model_key) if model_key is not None else None,
        "modelVersion": str(model_version) if model_version is not None else None,
        "generatedAt": str(generated_at) if generated_at is not None else None,
        "recentWindow": recent_window,
        "calibrated": calibrated,
        "metadata": metadata,
        "extras": extras,
        "raw": row,
    }


def group_key(item: Dict[str, Any]) -> Tuple[Any, ...]:
    if item["exportId"] not in (None, ""):
        return ("export_id", str(item["exportId"]))
    return (
        "fallback",
        item["targetRound"],
        item["modelKey"],
        item["modelVersion"],
        item["generatedAt"],
    )


def choose_latest_group(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[Tuple[Any, ...], List[Dict[str, Any]]] = defaultdict(list)

    for item in items:
        if item["number"] is None:
            continue
        if item["probability"] is None:
            continue
        buckets[group_key(item)].append(item)

    if not buckets:
        raise RuntimeError("유효한 export row를 찾지 못했습니다. number/probability 컬럼을 확인하세요.")

    def bucket_sort_key(rows: List[Dict[str, Any]]) -> Tuple[Any, ...]:
        head = max(
            rows,
            key=lambda r: (
                r["targetRound"] if r["targetRound"] is not None else -1,
                iso_sort_key(r["generatedAt"]),
                r["modelVersion"] or "",
                r["modelKey"] or "",
            ),
        )
        return (
            head["targetRound"] if head["targetRound"] is not None else -1,
            iso_sort_key(head["generatedAt"]),
            head["modelVersion"] or "",
            head["modelKey"] or "",
        )

    latest_rows = max(buckets.values(), key=bucket_sort_key)
    return latest_rows


def fetch_rows_from_supabase(
    supabase_url: str,
    supabase_key: str,
    table: str,
    limit: int,
) -> List[Dict[str, Any]]:
    if not supabase_url:
        raise RuntimeError("SUPABASE_URL 이 비어 있습니다.")
    if not supabase_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY 가 비어 있습니다.")

    base = supabase_url.rstrip("/") + f"/rest/v1/{urllib.parse.quote(table)}"
    qs = urllib.parse.urlencode(
        {
            "select": "*",
            "limit": str(limit),
        }
    )
    url = f"{base}?{qs}"

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
        payload = resp.read().decode("utf-8")

    data = json.loads(payload)
    if not isinstance(data, list):
        raise RuntimeError("Supabase 응답이 배열(list) 형식이 아닙니다.")
    return data


def load_rows(args: argparse.Namespace) -> List[Dict[str, Any]]:
    if args.input_json:
        path = Path(args.input_json)
        if not path.exists():
            raise RuntimeError(f"--input-json 파일을 찾을 수 없습니다: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise RuntimeError("--input-json 파일은 JSON 배열이어야 합니다.")
        return data

    return fetch_rows_from_supabase(
        supabase_url=args.supabase_url,
        supabase_key=args.supabase_key,
        table=args.table,
        limit=args.limit,
    )


def assign_rank_if_missing(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items_sorted = sorted(
        items,
        key=lambda r: (
            r["rank"] if r["rank"] is not None else math.inf,
            -(r["probability"] if r["probability"] is not None else -1),
            r["number"] if r["number"] is not None else math.inf,
        ),
    )

    ranked = []
    next_rank = 1
    for item in items_sorted:
        if item["rank"] is None:
            item = {**item, "rank": next_rank}
        ranked.append(item)
        next_rank += 1
    return ranked


def filter_by_target_round(items: List[Dict[str, Any]], target_round: Optional[int]) -> List[Dict[str, Any]]:
    if target_round is None:
        return items
    filtered = [x for x in items if x["targetRound"] == target_round]
    if not filtered:
        raise RuntimeError(f"target_round={target_round} 에 해당하는 row를 찾지 못했습니다.")
    return filtered


def build_snapshot(rows: List[Dict[str, Any]], table: str, top_k: int) -> Dict[str, Any]:
    rows = assign_rank_if_missing(rows)
    rows = sorted(
        rows,
        key=lambda r: (
            r["rank"] if r["rank"] is not None else math.inf,
            -(r["probability"] if r["probability"] is not None else -1),
            r["number"] if r["number"] is not None else math.inf,
        ),
    )

    if not rows:
        raise RuntimeError("스냅샷으로 변환할 row가 없습니다.")

    first = rows[0]
    probabilities = [r["probability"] for r in rows if r["probability"] is not None]
    probability_sum = round(sum(probabilities), 12) if probabilities else None

    top_rows = rows[: max(1, top_k)]
    top_numbers_by_rank = [r["number"] for r in top_rows if r["number"] is not None]
    top_numbers_sorted = sorted(top_numbers_by_rank)

    merged_metadata: Dict[str, Any] = {}
    for row in rows:
        if row["metadata"]:
            merged_metadata.update(row["metadata"])

    snapshot_numbers = []
    for row in rows:
        item = {
            "number": row["number"],
            "probability": round(float(row["probability"]), 12) if row["probability"] is not None else None,
            "rank": row["rank"],
        }
        if row["recentWindow"] is not None:
            item["recentWindow"] = row["recentWindow"]
        if row["calibrated"] is not None:
            item["calibrated"] = row["calibrated"]
        if row["extras"]:
            item["extra"] = row["extras"]
        snapshot_numbers.append(item)

    snapshot = {
        "snapshotVersion": 1,
        "generatedAt": utc_now_iso(),
        "source": {
            "kind": "supabase",
            "table": table,
            "exportId": first["exportId"],
        },
        "prediction": {
            "targetRound": first["targetRound"],
            "modelKey": first["modelKey"] or "stage3-minimal",
            "modelVersion": first["modelVersion"] or "unknown",
            "topK": int(top_k),
            "topNumbersByRank": top_numbers_by_rank,
            "topNumbersSorted": top_numbers_sorted,
            "numbers": snapshot_numbers,
        },
        "summary": {
            "candidateCount": len(snapshot_numbers),
            "probabilitySum": probability_sum,
            "maxProbability": max(probabilities) if probabilities else None,
            "minProbability": min(probabilities) if probabilities else None,
        },
        "metadata": merged_metadata,
    }

    return snapshot


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_snapshot(path: Path, snapshot: Dict[str, Any], pretty: bool) -> None:
    ensure_parent_dir(path)
    if pretty:
        payload = json.dumps(snapshot, ensure_ascii=False, indent=2)
    else:
        payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    path.write_text(payload + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()

    try:
        raw_rows = load_rows(args)
        normalized = [normalize_row(row) for row in raw_rows]
        normalized = filter_by_target_round(normalized, args.target_round)
        latest_group = choose_latest_group(normalized)
        snapshot = build_snapshot(latest_group, table=args.table, top_k=args.top_k)

        out_path = Path(args.out)
        write_snapshot(out_path, snapshot, pretty=args.pretty)

        print(f"[OK] prediction snapshot written: {out_path}")
        print(f" - targetRound : {snapshot['prediction']['targetRound']}")
        print(f" - modelKey    : {snapshot['prediction']['modelKey']}")
        print(f" - modelVersion: {snapshot['prediction']['modelVersion']}")
        print(f" - candidates  : {snapshot['summary']['candidateCount']}")
        print(f" - topNumbers  : {snapshot['prediction']['topNumbersSorted']}")
        return 0

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
