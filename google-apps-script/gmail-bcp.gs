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
 */
var DEFAULT_GMAIL_QUERY =
  'from:notificaciones@notificacionesbcp.com.pe ' +
  '"Realizaste un consumo" ' +
  'newer_than:2d';

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
    Logger.log('Sin correos del BCP en la ventana de búsqueda.');
    return;
  }

  var sentIds = loadSentIds_();
  var alreadySent = {};
  for (var i = 0; i < sentIds.length; i++) {
    alreadySent[sentIds[i]] = true;
  }

  var sent = 0;
  var skipped = 0;
  var failed = 0;

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();

    // Por HILO, no global: que falle un hilo no debe impedir marcar los demás.
    var threadFailed = 0;

    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      var messageId = message.getId();

      if (alreadySent[messageId]) {
        skipped++;
        continue;
      }

      // Un hilo puede mezclar correos que casan con la búsqueda y otros que no.
      if (!looksLikeBcpConsumption_(message)) continue;

      if (sendMessage_(message, thread, config)) {
        sent++;
        alreadySent[messageId] = true;
        sentIds.push(messageId);
      } else {
        threadFailed++;
        failed++;
      }
    }

    if (threadFailed === 0) {
      thread.addLabel(label);
    }
  }

  // Una sola escritura por ejecución en lugar de una por mensaje.
  if (sent > 0) saveSentIds_(sentIds);

  Logger.log('Enviados: ' + sent + ' · Ya enviados antes: ' + skipped + ' · Fallidos: ' + failed);
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
      headers: { 'x-ingest-key': config.ingestKey },
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
 * Segundo filtro, ya con el mensaje en la mano.
 *
 * La búsqueda de Gmail trabaja por hilos, así que puede devolver un hilo entero
 * por culpa de un solo mensaje. Esto comprueba mensaje a mensaje.
 */
function looksLikeBcpConsumption_(message) {
  var from = String(message.getFrom()).toLowerCase();
  if (from.indexOf('notificacionesbcp.com.pe') === -1) return false;

  var body = String(message.getPlainBody()).toLowerCase();
  return body.indexOf('realizaste un consumo') !== -1;
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
    processedLabel: properties.getProperty('PROCESSED_LABEL') || DEFAULT_PROCESSED_LABEL
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
    headers: { 'x-ingest-key': config.ingestKey },
    muteHttpExceptions: true
  });

  Logger.log('HTTP ' + response.getResponseCode() + ' → ' + response.getContentText());
  Logger.log(response.getResponseCode() === 200
    ? 'Conexión correcta.'
    : '401 = INGEST_KEY no coincide. 404 = revisa API_URL.');
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
        ' | casa: ' + looksLikeBcpConsumption_(message)
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
