#!/usr/bin/env python3
"""Valida el CSV público de HIRIPRO-V5 antes de cada commit automático."""
from __future__ import annotations

import csv
import math
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "hiripro-232.csv"
FIELDS = [
    "timestamp", "sensor_id", "pm25_ugm3", "pm1_ugm3", "pm10_ugm3",
    "pms_temperature_c", "pms_humidity_pct", "sht_temperature_c",
    "sht_humidity_pct", "signal",
]
MAX_BYTES = 40 * 1024 * 1024


def main() -> None:
    if not CSV_PATH.exists() or CSV_PATH.stat().st_size > MAX_BYTES:
        raise SystemExit("CSV ausente o mayor de 40 MiB")
    previous = ""
    count = 0
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != FIELDS:
            raise SystemExit("Cabecera CSV inválida")
        for line, row in enumerate(reader, 2):
            if row["sensor_id"] != "232":
                raise SystemExit(f"Línea {line}: sensor distinto de 232")
            stamp = row["timestamp"]
            parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if parsed.tzinfo is None or stamp <= previous:
                raise SystemExit(f"Línea {line}: fecha sin zona, duplicada o desordenada")
            previous = stamp
            for key in FIELDS[2:]:
                if row[key] == "":
                    continue
                value = float(row[key])
                if not math.isfinite(value):
                    raise SystemExit(f"Línea {line}: {key} no finito")
                if key.startswith("pm") and value < 0:
                    raise SystemExit(f"Línea {line}: {key} negativo")
                if key.endswith("_pct") and not 0 <= value <= 100:
                    raise SystemExit(f"Línea {line}: {key} fuera de rango")
                if key == "signal" and not 0 <= value <= 31:
                    raise SystemExit(f"Línea {line}: señal fuera de rango")
            count += 1
    if not count:
        raise SystemExit("CSV sin mediciones")
    print(f"CSV HiriPro 232 válido: {count} registros; última lectura {previous}")


if __name__ == "__main__":
    main()
