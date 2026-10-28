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

/**
 * Eenmalig te draaien in de editor (kies deze functie en klik op Uitvoeren) na het toevoegen van
 * de menucontrole: Google vraagt dan om toestemming om het menu op te halen.
 */
function toestemmingTesten() {
  const prijzen = haalMenuPrijzen_();
  Logger.log(prijzen ? 'Menu opgehaald: ' + Object.keys(prijzen).length + ' producten' : 'Menu NIET opgehaald (controleer toestemming en MENU_URL)');
}
