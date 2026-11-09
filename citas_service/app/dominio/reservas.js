'use strict';

const { CODIGOS, ErrorRepositorio } = require('../repos/errores');
const { validarTarjeta } = require('./tarjeta');
const { crearRelojSistema } = require('./reloj');

const DURACION_POR_DEFECTO = 300; // 5 minutos (RN01)
const LIMITE_POR_DEFECTO = 10; // RN04
const SITIOS_QUE_EXIGEN_COMPRADOR = ['web_1'];

/**
 * Dominio de reservas (R). Aplica las reglas de negocio sobre los repositorios y el reloj;
 * no conoce Express ni códigos HTTP.
 *
 * Reglas que viven aquí y no en el repositorio:
 * - `expiraEn = ahora + 300 s`.
 * - El límite de 10 se valida sólo cuando hay comprador (P15, BCK RN09).
 * - La reserva sólo la ve, libera y paga su dueño (RN09).
 * - El resultado del pago lo decide la tarjeta de prueba (D14).
 * - `segundosRestantes` se calcula al leer (CA-02, CA-12, CA-13).
 */
class ServicioReservas {
  /**
   * @param {Object} opciones
   * @param {{ reservasRepo: Object, ordenesRepo: Object }} opciones.repos
   * @param {import('./reloj').Reloj} [opciones.reloj]
   * @param {number} [opciones.duracionSegundos]
   * @param {number} [opciones.limitePorComprador]
   * @param {string[]} [opciones.sitiosQueExigenComprador]
   * @param {boolean} [opciones.permitirLiberarVencidas] hoy `false` (CA-17); D-04 propone `true`
   */
  constructor({
    repos,
    reloj = crearRelojSistema(),
    duracionSegundos = DURACION_POR_DEFECTO,
    limitePorComprador = LIMITE_POR_DEFECTO,
    sitiosQueExigenComprador = SITIOS_QUE_EXIGEN_COMPRADOR,
    permitirLiberarVencidas = false,
  } = {}) {
    if (!repos || !repos.reservasRepo || !repos.ordenesRepo) {
      throw new TypeError('ServicioReservas necesita reservasRepo y ordenesRepo.');
    }
    if (!reloj || typeof reloj.ahora !== 'function') {
      throw new TypeError('ServicioReservas necesita un reloj con ahora().');
    }
    this.repos = repos;
    this.reloj = reloj;
    this.duracionSegundos = duracionSegundos;
    this.limitePorComprador = limitePorComprador;
    this.sitiosQueExigenComprador = sitiosQueExigenComprador;
    this.permitirLiberarVencidas = permitirLiberarVencidas;
  }

  /**
   * Aparta los asientos por 5 minutos (RF04, CA-01 a CA-11).
   * @param {{ sitio: string, compradorId?: string, funcionId: string, asientoIds: string[] }} datos
   */
  async apartar({ sitio, compradorId, funcionId, asientoIds } = {}) {
    this.#exigirSitio(sitio);
    this.#exigirComprador(sitio, compradorId);

    const ahora = this.reloj.ahora();
    const expiraEn = new Date(ahora.getTime() + this.duracionSegundos * 1000);
    const limite = this.#hayComprador(compradorId) ? this.limitePorComprador : undefined;

    try {
      const reserva = await this.repos.reservasRepo.crear({
        sitio,
        compradorId,
        funcionId,
        asientoIds,
        ahora,
        expiraEn,
        limitePorComprador: limite,
      });
      return this.#vista(reserva, ahora);
    } catch (error) {
      throw normalizarDetalles(error);
    }
  }

  /**
   * Consulta una reserva del comprador (RF05). La de otro comprador responde
   * `NO_ENCONTRADO` para no revelar que existe (CA-14).
   * @param {string} reservaId
   * @param {{ compradorId?: string }} [datos]
   */
  async obtener(reservaId, { compradorId } = {}) {
    const ahora = this.reloj.ahora();
    const reserva = await this.repos.reservasRepo.obtener(reservaId, ahora);
    this.#exigirPropietario(reserva, compradorId);
    return this.#vista(reserva, ahora);
  }

  /** Reservas activas y vigentes del comprador (RF05). */
  async listarActivas(compradorId) {
    if (!this.#hayComprador(compradorId)) return [];
    const ahora = this.reloj.ahora();
    const reservas = await this.repos.reservasRepo.listarActivasDeComprador(compradorId, ahora);
    return reservas.map((reserva) => this.#vista(reserva, ahora));
  }

  /**
   * Libera una reserva activa del comprador (RF06, CA-16 a CA-18).
   * @param {string} reservaId
   * @param {string} [compradorId]
   */
  async liberar(reservaId, compradorId) {
    const ahora = this.reloj.ahora();
    const reserva = await this.repos.reservasRepo.obtener(reservaId, ahora);
    this.#exigirPropietario(reserva, compradorId);

    if (!this.permitirLiberarVencidas && reserva.estado === 'vencida') {
      throw new ErrorRepositorio(CODIGOS.RESERVA_VENCIDA, 'La reserva venció.', {
        expiraEn: reserva.expiraEn,
      });
    }

    try {
      const liberada = await this.repos.reservasRepo.liberar(reservaId, ahora);
      return this.#vista(liberada, ahora);
    } catch (error) {
      throw conExpiraEn(normalizarDetalles(error), reserva);
    }
  }

  /**
   * Pago simulado (RF08, CA-19 a CA-24 y CA-27).
   *
   * Valida la tarjeta antes de tocar la reserva: un número que no es de prueba es un
   * `SOLICITUD_INVALIDA` y no deja intento registrado.
   *
   * @param {string} reservaId
   * @param {Object} datosTarjeta
   * @param {{ compradorId?: string }} [datos]
   */
  async pagar(reservaId, datosTarjeta, { compradorId } = {}) {
    const ahora = this.reloj.ahora();
    const { resultado, ultimosDigitos } = validarTarjeta(datosTarjeta, ahora);

    const reserva = await this.repos.reservasRepo.obtener(reservaId, ahora);
    this.#exigirPropietario(reserva, compradorId);

    try {
      if (resultado === 'rechazado') {
        const intento = await this.repos.reservasRepo.registrarPagoRechazado({ reservaId, ahora });
        const actual = await this.repos.reservasRepo.obtener(reservaId, ahora);
        return {
          ...intento,
          simulado: true,
          ultimosDigitos,
          reserva: this.#vista(actual, ahora),
        };
      }

      const { intento, orden } = await this.repos.ordenesRepo.pagar({ reservaId, ahora });
      const actual = await this.repos.reservasRepo.obtener(reservaId, ahora);
      return {
        ...intento,
        simulado: true,
        ultimosDigitos,
        orden,
        reserva: this.#vista(actual, ahora),
      };
    } catch (error) {
      throw conExpiraEn(normalizarDetalles(error), reserva);
    }
  }

  // --- Reglas internas -----------------------------------------------------------------

  #hayComprador(compradorId) {
    return typeof compradorId === 'string' && compradorId.trim() !== '';
  }

  #exigirSitio(sitio) {
    if (typeof sitio !== 'string' || sitio.trim() === '') {
      throw new ErrorRepositorio(CODIGOS.SOLICITUD_INVALIDA, 'Falta identificar el sitio.');
    }
  }

  #exigirComprador(sitio, compradorId) {
    if (this.sitiosQueExigenComprador.includes(sitio) && !this.#hayComprador(compradorId)) {
      throw new ErrorRepositorio('NO_AUTENTICADO', 'Falta identificar al comprador.');
    }
  }

  /** No se revela la existencia de reservas ajenas (RN09, CA-14). */
  #exigirPropietario(reserva, compradorId) {
    if (!reserva) {
      throw new ErrorRepositorio(CODIGOS.NO_ENCONTRADO, 'Reserva no encontrada.');
    }
    if (this.#hayComprador(compradorId) && reserva.compradorId !== compradorId) {
      throw new ErrorRepositorio(CODIGOS.NO_ENCONTRADO, 'Reserva no encontrada.');
    }
  }

  /** Agrega `segundosRestantes` sin tocar el objeto guardado (CA-02, CA-12, CA-13). */
  #vista(reserva, ahora) {
    const segundosRestantes =
      reserva.estado === 'activa'
        ? Math.max(0, Math.floor((reserva.expiraEn.getTime() - ahora.getTime()) / 1000))
        : 0;
    return { ...reserva, segundosRestantes };
  }
}

/**
 * Adapta las formas de `detalles` del repositorio a la especificación (§4) sin
 * romper a quien ya usa la forma del repositorio:
 * - `ASIENTO_NO_DISPONIBLE` gana `asientoIds` además de `asientos` (D-01).
 * - `LIMITE_EXCEDIDO` publica `maximo` en lugar de `limite` (D-02).
 */
function normalizarDetalles(error) {
  if (!(error instanceof ErrorRepositorio) || !error.detalles) return error;

  if (error.codigo === CODIGOS.ASIENTO_NO_DISPONIBLE && Array.isArray(error.detalles.asientos)) {
    error.detalles.asientoIds = error.detalles.asientos.map((asiento) => asiento.asientoId);
  }

  if (error.codigo === CODIGOS.LIMITE_EXCEDIDO && error.detalles.limite !== undefined) {
    const { limite, ...resto } = error.detalles;
    error.detalles = { maximo: limite, ...resto };
  }

  return error;
}

/** Agrega `detalles.expiraEn` a `RESERVA_VENCIDA`, como pide el catálogo de errores (§4). */
function conExpiraEn(error, reserva) {
  if (error instanceof ErrorRepositorio && error.codigo === CODIGOS.RESERVA_VENCIDA && reserva) {
    error.detalles = { expiraEn: reserva.expiraEn, ...error.detalles };
  }
  return error;
}

module.exports = { ServicioReservas, DURACION_POR_DEFECTO, LIMITE_POR_DEFECTO };
