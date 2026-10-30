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

## "Ik weet het niet"

Naast de zoekbalk staat de knop **🤔 Ik weet het niet**. Je kiest daar tussen:

- **🧠 Beantwoord 4 vragen**: altijd of je zin hebt in vlees, kip, vis of vega, en daarna drie willekeurige
  uit een rijtje (trek, pittig, budget, warm of koud, handen of vork, iets nieuws, wat voor vrijdag, superkracht).
  Daarna stelt de app iets uit het menu voor, met de reden erbij en de knoppen **Iets anders** en **Opnieuw**.
- **🎡 Draai aan het rad**: een rad met acht willekeurige producten, binnen een budget dat je kiest
  (tot € 5, tot € 8 of maakt niet uit). Waar de pijl stopt, dat eet je.

Bij beide krijg je friet (bij een snack of burger) en een drankje als tip, die je met één tik toevoegt.

- Wat vlees, vega, pittig of licht is, raadt de app aan de naam en omschrijving van het product
  (`kiesKenmerken` in `index.html`). Komt er een nieuw product bij, dan gaat dat meestal vanzelf goed.
- Kies je **Vega** of **Helemaal niet pittig**, dan valt de rest weg. De andere antwoorden geven alleen voorrang.
- Grote bestellingen (gezinszakken, bittergarnituur, Family deal) en ijs stelt hij niet voor.

## Spelletje voor tijdens het wachten

Bovenin staat **🎮 Spelletje**: *Friet op de vlucht*, een kleine eigen renner. Een bakje friet rent weg en springt
over zout, saus en tomaten. Over een lage meeuw spring je heen, onder een hoge meeuw blijf je laag. Muntjes geven
25 punten extra. Springen met **spatie**, **pijltje omhoog** of **tikken**; langer vasthouden = hoger springen.
Op een telefoon is de wereld smaller en het tempo iets lager.

**Highscores:** na afloop kun je je naam invullen en je score opslaan. Onder het spel staat de top 10 van iedereen,
met je eigen naam gemarkeerd. Per naam telt alleen je beste score. De scores staan in een tabblad **Highscores** van
je Google Sheet; een rij weghalen daar haalt hem ook uit de lijst.

- De top 10 is voor iedereen met de link te zien (alleen naam en score).
- Het script weigert onmogelijke scores, namen korter dan 2 tekens en te vaak opslaan (30 keer per uur per naam),
  en vraagt de teamcode als je die hebt ingesteld. Echt valsspelen tegenhouden kan het niet: wie handig is, kan een
  nep-score insturen. Haal die dan weg in het tabblad.
- Dit werkt pas na het plakken van de nieuwe `google-apps-script.gs` en een **nieuwe versie** van de implementatie.
  Tot dan werkt het spel gewoon, maar zonder naamveld en top 10.

## Hetzelfde als vorige keer

Heeft iemand op dit apparaat al eens besteld, dan staat bovenin (en in het lege mandje) de knop
**🔁 Hetzelfde als vorige keer**. Die zet de laatste bestelling met dezelfde keuzes en extra's in het mandje,
tegen de prijzen van deze week, en vult de naam in.

- De app onthoudt dit in de browser van het apparaat (dezelfde lijst als **🧾 Mijn bestelling**). Op een ander
  apparaat of na het opruimen van de browser is de knop er niet. Bestellingen van anderen haalt hij nooit op.
- Staat een product of een gekozen extra niet meer op het menu, dan slaat hij die over en meldt hij welke.
- Wie vandaag al heeft besteld, ziet de knop niet, zodat je niet per ongeluk dubbel bestelt.

## Herinnering voor de deadline

Op vrijdag verschijnt in het laatste half uur voor **10:30** bovenin een balk: "⏰ Nog 14:59 om te bestellen".
Heeft iemand iets in zijn mandje dat nog niet is verstuurd, dan staat dat erbij. In de laatste 5 minuten wordt de
balk rood. Wegklikken kan; in de laatste 5 minuten komt hij één keer terug.

De tijd staat bovenin het script van `index.html` in `BESTELLEN_TOT` (en `HERINNER_MINUTEN` voor hoe lang van
tevoren). Het is alleen een herinnering: na 10:30 kun je nog steeds bestellen.

## Centrale opslag instellen (eenmalig, ±5 minuten)

1. Maak een nieuwe Google Sheet aan (bijv. "Family lunch bestellingen").
2. Ga naar **Extensies > Apps Script**.
3. Verwijder de voorbeeldcode en plak de inhoud van `google-apps-script.gs`. Klik op **Opslaan**.
4. Ga naar **Projectinstellingen** (tandwiel) en zet de tijdzone op
   **(GMT+01:00) Amsterdam**. Zo klopt "vandaag" in het overzicht op `admin.html`.
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

- **Collega's** tikken in het afrekenscherm op **✅ Ik heb betaald**. Het scherm laat hun eigen laatste bestelling
  van dit apparaat zien (dus maandag ook nog die van vrijdag). Met **Toch nog niet betaald** halen ze de melding weer weg.
- **Jij** ziet op `admin.html` onder **Wie heeft betaald?** per persoon het bedrag en de stand, met
  **Bevestig betaald** en **Terug naar open**, en een knop **Kopieer herinnering voor de groepsapp** met de namen
  van wie nog niets gemeld heeft. Bij **Per persoon** in het overzicht op `admin.html` staan dezelfde stickers.
- Een melding van een collega is alleen een melding: bevestigen kan alleen met de beheercode, en een bevestiging
  kan een collega niet meer terugzetten. De melding werkt alleen voor een naam die op die dag echt iets heeft besteld
  (maximaal 31 dagen terug), en met de teamcode als je die hebt ingesteld.
- Een oud script kent dit nog niet. Dan zie je in de app geen **Ik heb betaald** en op `admin.html` een melding
  dat je een nieuwe versie moet publiceren.

## Een dag afsluiten

Klaar met een vrijdag (iedereen heeft betaald, of je wilt er een streep onder zetten)? Kies op `admin.html` bij
**Wie heeft betaald?** de dag en klik op **🔒 Bestelling afsluiten**. Je krijgt eerst te zien wie nog niet bevestigd is.

Na het afsluiten:
- zien collega's die bestelling niet meer onder **🧾 Mijn bestelling** en in het afrekenscherm;
- kan niemand meer **Ik heb betaald** melden voor die dag (het script weigert het, ook buiten de app om);
- kan er die dag niet meer besteld worden, als je de dag van vandaag afsluit. De app toont dan
  "🔒 De bestellijst van vandaag is gesloten";
- zie jij alles nog wel op `admin.html`, en kun je betalingen nog bevestigen.

Afsluiten neemt ook alle **eerdere dagen** met bestellingen mee die nog open stonden, zoals een vergeten testdag.
Je ziet vooraf welke dagen dat zijn.

Met **🔓 Heropenen** draai je het terug, alleen voor die ene dag. De afgesloten dagen staan in een tabblad **Afgesloten** van je Google Sheet.
De bestelling blijft wel op het apparaat van de collega bewaard voor **Hetzelfde als vorige keer**, maar wordt niet
meer getoond.

> Dit werkt pas als je de nieuwe `google-apps-script.gs` hebt geplakt en een **nieuwe versie** hebt gepubliceerd.
> Tot dan zegt `admin.html` dat afsluiten nog niet kan.

## Publiceren via GitHub Pages

1. Push deze repository naar GitHub.
2. Ga naar **Settings > Pages**, kies bij *Source* de branch `main` en map `/ (root)`.
3. Na een minuut staat de app op `https://<gebruikersnaam>.github.io/<repo>/`.

## Wie ziet wat?

- **Collega's** zien alleen hun **eigen** bestelling: onder **🧾 Mijn bestelling** in de app staat wat dit
  apparaat heeft besteld. Er is geen lijst met bestellingen van anderen. De bestellingen van iedereen
  worden niet aan de website gegeven, ook niet als iemand rechtstreeks naar je Google-script vraagt.
- **Jij** ziet alles op `admin.html`, na het invullen van je beheercode (zie "Misbruik voorkomen").
- Bestelde iemand op een ander apparaat of is de browser opgeruimd? Dan staat de bestelling daar niet. Hij kan de
  QR nog wel gebruiken, maar je zegt hem zelf het bedrag (je ziet het op `admin.html`).
- Alleen de QR-code is openbaar, want die moet iedereen kunnen zien om te betalen.

**Let op:** zolang je het Google-script niet hebt bijgewerkt, kan iedereen met de web-app URL de oude bestellijst
nog ophalen. Plak de nieuwe `google-apps-script.gs` en publiceer een nieuwe versie.

## Bestellen bij Family

Als iedereen heeft besteld, open je `admin.html` en log je in. Onder **Alle bestellingen** zie je:

- **Per product**: alles opgeteld, in de volgorde van het menu, met afvinkvakjes om bij te houden wat je al
  hebt ingevuld. **Kopieer lijst** geeft een tekst voor de groepsapp.
- **Per persoon**: wie wat besteld heeft, wat diegene moet betalen en of het is betaald.
- **Alle regels**: de losse regels, en **Exporteer naar Excel**.
- Standaard de dag die je bovenin kiest (de laatste met bestellingen); vink **Toon alle dagen** aan voor alles.

Daarna kun je de lijst met de hand invullen, of het **e-food hulpje** gebruiken
(`helper.html`): een bladwijzer die op e-food.nl de producten van die dag, met alle keuzes
en extra's, in het mandje zet. Afrekenen doe je zelf. Het hulpje vraagt in zijn venstertje om je beheercode
(afgeschermd, alleen in het geheugen) om de bestellingen op te halen. Werkt de bladwijzer niet, gebruik dan
**📎 Kopieer voor e-food** op `admin.html`: die tekst bevat de bestellingen al, dus er is geen code nodig.
Verandert e-food zijn pagina, dan kan het hulpje stuk gaan.

## Goed om te weten

- Iedereen die de web-app URL kent, kan bestellingen plaatsen (binnen de grenzen hierboven), maar niets
  van anderen lezen. Zet er toch geen gevoelige gegevens in.
- Is `GOOGLE_SCRIPT_URL` leeg, dan werkt de app nog wel, maar blijven bestellingen
  alleen in de browser van degene die bestelt, en is er geen beheeroverzicht.
