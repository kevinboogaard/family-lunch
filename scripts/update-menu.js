/**
 * Haalt de menukaart van Cafetaria Family Mijdrecht op bij e-food.nl en schrijft menu.json.
 * Vergelijkt het nieuwe menu met het vorige en schrijft de verschillen naar wijzigingen/<datum>.md.
 * Draait elke donderdag via GitHub Actions (.github/workflows/update-menu.yml),
 * of handmatig met: node scripts/update-menu.js
 */
const fs = require('fs');
const path = require('path');

const API_URL = 'https://ntf-api.azurewebsites.net/api/assortment?storeId=100751&salesChannel=4&deliveryMethod=2';
const OUT_FILE = path.join(__dirname, '..', 'menu.json');
const WIJZIGINGEN_DIR = path.join(__dirname, '..', 'wijzigingen');
// Foto's van e-food in verschillende formaten: "5-" is 200x200 (~40 KB), "2-" is 400x400
const FOTO_URL = (formaat, mediaName) => `https://ntf.blob.core.windows.net/pictures/${formaat}-${mediaName}.jpg`;

// Geen gerecht: controle voor zakelijke klanten (€ 0,01)
const isGeenGerecht = naam => /^Verificatie/i.test(naam);

const stripHtml = s => (s || '')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&euro;/g, '€')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/\s+/g, ' ').trim();
const byPos = (x, y) => x.position - y.position;
const bySort = (x, y) => x.sort - y.sort;
const euro = n => '€ ' + Number(n).toFixed(2).replace('.', ',');
const nlDatum = (d, opties) => d.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', ...opties });

// Een product kan in meerdere categorieën staan; per product-ID één regel
function productenPerId(producten) {
  const map = new Map();
  for (const p of producten) {
    if (!map.has(p.id)) map.set(p.id, { ...p, cats: [] });
    map.get(p.id).cats.push(p.cat);
  }
  return map;
}

// Meerprijzen per optie (bijv. "Mayonaise"), ontdubbeld over alle vragensets en extra's
function optiePrijzen(menu) {
  const map = new Map();
  for (const v of menu.vragen) map.set(v.antwoordTekst.replace(/\.$/, '').trim(), v.meerprijs);
  for (const set of Object.values(menu.extras || {})) {
    for (const o of set.opties) map.set(`${o.naam.replace(/\.$/, '').trim()} (extra)`, o.prijs);
  }
  return map;
}

function vergelijk(oud, nieuw) {
  const oudP = productenPerId(oud.producten), nieuwP = productenPerId(nieuw.producten);
  const omhoog = [], omlaag = [], nieuweProducten = [], verdwenen = [];
  for (const [id, p] of nieuwP) {
    const o = oudP.get(id);
    if (!o) nieuweProducten.push(p);
    else if (p.price > o.price) omhoog.push({ p, van: o.price });
    else if (p.price < o.price) omlaag.push({ p, van: o.price });
  }
  for (const [id, o] of oudP) if (!nieuwP.has(id)) verdwenen.push(o);

  const oudO = optiePrijzen(oud), nieuwO = optiePrijzen(nieuw);
  const opties = [];
  for (const [naam, prijs] of nieuwO) {
    if (oudO.has(naam) && oudO.get(naam) !== prijs) opties.push({ naam, van: oudO.get(naam), naar: prijs });
  }
  return { omhoog, omlaag, nieuweProducten, verdwenen, opties };
}

function schrijfWijzigingen(oud, nieuw) {
  const w = vergelijk(oud, nieuw);
  const nu = new Date(nieuw.opgehaald);
  const verschil = (van, naar) => `${euro(van)} → ${euro(naar)} (${naar > van ? '+' : '−'}${euro(Math.abs(naar - van)).slice(2)})`;
  const cats = p => [...new Set(p.cats)].join(', ');

  const regels = [`## Run van ${nlDatum(nu, { dateStyle: 'full', timeStyle: 'short' })}`, ''];
  const sectie = (titel, items, fmt) => {
    if (items.length === 0) return;
    regels.push(`### ${titel} (${items.length})`, '', ...items.map(fmt), '');
  };
  sectie('Prijsverhogingen', w.omhoog, ({ p, van }) => `- **${p.name}** (${cats(p)}): ${verschil(van, p.price)}`);
  sectie('Prijsverlagingen', w.omlaag, ({ p, van }) => `- **${p.name}** (${cats(p)}): ${verschil(van, p.price)}`);
  sectie('Gewijzigde meerprijzen (sauzen en opties)', w.opties, o => `- **${o.naam}**: ${verschil(o.van, o.naar)}`);
  sectie('Nieuwe producten', w.nieuweProducten, p => `- **${p.name}** (${cats(p)}): ${euro(p.price)}`);
  sectie('Verdwenen producten', w.verdwenen, p => `- **${p.name}** (${cats(p)}): was ${euro(p.price)}`);

  const aantal = w.omhoog.length + w.omlaag.length + w.opties.length + w.nieuweProducten.length + w.verdwenen.length;
  if (aantal === 0) regels.push('Geen wijzigingen in prijzen of producten.', '');

  // Eén bestand per dag; een tweede run op dezelfde dag wordt eronder toegevoegd
  fs.mkdirSync(WIJZIGINGEN_DIR, { recursive: true });
  const datum = nu.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  const bestand = path.join(WIJZIGINGEN_DIR, `${datum}.md`);
  const kop = fs.existsSync(bestand) ? '' : `# Menuwijzigingen ${nlDatum(nu, { dateStyle: 'long' })}\n\n` +
    `Vergeleken met het menu van ${nlDatum(new Date(oud.opgehaald), { dateStyle: 'long', timeStyle: 'short' })}.\n\n`;
  fs.appendFileSync(bestand, kop + regels.join('\n') + '\n');
  console.log(`${path.relative(path.join(__dirname, '..'), bestand)}: ${aantal} wijziging(en)`);
}

async function main() {
  const response = await fetch(API_URL, { headers: { Accept: 'application/json', Origin: 'https://e-food.nl' } });
  if (!response.ok) throw new Error(`API gaf status ${response.status}`);
  const a = (await response.json())[0];
  if (!a || !a.mainGroups || !a.products) throw new Error('Onverwacht antwoord van de API');

  const producten = [];
  for (const mg of Object.values(a.mainGroups).filter(g => !g.deleted).sort(byPos)) {
    const subs = mg.subGroups.map(id => a.subGroups[id]).filter(g => g && !g.deleted).sort(byPos);
    for (const sg of subs) {
      const positions = sg.productPositions.map(id => a.productPositions[id])
        .filter(p => p && !p.isDeleted && p.isActive).sort(byPos);
      for (const pp of positions) {
        const pr = a.products[pp.productId];
        const naam = pp.name || (pr && pr.name);
        if (!pr || isGeenGerecht(naam) || pr.inStock === false) continue;
        // Zelfde logica als e-food (getProductAdditions): extra's van de subcategorie + van het product zelf
        const extraSets = [...new Set([sg.extraSetId, ...(pp.extraSetIds || [])].filter(id => id && a.extraSets[id]))];
        // Gekoppelde producten (statiegeld) telt e-food automatisch bij de prijs op
        const statiegeld = (pr.productLinks || []).reduce((som, id) => som + ((a.products[id] || {}).price || 0), 0);
        producten.push({
          id: pr.id,
          menuItemId: pp.id,
          cat: mg.name,
          sub: sg.name,
          name: naam,
          desc: stripHtml(pp.description || pr.description),
          price: pr.price,
          statiegeld: Math.round(statiegeld * 100) / 100,
          vragenSetID: pp.questionSetId || pr.questionSetId || null,
          extraSets,
          foto: pr.mediaName ? FOTO_URL(5, pr.mediaName) : null,
          fotoGroot: pr.mediaName ? FOTO_URL(2, pr.mediaName) : null
        });
      }
    }
  }

  // Extra's (aanvinkbaar, bijv. "Zonder zout" of "Met bestek"); alleen sets die een product gebruikt
  const extras = {};
  for (const id of new Set(producten.flatMap(p => p.extraSets))) {
    const es = a.extraSets[id];
    const titel = /^Extra's groep/i.test(es.name) ? "Extra's" : es.name.charAt(0).toUpperCase() + es.name.slice(1);
    const opties = es.products.filter(x => x.isActive && a.products[x.productId]).sort(byPos)
      .map(x => ({ id: x.productId, naam: a.products[x.productId].name, prijs: a.products[x.productId].price || 0 }));
    if (opties.length) extras[id] = { titel, opties };
  }
  producten.forEach(p => { p.extraSets = p.extraSets.filter(id => extras[id]); });

  const gebruikteSets = new Set(producten.map(p => p.vragenSetID).filter(Boolean));
  const vragen = [];
  for (const qs of Object.values(a.questionSets).filter(s => gebruikteSets.has(s.id))) {
    for (const q of [...qs.questions].sort(bySort)) {
      for (const an of [...q.answers].sort(bySort)) {
        vragen.push({
          vragenSetID: qs.id,
          vraagID: q.id,
          vraagTekst: q.text,
          antwoordTekst: an.text,
          meerprijs: (a.products[an.productId] || {}).price || 0
        });
      }
    }
  }

  // Veiligheidscheck: liever het oude menu houden dan een leeg of kapot menu publiceren
  if (producten.length < 50) throw new Error(`Maar ${producten.length} producten gevonden, menu niet bijgewerkt`);

  const menu = { opgehaald: new Date().toISOString(), geldigVanaf: a.validFrom, bron: 'e-food.nl', producten, vragen, extras };
  if (fs.existsSync(OUT_FILE)) {
    schrijfWijzigingen(JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')), menu);
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(menu, null, 1) + '\n');
  console.log(`menu.json geschreven: ${producten.length} producten, ${vragen.length} antwoordopties, ` +
    `${Object.keys(extras).length} sets met extra's (geldig vanaf ${a.validFrom})`);
}

main().catch(err => {
  console.error('Menu bijwerken mislukt:', err.message);
  process.exit(1);
});
