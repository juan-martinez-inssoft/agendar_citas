'use strict';

const { crearReposEnMemoria } = require('../../app/repos/memoria');
const { crearRelojFijo } = require('../../app/dominio/reloj');
const { ServicioReservas } = require('../../app/dominio/reservas');

const FUNCION = 'fun-2026-11-06-1900';
const T0 = new Date('2026-11-06T16:00:00.000Z');
const ANA = 'cmp-ana';
const LUIS = 'cmp-luis';

const PAGO_APROBADO = {
  numeroTarjeta: '4242 4242 4242 4242',
  titular: 'ANA PEREZ',
  vencimiento: '12/28',
  cvv: '123',
};
const PAGO_RECHAZADO = { ...PAGO_APROBADO, numeroTarjeta: '4000 0000 0000 0002' };

function entorno(opciones = {}) {
  const repos = crearReposEnMemoria();
  const reloj = crearRelojFijo(T0);
  const servicio = new ServicioReservas({ repos, reloj, ...opciones });
  return { repos, reloj, servicio };
}

const apartar = (servicio, cambios = {}) =>
  servicio.apartar({
    sitio: 'web_1',
    compradorId: ANA,
    funcionId: FUNCION,
    asientoIds: ['A7'],
    ...cambios,
  });

const estadoDeAsiento = async (repos, reloj, asientoId) => {
  const asientos = await repos.asientosRepo.listarAsientos(FUNCION, reloj.ahora());
  return asientos.find((asiento) => asiento.id === asientoId).estado;
};

describe('Apartar (RF04)', () => {
  test('CA-01: aparta A7 y A8 con total y moneda', async () => {
    const { servicio } = entorno();
    const reserva = await apartar(servicio, { asientoIds: ['A7', 'A8'] });

    expect(reserva.estado).toBe('activa');
    expect(reserva.total).toBe(1600);
    expect(reserva.moneda).toBe('MXN');
    expect(reserva.compradorId).toBe(ANA);
    expect(reserva.asientos.map((a) => a.asientoId)).toEqual(['A7', 'A8']);
  });

  test('CA-02: el plazo es de 300 segundos y se refleja en segundosRestantes', async () => {
    const { servicio } = entorno();
    const reserva = await apartar(servicio);

    expect(reserva.expiraEn.getTime() - reserva.creadaEn.getTime()).toBe(300 * 1000);
    expect(reserva.segundosRestantes).toBe(300);
  });

  test('CA-03: otro comprador recibe ASIENTO_NO_DISPONIBLE con el asiento', async () => {
    const { servicio } = entorno();
    const reserva = await apartar(servicio);

    const error = await apartar(servicio, { compradorId: LUIS }).catch((e) => e);

    expect(error).toMatchObject({ codigo: 'ASIENTO_NO_DISPONIBLE' });
    expect(error.detalles.asientoIds).toEqual(['A7']);
    expect(error.detalles.asientos).toEqual([
      { asientoId: 'A7', etiqueta: 'A7', estado: 'apartado' },
    ]);

    const original = await servicio.obtener(reserva.id, { compradorId: ANA });
    expect(original.estado).toBe('activa');
  });

  test('CA-04: si un asiento falla no se aparta ninguno', async () => {
    const { repos, reloj, servicio } = entorno();
    await apartar(servicio, { compradorId: LUIS, asientoIds: ['A8'] });

    const error = await apartar(servicio, { asientoIds: ['A7', 'A8'] }).catch((e) => e);

    expect(error.codigo).toBe('ASIENTO_NO_DISPONIBLE');
    expect(await estadoDeAsiento(repos, reloj, 'A7')).toBe('disponible');
  });

  test('CA-06: una función inexistente responde NO_ENCONTRADO', async () => {
    const { servicio } = entorno();
    const error = await apartar(servicio, { funcionId: 'fun-inexistente' }).catch((e) => e);
    expect(error.codigo).toBe('NO_ENCONTRADO');
  });

  test('rechaza asientos de otro recinto sin apartar nada', async () => {
    const { servicio } = entorno();
    const error = await apartar(servicio, { asientoIds: ['A7', 'NO-EXISTE'] }).catch((e) => e);
    expect(error).toMatchObject({
      codigo: 'SOLICITUD_INVALIDA',
      detalles: { asientoIds: ['NO-EXISTE'] },
    });
  });

  test('CA-07: la reserva guarda el precio del momento', async () => {
    const { servicio } = entorno();
    const reserva = await apartar(servicio);
    expect(reserva.asientos[0]).toMatchObject({ asientoId: 'A7', zonaId: 'preferente', precio: 800 });
  });

  test('exige el sitio y, en web_1, al comprador', async () => {
    const { servicio } = entorno();

    expect((await apartar(servicio, { sitio: '' }).catch((e) => e)).codigo).toBe('SOLICITUD_INVALIDA');
    expect((await apartar(servicio, { compradorId: '' }).catch((e) => e)).codigo).toBe('NO_AUTENTICADO');
  });
});

describe('Límite por persona y función (RF11)', () => {
  test('CA-08: 9 asientos más 2 responde LIMITE_EXCEDIDO con maximo', async () => {
    const { servicio } = entorno();
    await apartar(servicio, { asientoIds: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'] });

    const error = await apartar(servicio, { asientoIds: ['B1', 'B2'] }).catch((e) => e);

    expect(error).toMatchObject({
      codigo: 'LIMITE_EXCEDIDO',
      detalles: { maximo: 10, actuales: 9, solicitados: 2 },
    });
  });

  test('CA-09: el conteo suma boletos comprados y reservas vigentes', async () => {
    const { servicio } = entorno();
    const comprada = await apartar(servicio, { asientoIds: ['A1', 'A2', 'A3', 'A4'] });
    await servicio.pagar(comprada.id, PAGO_APROBADO, { compradorId: ANA });
    await apartar(servicio, { asientoIds: ['B1', 'B2', 'B3', 'B4', 'B5'] });

    const error = await apartar(servicio, { asientoIds: ['C1', 'C2'] }).catch((e) => e);

    expect(error).toMatchObject({ codigo: 'LIMITE_EXCEDIDO' });
  });

  test('CA-10: las reservas vencidas no cuentan', async () => {
    const { reloj, servicio } = entorno();
    await apartar(servicio, { asientoIds: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'] });
    reloj.avanzarSegundos(301);

    const segunda = await apartar(servicio, { asientoIds: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'] });

    expect(segunda.estado).toBe('activa');
  });

  test('CA-11: el límite es por persona y función, no por sitio', async () => {
    const { servicio } = entorno();
    await apartar(servicio, { asientoIds: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] });

    const error = await apartar(servicio, {
      sitio: 'web_2',
      asientoIds: ['B1', 'B2', 'B3', 'B4', 'B5'],
    }).catch((e) => e);

    expect(error.codigo).toBe('LIMITE_EXCEDIDO');
  });

  test('sin comprador no se aplica el límite (P15)', async () => {
    const { servicio } = entorno();
    await apartar(servicio, { asientoIds: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'] });
    // web_2 no exige comprador; hoy el repositorio todavía no acepta `compradorId` nulo.
    const error = await apartar(servicio, { sitio: 'web_2', compradorId: '' }).catch((e) => e);
    expect(error.codigo).not.toBe('LIMITE_EXCEDIDO');
  });
});

describe('Consultar y expirar (RF05, RF07)', () => {
  test('CA-12: a los 120 segundos quedan 180', async () => {
    const { reloj, servicio } = entorno();
    const reserva = await apartar(servicio);
    reloj.avanzarSegundos(120);

    const actual = await servicio.obtener(reserva.id, { compradorId: ANA });

    expect(actual.estado).toBe('activa');
    expect(actual.segundosRestantes).toBe(180);
  });

  test('CA-13: a los 300 segundos está vencida y sin segundos', async () => {
    const { reloj, servicio } = entorno();
    const reserva = await apartar(servicio);
    reloj.avanzarSegundos(300);

    const actual = await servicio.obtener(reserva.id, { compradorId: ANA });

    expect(actual.estado).toBe('vencida');
    expect(actual.segundosRestantes).toBe(0);
  });

  test('CA-14: la reserva de otro comprador responde NO_ENCONTRADO', async () => {
    const { servicio } = entorno();
    const reserva = await apartar(servicio);

    const error = await servicio.obtener(reserva.id, { compradorId: LUIS }).catch((e) => e);

    expect(error.codigo).toBe('NO_ENCONTRADO');
  });

  test('CA-15: al vencer, el asiento se libera solo', async () => {
    const { repos, reloj, servicio } = entorno();
    await apartar(servicio);
    expect(await estadoDeAsiento(repos, reloj, 'A7')).toBe('apartado');

    reloj.avanzarSegundos(301);

    expect(await estadoDeAsiento(repos, reloj, 'A7')).toBe('disponible');
  });
});

describe('Liberar (RF06)', () => {
  test('CA-16: libera la reserva y el asiento vuelve a estar disponible', async () => {
    const { repos, reloj, servicio } = entorno();
    const reserva = await apartar(servicio);

    const liberada = await servicio.liberar(reserva.id, ANA);

    expect(liberada.estado).toBe('liberada');
    expect(await estadoDeAsiento(repos, reloj, 'A7')).toBe('disponible');
  });

  test('CA-17: liberar una vencida responde RESERVA_VENCIDA', async () => {
    const { reloj, servicio } = entorno();
    const reserva = await apartar(servicio);
    reloj.avanzarSegundos(301);

    const error = await servicio.liberar(reserva.id, ANA).catch((e) => e);

    expect(error.codigo).toBe('RESERVA_VENCIDA');
  });

  test('D-04: la opción permitirLiberarVencidas libera en lugar de fallar', async () => {
    const { reloj, servicio } = entorno({ permitirLiberarVencidas: true });
    const reserva = await apartar(servicio);
    reloj.avanzarSegundos(301);

    const liberada = await servicio.liberar(reserva.id, ANA);

    expect(liberada.estado).toBe('liberada');
  });

  test('CA-18: liberar una pagada responde RESERVA_PAGADA', async () => {
    const { servicio } = entorno();
    const reserva = await apartar(servicio);
    await servicio.pagar(reserva.id, PAGO_APROBADO, { compradorId: ANA });

    const error = await servicio.liberar(reserva.id, ANA).catch((e) => e);

    expect(error.codigo).toBe('RESERVA_PAGADA');
  });
});

describe('Pago simulado (RF08)', () => {
  test('CA-19: la tarjeta 4242 genera la orden y el boleto', async () => {
    const { repos, reloj, servicio } = entorno();
    const reserva = await apartar(servicio);

    const pago = await servicio.pagar(reserva.id, PAGO_APROBADO, { compradorId: ANA });

    expect(pago).toMatchObject({ resultado: 'aprobado', simulado: true, ultimosDigitos: '4242' });
    expect(pago.orden.boletos).toHaveLength(1);
    expect(pago.orden.numero).toMatch(/^ORD-\d{6}$/);
    expect(pago.orden.boletos[0].codigo).toHaveLength(12);
    expect(pago.reserva.estado).toBe('pagada');
    expect(await estadoDeAsiento(repos, reloj, 'A7')).toBe('comprado');
  });

  test('CA-20: el rechazo no cambia la reserva ni su vencimiento', async () => {
    const { reloj, servicio } = entorno();
    const reserva = await apartar(servicio);
    reloj.avanzarSegundos(60);

    const pago = await servicio.pagar(reserva.id, PAGO_RECHAZADO, { compradorId: ANA });

    expect(pago).toMatchObject({ resultado: 'rechazado', simulado: true, ultimosDigitos: '0002' });
    expect(pago.orden).toBeUndefined();
    expect(pago.reserva.estado).toBe('activa');
    expect(pago.reserva.expiraEn.getTime()).toBe(reserva.expiraEn.getTime());
  });

  test('CA-21: se puede reintentar y sólo queda una orden', async () => {
    const { repos, servicio } = entorno();
    const reserva = await apartar(servicio);

    await servicio.pagar(reserva.id, PAGO_RECHAZADO, { compradorId: ANA });
    const aprobado = await servicio.pagar(reserva.id, PAGO_APROBADO, { compradorId: ANA });

    expect(aprobado.resultado).toBe('aprobado');
    expect(await repos.ordenesRepo.listarDeComprador(ANA)).toHaveLength(1);
  });

  test('CA-22: pagar una reserva vencida no crea orden', async () => {
    const { repos, reloj, servicio } = entorno();
    const reserva = await apartar(servicio);
    reloj.avanzarSegundos(301);

    const error = await servicio.pagar(reserva.id, PAGO_APROBADO, { compradorId: ANA }).catch((e) => e);

    expect(error.codigo).toBe('RESERVA_VENCIDA');
    expect(error.detalles.expiraEn.getTime()).toBe(reserva.expiraEn.getTime());
    expect(await repos.ordenesRepo.listarDeComprador(ANA)).toHaveLength(0);
  });

  test('CA-23: el pago doble responde RESERVA_PAGADA', async () => {
    const { repos, servicio } = entorno();
    const reserva = await apartar(servicio);
    await servicio.pagar(reserva.id, PAGO_APROBADO, { compradorId: ANA });

    const error = await servicio.pagar(reserva.id, PAGO_APROBADO, { compradorId: ANA }).catch((e) => e);

    expect(error.codigo).toBe('RESERVA_PAGADA');
    expect(await repos.ordenesRepo.listarDeComprador(ANA)).toHaveLength(1);
  });

  test('CA-27: una tarjeta que no es de prueba no registra el intento', async () => {
    const { repos, servicio } = entorno();
    const reserva = await apartar(servicio);

    const error = await servicio.pagar(
      reserva.id,
      { ...PAGO_APROBADO, numeroTarjeta: '4111 1111 1111 1111' },
      { compradorId: ANA }
    ).catch((e) => e);

    expect(error).toMatchObject({
      codigo: 'SOLICITUD_INVALIDA',
      detalles: { campo: 'numeroTarjeta' },
    });
    expect((await servicio.obtener(reserva.id, { compradorId: ANA })).estado).toBe('activa');
    expect(await repos.ordenesRepo.listarDeComprador(ANA)).toHaveLength(0);
  });

  test('la reserva de otro comprador no se puede pagar', async () => {
    const { servicio } = entorno();
    const reserva = await apartar(servicio);

    const error = await servicio.pagar(reserva.id, PAGO_APROBADO, { compradorId: LUIS }).catch((e) => e);

    expect(error.codigo).toBe('NO_ENCONTRADO');
  });
});

describe('Concurrencia (CA-25)', () => {
  test('dos apartados del mismo asiento: exactamente uno gana', async () => {
    const { servicio } = entorno();

    const resultados = await Promise.allSettled([
      apartar(servicio, { compradorId: ANA }),
      apartar(servicio, { compradorId: LUIS }),
    ]);

    const exitosos = resultados.filter((r) => r.status === 'fulfilled');
    const fallidos = resultados.filter((r) => r.status === 'rejected');

    expect(exitosos).toHaveLength(1);
    expect(fallidos).toHaveLength(1);
    expect(fallidos[0].reason.codigo).toBe('ASIENTO_NO_DISPONIBLE');
  });
});
