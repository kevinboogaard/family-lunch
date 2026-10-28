/**
 * Haalt de menukaart van Cafetaria Family Mijdrecht op bij e-food.nl en schrijft menu.json.
 * Draait elke donderdag via GitHub Actions (.github/workflows/update-menu.yml),
 * of handmatig met: node scripts/update-menu.js
 */
const fs = require('fs');
const path = require('path');

const API_URL = 'https://ntf-api.azurewebsites.net/api/assortment?storeId=100751&salesChannel=4&deliveryMethod=2';
const OUT_FILE = path.join(__dirname, '..', 'menu.json');

// Geen gerecht: controle voor zakelijke klanten (€ 0,01)
const isGeenGerecht = naam => /^Verificatie/i.test(naam);

const stripHtml = s => (s || '')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&euro;/g, '€')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/\s+/g, ' ').trim();
const byPos = (x, y) => x.position - y.position;
const bySort = (x, y) => x.sort - y.sort;

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
        producten.push({
          id: pr.id,
          menuItemId: pp.id,
          cat: mg.name,
          sub: sg.name,
          name: naam,
          desc: stripHtml(pp.description || pr.description),
          price: pr.price,
          vragenSetID: pp.questionSetId || pr.questionSetId || null
        });
      }
    }
  }

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

  const menu = { opgehaald: new Date().toISOString(), geldigVanaf: a.validFrom, bron: 'e-food.nl', producten, vragen };
  fs.writeFileSync(OUT_FILE, JSON.stringify(menu, null, 1) + '\n');
  console.log(`menu.json geschreven: ${producten.length} producten, ${vragen.length} antwoordopties (geldig vanaf ${a.validFrom})`);
}

main().catch(err => {
  console.error('Menu bijwerken mislukt:', err.message);
  process.exit(1);
});
