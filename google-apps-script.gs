/**
 * Centrale opslag voor de Family Bestel-App.
 *
 * Plak dit script in een Google Sheet via Extensies > Apps Script en publiceer
 * het als web-app (zie README.md). Bestellingen komen op het tabblad
 * "Bestellingen" te staan.
 *
 * Het script controleert elke bestelling zelf, dus ook als iemand de website
 * omzeilt en rechtstreeks naar dit adres stuurt:
 *  - maximaal aantal regels, stuks en euro's per bestelling
 *  - maximaal aantal bestellingen en stuks per naam per dag, en een noodrem per dag
 *  - alleen producten uit het menu, met een prijs die klopt (het totaal rekent het script zelf uit)
 *  - optioneel een teamcode (Projectinstellingen > Scripteigenschappen > BESTELCODE)
 */

const SHEET_NAME = 'Bestellingen';
// "Sleutel": een geheime code per bestelling die alleen het apparaat van de besteller kent. Daarmee kan alleen
// de besteller zelf "Ik heb betaald" melden, zijn status zien en zijn bestelling annuleren.
const HEADERS = ['BestelID', 'Datum', 'Tijd', 'Naam', 'Product', 'Aantal', 'Stuksprijs', 'Totaal', 'Sleutel'];
const KOLOM = { ID: 0, DATUM: 1, NAAM: 3, SLEUTEL: 8 };

// Het menu waartegen producten en prijzen gecontroleerd worden (leeg laten = niet controleren)
const MENU_URL = 'https://kevinboogaard.github.io/family-lunch/menu.json';

// Pas deze getallen gerust aan; ze gelden bij de volgende "Nieuwe versie" van de implementatie.
const LIMIETEN = {
  MAX_REGELS_PER_BESTELLING: 25,       // verschillende producten in één bestelling
  MAX_AANTAL_PER_REGEL: 10,            // stuks van hetzelfde product
  MAX_STUKS_PER_BESTELLING: 40,        // alle stuks bij elkaar in één bestelling
  MAX_BEDRAG_PER_BESTELLING: 200,      // euro
  MAX_BESTELLINGEN_PER_NAAM_PER_DAG: 3,
  MAX_STUKS_PER_NAAM_PER_DAG: 60,
  MAX_STUKS_PER_DAG_TOTAAL: 500,       // noodrem voor de hele dag
  MAX_MEERPRIJS_PER_STUK: 25,          // opties en extra's samen, boven op de menuprijs
  MIN_NAAM: 2,
  MAX_NAAM: 40,
  MAX_PRODUCT_TEKST: 250
};

// Beheer (admin.html): de QR-code om af te rekenen. Alleen met de beheercode te wijzigen.
const INSTELLINGEN_SHEET = 'Instellingen';
const BEHEER = {
  MIN_CODE_LENGTE: 8,          // een korte beheercode wordt niet geaccepteerd
  MAX_FOUTE_POGINGEN_PER_UUR: 10,
  MAX_QR_TEKENS: 150000,       // grootte van de afbeelding (als tekst)
  BLOK: 40000,                 // een cel in Google Sheets kan maximaal 50.000 tekens
  MAX_TEKST: 300,
  MAX_LINK: 500
};

// Wie heeft betaald? Per dag en naam: "zegt" (collega meldde dat hij betaald heeft) of "bevestigd" (door de beheerder)
const BETALINGEN_SHEET = 'Betalingen';
const BETAAL = { MAX_DAGEN_TERUG: 31 };

// Afgesloten dagen: geen bestellingen en geen "ik heb betaald" meer, en collega's zien die bestelling niet meer.
// Een eigen tabblad, want het opslaan van de QR maakt het tabblad Instellingen helemaal opnieuw.
const AFGESLOTEN_SHEET = 'Afgesloten';

// Highscores van het wachtspelletje: per naam alleen de beste score. Openbaar te lezen (top 10), dus alleen een naam en een getal.
// E-mailadressen die collega's bij een bestelling invullen (optioneel), voor de mail als jij hun betaling bevestigt.
// Een eigen tabblad, alleen voor de beheerder: de website geeft deze adressen nooit terug aan collega's.
const EMAIL_SHEET = 'E-mailadressen';
const EMAIL = { MAX_LENGTE: 120, APP_LINK: 'https://kevinboogaard.github.io/family-lunch/' };

const HIGHSCORES_SHEET = 'Highscores';
const HIGHSCORE = {
  MAX_SCORE: 100000,           // hoger is niet te halen; alles daarboven is geknoei
  MAX_NAAM: 20,
  TOP: 10,
  MAX_NAMEN: 300,              // daarna vallen de laagste eraf
  MAX_PER_NAAM_PER_UUR: 30,
  MAX_PER_UUR: 400
};

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
  // Een Sheet van voor de sleutels: kolomkop erbij zetten
  if (sheet.getLastColumn() < HEADERS.length) sheet.getRange(1, HEADERS.length).setValue(HEADERS[HEADERS.length - 1]);
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fout_(code, tekst) {
  return { ok: false, code: code, error: tekst };
}

// Voorkom dat tekst als formule wordt uitgevoerd (bijv. een naam die met "=" begint)
function veiligeTekst_(waarde, maxLengte) {
  let tekst = String(waarde == null ? '' : waarde).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLengte);
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

function afronden_(getal) {
  return Math.round(getal * 100) / 100;
}

/** Menuprijzen per productnaam (menuprijs + statiegeld), 6 uur bewaard. null = niet beschikbaar. */
function haalMenuPrijzen_() {
  if (!MENU_URL) return null;
  try {
    const cache = CacheService.getScriptCache();
    let json = cache.get('menuPrijzen');
    if (!json) {
      const antwoord = UrlFetchApp.fetch(MENU_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
      if (antwoord.getResponseCode() !== 200) return null;
      const menu = JSON.parse(antwoord.getContentText());
      const prijzen = {};
      menu.producten.forEach(function (p) {
        const prijs = afronden_((Number(p.price) || 0) + (Number(p.statiegeld) || 0));
        if (!(p.name in prijzen) || prijs < prijzen[p.name]) prijzen[p.name] = prijs;
      });
      json = JSON.stringify(prijzen);
      cache.put('menuPrijzen', json, 6 * 3600);
    }
    return JSON.parse(json);
  } catch (err) {
    // Geen menu (geen toestemming, GitHub even weg): dan gelden alleen de algemene limieten
    return null;
  }
}

/** Zoekt bij "Frites Mayonaise (Zonder zout)" het menuproduct "Frites Mayonaise" (de langste naam wint). */
function menuNaamBijRegel_(regel, menuPrijzen) {
  let beste = null;
  Object.keys(menuPrijzen).forEach(function (naam) {
    if ((regel === naam || regel.indexOf(naam + ' (') === 0) && (beste === null || naam.length > beste.length)) beste = naam;
  });
  return beste;
}

/** Wat er vandaag al in de sheet staat: totaal aantal stuks, en per naam het aantal bestellingen en stuks. */
function telVandaag_(waarden) {
  const dag = vandaag_();
  const tel = { stuks: 0, perNaam: {} };
  const ids = {};
  for (let i = 1; i < waarden.length; i++) {
    const rij = waarden[i];
    if (celNaarTekst_(rij[1], 'yyyy-MM-dd') !== dag) continue;
    const aantal = Number(rij[5]) || 0;
    const sleutel = String(rij[3]).toLowerCase();
    tel.stuks += aantal;
    const n = tel.perNaam[sleutel] || (tel.perNaam[sleutel] = { stuks: 0, bestellingen: 0 });
    n.stuks += aantal;
    if (!ids[sleutel + '|' + rij[0]]) { ids[sleutel + '|' + rij[0]] = true; n.bestellingen++; }
  }
  return tel;
}

/**
 * Controleert een bestelling. Geeft { ok: true, naam, regels } terug, of { ok: false, code, error }.
 * Gewone functie zonder Google-afhankelijkheden, zodat hij los te testen is.
 *   instellingen: { code: string|null, menuPrijzen: object|null, tel: {stuks, perNaam} }
 */
function valideerBestelling_(body, instellingen) {
  const L = LIMIETEN;

  if (instellingen.code && String(body && body.code || '') !== instellingen.code) {
    return fout_('CODE', 'De teamcode ontbreekt of klopt niet.');
  }

  const regels = body && body.data;
  if (!Array.isArray(regels) || regels.length === 0) return fout_('ONGELDIG', 'Er zit niets in deze bestelling.');
  if (regels.length > L.MAX_REGELS_PER_BESTELLING) {
    return fout_('LIMIET', 'Te veel verschillende producten in één bestelling (maximaal ' + L.MAX_REGELS_PER_BESTELLING + ').');
  }

  const naam = veiligeTekst_(regels[0] && regels[0].Naam, L.MAX_NAAM);
  if (naam.length < L.MIN_NAAM) return fout_('ONGELDIG', 'Vul een naam in van minimaal ' + L.MIN_NAAM + ' tekens.');

  const uit = [];
  let stuks = 0;
  let bedrag = 0;

  for (let i = 0; i < regels.length; i++) {
    const r = regels[i] || {};
    if (veiligeTekst_(r.Naam, L.MAX_NAAM).toLowerCase() !== naam.toLowerCase()) {
      return fout_('ONGELDIG', 'Alle regels van een bestelling moeten bij dezelfde naam horen.');
    }

    const product = veiligeTekst_(r.Product, L.MAX_PRODUCT_TEKST);
    if (!product) return fout_('ONGELDIG', 'Een regel heeft geen productnaam.');

    const aantal = Number(r.Aantal);
    if (!isFinite(aantal) || Math.floor(aantal) !== aantal || aantal < 1) return fout_('ONGELDIG', 'Het aantal bij "' + product + '" klopt niet.');
    if (aantal > L.MAX_AANTAL_PER_REGEL) return fout_('LIMIET', 'Maximaal ' + L.MAX_AANTAL_PER_REGEL + ' stuks van "' + product + '".');

    const prijs = afronden_(Number(r.Stuksprijs));
    if (!isFinite(prijs) || prijs < 0) return fout_('ONGELDIG', 'De prijs bij "' + product + '" klopt niet.');

    if (instellingen.menuPrijzen) {
      const basis = menuNaamBijRegel_(product, instellingen.menuPrijzen);
      if (basis === null) return fout_('ONGELDIG', '"' + product + '" staat niet op het menu.');
      const min = instellingen.menuPrijzen[basis];
      if (prijs < min - 0.005 || prijs > min + L.MAX_MEERPRIJS_PER_STUK) {
        return fout_('ONGELDIG', 'De prijs van "' + product + '" klopt niet met het menu.');
      }
    } else if (prijs > 100) {
      return fout_('ONGELDIG', 'De prijs bij "' + product + '" klopt niet.');
    }

    stuks += aantal;
    bedrag += prijs * aantal;
    uit.push({ product: product, aantal: aantal, prijs: prijs, totaal: afronden_(prijs * aantal) });
  }

  if (stuks > L.MAX_STUKS_PER_BESTELLING) return fout_('LIMIET', 'Te veel stuks in één bestelling (maximaal ' + L.MAX_STUKS_PER_BESTELLING + ').');
  if (bedrag > L.MAX_BEDRAG_PER_BESTELLING) return fout_('LIMIET', 'Het bedrag van één bestelling mag maximaal € ' + L.MAX_BEDRAG_PER_BESTELLING + ' zijn.');

  const tel = instellingen.tel || { stuks: 0, perNaam: {} };
  const eerder = tel.perNaam[naam.toLowerCase()] || { stuks: 0, bestellingen: 0 };
  if (eerder.bestellingen >= L.MAX_BESTELLINGEN_PER_NAAM_PER_DAG) {
    return fout_('LIMIET', 'Je hebt vandaag al ' + eerder.bestellingen + ' keer besteld (maximaal ' + L.MAX_BESTELLINGEN_PER_NAAM_PER_DAG + '). Vraag het beheer om iets aan te passen.');
  }
  if (eerder.stuks + stuks > L.MAX_STUKS_PER_NAAM_PER_DAG) {
    return fout_('LIMIET', 'Je zit vandaag aan het maximum van ' + L.MAX_STUKS_PER_NAAM_PER_DAG + ' stuks per persoon.');
  }
  if (tel.stuks + stuks > L.MAX_STUKS_PER_DAG_TOTAAL) {
    return fout_('LIMIET', 'De bestellijst van vandaag zit vol. Neem contact op met het beheer.');
  }

  return { ok: true, naam: naam, regels: uit };
}

// ---------- Beheer: QR-code om af te rekenen ----------

function instellingenSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INSTELLINGEN_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(INSTELLINGEN_SHEET);
    sheet.getRange('A:B').setNumberFormat('@');
    sheet.appendRow(['Sleutel', 'Waarde']);
  }
  return sheet;
}

// Alle waarden krijgen een "~" voorop: zo ziet Google Sheets lange tekens als "=" of "+" nooit voor een formule aan
function leesInstellingen_() {
  const waarden = instellingenSheet_().getDataRange().getValues();
  const uit = {};
  for (let i = 1; i < waarden.length; i++) {
    uit[String(waarden[i][0])] = String(waarden[i][1]).replace(/^~/, '');
  }
  return uit;
}

function schrijfInstellingen_(instellingen) {
  const sheet = instellingenSheet_();
  const rijen = [['Sleutel', 'Waarde']];
  Object.keys(instellingen).forEach(function (sleutel) { rijen.push([sleutel, '~' + instellingen[sleutel]]); });
  sheet.clear();
  sheet.getRange('A:B').setNumberFormat('@');
  sheet.getRange(1, 1, rijen.length, 2).setValues(rijen);
}

function leesQr_() {
  const i = leesInstellingen_();
  let qr = '';
  for (let n = 0; i['qr:' + n] !== undefined; n++) qr += i['qr:' + n];
  return { ok: true, qr: qr || null, tekst: i.qr_tekst || '', link: i.qr_link || '', bijgewerkt: i.qr_bijgewerkt || '' };
}

function schoneTekst_(waarde, maxLengte) {
  return String(waarde == null ? '' : waarde).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLengte);
}

// ---------- Betalingen ----------

function betalingenSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BETALINGEN_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(BETALINGEN_SHEET);
    sheet.getRange('A:D').setNumberFormat('@');
    sheet.appendRow(['Datum', 'Naam', 'Status', 'Bijgewerkt']);
  }
  return sheet;
}

function leesBetalingen_() {
  const waarden = betalingenSheet_().getDataRange().getValues();
  const lijst = [];
  for (let i = 1; i < waarden.length; i++) {
    lijst.push({
      Datum: celNaarTekst_(waarden[i][0], 'yyyy-MM-dd'),
      Naam: String(waarden[i][1]).replace(/^~/, ''),
      Status: String(waarden[i][2]),
      Bijgewerkt: String(waarden[i][3])
    });
  }
  return lijst;
}

function schrijfBetalingen_(lijst) {
  const sheet = betalingenSheet_();
  const rijen = [['Datum', 'Naam', 'Status', 'Bijgewerkt']];
  // "~" voor de naam: zo wordt een naam als "=SOM(…)" nooit een formule
  lijst.forEach(function (b) { rijen.push([b.Datum, '~' + b.Naam, b.Status, b.Bijgewerkt]); });
  sheet.clear();
  sheet.getRange('A:D').setNumberFormat('@');
  sheet.getRange(1, 1, rijen.length, 4).setValues(rijen);
}

/** Zet de status van een naam op een dag. Status "open" haalt de regel weg. */
function zetBetaling_(datum, naam, status) {
  const lijst = leesBetalingen_();
  const sleutel = naam.toLowerCase();
  const rest = lijst.filter(function (b) { return !(b.Datum === datum && b.Naam.toLowerCase() === sleutel); });
  if (status !== 'open') {
    rest.push({ Datum: datum, Naam: naam, Status: status, Bijgewerkt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') });
  }
  schrijfBetalingen_(rest);
}

/** Zoekt de naam zoals die in de bestellingen van die dag staat (hoofdletters maken niet uit). null als er niets besteld is. */
function vindBestelNaam_(naam, datum) {
  const waarden = getSheet_().getDataRange().getValues();
  const sleutel = String(naam).toLowerCase();
  for (let i = 1; i < waarden.length; i++) {
    if (celNaarTekst_(waarden[i][1], 'yyyy-MM-dd') === datum && String(waarden[i][3]).toLowerCase() === sleutel) return String(waarden[i][3]);
  }
  return null;
}

function datumGeldig_(datum) {
  return /^\d{4}-\d{2}-\d{2}$/.test(datum) && !isNaN(new Date(datum).getTime());
}

// ---------- Afgesloten dagen ----------

function afgeslotenSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AFGESLOTEN_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AFGESLOTEN_SHEET);
    sheet.getRange('A:B').setNumberFormat('@');
    sheet.appendRow(['Datum', 'Afgesloten op']);
  }
  return sheet;
}

function leesAfgesloten_() {
  const waarden = afgeslotenSheet_().getDataRange().getValues();
  const lijst = [];
  for (let i = 1; i < waarden.length; i++) {
    const datum = celNaarTekst_(waarden[i][0], 'yyyy-MM-dd');
    if (datumGeldig_(datum)) lijst.push({ Datum: datum, Op: String(waarden[i][1]) });
  }
  return lijst;
}

function isAfgesloten_(datum) {
  return leesAfgesloten_().some(function (a) { return a.Datum === datum; });
}

/**
 * Afsluiten neemt ook alle eerdere dagen met bestellingen mee die nog open stonden (bijv. een vergeten testdag).
 * Heropenen geldt alleen voor die ene dag. Geeft de dagen terug die extra zijn afgesloten.
 */
function zetAfgesloten_(datum, dicht) {
  const huidig = leesAfgesloten_();
  const rest = huidig.filter(function (a) { return a.Datum !== datum; });
  const meegesloten = [];
  if (dicht) {
    const op = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    const alDicht = {};
    huidig.forEach(function (a) { alDicht[a.Datum] = true; });
    const waarden = getSheet_().getDataRange().getValues();
    for (let i = 1; i < waarden.length; i++) {
      const dag = celNaarTekst_(waarden[i][1], 'yyyy-MM-dd');
      if (datumGeldig_(dag) && dag < datum && !alDicht[dag]) {
        alDicht[dag] = true;
        meegesloten.push(dag);
        rest.push({ Datum: dag, Op: op });
      }
    }
    rest.push({ Datum: datum, Op: op });
    rest.sort(function (a, b) { return a.Datum < b.Datum ? -1 : a.Datum > b.Datum ? 1 : 0; });
  }
  const rijen = [['Datum', 'Afgesloten op']].concat(rest.map(function (a) { return [a.Datum, a.Op]; }));
  const sheet = afgeslotenSheet_();
  sheet.clear();
  sheet.getRange('A:B').setNumberFormat('@');
  sheet.getRange(1, 1, rijen.length, 2).setValues(rijen);
  return meegesloten.sort();
}

// ---------- Highscores van het wachtspelletje ----------

function highscoresSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HIGHSCORES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(HIGHSCORES_SHEET);
    sheet.getRange('A:C').setNumberFormat('@');
    sheet.appendRow(['Naam', 'Score', 'Datum']);
  }
  return sheet;
}

function leesHighscores_() {
  const waarden = highscoresSheet_().getDataRange().getValues();
  const lijst = [];
  for (let i = 1; i < waarden.length; i++) {
    const score = Number(waarden[i][1]) || 0;
    if (score > 0) lijst.push({ naam: String(waarden[i][0]).replace(/^~/, ''), score: score, datum: celNaarTekst_(waarden[i][2], 'yyyy-MM-dd') });
  }
  return lijst.sort(function (a, b) { return b.score - a.score || (a.datum < b.datum ? -1 : 1); });
}

function topHighscores_() {
  return leesHighscores_().slice(0, HIGHSCORE.TOP);
}

/** Bewaart een score als het de beste van die naam is. Geeft de top 10 en je plek terug. */
function bewaarHighscore_(body) {
  const teamcode = PropertiesService.getScriptProperties().getProperty('BESTELCODE');
  if (teamcode && String(body.code || '') !== teamcode) return fout_('CODE', 'De teamcode ontbreekt of klopt niet.');

  const naam = schoneTekst_(body.naam, HIGHSCORE.MAX_NAAM);
  if (naam.length < LIMIETEN.MIN_NAAM) return fout_('ONGELDIG', 'Vul een naam in van minimaal ' + LIMIETEN.MIN_NAAM + ' tekens.');
  const score = Number(body.score);
  if (!isFinite(score) || Math.floor(score) !== score || score < 1 || score > HIGHSCORE.MAX_SCORE) return fout_('ONGELDIG', 'Deze score klopt niet.');

  // Niet eindeloos laten insturen: per naam en in totaal een maximum per uur
  const cache = CacheService.getScriptCache();
  const sleutelNaam = 'hs:' + naam.toLowerCase();
  const perNaam = Number(cache.get(sleutelNaam)) || 0;
  const totaal = Number(cache.get('hs:totaal')) || 0;
  if (perNaam >= HIGHSCORE.MAX_PER_NAAM_PER_UUR || totaal >= HIGHSCORE.MAX_PER_UUR) return fout_('LIMIET', 'Even rustig aan met opslaan. Probeer het later nog eens.');
  cache.put(sleutelNaam, String(perNaam + 1), 3600);
  cache.put('hs:totaal', String(totaal + 1), 3600);

  const lijst = leesHighscores_();
  const bestaand = lijst.filter(function (h) { return h.naam.toLowerCase() === naam.toLowerCase(); })[0];
  let verbeterd = false;
  if (!bestaand) {
    lijst.push({ naam: naam, score: score, datum: vandaag_() });
    verbeterd = true;
  } else if (score > bestaand.score) {
    bestaand.score = score;
    bestaand.datum = vandaag_();
    verbeterd = true;
  }
  if (verbeterd) {
    lijst.sort(function (a, b) { return b.score - a.score || (a.datum < b.datum ? -1 : 1); });
    const bewaren = lijst.slice(0, HIGHSCORE.MAX_NAMEN);
    // "~" voor de naam: zo wordt een naam als "=SOM(…)" nooit een formule
    const rijen = [['Naam', 'Score', 'Datum']].concat(bewaren.map(function (h) { return ['~' + h.naam, String(h.score), h.datum]; }));
    const sheet = highscoresSheet_();
    sheet.clear();
    sheet.getRange('A:C').setNumberFormat('@');
    sheet.getRange(1, 1, rijen.length, 3).setValues(rijen);
  }
  const plek = leesHighscores_().findIndex(function (h) { return h.naam.toLowerCase() === naam.toLowerCase(); }) + 1;
  return { ok: true, verbeterd: verbeterd, beste: Math.max(score, bestaand ? bestaand.score : 0), plek: plek, scores: topHighscores_() };
}

// ---------- E-mailadressen en de bevestigingsmail ----------

/** Alleen een gewoon adres; het eerste teken een letter of cijfer, zodat Sheets er nooit een formule van maakt. */
function geldigEmail_(waarde) {
  const email = String(waarde == null ? '' : waarde).trim();
  if (!email || email.length > EMAIL.MAX_LENGTE) return '';
  return /^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(email) ? email : '';
}

function emailSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EMAIL_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(EMAIL_SHEET);
    sheet.getRange('A:C').setNumberFormat('@');
    sheet.appendRow(['Datum', 'Naam', 'E-mail']);
  }
  return sheet;
}

function leesEmails_() {
  const waarden = emailSheet_().getDataRange().getValues();
  const lijst = [];
  for (let i = 1; i < waarden.length; i++) {
    lijst.push({ Datum: celNaarTekst_(waarden[i][0], 'yyyy-MM-dd'), Naam: String(waarden[i][1]).replace(/^~/, ''), Email: String(waarden[i][2]) });
  }
  return lijst;
}

/** Bewaart (of vervangt) het adres voor een naam op een dag. Adressen ouder dan 62 dagen vallen eraf. */
function bewaarEmail_(datum, naam, email) {
  const grens = Utilities.formatDate(new Date(Date.now() - 62 * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const rest = leesEmails_().filter(function (e) { return e.Datum >= grens && !(e.Datum === datum && e.Naam.toLowerCase() === naam.toLowerCase()); });
  rest.push({ Datum: datum, Naam: naam, Email: email });
  const rijen = [['Datum', 'Naam', 'E-mail']].concat(rest.map(function (e) { return [e.Datum, '~' + e.Naam, e.Email]; }));
  const sheet = emailSheet_();
  sheet.clear();
  sheet.getRange('A:C').setNumberFormat('@');
  sheet.getRange(1, 1, rijen.length, 3).setValues(rijen);
}

function zoekEmail_(datum, naam) {
  const gevonden = leesEmails_().filter(function (e) { return e.Datum === datum && e.Naam.toLowerCase() === naam.toLowerCase(); })[0];
  return gevonden ? gevonden.Email : '';
}

function htmlTekst_(tekst) {
  return String(tekst).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function nlDatum_(datum) {
  const d = new Date(datum + 'T12:00:00');
  const dagen = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const maanden = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  return dagen[d.getDay()] + ' ' + d.getDate() + ' ' + maanden[d.getMonth()];
}

function euroTekst_(bedrag) {
  return '€ ' + afronden_(bedrag).toFixed(2).replace('.', ',');
}

/** Stuurt de bevestigingsmail. Geeft terug wat er gebeurde: verstuurd, geen adres, of waarom het mislukte. */
function stuurBevestiging_(datum, naam) {
  const email = zoekEmail_(datum, naam);
  if (!email) return { mail: 'geen_adres' };
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return { mail: 'mislukt', mailFout: 'Het maximum aantal mails voor vandaag is bereikt.' };
    const regels = leesBestellingen_(datum).filter(function (b) { return b.Naam.toLowerCase() === naam.toLowerCase(); });
    const perProduct = {};
    let totaal = 0;
    regels.forEach(function (b) {
      perProduct[b.Product] = (perProduct[b.Product] || 0) + b.Aantal;
      totaal += b.Totaal;
    });
    const producten = Object.keys(perProduct).map(function (p) { return (perProduct[p] > 1 ? perProduct[p] + '× ' : '') + p.replace(/^'/, ''); });
    const dag = nlDatum_(datum);
    const onderwerp = '✅ Betaling ontvangen: Family lunch van ' + dag;
    const tekst = 'Hoi ' + naam + ',\n\n' +
      'Je betaling van ' + euroTekst_(totaal) + ' voor de Family lunch van ' + dag + ' is ontvangen. Bedankt!\n\n' +
      'Je bestelling:\n' + producten.map(function (p) { return '- ' + p; }).join('\n') + '\n\n' +
      'Tot de volgende vrijdag! 🍟\n' + EMAIL.APP_LINK;
    const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#222;max-width:520px">' +
      '<p>Hoi ' + htmlTekst_(naam) + ',</p>' +
      '<p>Je betaling van <b>' + euroTekst_(totaal) + '</b> voor de Family lunch van <b>' + htmlTekst_(dag) + '</b> is ontvangen. Bedankt! ✅</p>' +
      '<p style="margin-bottom:4px">Je bestelling:</p><ul style="margin-top:0">' + producten.map(function (p) { return '<li>' + htmlTekst_(p) + '</li>'; }).join('') + '</ul>' +
      '<p>Tot de volgende vrijdag! 🍟<br><a href="' + EMAIL.APP_LINK + '">' + EMAIL.APP_LINK + '</a></p></div>';
    MailApp.sendEmail({ to: email, subject: onderwerp, body: tekst, htmlBody: html, name: 'Family Vrijdag' });
    return { mail: 'verstuurd', mailNaar: email };
  } catch (err) {
    return { mail: 'mislukt', mailFout: String(err && err.message || err) };
  }
}

// ---------- Sleutels: alleen de besteller zelf ----------

/**
 * Hoort deze sleutel bij een bestelling van deze naam op deze dag? Bestellingen van voor de sleutels (lege kolom)
 * blijven werken zonder sleutel, anders zou "Ik heb betaald" voor oude bestellingen stoppen.
 */
function sleutelKlopt_(datum, naam, sleutel) {
  const waarden = getSheet_().getDataRange().getValues();
  const sleutelNaam = String(naam).toLowerCase();
  let heeftSleutels = false;
  for (let i = 1; i < waarden.length; i++) {
    if (celNaarTekst_(waarden[i][KOLOM.DATUM], 'yyyy-MM-dd') !== datum || String(waarden[i][KOLOM.NAAM]).toLowerCase() !== sleutelNaam) continue;
    const eigen = String(waarden[i][KOLOM.SLEUTEL] || '');
    if (eigen) {
      heeftSleutels = true;
      if (sleutel && eigen === String(sleutel)) return true;
    }
  }
  return !heeftSleutels;
}

// ---------- Bestellen dicht (los van afsluiten): geen nieuwe bestellingen, betalen kan nog ----------

function isBestellenDicht_() {
  return PropertiesService.getScriptProperties().getProperty('BESTELLEN_DICHT') === vandaag_() || isAfgesloten_(vandaag_());
}

function zetBestellenDicht_(dicht) {
  const props = PropertiesService.getScriptProperties();
  if (dicht) props.setProperty('BESTELLEN_DICHT', vandaag_());
  else props.deleteProperty('BESTELLEN_DICHT');
}

/** Bestellingen van vandaag annuleren, alleen met de sleutel en zolang bestellen nog open is en er niet betaald is. */
function annuleer_(body) {
  const lijst = Array.isArray(body.bestellingen) ? body.bestellingen.slice(0, 10) : [];
  if (!lijst.length) return fout_('ONGELDIG', 'Geen bestelling om te annuleren.');
  if (isBestellenDicht_()) return fout_('GESLOTEN', 'Bestellen is al dicht, dus annuleren kan niet meer. Vraag het de beheerder.');
  const sheet = getSheet_();
  const waarden = sheet.getDataRange().getValues();
  const vandaag = vandaag_();
  const weg = [];
  let naam = null;
  lijst.forEach(function (b) {
    const id = String(b && b.bestelID || ''), sleutel = String(b && b.sleutel || '');
    if (!id || !sleutel) return;
    for (let i = 1; i < waarden.length; i++) {
      if (String(waarden[i][KOLOM.ID]) !== id) continue;
      if (String(waarden[i][KOLOM.SLEUTEL] || '') !== sleutel) return;
      if (celNaarTekst_(waarden[i][KOLOM.DATUM], 'yyyy-MM-dd') !== vandaag) return;
      naam = String(waarden[i][KOLOM.NAAM]);
      weg.push(i);
    }
  });
  if (!weg.length) return fout_('ONGELDIG', 'Deze bestelling is niet (meer) te vinden.');
  const status = leesBetalingen_().filter(function (b) { return b.Datum === vandaag && b.Naam.toLowerCase() === naam.toLowerCase(); })[0];
  if (status && status.Status !== 'open') return fout_('ONGELDIG', 'Je hebt al gemeld dat je betaald hebt. Vraag de beheerder om je bestelling aan te passen.');
  // Van onder naar boven weghalen, anders schuiven de rijnummers op
  weg.sort(function (a, b) { return b - a; }).forEach(function (i) { sheet.deleteRow(i + 1); });
  return { ok: true, verwijderd: weg.length };
}

/** Een collega meldt "ik heb betaald" (of toch niet). Een bevestiging van de beheerder blijft staan. */
function betaaldMelding_(body) {
  const teamcode = PropertiesService.getScriptProperties().getProperty('BESTELCODE');
  if (teamcode && String(body.code || '') !== teamcode) return fout_('CODE', 'De teamcode ontbreekt of klopt niet.');

  const naam = schoneTekst_(body.naam, LIMIETEN.MAX_NAAM);
  if (naam.length < LIMIETEN.MIN_NAAM) return fout_('ONGELDIG', 'Vul je naam in.');

  const datum = body.datum ? String(body.datum) : vandaag_();
  if (!datumGeldig_(datum)) return fout_('ONGELDIG', 'Deze datum klopt niet.');
  const grens = Utilities.formatDate(new Date(Date.now() - BETAAL.MAX_DAGEN_TERUG * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (datum < grens || datum > vandaag_()) return fout_('ONGELDIG', 'Alleen bestellingen van de afgelopen ' + BETAAL.MAX_DAGEN_TERUG + ' dagen.');

  if (isAfgesloten_(datum)) return fout_('GESLOTEN', 'Deze bestelling is afgesloten.');

  const echteNaam = vindBestelNaam_(naam, datum);
  if (!echteNaam) return fout_('ONGELDIG', 'Geen bestelling gevonden voor "' + naam + '" op deze dag.');
  if (!sleutelKlopt_(datum, echteNaam, body.sleutel)) return fout_('SLEUTEL', 'Dit kan alleen op het apparaat waarmee je besteld hebt.');

  const huidig = leesBetalingen_().filter(function (b) { return b.Datum === datum && b.Naam.toLowerCase() === echteNaam.toLowerCase(); })[0];
  if (huidig && huidig.Status === 'bevestigd') return { ok: true, status: 'bevestigd' };

  if (body.actie === 'zegtBetaald') {
    zetBetaling_(datum, echteNaam, 'zegt');
    return { ok: true, status: 'zegt' };
  }
  zetBetaling_(datum, echteNaam, 'open'); // zegtNietBetaald
  return { ok: true, status: 'open' };
}

/** Controleert de beheercode. Te veel foute pogingen blokkeren het beheer een uur lang. */
function controleerBeheercode_(code) {
  const echt = PropertiesService.getScriptProperties().getProperty('BEHEERCODE');
  if (!echt || echt.length < BEHEER.MIN_CODE_LENGTE) {
    return fout_('GEEN_BEHEER', 'Beheer staat uit. Zet in Apps Script bij Scripteigenschappen een BEHEERCODE van minimaal ' + BEHEER.MIN_CODE_LENGTE + ' tekens.');
  }
  const cache = CacheService.getScriptCache();
  const fouten = Number(cache.get('beheerFouten')) || 0;
  if (fouten >= BEHEER.MAX_FOUTE_POGINGEN_PER_UUR) {
    return fout_('GEBLOKKEERD', 'Te veel foute pogingen. Probeer het over een uur opnieuw.');
  }
  if (String(code || '') !== echt) {
    cache.put('beheerFouten', String(fouten + 1), 3600);
    Utilities.sleep(1500); // trager raden
    return fout_('CODE', 'De beheercode klopt niet.');
  }
  cache.remove('beheerFouten');
  return { ok: true };
}

function beheerActie_(body) {
  const toegang = controleerBeheercode_(body.beheercode);
  if (!toegang.ok) return toegang;

  if (body.actie === 'controleer') return { ok: true };

  // Alles wat meer laat zien dan iemands eigen gegevens: alleen met de beheercode
  if (body.actie === 'bestellingen') return { ok: true, bestellingen: leesBestellingen_(body.datum) };
  if (body.actie === 'betalingen') return { ok: true, betalingen: leesBetalingen_(), afgesloten: leesAfgesloten_(), emails: leesEmails_(), bestellenDicht: isBestellenDicht_(), vandaag: vandaag_() };

  if (body.actie === 'bestellenDicht') {
    zetBestellenDicht_(body.dicht !== false);
    return { ok: true, bestellenDicht: isBestellenDicht_() };
  }

  if (body.actie === 'afsluiten') {
    const datum = String(body.datum || '');
    if (!datumGeldig_(datum)) return fout_('ONGELDIG', 'Deze datum klopt niet.');
    const meegesloten = zetAfgesloten_(datum, body.dicht !== false);
    return { ok: true, afgesloten: leesAfgesloten_(), meegesloten: meegesloten };
  }

  if (body.actie === 'zetBetaling') {
    const datum = String(body.datum || '');
    if (!datumGeldig_(datum)) return fout_('ONGELDIG', 'Deze datum klopt niet.');
    if (body.status !== 'bevestigd' && body.status !== 'open') return fout_('ONGELDIG', 'Onbekende status.');
    const naam = vindBestelNaam_(schoneTekst_(body.naam, LIMIETEN.MAX_NAAM), datum);
    if (!naam) return fout_('ONGELDIG', 'Geen bestelling gevonden voor deze naam op deze dag.');
    const was = leesBetalingen_().filter(function (b) { return b.Datum === datum && b.Naam.toLowerCase() === naam.toLowerCase(); })[0];
    zetBetaling_(datum, naam, body.status);
    // Alleen een mail bij de overgang naar "bevestigd", niet als hij al bevestigd was
    if (body.status === 'bevestigd' && !(was && was.Status === 'bevestigd')) {
      const uit = stuurBevestiging_(datum, naam);
      uit.ok = true;
      return uit;
    }
    return { ok: true };
  }

  if (body.actie === 'verwijderQr') {
    schrijfInstellingen_({});
    return { ok: true };
  }

  if (body.actie === 'zetQr') {
    const qr = String(body.qr || '');
    // Alleen een echte afbeelding (geen svg of html, daar kan script in zitten)
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/]+=*$/.test(qr)) return fout_('ONGELDIG', 'Dit is geen geldige png- of jpeg-afbeelding.');
    if (qr.length > BEHEER.MAX_QR_TEKENS) return fout_('ONGELDIG', 'De afbeelding is te groot. Gebruik een kleinere foto of screenshot.');

    const link = schoneTekst_(body.link, BEHEER.MAX_LINK);
    if (link && !/^https:\/\/[^\s"'<>]+$/.test(link)) return fout_('ONGELDIG', 'De betaallink moet met https:// beginnen.');

    const instellingen = {};
    for (let n = 0; n * BEHEER.BLOK < qr.length; n++) instellingen['qr:' + n] = qr.slice(n * BEHEER.BLOK, (n + 1) * BEHEER.BLOK);
    instellingen.qr_tekst = schoneTekst_(body.tekst, BEHEER.MAX_TEKST);
    instellingen.qr_link = link;
    instellingen.qr_bijgewerkt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    schrijfInstellingen_(instellingen);
    return { ok: true };
  }

  return fout_('ONGELDIG', 'Onbekende beheeractie.');
}

/** Bestelling opslaan. Verwacht JSON: { code?, data: [{ Naam, Product, Aantal, Stuksprijs }, ...] } */
function doPost(e) {
  const lock = LockService.getScriptLock();
  // Lukt het slot niet binnen 10 seconden (erg druk), dan een nette fout in plaats van een foutpagina
  if (!lock.tryLock(10000)) return json_(fout_('BEZIG', 'Het is even erg druk. Probeer het over een paar seconden opnieuw.'));
  try {
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return json_(fout_('ONGELDIG', 'De bestelling kon niet gelezen worden.'));
    }

    if (body && body.actie === 'betaalStatus') return json_(betaalStatus_(body));
    if (body && (body.actie === 'zegtBetaald' || body.actie === 'zegtNietBetaald')) return json_(betaaldMelding_(body));
    if (body && body.actie === 'highscore') return json_(bewaarHighscore_(body));
    if (body && body.actie === 'annuleer') return json_(annuleer_(body));
    if (body && body.actie) return json_(beheerActie_(body));

    const sheet = getSheet_();
    const waarden = sheet.getDataRange().getValues();

    // Bestelnummer en sleutel maakt de app zelf, zodat een herhaalde poging (het antwoord kwam niet aan) te herkennen is.
    // Alleen met dezelfde sleutel telt hij als dezelfde bestelling; de sleutel stuurt het script nooit terug.
    let bestelNr = /^[a-z0-9]{10,32}$/.test(String(body && body.bestelNr || '')) ? String(body.bestelNr) : '';
    const eigenSleutel = /^[a-f0-9]{32}$/.test(String(body && body.sleutel || '')) ? String(body.sleutel) : '';
    if (bestelNr) {
      const eerder = waarden.filter(function (rij, i) { return i > 0 && String(rij[KOLOM.ID]) === bestelNr; });
      if (eerder.length && eigenSleutel && String(eerder[0][KOLOM.SLEUTEL] || '') === eigenSleutel) {
        const som = eerder.reduce(function (s, rij) { return s + (Number(rij[7]) || 0); }, 0);
        return json_({ ok: true, bestelID: bestelNr, totaal: afronden_(som), dubbel: true });
      }
      if (eerder.length) bestelNr = ''; // nummer al in gebruik door een andere bestelling: gewoon een nieuw nummer
    }

    if (isBestellenDicht_()) return json_(fout_('GESLOTEN', 'De bestellijst van vandaag is gesloten. Volgende keer weer!'));

    const tel = telVandaag_(waarden);
    const resultaat = valideerBestelling_(body, {
      code: PropertiesService.getScriptProperties().getProperty('BESTELCODE'),
      menuPrijzen: haalMenuPrijzen_(),
      tel: tel
    });
    if (!resultaat.ok) return json_(resultaat);

    // Heeft er vandaag al iemand met deze naam besteld? Eerst vragen of dat dezelfde persoon is.
    const eerderVandaag = tel.perNaam[resultaat.naam.toLowerCase()];
    if (eerderVandaag && eerderVandaag.bestellingen > 0 && !body.naamBevestigd) {
      return json_(fout_('NAAM_BESTAAT', 'Er heeft vandaag al iemand als "' + resultaat.naam + '" besteld.'));
    }

    const nu = new Date();
    const tz = Session.getScriptTimeZone();
    const datum = Utilities.formatDate(nu, tz, 'yyyy-MM-dd');
    const tijd = Utilities.formatDate(nu, tz, 'HH:mm:ss');
    const bestelID = bestelNr || Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    const sleutel = eigenSleutel || Utilities.getUuid().replace(/-/g, '');

    // Totaal rekent het script zelf uit; wat de website meestuurt als Totaal wordt genegeerd
    const rows = resultaat.regels.map(function (r) {
      return [bestelID, datum, tijd, resultaat.naam, r.product, r.aantal, r.prijs, r.totaal, sleutel];
    });
    const totaal = afronden_(resultaat.regels.reduce(function (s, r) { return s + r.totaal; }, 0));

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);

    // Optioneel e-mailadres voor de bevestigingsmail; een ongeldig adres wordt genegeerd, de bestelling gaat gewoon door
    const email = geldigEmail_(body.email);
    if (email) bewaarEmail_(datum, resultaat.naam, email);

    return json_({ ok: true, bestelID: bestelID, sleutel: sleutel, totaal: totaal });
  } catch (err) {
    return json_(fout_('FOUT', String(err)));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Bestellingen van één dag, of alle dagen. Alleen voor de beheerder (zie beheerActie_):
 * een gewone bezoeker krijgt de lijst van anderen nooit te zien.
 */
function leesBestellingen_(datum) {
  let filterDatum = String(datum || '');
  if (filterDatum === 'vandaag') filterDatum = vandaag_();
  const values = getSheet_().getDataRange().getValues();
  return values.slice(1)
    .map(function (row) {
      return {
        BestelID: String(row[0]),
        Datum: celNaarTekst_(row[1], 'yyyy-MM-dd'),
        Tijd: celNaarTekst_(row[2], 'HH:mm:ss'),
        Naam: String(row[3]),
        Product: String(row[4]),
        Aantal: Number(row[5]) || 0,
        Stuksprijs: Number(row[6]) || 0,
        Totaal: Number(row[7]) || 0
      };
    })
    .filter(function (b) { return !filterDatum || b.Datum === filterDatum; });
}

/** Een collega vraagt de stand van zijn eigen betaling op: alleen die ene naam en dag, nooit een lijst. */
function betaalStatus_(body) {
  const naam = schoneTekst_(body.naam, LIMIETEN.MAX_NAAM);
  if (naam.length < LIMIETEN.MIN_NAAM) return fout_('ONGELDIG', 'Vul je naam in.');
  const datum = body.datum ? String(body.datum) : vandaag_();
  if (!datumGeldig_(datum)) return fout_('ONGELDIG', 'Deze datum klopt niet.');
  const afgesloten = isAfgesloten_(datum);

  // Heeft de beheerder de bestelling uit de Sheet gehaald? Dan zegt het script dat, zodat de app hem ook weghaalt.
  // "bestaand": welke van de meegestuurde bestelnummers er nog zijn (als iemand maar een deel weghaalde).
  const waarden = getSheet_().getDataRange().getValues();
  const rijen = waarden.filter(function (rij, i) {
    return i > 0 && celNaarTekst_(rij[KOLOM.DATUM], 'yyyy-MM-dd') === datum && String(rij[KOLOM.NAAM]).toLowerCase() === naam.toLowerCase();
  });
  const ids = Array.isArray(body.bestelIDs) ? body.bestelIDs.slice(0, 20).map(String) : null;
  const extra = ids ? { bestaand: ids.filter(function (id) { return rijen.some(function (rij) { return String(rij[KOLOM.ID]) === id; }); }) } : {};
  if (!rijen.length) return Object.assign({ ok: true, status: null, afgesloten: afgesloten, verwijderd: true }, extra);

  if (!sleutelKlopt_(datum, naam, body.sleutel)) return Object.assign({ ok: true, status: null, afgesloten: afgesloten }, extra);
  const huidig = leesBetalingen_().filter(function (b) { return b.Datum === datum && b.Naam.toLowerCase() === naam.toLowerCase(); })[0];
  return Object.assign({ ok: true, status: huidig ? huidig.Status : 'open', afgesloten: afgesloten }, extra);
}

/**
 * Alleen de QR-code is openbaar (die moet iedereen kunnen zien om te betalen), plus of de bestellijst van vandaag dicht is.
 * De rest gaat via POST met beheercode.
 */
function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.actie === 'highscores') return json_({ ok: true, scores: topHighscores_() });
    if (e && e.parameter && e.parameter.actie === 'qr') {
      const uit = leesQr_();
      uit.vandaagGesloten = isBestellenDicht_();
      return json_(uit);
    }
    return json_(fout_('BEHEER', 'Bestellingen zijn alleen zichtbaar voor de beheerder, via admin.html.'));
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * Eenmalig te draaien in de editor (kies deze functie en klik op Uitvoeren) na het toevoegen van
 * de menucontrole: Google vraagt dan om toestemming om het menu op te halen.
 */
function toestemmingTesten() {
  const prijzen = haalMenuPrijzen_();
  Logger.log(prijzen ? 'Menu opgehaald: ' + Object.keys(prijzen).length + ' producten' : 'Menu NIET opgehaald (controleer toestemming en MENU_URL)');
  // Vraagt ook toestemming om mail te versturen (voor de bevestigingsmail)
  Logger.log('Mails die vandaag nog verstuurd kunnen worden: ' + MailApp.getRemainingDailyQuota());
}
