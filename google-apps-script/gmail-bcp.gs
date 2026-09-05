/**
 * Ingesta de correos del BCP: Gmail → API de Next.js.
 *
 * Este script NO interpreta nada. Solo hace tres cosas:
 *
 *   1. Detectar los correos del BCP.
 *   2. Leer su metadata y su texto plano.
 *   3. Enviarlos a POST /api/ingest/bcp.
 *
 * Toda la lógica de negocio (validar, parsear, deduplicar, guardar) vive en
 * Next.js. Así se corrige el parser desplegando la web, sin volver a tocar
 * Apps Script, y se puede probar con `npm test`.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURACIÓN (una sola vez)
 * ---------------------------------------------------------------------------
 *
 *   1. Extensiones → Apps Script en https://script.google.com
 *   2. Pega este archivo.
 *   3. Configuración del proyecto → Propiedades del script → añade:
 *
 *        API_URL     https://tu-app.vercel.app/api/ingest/bcp
 *        INGEST_KEY  (el mismo valor que GMAIL_INGEST_KEY en Vercel)
 *
 *   4. Ejecuta `testConnection` una vez y autoriza los permisos.
 *   5. Ejecuta `setup` una vez para crear el trigger de 1 minuto.
 *
 * ---------------------------------------------------------------------------
 * RECUPERAR CORREOS ANTIGUOS (backfill)
 * ---------------------------------------------------------------------------
 *
 *   1. Edita BACKFILL_FROM y BACKFILL_TO, mas abajo.
 *   2. Ejecuta `previewBackfill` para ver cuantos correos hay, sin enviar nada.
 *   3. Ejecuta `backfillBcpEmails`.
 *
 * No duplica nada aunque lo repitas: lo ya ingerido se salta, y la base de
 * datos rechaza cualquier correo repetido por su gmail_message_id.
 *
 * Las claves van en Propiedades del script, NUNCA escritas en el código:
 * cualquiera con acceso al proyecto vería el fichero.
 */

/** Propiedades del script obligatorias. */
var REQUIRED_PROPERTIES = ['API_URL', 'INGEST_KEY'];

/**
 * Búsqueda en Gmail.
 *
 * Filtra por remitente y por contenido, no por asunto: todavía no conocemos el
 * asunto exacto de todos los correos del BCP. Se puede sobrescribir con la
 * propiedad opcional GMAIL_QUERY sin tocar el código.
 *
 * Las llaves son el OR de Gmail. Cada frase corresponde a un tipo de correo que
 * la API sabe leer: consumo con tarjeta, pago de servicios y transferencia. Si
 * añades un parser nuevo, esta lista y `looksLikeBcpEmail_` tienen que crecer a
 * la vez, o el correo no llegará nunca a salir de Gmail.
 */
var BCP_SEARCH_BASE =
  'from:notificaciones@notificacionesbcp.com.pe ' +
  '{"Realizaste un consumo" "Realizaste una compra" ' +
  '"Pago de servicios" "Realizaste una transferencia"}';

var DEFAULT_GMAIL_QUERY = BCP_SEARCH_BASE + ' newer_than:2d';

/**
 * Etiqueta que se pone a los correos ya enviados.
 *
 * Es SOLO una marca visual, para que veas en Gmail de un vistazo qué se ingirió.
 * NO se usa para filtrar la búsqueda: las etiquetas de Gmail se aplican al HILO
 * entero, así que excluir hilos etiquetados haría desaparecer para siempre
 * cualquier notificación nueva que Gmail agrupe en un hilo ya marcado.
 */
var DEFAULT_PROCESSED_LABEL = 'BCP-Ingestado';

/**
 * Propiedad donde se recuerdan los Gmail Message ID ya enviados.
 *
 * Este es el filtro anti-reenvío real, y trabaja a nivel de MENSAJE, no de hilo.
 * Es una optimización para no repetir peticiones: la garantía de que no haya
 * duplicados sigue siendo el índice único sobre `gmail_message_id` en PostgreSQL.
 */
var SENT_IDS_PROPERTY = 'SENT_MESSAGE_IDS';

/** Cuántos IDs se recuerdan. 300 cubren de sobra la ventana de búsqueda. */
var MAX_TRACKED_IDS = 300;

/** Tope de hilos por ejecución: los triggers de Apps Script tienen cuota. */
var MAX_THREADS_PER_RUN = 25;

/* ========================================================================== */
/*  BACKFILL — recuperar correos antiguos                                     */
/*                                                                            */
/*  EDITA ESTAS DOS FECHAS y ejecuta `backfillBcpEmails`. Es lo único que hay */
/*  que tocar; no hace falta cambiar ninguna Propiedad del script.            */
/* ========================================================================== */

/** Primer día a recuperar, inclusive. Formato AAAA/MM/DD. */
var BACKFILL_FROM = '2026/08/01';

/** Último día a recuperar, inclusive. */
var BACKFILL_TO = '2026/08/29';

/**
 * Tope de días por seguridad.
 *
 * Evita que un dedazo en el año lance miles de búsquedas contra Gmail.
 */
var BACKFILL_MAX_DAYS = 92;

/**
 * Tiempo máximo antes de parar por su cuenta.
 *
 * Apps Script corta la ejecución a los 6 minutos y lo hace de golpe, sin dejar
 * escribir el registro. Parando antes, el script alcanza a guardar lo enviado y
 * a decirte por qué día seguir.
 */
var BACKFILL_TIME_BUDGET_MS = 4.5 * 60 * 1000;

/* ========================================================================== */
/*  Función principal — la que dispara el trigger                             */
/* ========================================================================== */

/**
 * Busca correos del BCP sin enviar y los manda a la API.
 *
 * NO es tiempo real: es sondeo. Cada disparo del trigger toma una foto fija de
 * la búsqueda y procesa lo que había en ese instante. Un correo que llegue a
 * mitad de la ejecución simplemente entra en la siguiente pasada.
 *
 * Tampoco lleva un cursor por fecha. Cada pasada calcula una diferencia de
 * conjuntos: todo lo que casa con la búsqueda menos lo ya enviado. Así una
 * ejecución fallida no "pierde el sitio" ni deja huecos.
 */
function ingestBcpEmails() {
  var config = getConfig_();
  var label = getOrCreateLabel_(config.processedLabel);

  var threads = GmailApp.search(config.gmailQuery, 0, MAX_THREADS_PER_RUN);

  if (threads.length === 0) {
    Logger.log('Sin correos del BCP en la ventana de busqueda.');
    return;
  }

  var state = newRunState_();
  processThreads_(threads, config, label, state);
  flushSentIds_(state);

  Logger.log(describeRun_(state));
}

/* ========================================================================== */
/*  Backfill - las funciones que ejecutas TU a mano                           */
/* ========================================================================== */

/**
 * Reingesta los correos de un rango de fechas.
 *
 * POR QUE VA DIA A DIA. `GmailApp.search` devuelve como mucho los primeros
 * MAX_THREADS_PER_RUN hilos, y siempre desde el principio. Con una sola
 * busqueda de un mes entero, si hubiera mas hilos que ese tope los sobrantes no
 * se alcanzarian nunca: repetir la ejecucion volveria a encontrar los mismos de
 * arriba. Troceando por dias, cada busqueda es pequena y el tope deja de
 * importar.
 *
 * NO DUPLICA NADA. Lo ya ingerido se salta por el cache de IDs, y si algo se
 * reenvia la API responde ALREADY_PROCESSED: la garantia ultima es el indice
 * unico sobre gmail_message_id en PostgreSQL. Puedes ejecutarlo las veces que
 * quieras sobre el mismo rango.
 */
function backfillBcpEmails() {
  var config = getConfig_();
  var label = getOrCreateLabel_(config.processedLabel);
  var days = buildBackfillDays_();

  Logger.log('Backfill ' + BACKFILL_FROM + ' -> ' + BACKFILL_TO + ' (' + days.length + ' dias)');

  var state = newRunState_();
  var deadline = new Date().getTime() + BACKFILL_TIME_BUDGET_MS;
  var pending = null;

  for (var d = 0; d < days.length; d++) {
    if (new Date().getTime() > deadline) {
      pending = days[d];
      break;
    }

    var day = days[d];
    var threads = GmailApp.search(day.query, 0, MAX_THREADS_PER_RUN);

    if (threads.length === 0) continue;

    // Foto del contador antes de este dia, para poder informar SU cifra y no el
    // acumulado: leer "Ya enviados antes: 10" en la ultima linea y creer que son
    // los de ese dia lleva a conclusiones equivocadas.
    var before = { sent: state.sent, skipped: state.skipped, failed: state.failed };

    if (threads.length >= MAX_THREADS_PER_RUN) {
      // Un solo dia con mas hilos que el tope: improbable, pero avisarlo es
      // mejor que dejar un hueco silencioso en los datos.
      Logger.log(
        'AVISO ' + day.label + ': ' + threads.length + ' hilos, el maximo. ' +
        'Puede quedar algo fuera de ese dia.'
      );
    }

    processThreads_(threads, config, label, state);

    // Se guarda dia a dia: si Apps Script corta la ejecucion, lo ya enviado
    // queda anotado y la siguiente pasada no lo repite.
    flushSentIds_(state);

    Logger.log(day.label + ' -> ' + describeDelta_(before, state));
  }

  Logger.log('----------------------------------------');
  Logger.log('Backfill terminado, TOTAL del rango. ' + describeRun_(state));

  if (state.sent === 0 && state.skipped > 0) {
    Logger.log(
      'No se envio nada porque el script ya tenia esos correos en su memoria. ' +
      'Si acabas de corregir el parser, ejecuta forgetSentIds y repite.'
    );
  }

  if (pending) {
    Logger.log(
      'PARADA POR TIEMPO. Cambia BACKFILL_FROM a ' + pending.label +
      ' y vuelve a ejecutar backfillBcpEmails.'
    );
  }
}

/**
 * Cuenta lo que encontraria el backfill, sin enviar nada.
 *
 * Ejecutala siempre antes: confirma que el rango es el que crees y que los
 * correos casan con el filtro.
 */
function previewBackfill() {
  getConfig_();
  var days = buildBackfillDays_();

  Logger.log('Backfill ' + BACKFILL_FROM + ' -> ' + BACKFILL_TO + ' (' + days.length + ' dias)');

  var sentIds = loadSentIds_();
  var alreadySent = {};
  for (var i = 0; i < sentIds.length; i++) alreadySent[sentIds[i]] = true;

  var totalHilos = 0;
  var totalCasan = 0;
  var totalNuevos = 0;

  for (var d = 0; d < days.length; d++) {
    var day = days[d];
    var threads = GmailApp.search(day.query, 0, MAX_THREADS_PER_RUN);
    if (threads.length === 0) continue;

    var casan = 0;
    var nuevos = 0;

    for (var t = 0; t < threads.length; t++) {
      var messages = threads[t].getMessages();
      for (var m = 0; m < messages.length; m++) {
        if (!looksLikeBcpEmail_(messages[m])) continue;
        casan++;
        if (!alreadySent[messages[m].getId()]) nuevos++;
      }
    }

    totalHilos += threads.length;
    totalCasan += casan;
    totalNuevos += nuevos;

    Logger.log(
      day.label + ': ' + threads.length + ' hilos - ' + casan + ' correos del BCP - ' +
      nuevos + ' sin enviar todavia'
    );
  }

  Logger.log('----------------------------------------');
  Logger.log(
    'TOTAL: ' + totalHilos + ' hilos - ' + totalCasan + ' correos del BCP - ' +
    totalNuevos + ' sin enviar todavia'
  );
  Logger.log('No se ha enviado nada. Ejecuta backfillBcpEmails para hacerlo.');
}

/**
 * Convierte BACKFILL_FROM/TO en una busqueda por dia.
 *
 * Gmail trata `after:` como inclusivo y `before:` como exclusivo, asi que cada
 * dia se pide como [dia, dia+1).
 */
function buildBackfillDays_() {
  var from = parseBackfillDate_(BACKFILL_FROM);
  var to = parseBackfillDate_(BACKFILL_TO);

  if (!from) throw new Error('BACKFILL_FROM no es una fecha AAAA/MM/DD valida: ' + BACKFILL_FROM);
  if (!to) throw new Error('BACKFILL_TO no es una fecha AAAA/MM/DD valida: ' + BACKFILL_TO);

  if (from.getTime() > to.getTime()) {
    throw new Error(
      'BACKFILL_FROM (' + BACKFILL_FROM + ') es posterior a BACKFILL_TO (' + BACKFILL_TO + ').'
    );
  }

  var days = [];
  var cursor = new Date(from.getTime());

  while (cursor.getTime() <= to.getTime()) {
    var next = new Date(cursor.getTime());
    next.setDate(next.getDate() + 1);

    days.push({
      label: formatBackfillDate_(cursor),
      query: BCP_SEARCH_BASE +
        ' after:' + formatBackfillDate_(cursor) +
        ' before:' + formatBackfillDate_(next)
    });

    if (days.length > BACKFILL_MAX_DAYS) {
      throw new Error(
        'El rango supera ' + BACKFILL_MAX_DAYS + ' dias. Hazlo por tramos, ' +
        'o sube BACKFILL_MAX_DAYS si de verdad lo necesitas.'
      );
    }

    cursor = next;
  }

  return days;
}

/** 'AAAA/MM/DD' a Date local. Devuelve null si la fecha no existe. */
function parseBackfillDate_(text) {
  var match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(String(text).trim());
  if (!match) return null;

  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(year, month - 1, day);

  // JavaScript desborda en silencio: el 31 de febrero se convierte en 3 de marzo.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

function formatBackfillDate_(date) {
  return date.getFullYear() + '/' + pad2_(date.getMonth() + 1) + '/' + pad2_(date.getDate());
}

function pad2_(value) {
  return (value < 10 ? '0' : '') + value;
}

/* ========================================================================== */
/*  Motor compartido por la ingesta y el backfill                             */
/* ========================================================================== */

/** Estado acumulado de una ejecucion. */
function newRunState_() {
  var sentIds = loadSentIds_();
  var alreadySent = {};
  for (var i = 0; i < sentIds.length; i++) alreadySent[sentIds[i]] = true;

  return { sentIds: sentIds, alreadySent: alreadySent, pending: 0, sent: 0, skipped: 0, failed: 0 };
}

/**
 * Recorre los hilos y envia lo que falte.
 *
 * Lo usan tanto el trigger como el backfill. Si la logica de deduplicado o de
 * etiquetado viviera duplicada, un dia divergirian y solo se notaria por datos
 * que faltan.
 */
function processThreads_(threads, config, label, state) {
  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();

    // Por HILO, no global: que falle un hilo no debe impedir marcar los demas.
    var threadFailed = 0;

    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      var messageId = message.getId();

      if (state.alreadySent[messageId]) {
        state.skipped++;
        continue;
      }

      // Un hilo puede mezclar correos que casan con la busqueda y otros que no.
      if (!looksLikeBcpEmail_(message)) continue;

      if (sendMessage_(message, thread, config)) {
        state.sent++;
        state.pending++;
        state.alreadySent[messageId] = true;
        state.sentIds.push(messageId);
      } else {
        threadFailed++;
        state.failed++;
      }
    }

    if (threadFailed === 0) {
      thread.addLabel(label);
    }
  }
}

/** Escribe los IDs acumulados. Una sola escritura, y solo si hay algo nuevo. */
function flushSentIds_(state) {
  if (state.pending === 0) return;
  saveSentIds_(state.sentIds);
  state.pending = 0;
}

/** Lo ocurrido en un solo dia: el estado de ahora menos el de antes. */
function describeDelta_(before, state) {
  return describeRun_({
    sent: state.sent - before.sent,
    skipped: state.skipped - before.skipped,
    failed: state.failed - before.failed
  });
}

function describeRun_(state) {
  return 'Enviados: ' + state.sent +
    ' - Ya enviados antes: ' + state.skipped +
    ' - Fallidos: ' + state.failed;
}

/** Lee los Message ID ya enviados. Ante cualquier problema, empieza de cero. */
function loadSentIds_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SENT_IDS_PROPERTY);
  if (!raw) return [];

  try {
    var parsed = JSON.parse(raw);
    return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
  } catch (error) {
    // Reenviar de más es inofensivo (la API responde ALREADY_PROCESSED);
    // quedarse bloqueado por un JSON corrupto, no.
    Logger.log('No se pudo leer ' + SENT_IDS_PROPERTY + ', se reinicia: ' + error);
    return [];
  }
}

/** Guarda los IDs, descartando los más antiguos por encima del tope. */
function saveSentIds_(ids) {
  while (ids.length > MAX_TRACKED_IDS) {
    ids.shift();
  }
  PropertiesService.getScriptProperties().setProperty(SENT_IDS_PROPERTY, JSON.stringify(ids));
}

/**
 * Envía un mensaje a la API.
 *
 * @return {boolean} true si la API lo dio por guardado (2xx).
 */
function sendMessage_(message, thread, config) {
  var messageId = message.getId();

  var payload = {
    gmailMessageId: messageId,
    gmailThreadId: thread.getId(),
    from: message.getFrom(),
    to: message.getTo(),
    subject: message.getSubject(),
    receivedAt: message.getDate().toISOString(),
    // Texto plano: exactamente lo que espera el parser de Next.js.
    rawBody: message.getPlainBody()
  };

  try {
    var response = UrlFetchApp.fetch(config.apiUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: buildHeaders_(config),
      payload: JSON.stringify(payload),
      // Sin esto, un 4xx/5xx lanza una excepción y corta el bucle entero.
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    // 2xx = el correo está guardado (incluido PARSE_ERROR, que es permanente):
    // se recuerda su ID para no reintentarlo eternamente.
    if (code >= 200 && code < 300) {
      Logger.log('OK  ' + messageId + ' → ' + body);
      return true;
    }

    // 4xx = configuración mal (clave, remitente). 5xx = fallo transitorio.
    // En ambos casos NO se recuerda: se reintenta en el próximo disparo.
    Logger.log('ERR ' + messageId + ' → HTTP ' + code + ' ' + body);
    return false;
  } catch (error) {
    Logger.log('ERR ' + messageId + ' → ' + error);
    return false;
  }
}

/**
 * Cabeceras de toda peticion a la API.
 *
 * Ademas de la clave de ingesta, anade el bypass de Vercel si esta configurado.
 * Eso permite dejar activa la Deployment Protection —para que solo tu veas el
 * dashboard— sin bloquear a este script.
 *
 * Se configura con la propiedad opcional VERCEL_BYPASS, cuyo valor sale de
 * Vercel -> Settings -> Deployment Protection -> Protection Bypass for
 * Automation. Sin ella, todo funciona igual que antes.
 */
function buildHeaders_(config) {
  var headers = { 'x-ingest-key': config.ingestKey };

  if (config.vercelBypass) {
    headers['x-vercel-protection-bypass'] = config.vercelBypass;
    // Evita que Vercel deje una cookie de sesion en cada llamada.
    headers['x-vercel-set-bypass-cookie'] = 'false';
  }

  return headers;
}

/**
 * Frases que identifican un correo que la API sabe interpretar.
 *
 * Sin tildes ni mayúsculas, porque así se comparan abajo. Deben coincidir con
 * los marcadores de los parsers de `lib/parsers/`: si aquí falta uno, el correo
 * se descarta antes de salir de Gmail; si sobra, la API responde PARSE_ERROR y
 * el correo queda guardado igualmente para reprocesarlo.
 */
var BCP_BODY_MARKERS = [
  'realizaste un consumo',
  'realizaste una compra',
  'pago de servicios',
  'realizaste una transferencia'
];

/**
 * Segundo filtro, ya con el mensaje en la mano.
 *
 * La búsqueda de Gmail trabaja por hilos, así que puede devolver un hilo entero
 * por culpa de un solo mensaje. Esto comprueba mensaje a mensaje.
 */
function looksLikeBcpEmail_(message) {
  var from = String(message.getFrom()).toLowerCase();
  if (from.indexOf('notificacionesbcp.com.pe') === -1) return false;

  var body = String(message.getPlainBody()).toLowerCase();

  for (var i = 0; i < BCP_BODY_MARKERS.length; i++) {
    if (body.indexOf(BCP_BODY_MARKERS[i]) !== -1) return true;
  }

  return false;
}

/* ========================================================================== */
/*  Configuración y utilidades                                                */
/* ========================================================================== */

/** Lee las Propiedades del script y falla claro si falta alguna. */
function getConfig_() {
  var properties = PropertiesService.getScriptProperties();

  var missing = [];
  for (var i = 0; i < REQUIRED_PROPERTIES.length; i++) {
    if (!properties.getProperty(REQUIRED_PROPERTIES[i])) {
      missing.push(REQUIRED_PROPERTIES[i]);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      'Faltan Propiedades del script: ' + missing.join(', ') +
      '. Configuración del proyecto → Propiedades del script.'
    );
  }

  return {
    apiUrl: properties.getProperty('API_URL'),
    ingestKey: properties.getProperty('INGEST_KEY'),
    gmailQuery: properties.getProperty('GMAIL_QUERY') || DEFAULT_GMAIL_QUERY,
    processedLabel: properties.getProperty('PROCESSED_LABEL') || DEFAULT_PROCESSED_LABEL,
    // Opcional: solo si dejas activa la Deployment Protection de Vercel.
    vercelBypass: properties.getProperty('VERCEL_BYPASS') || ''
  };
}

/** Devuelve la etiqueta, creándola la primera vez. */
function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/* ========================================================================== */
/*  Funciones que ejecutas TÚ a mano                                          */
/* ========================================================================== */

/**
 * Crea el trigger de 1 minuto. Ejecútala UNA vez.
 *
 * Borra antes los triggers previos de esta misma función para que ejecutarla
 * dos veces no acabe con dos triggers enviando todo por duplicado.
 */
function setup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestBcpEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('ingestBcpEmails').timeBased().everyMinutes(1).create();

  Logger.log('Trigger creado: ingestBcpEmails cada 1 minuto.');
  Logger.log('Recuerda bajarlo a 5-15 minutos cuando termines la POC.');
}

/** Elimina el trigger. Útil para parar la ingesta sin borrar el proyecto. */
function removeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestBcpEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  Logger.log('Triggers eliminados: ' + removed);
}

/**
 * Olvida qué correos se enviaron ya, para volver a mandarlos todos.
 *
 * Úsala tras corregir el parser: los correos que quedaron en PARSE_ERROR se
 * reenvían y la API los reprocesa sobre la misma fila, sin duplicar nada.
 *
 * Solo borra la memoria del script. En Gmail no toca nada, y en la base de datos
 * tampoco: el reenvío es idempotente.
 */
function forgetSentIds() {
  PropertiesService.getScriptProperties().deleteProperty(SENT_IDS_PROPERTY);
  Logger.log('Memoria de enviados borrada. El próximo disparo reenviará todo lo');
  Logger.log('que encuentre la búsqueda: ' + getConfig_().gmailQuery);
}

/**
 * Comprueba que API_URL e INGEST_KEY son correctas, sin enviar ningún correo.
 * Ejecútala tras configurar las propiedades: debe responder HTTP 200.
 */
function testConnection() {
  var config = getConfig_();

  var response = UrlFetchApp.fetch(config.apiUrl, {
    method: 'get',
    headers: buildHeaders_(config),
    muteHttpExceptions: true
  });

  Logger.log('HTTP ' + response.getResponseCode() + ' → ' + response.getContentText());
  var code = response.getResponseCode();
  if (code === 200) {
    Logger.log('Conexión correcta.');
  } else if (code === 302 || code === 307) {
    Logger.log('Vercel está redirigiendo a su login: tienes activa la Deployment');
    Logger.log('Protection. O la desactivas, o generas un Protection Bypass for');
    Logger.log('Automation y lo pones en la propiedad VERCEL_BYPASS.');
  } else if (code === 401) {
    Logger.log('401 = INGEST_KEY no coincide con GMAIL_INGEST_KEY en Vercel.');
  } else if (code === 404) {
    Logger.log('404 = revisa API_URL. Debe acabar en /api/ingest/bcp.');
  } else {
    Logger.log('Revisa API_URL y las variables de entorno en Vercel.');
  }
}

/**
 * Muestra qué correos encontraría la búsqueda, SIN enviar nada.
 * Úsala para afinar GMAIL_QUERY antes de activar el trigger.
 */
function previewSearch() {
  var config = getConfig_();
  var threads = GmailApp.search(config.gmailQuery, 0, 10);

  Logger.log('Búsqueda: ' + config.gmailQuery);
  Logger.log('Hilos encontrados: ' + threads.length);

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      Logger.log(
        '- [' + message.getDate() + '] ' + message.getFrom() +
        ' | ' + message.getSubject() +
        ' | casa: ' + looksLikeBcpEmail_(message)
      );
    }
  }
}

/**
 * Vuelca el texto plano del correo del BCP más reciente.
 *
 * Es la forma de obtener una muestra REAL para el parser: ejecútala, copia el
 * texto del log a un archivo `.txt` y pruébalo con
 * `npm run parse:sample -- ruta/al/archivo.txt`.
 */
function dumpLatestEmailBody() {
  var config = getConfig_();
  var threads = GmailApp.search(config.gmailQuery, 0, 1);

  if (threads.length === 0) {
    Logger.log('No se encontró ningún correo con: ' + config.gmailQuery);
    return;
  }

  var messages = threads[0].getMessages();
  var message = messages[messages.length - 1];

  Logger.log('From:    ' + message.getFrom());
  Logger.log('To:      ' + message.getTo());
  Logger.log('Subject: ' + message.getSubject());
  Logger.log('Date:    ' + message.getDate().toISOString());
  Logger.log('----- INICIO DEL TEXTO PLANO -----');
  Logger.log(message.getPlainBody());
  Logger.log('----- FIN DEL TEXTO PLANO -----');
}
