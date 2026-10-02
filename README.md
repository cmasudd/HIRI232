# Estación Material Particulado "HiriPro" C+ UDD

Portal estático dedicado al **sensor (232) HIRIPRO-V5**, instalado en Ante Puerto Lirquén. Conserva el header institucional C+ UDD y presenta un dashboard nuevo, adaptable a escritorio y móvil.

- Ocho tarjetas con la última lectura real disponible de cada variable.
- Históricos por variable: 24 horas, 7 días, 30 días, todo el histórico o fechas personalizadas.
- Mediciones originales y promedios por hora/día, con estadísticas y tabla de detalle.
- CSV de la selección y del histórico completo con las ocho variables.
- Acceso de demo, sin backend ni sesiones: **admin / 1234**. Al recargar se solicita nuevamente el acceso.

## Configuración desde GitHub

Edita `config/portal.json` y guarda el cambio en la rama publicada. Las credenciales se cambian en `access.username` y `access.password`.

El portal productivo usa `data.mode: "csv"` y carga exclusivamente las mediciones reales publicadas en `data/hiripro-232.csv`; si el archivo está vacío o falla la carga, muestra el estado correspondiente y nunca sustituye datos ficticios. El histórico se publica cada hora. La última fila se consulta desde la API V3 cada 10 minutos y se fusiona en memoria, sin descargar el histórico desde MariaDB en el navegador. Los períodos rápidos se calculan respecto de la hora actual para hacer visibles los períodos sin nuevas mediciones.

El modo `demo` se conserva únicamente para desarrollo local explícito. Todas las descargas del modo productivo quedan marcadas como `MEDIDO`.

`refreshMinutes` controla la consulta de la última lectura (10 minutos), `historyUpdateMinutes` documenta la publicación horaria y `staleAfterMinutes` establece cuándo una lectura deja de considerarse reciente (60 minutos).

El acceso es una barrera visual de demostración: las credenciales y los CSV se pueden consultar públicamente en un sitio estático. No protege los datos, tal como se solicitó.

## Probar localmente

```powershell
python -m http.server 8080
```

Abre http://localhost:8080 e ingresa las credenciales. Se necesita HTTP para cargar la configuración y el CSV; no abrir `index.html` mediante `file://`.

## Publicación

En GitHub Pages configura la publicación desde la raíz de la rama que uses para el sitio. No hay compilación ni dependencias de Node. También puede servirse desde Nginx o cualquier servidor estático. Se incluyen Chart.js y el logo institucional localmente.

El clon publicador consulta MariaDB local con acceso protegido y de solo lectura. El navegador consulta únicamente `/v3/vista-previa?id_dispositivo=232&limite=1`. Sigue [las instrucciones operativas del servidor](documentacion/AGENTE_SERVIDOR.md).

El perfil del 2 de octubre de 2026 autorizó PM1, PM2.5, PM10, temperatura y humedad PMS5003, temperatura y humedad SHT40 y señal SIM7600G. SO₂, TVOC, eCO₂, GPS, velocidad, satélites y PM100 sólo presentaban centinelas; el voltaje era casi completamente cero y sin valores positivos desde julio. Esas columnas se excluyen para no publicar fallas como observaciones reales.

## Verificación

```powershell
node --check app.js
node --test tests/portal.test.cjs
python -m unittest discover -s tests -v
```

## Ubicación y referencias ambientales

La estación se ubica en **Ante Puerto Lirquén**, coordenadas **−36.723383, −72.980878**. El mapa usa Leaflet local y cartografía OpenStreetMap; necesita conexión para las teselas. Las coordenadas también quedan visibles y hay un enlace al mapa completo si la cartografía no está disponible.

El panel ambiental compara **ayer** (día calendario de Chile) con los rangos de concentración de 24 horas de la EPA para PM 2.5 y PM 10. Requiere al menos 18 horas distintas con datos y da igual peso a cada promedio horario. PM 1.0, temperatura, humedad y señal no reciben categorías AQI. La cobertura intrahoraria del sensor no está certificada: la comparación es orientativa.

El histórico abre con 30 días y promedios diarios: muestra una banda de mínimo–máximo observado, la línea de promedio y la referencia chilena discontinua. La escala continua de colores es visual y el rojo marca el valor de referencia chilena; no representa categorías EPA. Los rangos de salud EPA siguen en la sección de interpretación. Los días de borde pueden ser parciales y el día en curso es provisional. Los días sin datos se muestran como huecos, sin ceros artificiales.

Las referencias chilenas se presentan por separado: PM 2.5, 50 µg/m³; PM 10, 130 µg/m³N. No se determina cumplimiento normativo ni se asume normalización de PM 10. La metodología y las fuentes están enlazadas en la página.

Fuentes consultadas:

- [EPA · Umbrales de concentración AQI](https://aqs.epa.gov/aqsweb/documents/codetables/aqi_breakpoints.html).
- [AirNow · Categorías de salud](https://www.airnow.gov/aqi/aqi-basics/).
- [EPA · Documento técnico AQI](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P101AP0Q.TXT).
- [Chile · DS 12/2011, PM 2.5](https://www.bcn.cl/leychile/Navegar?idNorma=1025202).
- [Chile · DS 12/2021, PM 10](https://www.bcn.cl/leychile/navegar?idNorma=1176988).
