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
const HEADERS = ['BestelID', 'Datum', 'Tijd', 'Naam', 'Product', 'Aantal', 'Stuksprijs', 'Totaal'];

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

function zetAfgesloten_(datum, dicht) {
  const rest = leesAfgesloten_().filter(function (a) { return a.Datum !== datum; });
  if (dicht) rest.push({ Datum: datum, Op: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') });
  const rijen = [['Datum', 'Afgesloten op']].concat(rest.map(function (a) { return [a.Datum, a.Op]; }));
  const sheet = afgeslotenSheet_();
  sheet.clear();
  sheet.getRange('A:B').setNumberFormat('@');
  sheet.getRange(1, 1, rijen.length, 2).setValues(rijen);
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
  if (body.actie === 'betalingen') return { ok: true, betalingen: leesBetalingen_(), afgesloten: leesAfgesloten_() };

  if (body.actie === 'afsluiten') {
    const datum = String(body.datum || '');
    if (!datumGeldig_(datum)) return fout_('ONGELDIG', 'Deze datum klopt niet.');
    zetAfgesloten_(datum, body.dicht !== false);
    return { ok: true, afgesloten: leesAfgesloten_() };
  }

  if (body.actie === 'zetBetaling') {
    const datum = String(body.datum || '');
    if (!datumGeldig_(datum)) return fout_('ONGELDIG', 'Deze datum klopt niet.');
    if (body.status !== 'bevestigd' && body.status !== 'open') return fout_('ONGELDIG', 'Onbekende status.');
    const naam = vindBestelNaam_(schoneTekst_(body.naam, LIMIETEN.MAX_NAAM), datum);
    if (!naam) return fout_('ONGELDIG', 'Geen bestelling gevonden voor deze naam op deze dag.');
    zetBetaling_(datum, naam, body.status);
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
  lock.waitLock(10000);
  try {
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return json_(fout_('ONGELDIG', 'De bestelling kon niet gelezen worden.'));
    }

    if (body && body.actie === 'betaalStatus') return json_(betaalStatus_(body));
    if (body && (body.actie === 'zegtBetaald' || body.actie === 'zegtNietBetaald')) return json_(betaaldMelding_(body));
    if (body && body.actie) return json_(beheerActie_(body));

    if (isAfgesloten_(vandaag_())) return json_(fout_('GESLOTEN', 'De bestellijst van vandaag is gesloten. Volgende keer weer!'));

    const sheet = getSheet_();
    const resultaat = valideerBestelling_(body, {
      code: PropertiesService.getScriptProperties().getProperty('BESTELCODE'),
      menuPrijzen: haalMenuPrijzen_(),
      tel: telVandaag_(sheet.getDataRange().getValues())
    });
    if (!resultaat.ok) return json_(resultaat);

    const nu = new Date();
    const tz = Session.getScriptTimeZone();
    const datum = Utilities.formatDate(nu, tz, 'yyyy-MM-dd');
    const tijd = Utilities.formatDate(nu, tz, 'HH:mm:ss');
    const bestelID = Utilities.getUuid().slice(0, 8);

    // Totaal rekent het script zelf uit; wat de website meestuurt als Totaal wordt genegeerd
    const rows = resultaat.regels.map(function (r) {
      return [bestelID, datum, tijd, resultaat.naam, r.product, r.aantal, r.prijs, r.totaal];
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);

    return json_({ ok: true, bestelID: bestelID });
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
  const huidig = leesBetalingen_().filter(function (b) { return b.Datum === datum && b.Naam.toLowerCase() === naam.toLowerCase(); })[0];
  return { ok: true, status: huidig ? huidig.Status : 'open', afgesloten: isAfgesloten_(datum) };
}

/**
 * Alleen de QR-code is openbaar (die moet iedereen kunnen zien om te betalen), plus of de bestellijst van vandaag dicht is.
 * De rest gaat via POST met beheercode.
 */
function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.actie === 'qr') {
      const uit = leesQr_();
      uit.vandaagGesloten = isAfgesloten_(vandaag_());
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
}
