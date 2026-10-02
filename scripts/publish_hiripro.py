#!/usr/bin/env python3
"""Exporta las ocho series validadas del dispositivo 232 al CSV público."""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "data" / "hiripro-232.csv"
DEFAULT_ENV_FILE = Path("/var/www/api_sensores/.env")
DEVICE_ID = 232
DEVICE_CODE = "HIRIPRO-V5"
LOCAL_TIMEZONE = ZoneInfo("America/Santiago")
BATCH_SIZE = 5_000
OVERLAP = timedelta(days=2)

KEYS = (
    "pm25_ugm3", "pm1_ugm3", "pm10_ugm3", "pms_temperature_c",
    "pms_humidity_pct", "sht_temperature_c", "sht_humidity_pct", "signal",
)
FIELDS = ("timestamp", "sensor_id", *KEYS)

# Selección resultante del perfil del 02-10-2026. Las demás variables del
# dispositivo son centinelas/constantes y no constituyen mediciones publicables.
MODEL_VARIABLES: dict[str, dict[int, str]] = {
    "PMS5003": {3: "pms_temperature_c", 6: "pms_humidity_pct", 7: "pm1_ugm3", 8: "pm25_ugm3", 9: "pm10_ugm3"},
    "SHT40": {3: "sht_temperature_c", 6: "sht_humidity_pct"},
    "SIM7600G": {15: "signal"},
}


def timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        parsed = value.replace(tzinfo=LOCAL_TIMEZONE) if value.tzinfo is None else value
    elif isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("timestamp sin zona horaria")
    else:
        raise ValueError("timestamp debe ser ISO 8601 con zona horaria")
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize(records: Any) -> list[dict[str, Any]]:
    if not isinstance(records, list):
        raise ValueError('La respuesta debe ser una lista de registros o {"records": [...]}')
    by_time: dict[str, dict[str, Any]] = {}
    for row in records:
        if not isinstance(row, dict):
            raise ValueError("Registro inválido")
        if str(row.get("sensor_id")) != str(DEVICE_ID):
            continue
        normalized: dict[str, Any] = {"timestamp": timestamp(row.get("timestamp")), "sensor_id": DEVICE_ID}
        for key in KEYS:
            value = row.get(key)
            if value is None or value == "":
                normalized[key] = ""
                continue
            if isinstance(value, bool):
                raise ValueError(f"{key}: valor booleano inválido")
            value = float(value)
            if not math.isfinite(value):
                raise ValueError(f"{key}: valor no finito")
            if key.endswith("_pct") and not 0 <= value <= 100:
                raise ValueError(f"{key}: humedad fuera de 0–100")
            if key.startswith("pm") and key.endswith("_ugm3") and value < 0:
                raise ValueError(f"{key}: concentración negativa")
            if key.endswith("_temperature_c") and not -30 <= value <= 60:
                raise ValueError(f"{key}: temperatura fuera de rango")
            if key == "signal" and not 0 <= value <= 31:
                raise ValueError("signal: valor fuera de 0–31")
            normalized[key] = value
        if not any(normalized[key] != "" for key in KEYS):
            raise ValueError("Registro 232 sin ninguna variable válida")
        by_time[normalized["timestamp"]] = normalized
    return list(by_time.values())


def publish(records: Any, destination: Path = DESTINATION, replace: bool = False) -> tuple[bool, int]:
    incoming = normalize(records)
    if not incoming:
        raise ValueError("No se recibieron registros válidos del sensor 232")
    merged: dict[str, dict[str, Any]] = {}
    if destination.exists() and not replace:
        with destination.open(encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            if reader.fieldnames != list(FIELDS):
                raise ValueError("El CSV existente no cumple el contrato")
            for row in normalize(list(reader)):
                merged[row["timestamp"]] = row
    for row in incoming:
        existing = merged.get(row["timestamp"], {})
        merged[row["timestamp"]] = {key: row[key] if row[key] != "" else existing.get(key, "") for key in FIELDS}
    ordered = [merged[key] for key in sorted(merged)]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(ordered)
    content = output.getvalue()
    if destination.exists() and destination.read_text(encoding="utf-8-sig") == content:
        return False, len(ordered)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", dir=destination.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return True, len(ordered)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def connect_database(env_file: Path):
    load_env_file(env_file)
    required = ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError("Faltan variables de MariaDB: " + ", ".join(missing))
    import mysql.connector
    names = ("host", "user", "password", "database")
    values = tuple(os.environ[name] for name in ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"))
    settings = dict(zip(names, values))
    settings.update(port=int(os.environ.get("DB_PORT", "3306")), connection_timeout=15)
    return mysql.connector.connect(**settings)


def discover_sources(connection) -> list[tuple[int, dict[int, str]]]:
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(
            """SELECT d.codigo_interno, s.id_sensor, st.modelo
               FROM dispositivos d
               JOIN sensores_en_dispositivo sd ON sd.id_dispositivo = d.id_dispositivo
               JOIN sensores s ON s.id_sensor = sd.id_sensor
               JOIN sensores_tipo st ON st.id_sensor_tipo = s.id_sensor_tipo
               WHERE d.id_dispositivo = %s ORDER BY s.id_sensor""",
            (DEVICE_ID,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
    if not rows or any(row["codigo_interno"] != DEVICE_CODE for row in rows):
        raise RuntimeError("El dispositivo 232 no corresponde a HIRIPRO-V5")
    sources = [(int(row["id_sensor"]), MODEL_VARIABLES[row["modelo"]]) for row in rows if row["modelo"] in MODEL_VARIABLES]
    if len(sources) != len(MODEL_VARIABLES):
        raise RuntimeError("No se encontraron todos los instrumentos validados de HIRIPRO-V5")
    return sources


def incremental_start(destination: Path, all_history: bool) -> datetime:
    if all_history or not destination.exists():
        return datetime(1970, 1, 1)
    with destination.open(encoding="utf-8-sig", newline="") as file:
        latest = max((row["timestamp"] for row in csv.DictReader(file)), default="")
    if not latest:
        return datetime(1970, 1, 1)
    return datetime.fromisoformat(latest.replace("Z", "+00:00")).astimezone(LOCAL_TIMEZONE).replace(tzinfo=None) - OVERLAP


def clean_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    # Ambos instrumentos usan el par exacto 0/0 como ausencia de lectura.
    for temperature_key, humidity_key in (("pms_temperature_c", "pms_humidity_pct"), ("sht_temperature_c", "sht_humidity_pct")):
        if snapshot.get(temperature_key) == 0 and snapshot.get(humidity_key) == 0:
            snapshot[temperature_key] = ""
            snapshot[humidity_key] = ""
    return snapshot


def fetch_database_records(connection, start: datetime) -> list[dict[str, Any]]:
    snapshots: dict[datetime, dict[str, Any]] = {}
    for sensor_id, mapping in discover_sources(connection):
        variable_ids = sorted(mapping)
        placeholders = ",".join(["%s"] * len(variable_ids))
        last_date, last_id = start, 0
        while True:
            cursor = connection.cursor(dictionary=True)
            try:
                cursor.execute(
                    f"""SELECT id_dato, fecha, id_variable, valor
                        FROM datos FORCE INDEX (idx_datos_sensor_fecha)
                        WHERE id_sensor = %s AND id_variable IN ({placeholders})
                          AND (fecha > %s OR (fecha = %s AND id_dato > %s))
                        ORDER BY fecha, id_dato LIMIT %s""",
                    (sensor_id, *variable_ids, last_date, last_date, last_id, BATCH_SIZE),
                )
                page = cursor.fetchall()
            finally:
                cursor.close()
            for row in page:
                snapshots.setdefault(row["fecha"], {})[mapping[int(row["id_variable"])]] = float(row["valor"])
            if len(page) < BATCH_SIZE:
                break
            last_date, last_id = page[-1]["fecha"], int(page[-1]["id_dato"])
    return [{"timestamp": timestamp(moment), "sensor_id": DEVICE_ID, **clean_snapshot(values)} for moment, values in sorted(snapshots.items())]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="JSON canónico local")
    parser.add_argument("--all", action="store_true", help="Reconstruir todo el histórico desde MariaDB")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--output", type=Path, default=DESTINATION)
    args = parser.parse_args()
    if args.input:
        payload = json.loads(args.input.read_text(encoding="utf-8-sig"))
        records = payload.get("records") if isinstance(payload, dict) else payload
    else:
        connection = connect_database(args.env_file)
        try:
            records = fetch_database_records(connection, incremental_start(args.output, args.all))
        finally:
            connection.close()
    changed, count = publish(records, args.output, replace=args.all)
    print(f"HiriPro 232: {count} registros; " + ("CSV actualizado" if changed else "sin cambios"))


if __name__ == "__main__":
    main()
