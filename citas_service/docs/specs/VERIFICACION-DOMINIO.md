# Verificación de los criterios de aceptación contra los repositorios en memoria

**Autor:** R (dominio de reservas) · **Fecha:** 9 nov 2026
**Fuentes:** `docs/ESPECIFICACION.md` §5 (CA-01 a CA-27), `app/repos/memoria/*`, `app/repos/interfaces.js`, `tests/repos/contrato-repos.js`.

**Método:** se ejecutó `npm test` (58 pruebas, 4 suites, todas en verde) y se recorrió cada criterio contra el código, no contra la prueba. El veredicto indica si la **regla** está implementada, no si el endpoint existe.

| Veredicto | Significado |
| --- | --- |
| ✅ | La regla ya está en el repositorio y cumple el criterio |
| 🟡 | El repositorio hace su parte; falta la decisión de la capa de dominio |
| ❌ | El repositorio contradice la especificación |
| ⛔ | No existe todavía y corresponde a la capa de dominio |

---

## 1. Resultado por criterio

| CA | Regla | Veredicto | Dónde / por qué |
| --- | --- | --- | --- |
| CA-01 | Apartado exitoso | 🟡 | `crear()` calcula total y moneda; faltan `expiraEn` (dominio) y `Location` (HTTP) |
| CA-02 | Plazo de 5 min | ⛔ | El repo recibe `expiraEn` ya calculado (E15); los 300 s los pone el dominio |
| CA-03 | Exclusividad | ✅ | `ASIENTO_NO_DISPONIBLE` con la lista de asientos; forma distinta, ver D-01 |
| CA-04 | Disponibilidad parcial | ✅ | Verifica todos antes de apartar: todo o nada |
| CA-05 | Una función por reserva | 🟡 | El modelo no liga asientos a funciones; ver D-06 |
| CA-06 | Función inexistente | ✅ | `NO_ENCONTRADO` |
| CA-07 | Precio congelado | ✅ | El precio se copia al `asientos[]` de la reserva |
| CA-08 | Límite al apartar | ✅ | `LIMITE_EXCEDIDO` con `actuales` y `solicitados`; nombre `limite` vs `maximo`, ver D-02 |
| CA-09 | El conteo suma boletos y reservas | ✅ | Cuenta reservas `activa` y `pagada` (los boletos viven en la orden) |
| CA-10 | Las vencidas no cuentan | ✅ | `estadoReserva()` las excluye |
| CA-11 | Límite por persona y función | ✅ | Filtra por `compradorId` + `funcionId`, sin mirar el sitio |
| CA-12 | Cuenta regresiva | 🟡 | `estado` correcto; `segundosRestantes` no existe en el repo |
| CA-13 | Vencida calculada | 🟡 | Igual: estado `vencida`, falta `segundosRestantes = 0` |
| CA-14 | Reserva de otro comprador | ⛔ | `obtener()` no filtra por comprador; la propiedad la valida el dominio |
| CA-15 | Los asientos se liberan solos | ✅ | `estadoAsiento()` compara `expiraEn > ahora` |
| CA-16 | Liberación exitosa | ✅ | Devuelve los asientos y no se puede repetir |
| CA-17 | Liberar una vencida | ❌ | El repo **sí** libera vencidas (BCK RN12); contradice el `410`, ver D-04 |
| CA-18 | Liberar una pagada | ✅ | `RESERVA_PAGADA` |
| CA-19 | Pago aprobado | 🟡 | Crea intento, orden, boletos y marca asientos; faltan `simulado`, tarjeta y últimos 4 dígitos |
| CA-20 | Rechazo no extiende el plazo | 🟡 | `registrarPagoRechazado()` no toca la reserva; el resultado lo decide el dominio |
| CA-21 | Reintento tras rechazo | ✅ | Probado en el contrato; sólo falta elegir la tarjeta |
| CA-22 | Pago de una vencida | ✅ | `exigirReservaVigente()` lanza antes de crear el intento |
| CA-23 | Pago doble | ✅ | `RESERVA_PAGADA`; no hay segunda orden |
| CA-24 | Atomicidad del pago | ✅ | Prepara todo y aplica al final; ver D-09 |
| CA-25 | Dos apartados simultáneos | ✅ | Cuerpo síncrono; probado en el contrato |
| CA-26 | Formato de error uniforme | ⛔ | `enviarError()` existe, pero nadie traduce `ErrorRepositorio` a HTTP |
| CA-27 | Datos de tarjeta inválidos | ⛔ | Validación D14 inexistente |

**Resumen:** 16 ✅ · 6 🟡 · 1 ❌ · 4 ⛔

---

## 2. Discrepancias y huecos

### D-01 · Forma de `detalles` en `ASIENTO_NO_DISPONIBLE` (media)

- **Especificación:** `detalles.asientoIds = ["A7"]`.
- **Repositorio:** `detalles.asientos = [{ asientoId, etiqueta, estado }]` (`reservas-repo-memoria.js:65-70`).
- **Recomendación:** adoptar la forma del repositorio, que informa la etiqueta y si está `apartado` o `comprado`; corregir §4 y el ejemplo de `openapi.yaml`. web_1 no lee ese campo.

### D-02 · Nombre del máximo en `LIMITE_EXCEDIDO` (baja)

- **Especificación:** `detalles { maximo, actuales, solicitados }`.
- **Repositorio:** `detalles { limite, actuales, solicitados }` (`reservas-repo-memoria.js:77-81`).
- **Recomendación:** unificar en `maximo` (lo dice la spec y suena a regla, no a parámetro interno).

### D-03 · Orden de validación: disponibilidad antes que límite (media)

- **Especificación (§3.2):** límite (paso 4) antes que disponibilidad (paso 5).
- **Repositorio:** disponibilidad (`:56-71`) antes que límite (`:73-83`).
- **Efecto:** si un asiento está ocupado y además se pasa de 10, responde `409`, no `422`.
- **Recomendación:** aceptar el orden del repositorio (informar el conflicto real es más útil que contar asientos que no se podrán apartar) y corregir §3.2.

### D-04 · Liberar una reserva vencida (alta)

- **Especificación (CA-17, §3.6):** `410 RESERVA_VENCIDA`.
- **Repositorio:** la marca `liberada` y limpia los asientos, siguiendo **BCK RN12** (`:149-150`).
- **Riesgo:** si la reserva venció y otro comprador ya apartó el asiento, el código no lo pisa (`:154`), así que la operación es segura.
- **Recomendación:** adoptar RN12 → `204`, alinear §3.6 y CA-17. Es la única ❌ y conviene cerrarla antes de la demo.

### D-05 · `segundosRestantes` no está en la reserva (media)

`openapi.yaml` lo marca `required` en `Reserva`, y `vistaReserva()` no lo calcula (`almacen.js:62-64`). **No requiere cambio de repositorio:** lo calcula el dominio al armar la respuesta (`max(0, expiraEn - ahora)` sólo si está `activa`).

### D-06 · CA-05 no es representable (media)

Los asientos pertenecen al **recinto**, no a la función: la misma butaca se aparta por función. El repositorio valida que sean del mismo sitio (`:44-47`), no de la misma función. `D1` de otra función del mismo evento **sí** es válido. **Recomendación:** reescribir RN03 y CA-05 como «asientos de otro recinto» y dejar el caso real en `400 SOLICITUD_INVALIDA`.

### D-07 · Los intentos de pago no guardan la tarjeta (media, depende de D)

`IntentosPago` no tiene `ultimosDigitos` (P19) ni `simulado` (`ordenes-repo-memoria.js:29-34`). El dominio puede devolver `simulado: true` y los últimos 4 dígitos en memoria, pero **no se persisten**. Requiere cambio del repositorio cuando el backend agregue `UltimosDigitos`.

### D-08 · La compra como invitado sigue bloqueada (alta, depende de D)

`crear()` exige `compradorId` no vacío (`reservas-repo-memoria.js:31`). Con P15 (`IdComprador` nulo y `Sitios.RequiereComprador`), web_2 no puede comprar. El dominio omitirá el límite cuando no haya comprador, pero el repositorio rechazará la reserva hasta que se ajuste.

### D-09 · Folio y códigos se consumen antes de aplicar (baja)

`siguienteFolio()` y `codigoBoletoUnico()` corren al preparar la orden (`:37` y `:46`). Si algo fallara antes de aplicar, quedaría un hueco en la numeración y códigos reservados. Hoy nada puede fallar entre ambos pasos, así que es sólo una nota para el adaptador SQL.

### D-10 · Falta el mapeo de errores de negocio (alta, para quien monte las rutas)

`app.js:39-51` sólo maneja JSON mal formado y el `500` genérico. Nadie convierte `ErrorRepositorio` en `400/404/409/410/422`. El dominio expone el `codigo`; el mapeo a status HTTP queda en la capa de rutas (D).

---

## 3. Lo que queda del lado de R

| Regla | Archivo propuesto |
| --- | --- |
| Reloj inyectable y plazo de 300 s | `app/dominio/reloj.js` |
| Validación D14 y últimos 4 dígitos | `app/dominio/tarjeta.js` |
| `expiraEn`, límite según el sitio, propiedad, `segundosRestantes`, elección del pago | `app/dominio/reservas.js` |
| Pruebas CA-01 a CA-27 con reloj simulado, sin HTTP | `tests/dominio/` |

## 4. Lo que hay que reportar

Todo quedó anotado y con dueño en [`PENDIENTES-DE-ACUERDO.md`](PENDIENTES-DE-ACUERDO.md):

- **D:** D-07 (últimos 4 dígitos), D-08 (comprador nulo), D-10 (mapeo de errores) y el orden de validación de D-03.
- **L:** `openapi.yaml` con las tarjetas de D14, `Boleto.codigo` de 12 caracteres, `Orden.numero` `ORD-000123` y las formas de `detalles` (D-01, D-02).
- **R (este documento):** corregir §3.2, §3.6, §4 y CA-05/CA-17 una vez acordado D-03 y D-04.
