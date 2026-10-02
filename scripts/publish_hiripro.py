#!/usr/bin/env python3
"""Importa únicamente HiriPro 232 desde JSON de API al CSV público del portal."""
from __future__ import annotations
import argparse
import csv
import io
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
KEYS = ('pm25_ugm3', 'pm1_ugm3', 'pm10_ugm3', 'pms_temperature_c',
        'pms_humidity_pct', 'sht_temperature_c', 'sht_humidity_pct', 'signal')
FIELDS = ('timestamp', 'sensor_id', *KEYS)


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('timestamp debe ser ISO 8601 con zona horaria')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timestamp sin zona horaria; la API debe indicar Z o un offset')
    return parsed.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def normalize(records):
    if not isinstance(records, list):
        raise ValueError('La respuesta debe ser una lista de registros o {"records": [...]}')
    by_time = {}
    for row in records:
        if not isinstance(row, dict):
            raise ValueError('Registro de API inválido')
        if str(row.get('sensor_id')) != '232':
            continue
        normalized = {'timestamp': timestamp(row.get('timestamp')), 'sensor_id': 232}
        for key in KEYS:
            value = row.get(key)
            if value is None or value == '':
                normalized[key] = ''
            else:
                if isinstance(value, bool):
                    raise ValueError(f'{key}: valor booleano inválido')
                value = float(value)
                if not math.isfinite(value):
                    raise ValueError(f'{key}: valor no finito')
                if key.endswith('_pct') and not 0 <= value <= 100:
                    raise ValueError(f'{key}: humedad fuera de 0–100')
                if key.startswith('pm') and key.endswith('_ugm3') and value < 0:
                    raise ValueError(f'{key}: concentración negativa')
                normalized[key] = value
        if not any(normalized[key] != '' for key in KEYS):
            raise ValueError('Registro 232 sin ninguna variable válida')
        by_time[normalized['timestamp']] = normalized
    return list(by_time.values())


def publish(records, destination):
    incoming = normalize(records)
    if not incoming:
        raise ValueError('No se recibieron registros válidos del sensor 232; no se modifica el histórico')
    merged = {}
    if destination.exists():
        with destination.open(encoding='utf-8-sig', newline='') as file:
            reader = csv.DictReader(file)
            if reader.fieldnames != list(FIELDS):
                raise ValueError('El CSV existente no cumple el contrato; no se sobrescribe')
            for row in normalize(list(reader)):
                merged[row['timestamp']] = row
    for row in incoming:
        existing = merged.get(row['timestamp'], {})
        # Una respuesta parcial no borra variables de una publicación anterior.
        merged[row['timestamp']] = {key: row[key] if row[key] != '' else existing.get(key, '') for key in FIELDS}
    ordered = [merged[key] for key in sorted(merged)]
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator='\n')
    writer.writeheader()
    writer.writerows(ordered)
    content = output.getvalue()
    if destination.exists() and destination.read_text(encoding='utf-8-sig') == content:
        return False, len(ordered)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='', dir=destination.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
        os.replace(temporary, destination)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return True, len(ordered)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, help='JSON local ya obtenido por el agente del servidor')
    args = parser.parse_args()
    if args.input:
        payload = json.loads(args.input.read_text(encoding='utf-8-sig'))
    else:
        endpoint = os.environ.get('HIRIPRO_API_URL')
        if not endpoint:
            parser.error('Define HIRIPRO_API_URL o utiliza --input export.json')
        headers = {'Accept': 'application/json'}
        token = os.environ.get('HIRIPRO_API_TOKEN')
        if token:
            headers['Authorization'] = f'Bearer {token}'
        request = Request(endpoint, headers=headers)
        with urlopen(request, timeout=60) as response:
            payload = json.load(response)
    records = payload.get('records') if isinstance(payload, dict) else payload
    changed, count = publish(records, ROOT / 'data' / 'hiripro-232.csv')
    print(f'HiriPro 232: {count} registros; ' + ('CSV actualizado' if changed else 'sin cambios'))


if __name__ == '__main__':
    main()
