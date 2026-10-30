# Pool Lab

## Presentación

Esta integración trae a Gladys los análisis de agua de su fotómetro **Water-i.d. PoolLab 1.0 / 2.0** o **PrimeLab**: pH, cloro, ácido cianúrico, alcalinidad, dureza y los demás parámetros que mida, con el rango ideal que haya definido para cada uno en LabCom. Lee la **nube LabCom** mediante su API GraphQL oficial con un token de API personal. Solo lee y no está afiliada a Water-i.d.

- Un dispositivo por «punto de muestreo» de LabCom (una piscina, un spa): una función por parámetro medido, con el valor de su último análisis, y el equilibrio del agua (lo que está fuera de su rango ideal).
- Dos widgets del panel: el último análisis de una piscina, coloreado según el rango ideal; el historial de un parámetro con su rango ideal.
- Disparadores de escena: nueva medición, parámetro fuera de su rango ideal, de vuelta en rango, análisis del agua pendiente, token rechazado.
- Acciones de escena: actualizar ahora, último valor de un parámetro.

Las mediciones siguen siendo **manuales**: usted analiza el agua con el fotómetro, la aplicación PoolLab sincroniza el resultado con LabCom y Gladys lo lee allí. Gladys nunca mide por sí misma.

Transporte: nube. El token de API va a LabCom (`backend.labcom.cloud`); las mediciones vienen de la nube LabCom.

## Requisitos previos

- Gladys Assistant 5.3.0 o posterior.
- Un PoolLab 1.0, PoolLab 2.0 o PrimeLab, y una cuenta LabCom en la que la aplicación sincronice sus mediciones (compruébelas en [labcom.cloud](https://labcom.cloud/)).
- Un **token de API** personal: inicie sesión en [labcom.cloud](https://labcom.cloud/), abra **Ajustes** ([labcom.cloud/pages/user-setting](https://labcom.cloud/pages/user-setting)), cree un token de API y cópielo. Manténgalo en secreto: quien lo tenga puede leer sus mediciones.
- Opcional, pero útil: el rango ideal de cada parámetro en LabCom (valores mínimo y máximo). Sin él, un parámetro se muestra «sin rango ideal» y nunca activa los disparadores de rango.

## Configuración

| Campo                         | Significado                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Token de API de LabCom        | El token creado en labcom.cloud (un secreto: nunca se vuelve a mostrar ni se escribe en los registros; solo una huella en `/data`) |
| Lectura de LabCom             | Cada 5, 10, 15 (por defecto), 30 o 60 minutos: cuánto tarda Gladys en ver un nuevo análisis tras una sincronización                |
| Recordatorio de análisis tras | 3, 7 (por defecto), 14 o 30 días sin una nueva medición antes del disparador «análisis del agua pendiente»; o nunca                |
| Idioma de los textos          | Nombres de las funciones, equilibrio del agua, textos de escenas y errores; automático sigue el último widget                      |

Botones:

- **Probar la conexión** lee LabCom con el token y enumera las piscinas (y cuántas tienen mediciones).
- **Diagnóstico** escribe el estado de la integración en sus registros, sin el token.

La primera lectura obtiene todas las mediciones de la cuenta; después cada lectura solo pide las mediciones de la última semana, y los últimos 400 días se vuelven a leer cada 6 horas (una medición modificada o borrada en LabCom se sigue). La integración guarda hasta 300 mediciones de 400 días por parámetro en `/data`.

## Uso

### Dispositivos

Tras la configuración, abra **Descubrir**: cada piscina o spa con al menos una medición se ofrece como dispositivo con el nombre de su referencia en LabCom. Añada los que desee. Un parámetro medido más tarde añade una función: Descubrir propone entonces actualizar el dispositivo.

| Parámetro                                                                                                                                              | Categoría / tipo                 | Unidad                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | --------------------------- |
| pH                                                                                                                                                     | `ph-sensor` / `decimal`          | pH                          |
| Cloro libre, total, combinado, bromo, oxígeno activo, peróxido de hidrógeno, dióxido de cloro, ozono, PHMB, ácido cianúrico, alcalinidad, dureza, sal… | `level-sensor` / `decimal`       | ppm (mg/l), o ninguna       |
| Temperatura del agua                                                                                                                                   | `temperature-sensor` / `decimal` | °C (°F si LabCom lo indica) |
| Redox (ORP)                                                                                                                                            | `orp-sensor` / `decimal`         | mV                          |
| Equilibrio del agua                                                                                                                                    | `text` / `text`                  | —                           |

Gladys no tiene categoría para el cloro ni la alcalinidad: usan el sensor numérico simple `level-sensor` / `decimal` (como la integración Flipr). Un valor fuera de la escala de medición del fotómetro (OVERRANGE, UNDERRANGE) no tiene número: la función conserva su último valor, y el equilibrio del agua y los widgets lo indican.

### Widgets del panel

![Los dos widgets: el último análisis de una piscina (pH y cloro libre fuera de rango, los demás en rango) y el historial de 90 días de su cloro libre con el rango ideal, luego el último análisis de un spa (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-pool-lab/main/docs/assets/widgets.es.png)

- **Análisis del agua**: una piscina (a elegir en los ajustes del widget; la primera por defecto): los cinco primeros parámetros en mosaicos, verde en rango, naranja fuera de rango, rojo fuera de la escala de medición, gris sin rango; cuándo se hizo el último análisis, el equilibrio del agua y los demás parámetros. El botón **Actualizar** lee LabCom de inmediato (como máximo una vez por minuto).
- **Historial de un parámetro**: un parámetro de una piscina durante 30, 90 o 365 días, a la hora real de cada análisis (no la hora en que Gladys lo recibió), con el ideal mínimo y máximo como dos líneas, el número de análisis y la parte en rango.

### Escenas

Disparadores (una vez por cambio, nunca en la primera lectura, nunca por una acción de escena), filtrables por piscina y parámetro:

- **Nueva medición**: un parámetro tiene un análisis más reciente en LabCom (un evento por parámetro analizado).
- **Parámetro fuera de rango**: un parámetro pasa a estar demasiado bajo o alto para su rango ideal (filtro: dirección).
- **De vuelta en rango**: un parámetro que estaba fuera de rango vuelve a él.
- **Análisis del agua pendiente**: ninguna medición en una piscina durante el plazo de la configuración, una vez, entre las 9:00 y las 21:00.
- **Token rechazado**: LabCom rechaza el token de API.

Acciones:

- **Actualizar ahora**: lee LabCom (como máximo una vez por minuto); devuelve el número de piscinas, de parámetros fuera de rango y la hora del último análisis.
- **Último valor de un parámetro**: valor, unidad, estado, rango ideal, fecha y una frase, de la última lectura.

Ejemplos:

- Cuando **Pool Lab: parámetro fuera de rango** (cloro libre, demasiado bajo) → enviar «Cloro libre {{triggerEvent.data.value_text}} mg/l, ideal desde {{triggerEvent.data.ideal_low}}: añada cloro».
- Cuando **Pool Lab: análisis del agua pendiente** → enviar «Ningún análisis de la piscina desde hace {{triggerEvent.data.days_since}} días».
- Cada sábado a las 10:00 → **Pool Lab: último valor de un parámetro** (pH) → enviar su resumen.

## Solución de problemas

- **«LabCom rechaza el token de API»**: el token se borró o se copió mal; cree uno nuevo en labcom.cloud (Ajustes) y péguelo en la configuración.
- **Ningún dispositivo ofrecido**: solo se ofrecen las piscinas con al menos una medición; pulse **Probar la conexión** y compruebe en labcom.cloud que la aplicación sincronizó.
- **Un análisis que no aparece**: la aplicación debe sincronizarlo primero con LabCom; luego aparece en la siguiente lectura (15 minutos por defecto) o con **Actualizar**.
- **«Sin rango ideal»**: defina el ideal mínimo y máximo del parámetro en LabCom.
- Para una incidencia, indique las versiones de Gladys y de la integración, el mensaje de **Probar la conexión** y las líneas «Pool Lab diagnostic» escritas por **Diagnóstico** en los registros de la integración. Nunca pegue su token.

### Limitaciones conocidas

- **Nunca probada con una cuenta LabCom real**: la integración sigue el esquema GraphQL publicado y los dos clientes de código abierto (Home Assistant, ioBroker). La grafía exacta del estado del rango ideal es desconocida: se lee en cualquier forma y se calcula a partir del rango ideal cuando falta.
- Los puntos de muestreo compartidos (por otro usuario de LabCom) y los productos de tratamiento no se leen.
- La naturaleza de un parámetro (pH, cloro libre…) viene de su identificador o su nombre en LabCom: un parámetro desconocido conserva su nombre de LabCom y la categoría numérica simple.
