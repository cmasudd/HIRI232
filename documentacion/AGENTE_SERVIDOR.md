# Operación del publicador HiriPro 232

## Arquitectura activa

```text
MariaDB local --cada hora--> data/hiripro-232.csv --> GitHub Pages
API V3 /vista-previa --cada 10 min-----------------> navegador
```

El único dispositivo admitido es **232 / HIRIPRO-V5**. El exportador verifica
ese código antes de leer datos. El histórico nunca se obtiene desde el
navegador y la consulta viva solicita una sola fila.

## Perfil de publicación

Se publican ocho series validadas:

| Instrumento | Variables |
|---|---|
| PMS5003 | PM1, PM2.5, PM10, temperatura, humedad |
| SHT40 | temperatura, humedad |
| SIM7600G | intensidad de señal (0–31, sin convertir a dBm o porcentaje) |

El perfil del 2 de octubre de 2026 encontró 12.037 ciclos entre el 22 de abril
y el 2 de octubre. SO₂, TVOC, eCO₂, latitud, longitud, velocidad, satélites y
PM100 contenían solamente `-1` y `0`. El voltaje tenía 11.972 ceros en 12.037
filas y su último valor positivo era del 31 de julio. Se excluyen hasta una
nueva validación. Los pares temperatura/humedad exactamente `0/0` de un mismo
instrumento se tratan como ausencia de lectura; los ceros de material
particulado se conservan.

## Clon exclusivo

La automatización vive en:

```text
/home/cmas/servicios/hiri232-publisher
```

No se usa el clon de desarrollo. El wrapper rechaza un worktree sucio, hace
`pull --ff-only`, ejecuta el exportador y el validador, agrega solamente el CSV
y crea un commit únicamente si cambió el dato. Un `push` fallido deja el commit
local para el siguiente reintento.

La conexión carga los nombres `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y
`DB_PASSWORD` desde `/var/www/api_sensores/.env`. El archivo no se copia, no se
imprime y no se agrega a Git.

## Ejecución manual

```bash
cd /home/cmas/servicios/hiri232-publisher
/usr/bin/flock -n /tmp/hiripro-232-update.lock ./scripts/update_data.sh
```

Reconstrucción completa supervisada:

```bash
/var/www/api_sensores/venv/bin/python scripts/publish_hiripro.py --all
/var/www/api_sensores/venv/bin/python scripts/validate_export.py
```

El trabajo normal consulta únicamente desde dos días antes de la última fila
publicada, para admitir correcciones tardías sin repetir el backfill.

## Agenda

Existe una sola entrada de cron, al minuto 37 de cada hora:

```cron
37 * * * * /usr/bin/flock -n /tmp/hiripro-232-update.lock /home/cmas/servicios/hiri232-publisher/scripts/update_data.sh >> /home/cmas/servicios/hiri232-publisher/data-update.log 2>&1
```

El minuto evita las otras publicaciones horarias del servidor. El navegador
usa `refreshMinutes: 10` para la última fila; esto no ejecuta el backfill ni
crea commits cada diez minutos.

## Verificación

```bash
git -C /home/cmas/servicios/hiri232-publisher status --short --branch
tail -n 50 /home/cmas/servicios/hiri232-publisher/data-update.log
/var/www/api_sensores/venv/bin/python scripts/validate_export.py
```

Además se debe comprobar la URL de Pages, que la fecha de la tarjeta coincida
con la API V3, que el CSV tenga solamente `sensor_id=232` y que el origen de las
descargas sea `MEDIDO`.

## Reversión

1. Retirar únicamente la línea `hiripro-232-update` del crontab usando la copia
   protegida registrada durante la instalación.
2. Adquirir `/tmp/hiripro-232-update.lock`.
3. Restaurar el clon o el CSV desde el respaldo fechado.
4. Revertir el commit mediante `git revert`; no usar `reset --hard`.
5. Restaurar la versión anterior de CORS del API si también se revierte la
   consulta viva y recargar `api_sensores`.
6. Verificar de nuevo el sitio público y registrar hashes y resultado.

Nunca se guardan credenciales, hashes reales, cookies, tokens ni archivos
`.env` en el repositorio, cron, logs o documentación.
