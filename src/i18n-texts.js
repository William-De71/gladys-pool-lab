// -----------------------------------------------------------------------------
// Texts of the Pool Lab integration, in English, French, German and Spanish
// (English fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names and the water balance, widget contents, scene texts,
// errors, results of the configuration buttons. Vocabulary of the Gladys
// interface (appareil / Gerät / dispositivo) and of pool care (chlore libre /
// freies Chlor / cloro libre, TAC, stabilisant…). German says "du", Spanish
// "usted", like Gladys. Pool names come from LabCom, never translated.
// -----------------------------------------------------------------------------

/**
 * @description A text in the four languages.
 * @param {string} en - English.
 * @param {string} fr - French.
 * @param {string} de - German.
 * @param {string} es - Spanish.
 * @returns {object} `{ en, fr, de, es }`.
 */
const L = (en, fr, de, es) => ({ en, fr, de, es });

const TEXTS = {
  // what a parameter measures (feature names, scene texts)
  kind_ph: L('pH', 'pH', 'pH-Wert', 'pH'),
  kind_chlorine_free: L('Free chlorine', 'Chlore libre', 'Freies Chlor', 'Cloro libre'),
  kind_chlorine_total: L('Total chlorine', 'Chlore total', 'Gesamtchlor', 'Cloro total'),
  kind_chlorine_combined: L(
    'Combined chlorine',
    'Chlore combiné',
    'Gebundenes Chlor',
    'Cloro combinado',
  ),
  kind_bromine: L('Bromine', 'Brome', 'Brom', 'Bromo'),
  kind_active_oxygen: L('Active oxygen', 'Oxygène actif', 'Aktivsauerstoff', 'Oxígeno activo'),
  kind_hydrogen_peroxide: L(
    'Hydrogen peroxide',
    'Peroxyde d’hydrogène',
    'Wasserstoffperoxid',
    'Peróxido de hidrógeno',
  ),
  kind_chlorine_dioxide: L(
    'Chlorine dioxide',
    'Dioxyde de chlore',
    'Chlordioxid',
    'Dióxido de cloro',
  ),
  kind_ozone: L('Ozone', 'Ozone', 'Ozon', 'Ozono'),
  kind_phmb: L('PHMB (biguanide)', 'PHMB (biguanide)', 'PHMB (Biguanid)', 'PHMB (biguanida)'),
  kind_cya: L(
    'Cyanuric acid (stabilizer)',
    'Acide cyanurique (stabilisant)',
    'Cyanursäure (Stabilisator)',
    'Ácido cianúrico (estabilizante)',
  ),
  kind_alkalinity: L(
    'Total alkalinity (TA)',
    'Alcalinité (TAC)',
    'Gesamtalkalität (TA)',
    'Alcalinidad total (TA)',
  ),
  kind_calcium_hardness: L('Calcium hardness', 'Dureté calcique', 'Calciumhärte', 'Dureza cálcica'),
  kind_total_hardness: L('Total hardness', 'Dureté totale (TH)', 'Gesamthärte', 'Dureza total'),
  kind_salt: L('Salt', 'Sel', 'Salz', 'Sal'),
  kind_phosphate: L('Phosphate', 'Phosphates', 'Phosphat', 'Fosfatos'),
  kind_temperature: L(
    'Water temperature',
    'Température de l’eau',
    'Wassertemperatur',
    'Temperatura del agua',
  ),
  kind_orp: L('Redox (ORP)', 'Redox (ORP)', 'Redox (ORP)', 'Redox (ORP)'),
  kind_other: L('Other parameter', 'Autre paramètre', 'Anderer Parameter', 'Otro parámetro'),

  // the same, short (tiles: 24 characters)
  tile_ph: L('pH', 'pH', 'pH-Wert', 'pH'),
  tile_chlorine_free: L('Free chlorine', 'Chlore libre', 'Freies Chlor', 'Cloro libre'),
  tile_chlorine_total: L('Total chlorine', 'Chlore total', 'Gesamtchlor', 'Cloro total'),
  tile_chlorine_combined: L(
    'Combined chlorine',
    'Chlore combiné',
    'Gebundenes Chlor',
    'Cloro combinado',
  ),
  tile_bromine: L('Bromine', 'Brome', 'Brom', 'Bromo'),
  tile_active_oxygen: L('Active oxygen', 'Oxygène actif', 'Aktivsauerstoff', 'Oxígeno activo'),
  tile_hydrogen_peroxide: L('H₂O₂', 'H₂O₂', 'H₂O₂', 'H₂O₂'),
  tile_chlorine_dioxide: L(
    'Chlorine dioxide',
    'Dioxyde de chlore',
    'Chlordioxid',
    'Dióxido de cloro',
  ),
  tile_ozone: L('Ozone', 'Ozone', 'Ozon', 'Ozono'),
  tile_phmb: L('PHMB', 'PHMB', 'PHMB', 'PHMB'),
  tile_cya: L('Stabilizer', 'Stabilisant', 'Stabilisator', 'Estabilizante'),
  tile_alkalinity: L('Alkalinity (TA)', 'Alcalinité (TAC)', 'Alkalität (TA)', 'Alcalinidad (TA)'),
  tile_calcium_hardness: L('Calcium hardness', 'Dureté calcique', 'Calciumhärte', 'Dureza cálcica'),
  tile_total_hardness: L('Total hardness', 'Dureté totale', 'Gesamthärte', 'Dureza total'),
  tile_salt: L('Salt', 'Sel', 'Salz', 'Sal'),
  tile_phosphate: L('Phosphate', 'Phosphates', 'Phosphat', 'Fosfatos'),
  tile_temperature: L('Water', 'Eau', 'Wasser', 'Agua'),
  tile_orp: L('Redox', 'Redox', 'Redox', 'Redox'),
  tile_other: L('Other', 'Autre', 'Andere', 'Otro'),

  // ideal range status (LabCom: OKAY, TOO LOW, TOO HIGH, NOT SET)
  status_ok: L('In range', 'Dans la plage', 'Im Bereich', 'En rango'),
  status_too_low: L('Too low', 'Trop bas', 'Zu niedrig', 'Demasiado bajo'),
  status_too_high: L('Too high', 'Trop haut', 'Zu hoch', 'Demasiado alto'),
  status_not_set: L('No ideal range', 'Sans plage idéale', 'Kein Idealbereich', 'Sin rango ideal'),
  statusNone: L(
    'No previous test',
    'Aucun test précédent',
    'Kein vorheriger Test',
    'Sin prueba anterior',
  ),

  // the water balance feature
  featureBalance: L('Water balance', 'Équilibre de l’eau', 'Wasserbalance', 'Equilibrio del agua'),
  balanceOut: L(
    '{parameter} {status}',
    '{parameter} {status}',
    '{parameter} {status}',
    '{parameter} {status}',
  ),
  balanceOk: L('All in range', 'Tout dans la plage', 'Alles im Bereich', 'Todo en rango'),
  balanceNotSet: L(
    'No ideal range set',
    'Aucune plage idéale définie',
    'Kein Idealbereich festgelegt',
    'Sin rango ideal definido',
  ),

  // values out of the measuring range of the photometer
  valueOver: L('over range', 'hors échelle', 'Überlauf', 'sobre escala'),
  valueUnder: L('under range', 'sous échelle', 'Unterlauf', 'bajo escala'),

  // scene texts
  summaryIdeal: L(
    'ideal {low}–{high}',
    'idéal {low}–{high}',
    'ideal {low}–{high}',
    'ideal {low}–{high}',
  ),
  summaryParameter: L(
    '{parameter}: {value} ({status}), measured {when}',
    '{parameter} : {value} ({status}), mesuré {when}',
    '{parameter}: {value} ({status}), gemessen {when}',
    '{parameter}: {value} ({status}), medido {when}',
  ),

  // widgets
  widgetNoMeasurement: L(
    'No measurement for this pool yet: test the water with your PoolLab and synchronize the app.',
    'Aucune mesure pour ce bassin : testez l’eau avec votre PoolLab et synchronisez l’application.',
    'Noch keine Messung für dieses Becken: Teste das Wasser mit deinem PoolLab und synchronisiere die App.',
    'Aún no hay mediciones para esta piscina: analice el agua con su PoolLab y sincronice la aplicación.',
  ),
  widgetNoHistory: L(
    'No {parameter} measurement in the last {days} days (last one: {when}).',
    'Aucune mesure de {parameter} sur les {days} derniers jours (dernière : {when}).',
    'Keine Messung von {parameter} in den letzten {days} Tagen (letzte: {when}).',
    'Ninguna medición de {parameter} en los últimos {days} días (última: {when}).',
  ),
  widgetNoParameter: L(
    '{parameter} was never measured on {pool}.',
    '{parameter} n’a jamais été mesuré sur {pool}.',
    '{parameter} wurde bei {pool} nie gemessen.',
    '{parameter} nunca se ha medido en {pool}.',
  ),
  rowLastTest: L('Last test', 'Dernier test', 'Letzter Test', 'Última prueba'),
  rowWhen: L('{when} ({ago})', '{when} ({ago})', '{when} ({ago})', '{when} ({ago})'),
  rowBalance: L('Water balance', 'Équilibre de l’eau', 'Wasserbalance', 'Equilibrio del agua'),
  rowOutCount: L(
    '{count} out of range',
    '{count} hors plage',
    '{count} außerhalb',
    '{count} fuera de rango',
  ),
  buttonRefresh: L('Refresh', 'Actualiser', 'Aktualisieren', 'Actualizar'),
  tileTests: L(
    'Tests ({days} days)',
    'Tests ({days} jours)',
    'Tests ({days} Tage)',
    'Pruebas ({days} d)',
  ),
  tileInRange: L('In range', 'Dans la plage', 'Im Bereich', 'En rango'),
  seriesIdealLow: L('Ideal low', 'Idéal bas', 'Ideal unten', 'Ideal mínimo'),
  seriesIdealHigh: L('Ideal high', 'Idéal haut', 'Ideal oben', 'Ideal máximo'),
  captionIdeal: L(
    'Ideal range in LabCom: {low} – {high} {unit}',
    'Plage idéale dans LabCom : {low} – {high} {unit}',
    'Idealbereich in LabCom: {low} – {high} {unit}',
    'Rango ideal en LabCom: {low} – {high} {unit}',
  ),
  captionNoIdeal: L(
    'No ideal range set in LabCom for this parameter.',
    'Aucune plage idéale définie dans LabCom pour ce paramètre.',
    'Kein Idealbereich in LabCom für diesen Parameter.',
    'Sin rango ideal definido en LabCom para este parámetro.',
  ),
  toastTooSoon: L(
    'Already refreshed less than a minute ago.',
    'Déjà actualisé il y a moins d’une minute.',
    'Vor weniger als einer Minute bereits aktualisiert.',
    'Ya se actualizó hace menos de un minuto.',
  ),
  toastRefreshed: L(
    'LabCom read: {count} pool(s).',
    'LabCom lu : {count} bassin(s).',
    'LabCom gelesen: {count} Becken.',
    'LabCom leído: {count} piscina(s).',
  ),

  // connection status and errors
  statusNoToken: L(
    'Enter your LabCom API token in the configuration.',
    'Saisissez votre jeton d’API LabCom dans la configuration.',
    'Gib dein LabCom-API-Token in der Konfiguration ein.',
    'Introduzca su token de API de LabCom en la configuración.',
  ),
  statusWaiting: L(
    'Reading LabCom…',
    'Lecture de LabCom…',
    'LabCom wird gelesen…',
    'Leyendo LabCom…',
  ),
  statusNoPool: L(
    'Connected to LabCom: {count} pool(s), no measurement yet.',
    'Connecté à LabCom : {count} bassin(s), aucune mesure pour l’instant.',
    'Mit LabCom verbunden: {count} Becken, noch keine Messung.',
    'Conectado a LabCom: {count} piscina(s), aún sin mediciones.',
  ),
  statusOk: L(
    'Connected to LabCom: {count} pool(s), {out} parameter(s) out of range.',
    'Connecté à LabCom : {count} bassin(s), {out} paramètre(s) hors plage.',
    'Mit LabCom verbunden: {count} Becken, {out} Parameter außerhalb des Bereichs.',
    'Conectado a LabCom: {count} piscina(s), {out} parámetro(s) fuera de rango.',
  ),
  statusPaused: L(
    'LabCom asked to wait: readings paused.',
    'LabCom a demandé d’attendre : lectures en pause.',
    'LabCom bat um eine Pause: Abfragen pausiert.',
    'LabCom pidió esperar: lecturas en pausa.',
  ),
  errToken: L(
    'LabCom refuses the API token: create a new one on labcom.cloud (Settings) and paste it in the configuration.',
    'LabCom refuse le jeton d’API : créez-en un nouveau sur labcom.cloud (Paramètres) et collez-le dans la configuration.',
    'LabCom lehnt das API-Token ab: Erstelle auf labcom.cloud (Einstellungen) ein neues und füge es in der Konfiguration ein.',
    'LabCom rechaza el token de API: cree uno nuevo en labcom.cloud (Ajustes) y péguelo en la configuración.',
  ),
  errRateLimit: L(
    'LabCom asked to wait: the next reading will come later.',
    'LabCom a demandé d’attendre : la prochaine lecture viendra plus tard.',
    'LabCom bat um eine Pause: Die nächste Abfrage folgt später.',
    'LabCom pidió esperar: la próxima lectura llegará más tarde.',
  ),
  errServer: L(
    'LabCom is not answering properly right now: the next reading will try again.',
    'LabCom ne répond pas correctement pour le moment : la prochaine lecture réessaiera.',
    'LabCom antwortet gerade nicht richtig: Die nächste Abfrage versucht es erneut.',
    'LabCom no responde correctamente ahora: la próxima lectura lo volverá a intentar.',
  ),
  errUnreachable: L(
    'LabCom cannot be reached: check the Internet connection of Gladys.',
    'LabCom est injoignable : vérifiez la connexion Internet de Gladys.',
    'LabCom ist nicht erreichbar: Prüfe die Internetverbindung von Gladys.',
    'No se puede contactar con LabCom: compruebe la conexión a Internet de Gladys.',
  ),
  errFailed: L(
    'Reading LabCom failed: {detail}',
    'La lecture de LabCom a échoué : {detail}',
    'Das Lesen von LabCom ist fehlgeschlagen: {detail}',
    'La lectura de LabCom falló: {detail}',
  ),
  errNoPool: L(
    'No pool with measurements in LabCom yet.',
    'Aucun bassin avec des mesures dans LabCom pour l’instant.',
    'Noch kein Becken mit Messungen in LabCom.',
    'Aún no hay ninguna piscina con mediciones en LabCom.',
  ),

  // configuration buttons
  testOk: L(
    'LabCom accepts the token: {count} pool(s){names}, {measured} with measurements.',
    'LabCom accepte le jeton : {count} bassin(s){names}, dont {measured} avec des mesures.',
    'LabCom akzeptiert das Token: {count} Becken{names}, davon {measured} mit Messungen.',
    'LabCom acepta el token: {count} piscina(s){names}, {measured} con mediciones.',
  ),
  diagnosticDone: L(
    'Diagnostic written to the logs of the integration in {count} line(s) (no token).',
    'Diagnostic écrit dans les journaux de l’intégration en {count} ligne(s) (sans jeton).',
    'Diagnose in {count} Zeile(n) in die Logs der Integration geschrieben (ohne Token).',
    'Diagnóstico escrito en los registros de la integración en {count} línea(s) (sin token).',
  ),

  // durations
  never: L('never', 'jamais', 'nie', 'nunca'),
  justNow: L('just now', 'à l’instant', 'gerade eben', 'ahora mismo'),
  minutesAgo: L('{n} min ago', 'il y a {n} min', 'vor {n} Min.', 'hace {n} min'),
  hoursAgo: L('{n} h ago', 'il y a {n} h', 'vor {n} Std.', 'hace {n} h'),
  daysAgo: L('{n} days ago', 'il y a {n} jours', 'vor {n} Tagen', 'hace {n} días'),
};

export { TEXTS };
