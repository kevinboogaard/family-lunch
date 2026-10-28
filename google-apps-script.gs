/**
 * Centrale opslag voor de Family Bestel-App.
 *
 * Plak dit script in een Google Sheet via Extensies > Apps Script en publiceer
 * het als web-app (zie README.md). Bestellingen komen op het tabblad
 * "Bestellingen" te staan.
 */

const SHEET_NAME = 'Bestellingen';
const HEADERS = ['BestelID', 'Datum', 'Tijd', 'Naam', 'Product', 'Aantal', 'Stuksprijs', 'Totaal'];
const MAX_REGELS_PER_BESTELLING = 100;

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    // Datum en tijd als tekst bewaren, zodat Sheets ze niet omzet
    sheet.getRange('B:C').setNumberFormat('@');
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Voorkom dat tekst als formule wordt uitgevoerd (bijv. een naam die met "=" begint)
function veiligeTekst_(waarde, maxLengte) {
  let tekst = String(waarde == null ? '' : waarde).slice(0, maxLengte);
  if (/^[=+\-@]/.test(tekst)) tekst = "'" + tekst;
  return tekst;
}

function vandaag_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function celNaarTekst_(waarde, patroon) {
  if (waarde instanceof Date) {
    return Utilities.formatDate(waarde, Session.getScriptTimeZone(), patroon);
  }
  return String(waarde);
}

/** Bestelling opslaan. Verwacht JSON: { data: [{ Naam, Product, Aantal, Stuksprijs, Totaal }, ...] } */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const regels = body.data;
    if (!Array.isArray(regels) || regels.length === 0 || regels.length > MAX_REGELS_PER_BESTELLING) {
      return json_({ ok: false, error: 'Ongeldige bestelling.' });
    }

    const nu = new Date();
    const tz = Session.getScriptTimeZone();
    const datum = Utilities.formatDate(nu, tz, 'yyyy-MM-dd');
    const tijd = Utilities.formatDate(nu, tz, 'HH:mm:ss');
    const bestelID = Utilities.getUuid().slice(0, 8);

    const rows = regels.map(r => [
      bestelID,
      datum,
      tijd,
      veiligeTekst_(r.Naam, 100),
      veiligeTekst_(r.Product, 300),
      Number(r.Aantal) || 0,
      Number(r.Stuksprijs) || 0,
      Number(r.Totaal) || 0
    ]);

    const sheet = getSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);

    return json_({ ok: true, bestelID: bestelID });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Bestellingen ophalen. Optioneel ?datum=vandaag of ?datum=2026-10-30 */
function doGet(e) {
  try {
    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    let filterDatum = (e && e.parameter && e.parameter.datum) || '';
    if (filterDatum === 'vandaag') filterDatum = vandaag_();

    const bestellingen = values.slice(1)
      .map(row => ({
        BestelID: String(row[0]),
        Datum: celNaarTekst_(row[1], 'yyyy-MM-dd'),
        Tijd: celNaarTekst_(row[2], 'HH:mm:ss'),
        Naam: String(row[3]),
        Product: String(row[4]),
        Aantal: Number(row[5]) || 0,
        Stuksprijs: Number(row[6]) || 0,
        Totaal: Number(row[7]) || 0
      }))
      .filter(b => !filterDatum || b.Datum === filterDatum);

    return json_({ ok: true, bestellingen: bestellingen });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
