# Family Vrijdagmiddag Bestel-App

Bestelapp voor de vrijdagmiddaglunch. De menukaart komt uit
`FamilyMenu_PowerApps_Ready.xlsx`; bestellingen van iedereen komen samen in één
Google Sheet.

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

## Goed om te weten

- Iedereen die de web-app URL kent, kan bestellingen plaatsen en het overzicht
  lezen. Dat is prima voor een lunchlijst, maar zet er geen gevoelige gegevens in.
- Het beheeroverzicht toont standaard alleen de bestellingen van vandaag. Vink
  "Alleen vandaag" uit om alles te zien.
- Is `GOOGLE_SCRIPT_URL` leeg, dan werkt de app nog wel, maar blijven bestellingen
  alleen in de browser van degene die bestelt.
