# Family Vrijdagmiddag Bestel-App

Bestelapp voor de vrijdagmiddaglunch. De menukaart staat in `menu.json`;
bestellingen van iedereen komen samen in één Google Sheet.

## Menukaart

Elke donderdag om 07:00 (08:00 zomertijd) haalt GitHub Actions het actuele menu
van [Cafetaria Family Mijdrecht op e-food.nl](https://e-food.nl/skin/family/mijdrecht/cafetaria-family-mijdrecht/browse)
op en werkt `menu.json` bij (`scripts/update-menu.js`). De app toont bovenaan
wanneer het menu voor het laatst is opgehaald.

- **Direct bijwerken:** ga op GitHub naar **Actions > Menukaart bijwerken > Run workflow**,
  of draai lokaal `node scripts/update-menu.js` en push `menu.json`.
- **Mislukt het ophalen** (bijv. e-food.nl is offline), dan blijft het vorige menu
  gewoon staan en stuurt GitHub je een e-mail.
- **Wijzigingen:** bij elke run komt in de map `wijzigingen/` een bestand per dag
  (bijv. `wijzigingen/2026-10-29.md`) met prijsverhogingen, prijsverlagingen,
  gewijzigde meerprijzen van sauzen/opties en nieuwe of verdwenen producten,
  vergeleken met de vorige run.

## Centrale opslag instellen (eenmalig, ±5 minuten)

1. Maak een nieuwe Google Sheet aan (bijv. "Family lunch bestellingen").
2. Ga naar **Extensies > Apps Script**.
3. Verwijder de voorbeeldcode en plak de inhoud van `google-apps-script.gs`. Klik op **Opslaan**.
4. Ga naar **Projectinstellingen** (tandwiel) en zet de tijdzone op
   **(GMT+01:00) Amsterdam**. Zo klopt "Alleen vandaag" in het beheeroverzicht.
5. Klik op **Implementeren > Nieuwe implementatie**:
   - Type: **Web-app**
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**
6. Klik op **Implementeren**, geef toestemming voor je Google-account en kopieer de
   **web-app URL** (eindigt op `/exec`).
7. Plak die URL in `index.html` bij `const GOOGLE_SCRIPT_URL = "";` en publiceer
   de wijziging naar GitHub.

Het tabblad **Bestellingen** wordt bij de eerste bestelling automatisch aangemaakt.

> Pas je het script later aan? Kies dan **Implementeren > Implementaties beheren >
> Bewerken > Nieuwe versie**, anders blijft de oude versie actief. De URL blijft gelijk.

## Publiceren via GitHub Pages

1. Push deze repository naar GitHub.
2. Ga naar **Settings > Pages**, kies bij *Source* de branch `main` en map `/ (root)`.
3. Na een minuut staat de app op `https://<gebruikersnaam>.github.io/<repo>/`.

## Bestellen bij Family

Als iedereen heeft besteld, open je in de app **Alle bestellingen**:

- **Per product** telt alles op, in de volgorde van het menu, met afvinkvakjes
  om bij te houden wat je al hebt ingevuld. **Kopieer lijst** geeft een tekst voor de groepsapp.
- **Per persoon** laat zien wie wat besteld heeft en wat diegene moet betalen.

Daarna kun je de lijst met de hand invullen, of het **e-food hulpje** gebruiken
(`helper.html`): een bladwijzer die op e-food.nl de producten van vandaag, met alle keuzes
en extra's, in het mandje zet. Afrekenen doe je zelf. Zie `helper.html` voor de uitleg.
Het hulpje (`e-food-helper.js`) leest het menu uit `menu.json` en de bestellingen uit de
Google Sheet; verandert e-food zijn pagina, dan kan het hulpje stuk gaan.

## Goed om te weten

- Iedereen die de web-app URL kent, kan bestellingen plaatsen en het overzicht
  lezen. Dat is prima voor een lunchlijst, maar zet er geen gevoelige gegevens in.
- Het beheeroverzicht toont standaard alleen de bestellingen van vandaag. Vink
  "Alleen vandaag" uit om alles te zien.
- Is `GOOGLE_SCRIPT_URL` leeg, dan werkt de app nog wel, maar blijven bestellingen
  alleen in de browser van degene die bestelt.
