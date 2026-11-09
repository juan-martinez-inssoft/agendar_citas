# Especificación — citas_service

Estado: **borrador de R (dominio de reservas)** para revisión de L. Actualizado el 6 nov con D14 (pago con tarjetas de prueba) y con la respuesta de web_2 a P4. Cubre la parte del contrato que corresponde a reservas, expiración, pago y límite por persona; el catálogo (eventos, funciones, asientos) y la autenticación se especifican aparte.

Base: `DEFINICION.md` (RF01–RF15, RN01–RN11), `specs/openapi.yaml` v0.1 y `architecture/adr/ADR-003-expiracion.md`. Cuando este documento y `openapi.yaml` difieran, **manda la spec** y se corrige aquí.

Las partes que dependen de otros equipos van marcadas como **[pendiente Pn]**. No se consideran acordadas hasta que aparezcan en `specs/ACUERDOS.md` → *Decisiones acordadas*.

---

## 1. Alcance

| Cubierto aquí | Fuera de este documento |
| --- | --- |
| Estados de asiento y de reserva | Catálogo de eventos, funciones y zonas (D) |
| Apartar, consultar, liberar y expirar (RF04–RF07) | Registro e inicio de sesión (D, depende de P5) |
| Pago simulado y orden (RF08, RF09) | Formato de los códigos de boleto y QR (PR7) |
| Límite de 10 asientos por persona y función (RF11, RN04) | Consolidación del backoffice (RF15) |
| Errores `400`, `401`, `404`, `409`, `410`, `422` y criterios de aceptación | Identificación del sitio en detalle (PR5) |

**Alcance por sitio (P4, PR #8):** `web_1` compra con cuenta, así que el límite de 10 (RN04) y la propiedad de la reserva (RN09) le aplican. `web_2` es un cineclub de 10 salas que compra **como invitado, sin cuenta**, por lo que esas dos reglas no aplican ahí; el servicio solo identifica al sitio. Cómo se registra una reserva sin comprador está abierto en P15, y el conteo diario que pide web_2 en P18.

---

## 2. Máquina de estados

### 2.1 Asiento en una función

El estado **no se guarda**: se calcula al consultar (ADR-003).

```text
              crearReserva            pagarReserva (aprobado)
disponible ───────────────▶ apartado ────────────────────────▶ comprado
     ▲                          │
     │  liberarReserva          │  vence el plazo (5 min)
     └──────────────────────────┘
```

| Estado | Condición | Transiciones de salida |
| --- | --- | --- |
| `disponible` | Sin reserva activa vigente y sin boleto | → `apartado` (crear reserva) |
| `apartado` | Pertenece a una reserva `activa` con `expiraEn > ahora` | → `comprado` (pago aprobado); → `disponible` (liberación o vencimiento) |
| `comprado` | Tiene boleto de una orden | Ninguna (terminal) |

Reglas:

- **RN02 — Exclusividad.** Un asiento sólo puede estar en una reserva vigente o en un boleto, nunca en dos a la vez.
- **RF03.** La consulta no revela quién aparta o compra; sólo el estado.
- Un asiento `comprado` no puede volver a `disponible` en el alcance de este ejercicio (no hay reembolsos ni cancelaciones de orden).

### 2.2 Reserva

```text
                pagarReserva (aprobado)
   ┌──────────▶ orden: pagada
   │
activa ────────┼──▶ liberada            (DELETE, sólo vigente)
   │
   └──────────▶ vencida               (ahora >= expiraEn, calculado)
```

| Estado | Se guarda | Significado | Operaciones permitidas |
| --- | --- | --- | --- |
| `activa` | Sí | Creada, dentro del plazo | Consultar, liberar, pagar |
| `vencida` | **No** | `activa` con `expiraEn <= ahora` | Consultar (lectura); liberar y pagar responden `410` |
| `liberada` | Sí | Cancelada por el comprador | Consultar (lectura) |
| `pagada` | Sí | Pago aprobado; generó orden | Consultar (lectura) |

- `vencida`, `liberada` y `pagada` son estados terminales; ninguna vuelve a `activa`.
- `vencida` es **calculado**, nunca almacenado (ADR-003, PR1).

---

## 3. Reglas de cálculo

### 3.1 Estado del asiento

```text
si tiene boleto                              → comprado
si existe reserva activa con expiraEn > ahora → apartado
en otro caso                                  → disponible
```

La comparación es estricta: con `ahora == expiraEn` la reserva ya está vencida y el asiento está disponible.

### 3.2 Creación de reserva (RF04)

Entrada: `funcionId`, `asientoIds[]` (1 a 10, sin repetidos).

Orden de validación (determinista, para que las pruebas no dependan del orden de los chequeos):

1. **Formato** — cuerpo válido, `X-Sitio` presente, 1–10 asientos, sin duplicados → `400 SOLICITUD_INVALIDA`.
2. **Identidad** — comprador identificado → `401 NO_AUTENTICADO` **[pendiente P5]**.
3. **Existencia** — la función existe y todos los asientos pertenecen a ella → `404 NO_ENCONTRADO`. Asientos de funciones distintas → `400` (RN03).
4. **Límite** — RN04 → `422 LIMITE_EXCEDIDO` **[propuesto, PR4]**.
5. **Disponibilidad** — todos los asientos disponibles → si alguno no lo está, `409 ASIENTO_NO_DISPONIBLE` con `detalles.asientoIds` de los que fallaron (RN11) **[propuesto, P9]**.
6. **Creación** — asignar `id`, tomar precios de la zona en esa función, calcular `total`, `creadaEn = ahora`, `expiraEn = ahora + 5 min`, estado `activa` → `201` con `Location`.

- La reserva es **atómica**: si falla cualquier paso, no se aparta ningún asiento.
- Todos los asientos deben ser de la misma función (RN03).
- El precio se congela al apartar y no cambia durante la vigencia (RN08).
- `total = Σ precio` de los asientos; `moneda` = MXN para web_1 **[P4 para web_2]**.

### 3.3 Exclusividad y concurrencia (RN02)

| Implementación | Mecanismo |
| --- | --- |
| En memoria | Verificación y apartado dentro de una sola función síncrona; Node.js no intercala (ADR-002) |
| Adaptador real | Transacción con bloqueo e índice único en la BD (D6, PR2); si el número de filas afectadas no coincide con los asientos pedidos, se revierte todo y se informa cuáles fallaron **[P12, P13]** |

En ambos casos, dos peticiones por el mismo asiento producen exactamente un `201` y un `409`.

### 3.4 Expiración (RN01, RF07, ADR-003)

- `expiraEn = creadaEn + 300 s`, calculado con el **reloj del servicio** (inyectable).
- **Expiración perezosa:** en cada lectura u operación se compara `expiraEn` con `ahora`; no hay temporizador obligatorio.
- Al vencer, los asientos vuelven a estar disponibles **sin intervención del sitio**.
- Un barrido periódico es opcional y sólo de limpieza; ninguna regla depende de él.
- `segundosRestantes = max(0, expiraEn - ahora)` en segundos enteros **si la reserva está `activa`**; en cualquier otro estado (`vencida`, `liberada`, `pagada`) vale `0`, aunque `expiraEn` todavía esté en el futuro.

### 3.5 Límite por persona y función (RN04, RF11)

```text
boletos comprados
+ asientos en reservas activas vigentes (expiraEn > ahora)
+ asientos solicitados
≤ 10
```

- Cuenta todas las operaciones del comprador en esa función, **sin importar el sitio** desde el que se hicieron.
- Las reservas vencidas no cuentan.
- Si se excede: `422 LIMITE_EXCEDIDO` con `detalles: { maximo: 10, actuales, solicitados }` **[propuesto, PR4]**.
- La consulta de conteo recibe `ahora` como parámetro (ADR-003), de modo que se puede probar con reloj simulado.

### 3.6 Liberación (RF06)

- Sólo sobre una reserva `activa` y vigente → `204`, sin cuerpo; los asientos quedan `disponible`.
- Reserva vencida → `410 RESERVA_VENCIDA`.
- Reserva pagada → `409 RESERVA_PAGADA`.
- Reserva de otro comprador → `404 NO_ENCONTRADO` (no se revela que existe, RN09) **[P5]**.
- Liberar dos veces: la segunda responde `410 RESERVA_LIBERADA`.

### 3.7 Pago simulado (RF08, RN05–RN07)

Entrada (D14): `numeroTarjeta`, `titular`, `vencimiento` (`MM/AA`, no vencida) y `cvv` (3 dígitos).

| Número de tarjeta | Resultado |
| --- | --- |
| `4242 4242 4242 4242` | Siempre **aprobado** |
| `4000 0000 0000 0002` | Siempre **rechazado** |
| Cualquier otro número | `400 SOLICITUD_INVALIDA` («usa una tarjeta de prueba») |

| Caso | Respuesta | Efecto |
| --- | --- | --- |
| Reserva activa vigente + tarjeta aprobada | `201` con `resultado: aprobado` | Reserva → `pagada`, se crea la **orden** y sus **boletos** en una sola operación |
| Reserva activa vigente + tarjeta rechazada | `201` con `resultado: rechazado` | Se registra el intento; la reserva sigue `activa` y `expiraEn` **no cambia** (RN06) |
| Reserva vencida | `410 RESERVA_VENCIDA` | No se cobra, no se crea orden ni boleto |
| Reserva pagada | `409 RESERVA_PAGADA` | No se permite un segundo pago |
| Reserva liberada | `410 RESERVA_LIBERADA` | Sin efecto |
| Campos faltantes, formato inválido o número que no es de prueba | `400 SOLICITUD_INVALIDA` | No se registra el intento |

- Ambos resultados responden `201` porque el **intento** queda registrado; el resultado viaja en el cuerpo.
- `simulado: true` siempre; el sitio debe avisar al usuario que el pago es simulado.
- **Datos de tarjeta (D14):** el servicio nunca guarda el número completo ni el `cvv`; el intento registra sólo los últimos 4 dígitos. La columna en `IntentosPago` está pedida al backend (P19); mientras no exista, el servicio los conserva sólo en memoria para armar la respuesta.
- **RN07 — Atomicidad:** marcar pagada + crear orden + crear boletos ocurre todo o nada. Si falla cualquier paso, la reserva permanece `activa`.
- Cada boleto recibe un código único y difícil de adivinar (RN10).

---

## 4. Catálogo de errores

Formato único del cuerpo (igual en toda la API):

```json
{
  "error": {
    "codigo": "CODIGO_ESTABLE",
    "mensaje": "Texto en español apto para mostrar al usuario.",
    "detalles": { }
  }
}
```

| HTTP | `codigo` | Cuándo | `detalles` |
| --- | --- | --- | --- |
| `400` | `SOLICITUD_INVALIDA` | Cuerpo inválido, falta `X-Sitio`, asientos repetidos, más de 10 en una petición, asientos de funciones distintas, **o datos de tarjeta mal formados o con un número que no es de prueba (D14)** | `campo` opcional |
| `401` | `NO_AUTENTICADO` | Falta el token del comprador o es inválido | — |
| `404` | `NO_ENCONTRADO` | Función, asiento o reserva inexistente, o reserva de otro comprador | — |
| `409` | `ASIENTO_NO_DISPONIBLE` | Al menos un asiento ya está `apartado` o `comprado` | `asientoIds: []` |
| `409` | `RESERVA_PAGADA` | Se intenta pagar o liberar una reserva ya pagada | — |
| `410` | `RESERVA_VENCIDA` | La reserva pasó su `expiraEn` | `expiraEn` |
| `410` | `RESERVA_LIBERADA` | La reserva fue liberada antes | — |
| `422` | `LIMITE_EXCEDIDO` | Se superarían 10 asientos por persona y función | `maximo`, `actuales`, `solicitados` |
| `500` | `ERROR_INTERNO` | Falla inesperada; se registra en log sin datos sensibles | — |

Notas:

- El `codigo` es estable y el sitio decide qué mostrar; el `mensaje` puede cambiar redacción.
- `422 LIMITE_EXCEDIDO` es una **propuesta** (PR4): distingue la regla de negocio del conflicto de disponibilidad. Si los webs prefieren `409`, se cambia sólo la tabla y la spec.
- Los errores nunca incluyen datos de otro comprador (RN09).

---

## 5. Criterios de aceptación (Given / When / Then)

Convenciones: `ahora` es la hora del reloj simulado; `T0 = 2026-11-06T10:00:00-06:00`. Asientos de ejemplo: `A7`, `A8` (Preferente, $800), `D1` (General, $500).

### RF04 — Apartar

**CA-01 · Apartado exitoso**
- **Dado** un comprador identificado y `A7`, `A8` disponibles en la función `F1`
- **Cuando** hace `POST /api/v1/reservas` con `{ funcionId: "F1", asientoIds: ["A7","A8"] }`
- **Entonces** responde `201`, la reserva queda `activa`, `total = 1600`, `moneda = MXN` y `Location` apunta a la reserva

**CA-02 · Plazo de 5 minutos (RN01)**
- **Dado** el reloj en `T0`
- **Cuando** se crea la reserva del CA-01
- **Entonces** `expiraEn - creadaEn = 300 s` y `segundosRestantes = 300`

**CA-03 · Exclusividad (RN02)**
- **Dado** una reserva vigente que ya incluye `A7`
- **Cuando** otro comprador intenta apartar `A7`
- **Entonces** responde `409 ASIENTO_NO_DISPONIBLE` y `detalles.asientoIds = ["A7"]`; la reserva original no cambia

**CA-04 · Disponibilidad parcial (RN11) — [pendiente P9]**
- **Dado** `A7` disponible y `A8` apartado por otro comprador
- **Cuando** se intenta apartar `["A7","A8"]`
- **Entonces** responde `409 ASIENTO_NO_DISPONIBLE` y **no queda apartado** `A7`

**CA-05 · Una función por reserva (RN03)**
- **Dado** `A7` de `F1` y `D1` de `F2`
- **Cuando** se envían juntos en una reserva
- **Entonces** responde `400 SOLICITUD_INVALIDA`

**CA-06 · Función o asiento inexistente**
- **Dado** un `funcionId` que no existe
- **Cuando** se intenta apartar
- **Entonces** responde `404 NO_ENCONTRADO`

**CA-07 · Precio congelado (RN08)**
- **Dado** una reserva con `A7` a $800
- **Cuando** cambia el precio de la zona y se consulta la reserva
- **Entonces** el precio y el total siguen en $800

### RF11 / RN04 — Límite de 10

**CA-08 · Límite al apartar**
- **Dado** un comprador con 9 asientos contados en `F1`
- **Cuando** intenta apartar 2 más en `F1`
- **Entonces** responde `422 LIMITE_EXCEDIDO` con `{ maximo: 10, actuales: 9, solicitados: 2 }`

**CA-09 · El conteo suma boletos y reservas vigentes**
- **Dado** un comprador con 4 boletos comprados y 5 asientos en una reserva vigente de `F1`
- **Cuando** intenta apartar 2 asientos más de `F1`
- **Entonces** responde `422`

**CA-10 · Las reservas vencidas no cuentan**
- **Dado** un comprador con 10 asientos apartados cuya reserva ya venció
- **Cuando** aparta 10 asientos nuevos de la misma función
- **Entonces** responde `201`

**CA-11 · El límite es por persona y función, no por sitio**
- **Dado** un comprador que apartó 6 asientos desde `web_1`
- **Cuando** pide 5 más desde `web_2` en la misma función
- **Entonces** responde `422`

### RF05 — Consultar

**CA-12 · Cuenta regresiva**
- **Dado** una reserva activa creada en `T0`
- **Cuando** se consulta con el reloj en `T0 + 120 s`
- **Entonces** responde `200`, `estado = activa` y `segundosRestantes = 180`

**CA-13 · Reserva vencida calculada**
- **Dado** una reserva activa creada en `T0`
- **Cuando** se consulta con el reloj en `T0 + 300 s`
- **Entonces** responde `200`, `estado = vencida` y `segundosRestantes = 0`

**CA-14 · Reserva de otro comprador (RN09) — [pendiente P5]**
- **Dado** una reserva de otro comprador
- **Cuando** se intenta consultar
- **Entonces** responde `404 NO_ENCONTRADO`

### RF07 — Expiración

**CA-15 · Los asientos se liberan solos**
- **Dado** una reserva activa con `A7`
- **Cuando** el reloj avanza 301 s
- **Entonces** `GET /funciones/F1/asientos` muestra `A7` como `disponible`, sin ninguna petición de liberación

### RF06 — Liberar

**CA-16 · Liberación exitosa**
- **Dado** una reserva activa con `A7`
- **Cuando** el dueño hace `DELETE /reservas/{id}`
- **Entonces** responde `204` y `A7` vuelve a `disponible`

**CA-17 · Liberar una reserva vencida**
- **Dado** una reserva con `expiraEn` ya pasado
- **Cuando** el dueño intenta liberarla
- **Entonces** responde `410 RESERVA_VENCIDA` y el estado sigue `vencida`

**CA-18 · Liberar una reserva pagada**
- **Dado** una reserva `pagada`
- **Cuando** el dueño intenta liberarla
- **Entonces** responde `409 RESERVA_PAGADA`

### RF08 — Pago

**CA-19 · Pago aprobado (D14)**
- **Dado** una reserva activa con `A7`
- **Cuando** se envía `{ numeroTarjeta: "4242 4242 4242 4242", titular: "ANA PEREZ", vencimiento: "12/28", cvv: "123" }`
- **Entonces** responde `201` con `simulado: true`, la reserva queda `pagada`, se crea una orden con 1 boleto con código único y `A7` pasa a `comprado`

**CA-20 · Pago rechazado no extiende el plazo (RN06, D14)**
- **Dado** una reserva activa con `expiraEn = T0 + 300`
- **Cuando** se envía `{ numeroTarjeta: "4000 0000 0000 0002", titular: "ANA PEREZ", vencimiento: "12/28", cvv: "123" }` en `T0 + 60`
- **Entonces** responde `201` con `resultado: rechazado`, la reserva sigue `activa` y `expiraEn` sigue igual

**CA-21 · Reintento tras rechazo**
- **Dado** el caso del CA-20
- **Cuando** se reintenta con `4242 4242 4242 4242` antes de vencer
- **Entonces** responde `201`, la reserva pasa a `pagada` y existe **una sola** orden

**CA-22 · Pago sobre reserva vencida (RN05)**
- **Dado** una reserva vencida
- **Cuando** se intenta pagar
- **Entonces** responde `410 RESERVA_VENCIDA`, no se crea orden ni boleto y no hay registro de cobro

**CA-23 · Pago doble**
- **Dado** una reserva `pagada`
- **Cuando** se intenta pagar otra vez
- **Entonces** responde `409 RESERVA_PAGADA` y sigue existiendo una sola orden

**CA-24 · Atomicidad del pago (RN07)**
- **Dado** una reserva activa
- **Cuando** falla la creación de un boleto durante el pago
- **Entonces** no queda orden parcial ni boleto huérfano y la reserva sigue `activa`

### Conclusiones transversales

**CA-25 · Dos apartados simultáneos del mismo asiento (RN02)**
- **Dado** `A7` disponible
- **Cuando** dos peticiones de reserva por `A7` se ejecutan "al mismo tiempo"
- **Entonces** exactamente una responde `201` y la otra `409 ASIENTO_NO_DISPONIBLE`

**CA-26 · Formato de error uniforme**
- **Dado** cualquier error de los anteriores
- **Cuando** se inspecciona el cuerpo
- **Entonces** tiene `error.codigo`, `error.mensaje` y, si aplica, `error.detalles`, sin datos de otros compradores

**CA-27 · Datos de tarjeta inválidos (D14)**
- **Dado** una reserva activa
- **Cuando** se envía un `numeroTarjeta` distinto de las dos tarjetas de prueba, o un `vencimiento` ya pasado, o un `cvv` que no tiene 3 dígitos
- **Entonces** responde `400 SOLICITUD_INVALIDA` con `detalles.campo` y **no** se registra el intento de pago

---

## 6. Matriz requisito → criterio

| Requisito | Criterios |
| --- | --- |
| RF04 | CA-01 a CA-07 |
| RF05 | CA-12, CA-13, CA-14 |
| RF06 | CA-16, CA-17, CA-18 |
| RF07 | CA-15 |
| RF08 | CA-19 a CA-24, CA-27 |
| RF09 | CA-19 (orden y boleto) |
| RF11 | CA-08 a CA-11 |
| RN01 | CA-02 |
| RN02 | CA-03, CA-25 |
| RN03 | CA-05 |
| RN04 | CA-08 a CA-11 |
| RN05 | CA-22 |
| RN06 | CA-20, CA-21 |
| RN07 | CA-24 |
| RN08 | CA-07 |
| RN09 | CA-14 |
| RN10 | CA-19 |

---

## 7. Lo que falta para congelar esta especificación

| Pendiente | Qué decide | Qué cambia aquí |
| --- | --- | --- |
| **P9** | Disponibilidad parcial | CA-04 y la tabla de errores. El backend ya lo implementa (RN08) y web_2 está de acuerdo (PR #8); **solo falta web_1** |
| ~~P10~~ | **Resuelto en D14:** pago con dos tarjetas de prueba; el sitio envía `numeroTarjeta`, `titular`, `vencimiento` y `cvv` | Ya aplicado en §3.7 y CA-19 a CA-21. Obliga a reemplazar `resultadoSimulado` en `openapi.yaml` |
| **P5** | Quién gestiona cuentas y cómo se identifica al comprador | RN09, RF10, CA-11, CA-14 y el `401`. web_2 ya respondió que no usa cuentas; falta web_1 |
| **P4** | Negocio y datos de web_2 | **Respondido por web_2 (PR #8):** cineclub, 10 salas, una zona por función, precio por formato, compra sin cuenta. Ya reflejado en §1; sus consecuencias son P15–P18 |
| **P15** | Cómo registrar una reserva sin comprador (`IdComprador` no admite nulos) | RN09, RF10 y el modelo de `Reserva`; hoy el contrato exige comprador |
| **P19** | Columna para los últimos 4 dígitos en `IntentosPago` | §3.7: sin ella, los últimos 4 dígitos solo se pueden devolver en memoria |
| **P8** | Zona horaria | Los ejemplos de `inicio` y `expiraEn`. El backend ya respondió (UTC en BD, el servicio convierte a `America/Mexico_City`); falta la confirmación de los webs (ver Anexo A) |
| **PR3** | `409`/`410` como errores acordados | La tabla de errores |
| **PR4** | Código del límite (hoy `422`) | CA-08 a CA-11 |
| **PR7** | Formato del código de boleto | CA-19 |
| ~~P11–P13~~ | **Resueltos por el backend el 5 nov** (ver Anexo A) | Ya no bloquean: `@Ahora` + `Estado`/`ExpiraEn`, códigos por rangos y asientos fallidos en un result set + mensaje |

---

## 8. Criterios para las pruebas (etapa 6)

- **Reloj simulado** (`RelojFijo`): se define `ahora` al inicio y se avanza de forma explícita; ninguna prueba espera 5 minutos reales (RNF06).
- **Datos semilla**: 1 evento, 1 función de prueba, zonas Preferente/General/Balcón y asientos `A7`, `A8`, `D1` disponibles al iniciar.
- **Independencia**: cada prueba parte de un estado limpio; no se comparten reservas entre pruebas.
- **Concurrencia**: CA-25 se implementa lanzando las dos peticiones con `Promise.all` y verificando que sólo una tenga éxito.
- **Sin datos sensibles** en logs ni en cuerpos de error (RNF09).

---

## 9. Revisión pendiente

Las correcciones concretas, con su dueño y el texto propuesto para `ACUERDOS.md`, están en [`specs/PENDIENTES-DE-ACUERDO.md`](PENDIENTES-DE-ACUERDO.md).

- **L:** publicar en `openapi.yaml` los cambios de D14 (tarjetas de prueba en lugar de `resultadoSimulado`), el `pattern` del código de boleto de 12 caracteres, `ORD-000123` y las formas de `detalles`.
- **R:** faltan **P9** y **P5**, ambos de web_1, para congelar la versión 1.0; P10 ya está aplicado en §3.7.
- **D:** confirmar que las interfaces `ReservasRepo` y `OrdenesRepo` reciben `ahora` y exponen lo necesario para CA-08 a CA-11 y CA-24; además, PA-08 a PA-11 de la lista de pendientes.

---

## Anexo A — Alineación con `citas_backend` (revisión del 6 nov 2026)

Fuentes revisadas: `citas_backend/docs/BCK_ANTEPROYECTO.md`, `BCK_PROPUESTA.md` (§4, §5, §7), `BCK_DEFINICION.md` (§5, §6, §8) y los ADR `BCK_ADR-001` a `BCK_ADR-004`.

**Aviso:** estas respuestas ya están escritas por el backend y se enviaron al chat el 5 nov. L las registró como **D7–D14 en su PR #9** (abierto, sin fusionar); este anexo queda como sustento técnico y como referencia de las diferencias detectadas. Hasta que el PR #9 se fusione, la fuente oficial sigue siendo `ACUERDOS.md` en `main`.

### A.1 Pendientes con respuesta ya escrita

| Ref. | Respuesta del backend | Dónde está | Efecto en este documento |
| --- | --- | --- | --- |
| P3 | El backend carga los datos iniciales de web_1 (1 evento, 120 funciones, 3 zonas, 120 asientos, 360 precios) en `05_datos_iniciales.sql`; los de web_2 cuando se responda P4 | PROPUESTA §7 | Los datos semilla de §8 los provee la BD, no el servicio |
| P6 | Diccionario de datos con la equivalencia de cada campo en `BCK_DEFINICION.md` §6 y diagrama en `docs/architecture/`; columnas nuevas por script nuevo numerado y aviso por chat | PROPUESTA §7, DEF §9 | Ya existe la trazabilidad campo a campo |
| P11 | `spAsientos_ListarPorFuncion` recibe `@Ahora` y devuelve `Estado` (`Disponible`/`Apartado`/`Vendido`) **y** `ExpiraEn` | PROPUESTA §7 | El adaptador no calcula el estado; la versión en memoria sí (A.4) |
| P12 | Rangos: `51xxx → 409`, `52xxx → 410`, `53xxx → 422`, `54xxx → 404`, `50000 → 500`; la lista final se publica en `BCK_ESPECIFICACION.md` (etapa 4, aún no escrita) | PROPUESTA §5, DEF §5.6 | Ver A.2 |
| P13 | `spReservas_Crear` devuelve un result set con `IdAsiento`, `Etiqueta` y `Motivo` **antes** de `THROW 51001`; los Id van también en el texto del mensaje | PROPUESTA §7, DEF RN08 | `detalles.asientoIds` se puede llenar por cualquiera de las dos vías |
| P14 | El precio va por zona **y función** (`PreciosZonaFuncion`) | PROPUESTA §7, DEF §6.2 | Confirma RN08; no cambia la API |
| P8 (lado backend) | Fechas en **UTC** en la BD; el servicio las entrega en `America/Mexico_City`, que es UTC−6 todo el año | ANTEPROYECTO E6/E18, DEF RN24 | Ver A.4 |
| P5 (lado backend) | La BD guarda compradores con correo único y **hash**; el hash, la autenticación y los tokens los hace el servicio | ANTEPROYECTO E3 | Habilita RF12 y RN09 si los webs aceptan |
| PR1 | Aceptada: el servicio envía `@ExpiraEn` junto con `@Ahora`; la BD sólo valida `ExpiraEn > Ahora` | DEF E15, RN07 | Refuerza ADR-003 |
| PR2 / D6 | Apartado atómico con actualización condicionada, transacción e índice único | `BCK_ADR-002`, DEF RN08 | Igual que CA-03 y CA-25 |
| PR4 | El máximo de 10 lo valida el servicio y lo **revalida** `spReservas_Crear` (53001 → 422) | PROPUESTA §4, DEF RN09 | Confirma CA-08 a CA-11 con `422` |

### A.2 Conversión de errores `THROW` → respuesta HTTP

El servicio decide por el código numérico y nunca lo expone al cliente.

| `THROW` | HTTP | `codigo` de la API | Cuándo |
| --- | --- | --- | --- |
| 51001 | 409 | `ASIENTO_NO_DISPONIBLE` | Asientos ocupados al crear; `detalles.asientoIds` |
| 51002 | 409 | `CORREO_REGISTRADO` | Registro con correo ya existente |
| 51003 | 409 | `RESERVA_PAGADA` | Reserva ya pagada o liberada |
| 52001 | 410 | `RESERVA_VENCIDA` | Pago o liberación sobre reserva vencida |
| 53001 | 422 | `LIMITE_EXCEDIDO` | Más de 10 asientos por persona y función |
| 53002 | 422 | `SOLICITUD_INVALIDA` | Lista vacía, repetida, inválida o de más de 10 |
| 53003 | 422 | `SOLICITUD_INVALIDA` | Asiento que no pertenece a la función |
| 53004 | 422 | `ERROR_INTERNO` (**propuesta**) | `ExpiraEn` no posterior a `Ahora`: es un fallo del servicio, no del cliente |
| 54001–54005 | 404 | `NO_ENCONTRADO` | Función, reserva, orden, comprador, sitio o evento |
| 50000 | 500 | `ERROR_INTERNO` | Error no previsto |

**Precedencia:** el servicio valida antes de llamar al SP (formato → identidad → existencia → límite → disponibilidad). Si la validación previa detecta el problema responde `400`; los `422` del backend aparecen sólo si la petición pasó la validación previa (defensa en profundidad). Por eso CA-05 sigue siendo `400` aunque `53003` diga `422`.

### A.3 Decisiones que el servicio debe confirmar (QB2–QB5)

| # | Pregunta del backend | Respuesta propuesta de R |
| --- | --- | --- |
| QB2 | ¿Aceptan que `spReservas_Crear` reciba `@Ahora` **y** `@ExpiraEn`? | **Sí.** Coincide con ADR-003: el servicio calcula `expiraEn = ahora + 5 min` y la BD sólo valida `ExpiraEn > Ahora` |
| QB3 | ¿El driver `mssql` lee el result set que llega antes de `THROW`? | **No de forma confiable.** Se usará el texto del mensaje (`Asientos no disponibles: 12,15`) como ruta principal y, si el result set llega, se usa para `Etiqueta`. Se verifica en la etapa 6 |
| QB4 | ¿Folio `ORD-000123` y código de boleto de 12 caracteres? | **Folio: sí.** Código: sí, pero hay que corregir `openapi.yaml` (A.4) |
| QB5 | Códigos nuevos 53004 y 54005 | **Aceptados**, con el mapeo de A.2 |

### A.4 Diferencias detectadas y propuesta de ajuste

| # | Diferencia | Impacto | Propuesta |
| --- | --- | --- | --- |
| 1 | `openapi.yaml` ejemplifica `Boleto.codigo` como `BOL-7KQ2-M9XD-4TPA`; el backend genera `CHAR(12)` sin prefijos ni guiones | El QR del sitio y el contrato deben coincidir | Adoptar 12 caracteres (ej. `7KQ2M9XD4TPA`) y actualizar ejemplo y `pattern` de la spec |
| 2 | `openapi.yaml` ejemplifica `Orden.numero` como `ORD-2026-000123`; el backend genera `ORD-` + `Id` a 6 dígitos | El sitio mostraría un número distinto al real | Adoptar `ORD-000123` |
| 3 | DEF RN12 permite liberar reservas vencidas; CA-17 responde `410` | Ninguno funcional: `SP11` no recibe `@Ahora` y el vencimiento es del servicio | El servicio responde `410` y no llama al SP; `SP17` queda sólo para limpieza |
| 4 | En memoria el estado se calcula; con BD lo devuelve `spAsientos_ListarPorFuncion` | Dos fuentes de verdad | El adaptador mapea `Disponible`/`Apartado`/`Vendido` a `disponible`/`apartado`/`comprado`; ambas implementaciones deben usar la misma regla (`ExpiraEn > ahora`) |
| 5 | `PreciosZonaFuncion.Moneda` admite `MXN` o `USD` | web_2 ya respondió que usa **MXN** (PR #8) | Mantener `moneda` en el contrato y no asumirla en el código: es un dato de la función |

### A.5 Implicación para el esqueleto (D)

Las firmas de `ReservasRepo` deben recibir el reloj y el vencimiento, no calcularlos:

```text
ReservasRepo.crear({ compradorId, sitio, funcionId, asientoIds, ahora, expiraEn })
ReservasRepo.contarAsientos(compradorId, funcionId, ahora)
ReservasRepo.obtener(reservaId, ahora)
```

Si el esqueleto no incluye `expiraEn` en `crear`, el adaptador a SQL Server no podrá cumplir E15 y habrá que rehacerlo. Es el punto que hay que cerrar con D antes de escribir el dominio.
