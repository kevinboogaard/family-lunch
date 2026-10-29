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

## Misbruik voorkomen

De web-app URL van het Google-script is openbaar: wie hem kent kan er bestellingen naartoe
sturen, ook zonder de website. Daarom controleert het script zelf elke bestelling
(`valideerBestelling_` in `google-apps-script.gs`):

| Controle | Standaard |
|---|---|
| Verschillende producten per bestelling | max 25 |
| Stuks van hetzelfde product | max 10 |
| Stuks per bestelling | max 40 |
| Bedrag per bestelling | max € 200 |
| Bestellingen per naam per dag | max 3 |
| Stuks per naam per dag | max 60 |
| Stuks per dag voor iedereen samen (noodrem) | max 500 |
| Product en prijs | moet op het menu staan, met een prijs die klopt |

Het totaalbedrag rekent het script zelf uit; wat een bezoeker als totaal meestuurt telt niet.
De getallen staan bovenaan het script in `LIMIETEN` en gelden na een nieuwe versie van de implementatie.
De website heeft dezelfde grenzen (`MANDJE_LIMIETEN` in `index.html`), zodat iemand niet pas
bij het versturen een afwijzing krijgt.

**Na het bijwerken van het script (eenmalig):**
1. Plak de nieuwe `google-apps-script.gs` in je Apps Script-project en sla op.
2. Kies bij de functie-keuzelijst bovenin `toestemmingTesten` en klik op **Uitvoeren**. Geef toestemming
   om een externe dienst te gebruiken (nodig om het menu op te halen). Zie je "Google heeft deze app niet
   gecontroleerd"? Kies **Geavanceerd > Ga naar (naam van je project)**: het is je eigen script.
3. **Implementeren > Implementaties beheren > Bewerken (potlood) > Versie: Nieuwe versie > Implementeren.**
   De URL blijft gelijk.

**Teamcode (optioneel):** wil je dat alleen collega's kunnen bestellen, zet dan in Apps Script bij
**Projectinstellingen > Scripteigenschappen** een eigenschap `BESTELCODE` met een code naar keuze,
en deel die code met je team. De app vraagt er één keer om en onthoudt hem daarna in de browser.
Verwijder je de eigenschap, dan is er geen code meer nodig. Het is een gedeeld wachtwoord: het houdt
buitenstaanders tegen, niet iemand in je team die de code doorgeeft.

**Wat dit niet kan:** het script ziet niet wie iemand is, dus een collega kan onder een andere naam
nog steeds een paar keer bestellen. Het beperkt de schade tot een paar regels. Rommel haal je weg door
de rijen in het tabblad **Bestellingen** te verwijderen.

## Afrekenen met een QR-code (beheer)

Op `admin.html` (`https://kevinboogaard.github.io/family-lunch/admin.html`) zet je de QR-code waarmee
collega's jou kunnen betalen, bijvoorbeeld een Tikkie- of bank-QR. In de app verschijnt dan een knop
**💶 Afrekenen** en na het plaatsen van een bestelling opent het afrekenscherm vanzelf, met de QR, jouw
tekst en het bedrag dat die persoon vandaag moet betalen.

**Instellen (eenmalig):**
1. Zet in Apps Script bij **Projectinstellingen > Scripteigenschappen** de eigenschap `BEHEERCODE` met een
   lange code (minimaal 8 tekens). Deze is een andere dan de teamcode.
2. Plak de nieuwe `google-apps-script.gs` in je project en publiceer een **nieuwe versie** (zie hierboven).
3. Open `admin.html`, log in met de beheercode, kies je QR-afbeelding en klik op **Opslaan voor iedereen**.

- De afbeelding wordt in je browser verkleind (max 640 px) en de pagina probeert de QR te lezen, zodat je
  zeker weet dat hij ook na het verkleinen scant. Bevat de QR een https-link, dan wordt die als betaallink ingevuld.
- Een **betaallink** is handig: wie op zijn telefoon bestelt, kan zijn eigen scherm niet scannen en tikt dan op de link.
- De QR staat in een tabblad **Instellingen** van je Google Sheet, naast **Bestellingen**.
- Beheer werkt alleen met de beheercode. Na 10 foute pogingen is het een uur geblokkeerd, en zonder
  `BEHEERCODE` is beheer uitgeschakeld. Wie je beheercode kent, kan de QR vervangen door een eigen rekening:
  deel hem dus niet.
- Wil je de QR weghalen, klik dan op `admin.html` op **Verwijderen**.

## Wie heeft betaald?

De betaalstatus staat per dag en per naam in een tabblad **Betalingen** van je Google Sheet (naast
**Bestellingen** en **Instellingen**). Er zijn drie standen:

| Stand | Betekenis |
|---|---|
| ⏳ open | nog niets gemeld |
| 🟡 zegt betaald | de collega heeft in het afrekenscherm op **Ik heb betaald** getikt |
| ✅ bevestigd | jij hebt in je bank- of Tikkie-app gezien dat het bedrag binnen is |

- **Collega's** tikken in het afrekenscherm op **✅ Ik heb betaald**. Het scherm laat de laatste bestelling
  van die naam zien (dus maandag ook nog die van vrijdag). Met **Toch nog niet betaald** halen ze de melding weer weg.
- **Jij** ziet op `admin.html` onder **Wie heeft betaald?** per persoon het bedrag en de stand, met
  **Bevestig betaald** en **Terug naar open**, en een knop **Kopieer herinnering voor de groepsapp** met de namen
  van wie nog niets gemeld heeft. In het overzicht in de app staan bij **Per persoon** dezelfde stickers.
- Een melding van een collega is alleen een melding: bevestigen kan alleen met de beheercode, en een bevestiging
  kan een collega niet meer terugzetten. De melding werkt alleen voor een naam die op die dag echt iets heeft besteld
  (maximaal 31 dagen terug), en met de teamcode als je die hebt ingesteld.
- Een oud script kent dit nog niet. Dan zie je in de app geen **Ik heb betaald** en op `admin.html` een melding
  dat je een nieuwe versie moet publiceren.

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
