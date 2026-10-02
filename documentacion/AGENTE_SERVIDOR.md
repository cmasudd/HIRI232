# Instrucciones para el agente del servidor: publicar HiriPro 232

## Objetivo y alcance

Publicar las mediciones del único sensor **232 / HIRIPRO-V5**, de Ante Puerto Lirquén. Se retiró la integración de Coyhaique: no ejecutar el antiguo descargador de Looker ni publicar otros sensores.

El frontend está listo. Falta conocer la URL real y la forma de respuesta de la API. **No inventar el endpoint ni presentar datos simulados como reales.** Solicitar al responsable URL, autenticación, rango histórico, frecuencia de medición y mecanismo de paginación. No usar `admin / 1234` como credenciales de la API: corresponden solamente al acceso visual del portal.

## Contrato de datos

El importador `scripts/publish_hiripro.py` acepta una lista JSON o un objeto con `records` como lista, con estos campos canónicos:

| Campo | Variable | Unidad |
|---|---|---|
| timestamp | Fecha de medición, ISO 8601 con Z u offset | Ej. 2026-10-02T13:00:00Z |
| sensor_id | Identificador | 232 |
| pm1_ugm3 | PMS5003 · PM 1.0 | µg/m³ |
| pm25_ugm3 | PMS5003 · PM 2.5 | µg/m³ |
| pm10_ugm3 | PMS5003 · PM 10 | µg/m³ |
| pms_temperature_c | PMS5003 · Temperatura | °C |
| pms_humidity_pct | PMS5003 · Humedad | % |
| sht_temperature_c | SHT40 · Temperatura | °C |
| sht_humidity_pct | SHT40 · Humedad | % |
| signal | SIM7600G · Intensidad de señal telefónica | Adimensional |

Valores ausentes: `null` o campo ausente; nunca usar cero como sustituto. No convertir la señal a dBm o porcentaje sin documentación del proveedor. El importador rechaza NaN, infinitos, humedad fuera de 0–100 y concentraciones negativas. Filtra otros sensores, ordena en UTC, deduplica por timestamp, conserva el histórico y mantiene valores previos ante actualizaciones parciales. Solo reemplaza el CSV cuando toda la importación es válida; los errores no vacían el archivo publicado.

Si la API devuelve otro formato, crear un adaptador en el servidor que traduzca los campos a este contrato. Si entrega variables por separado, agrupar por fecha y sensor. Reunir **todas las páginas** en un JSON canónico antes de importar: el importador genérico no conoce la paginación particular de la API. Resolver explícitamente la zona horaria si la API trae fechas sin offset. No inferir UTC de fechas locales.

## Primera carga y actualización

1. Usar un clon de publicación exclusivo en el servidor y detener/reemplazar el cron anterior de Aire Aysén. Comprobar que la rama del clon sea la publicada por GitHub Pages.
2. Obtener el histórico disponible de 232, adaptar y reunir todas las páginas. Importar con `python3 scripts/publish_hiripro.py --input /ruta/export-232.json`. Revisar el CSV generado y sus ocho columnas de variables. No guardar exportaciones ni tokens dentro del repositorio.
3. Si la API ya devuelve el contrato canónico completo, consultar directamente mediante `HIRIPRO_API_URL` y opcionalmente `HIRIPRO_API_TOKEN` (Authorization Bearer). Guardar estas variables fuera del repositorio, en un archivo de entorno accesible solo al publicador.
4. Para consultas incrementales pedir un intervalo solapado que admita registros tardíos/correcciones. El importador combina las respuestas con el CSV anterior. Adaptar URL y rango en el servidor si la API requiere parámetros de fecha.
5. Una vez publicado y validado el CSV real, cambiar `data.mode` de `demo` a `csv` en `config/portal.json` y publicar el cambio. El archivo inicial tiene solo cabeceras; no contiene observaciones reales.
6. Mantener la publicación automática del servidor cada **10 minutos**, según lo solicitado, y conservar `data.refreshMinutes: 10` en el portal. El frontend revisa el CSV cada 10 minutos; eso no consulta directamente al equipo.

Ejemplo de `/etc/hiripro-232.env`, fuera del repositorio:

```bash
export HIRIPRO_API_URL='URL_REAL_CONFIRMADA_PARA_EL_SENSOR_232'
export HIRIPRO_API_TOKEN='TOKEN_SI_CORRESPONDE'
```

Probar primero `python3 scripts/publish_hiripro.py` con esas variables exportadas. Consulta y genera el CSV local; no hace commit ni push.

El wrapper `scripts/update_data.sh` hace pull, consulta API, agrega únicamente `data/hiripro-232.csv`, crea commit si cambió y hace push a la rama actual. Requiere Python 3.10+, Git y credenciales de escritura de Git. No requiere paquetes pip. Usarlo en un clon exclusivo para no mezclar trabajo de desarrollo.

Cron de publicación cada 10 minutos (ajustar únicamente las rutas):

```cron
*/10 * * * * /usr/bin/flock -n /tmp/hiripro-232.lock /bin/bash -c 'source /etc/hiripro-232.env && /bin/bash /srv/hiripro-232/scripts/update_data.sh' >> /var/log/hiripro-232.log 2>&1
```

Para una API que requiere adaptador, reemplazar la consulta del wrapper por el adaptador seguido de `publish_hiripro.py --input ...`. Mantener bloqueo, commits solo al cambiar CSV y salida de error ante fallos.

## Comprobación antes de activar datos reales

- Ejecutar las pruebas indicadas en README.
- Confirmar que todas las filas tienen `sensor_id=232`, timestamp con zona y unidades correctas.
- Abrir el dashboard y comparar la última fecha y al menos un valor de cada variable con la API.
- Probar selección histórica y ambas descargas. Los CSV incluyen ocho variables y `data_origin=MEDIDO`.
- Verificar modo `csv`, ausencia de insignia DEMO y estado “Sin lecturas recientes” ante fechas antiguas.
- Verificar cron, log, permisos Git y despliegue Pages. Confirmar que no siga activo el publicador anterior.

No incluir tokens privados en `portal.json`, JavaScript, README o commits. El acceso hardcodeado del portal no protege el CSV público.

## Ubicación confirmada

Ante Puerto Lirquén: latitud `-36.723383`, longitud `-72.980878`. Las coordenadas están en `config/portal.json`. No sustituirlas por la ubicación anterior de San Vicente ni por coordenadas del informe de Coyhaique.

El portal calcula una referencia ambiental para el día anterior con al menos 18 horas distintas. Conviene mantener en las publicaciones la resolución original y sus ausencias: nunca rellenar huecos con ceros ni duplicar lecturas para aumentar cobertura. Los rangos y fuentes se documentan en el README y en la sección de interpretación de la página.
