/**
 * Family e-food hulpje
 *
 * Draait als bladwijzer op de menukaart van Cafetaria Family Mijdrecht op e-food.nl.
 * Haalt de bestellingen van vandaag op uit de Google Sheet, telt ze op per product en
 * zet ze, nadat jij op de knop klikt, in het mandje van e-food. Het hulpje rekent NIET af:
 * dat doe jij zelf, na een controle van het mandje.
 *
 * Installeren: zie helper.html.
 */
(function () {
    'use strict';

    // Plan B: de app plakt de gegevens (menu + bestellingen) zelf voor het script, zodat er geen
    // verbinding vanaf e-food nodig is. Zie "Kopieer voor e-food" in de app.
    let ingebouwd = null;
    function neemIngebouwd() {
        if (window.__familyHelperData) { ingebouwd = window.__familyHelperData; delete window.__familyHelperData; }
    }
    neemIngebouwd();

    if (window.__familyHelper) { window.__familyHelper.open(); return; }

    const scriptEl = document.currentScript;
    const srcUrl = scriptEl && scriptEl.src ? new URL(scriptEl.src) : null;
    // Voor testen: window.__familyHelperConfig = { basis, orders } of ?orders=... achter het script-adres.
    // Zonder die instellingen staat het menu op GitHub Pages en komen de bestellingen uit de Google Sheet.
    const cfg = window.__familyHelperConfig || {};
    const BASIS = cfg.basis || (srcUrl ? srcUrl.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '') : 'https://kevinboogaard.github.io/family-lunch/');
    const BESTELLINGEN_URL = cfg.orders || (srcUrl && srcUrl.searchParams.get('orders')) ||
        'https://script.google.com/macros/s/AKfycbyQoX7KhN74KetP3D8G9VTF59zRMauPE1V57Z-ThODdUtaSLfyWRhNsGCKBJrXF_rpSBw/exec';

    const wacht = ms => new Promise(r => setTimeout(r, ms));
    async function wachtOp(test, max = 4000, stap = 100) {
        const t0 = Date.now();
        while (Date.now() - t0 < max) {
            const v = test();
            if (v) return v;
            await wacht(stap);
        }
        return null;
    }

    // Prijzen ("1,00" bij keuzes, "(0,90)" bij extra's) en slotpunten ("Mayonaise.") weghalen,
    // zodat namen uit de app en van e-food gelijk worden
    const norm = s => String(s || '').toLowerCase().replace(/\s*\(?\s*\d+,\d{2}\s*\)?\s*$/, '').replace(/[.\s]+$/, '').replace(/\s+/g, ' ').trim();

    // ---------- e-food ----------
    const orderService = () => angular.element(document.body).injector().get('ef2OrderService');
    const mandje = () => orderService().order.products || [];
    const totaalStuks = () => mandje().reduce((s, p) => s + (p.quantity || 0), 0);
    const aantalVan = (id, naam) => mandje().filter(p => p.id === id || p.name === naam).reduce((s, p) => s + (p.quantity || 0), 0);
    const modalEl = () => document.querySelector('.modal.product-detail');
    const kaarten = () => [...document.querySelectorAll('div.product[class*="product-"]')];

    function vindKaart(id) {
        return kaarten().find(k => { try { return angular.element(k).scope().product.id === id; } catch (e) { return false; } });
    }

    function sluitModal() {
        const m = modalEl();
        const knop = m && m.querySelector('[data-ng-click="close()"]');
        if (knop) knop.click();
    }

    // Eerste zichtbare vraag in de pop-up waar nog geen antwoord is gekozen
    function openVraag(modal) {
        const vragen = [...modal.querySelectorAll('[class*="product-question-"]')]
            .filter(e => /(^|\s)product-question-\d+(\s|$)/.test(e.className) && e.offsetHeight > 0);
        return vragen.find(v => !v.querySelector('.product-answer.active')) || null;
    }

    async function voegToe(item) {
        const kaart = vindKaart(item.id);
        if (!kaart) throw new Error('Product niet gevonden op de pagina');
        const knop = kaart.querySelector('button[data-ng-click^="determineAction"]');
        if (!knop) throw new Error('Geen bestelknop gevonden');

        const voor = totaalStuks();
        knop.click();
        const uitkomst = await wachtOp(() => modalEl() ? 'modal' : (totaalStuks() > voor ? 'direct' : null), 4000);
        if (!uitkomst) throw new Error('Geen reactie van e-food');

        // Product zonder keuzes: e-food zet het meteen in het mandje
        if (uitkomst === 'direct') {
            for (let i = 1; i < item.aantal; i++) {
                const v = totaalStuks();
                knop.click();
                if (!await wachtOp(() => totaalStuks() > v, 3000)) throw new Error('Aantal ' + item.aantal + ' niet gehaald');
            }
            if (item.antwoorden.length || item.extras.length) throw new Error('Is zonder de gekozen opties toegevoegd');
            return;
        }

        try {
            const modal = modalEl();

            // Vragen: per open vraag de eerste nog niet gebruikte keuze die erbij past
            const rest = [...item.antwoorden];
            while (rest.length) {
                const vraag = await wachtOp(() => openVraag(modal), 3000);
                if (!vraag) break;
                const titel = (vraag.querySelector('.title') || {}).innerText || '';
                const opties = [...vraag.querySelectorAll('.product-answer-container')];
                const idx = rest.findIndex(t => opties.some(o => norm(o.innerText) === norm(t)));
                if (idx < 0) throw new Error('Keuze "' + rest[0] + '" bestaat niet bij vraag "' + titel.trim() + '"');
                const token = rest.splice(idx, 1)[0];
                opties.find(o => norm(o.innerText) === norm(token)).click();
                await wacht(450);
            }
            if (rest.length) throw new Error('Keuze niet toegepast: ' + rest.join(', '));
            await wacht(300);
            const nogOpen = openVraag(modal);
            if (nogOpen) throw new Error('E-food vraagt nog: ' + ((nogOpen.querySelector('.title') || {}).innerText || '').trim());

            // Extra's (aanvinkbaar)
            if (item.extras.length) {
                const stap = [...modal.querySelectorAll('[data-ng-click]')].find(e => e.getAttribute('data-ng-click') === "setStep('additions')");
                if (stap) { stap.click(); await wacht(500); }
                for (const naam of item.extras) {
                    const lab = [...modal.querySelectorAll('label.checkbox')]
                        .find(l => norm((l.querySelector('.name') || {}).innerText) === norm(naam));
                    if (!lab) throw new Error('Extra "' + naam + '" niet gevonden');
                    const inp = lab.querySelector('input');
                    if (!inp.checked) inp.click();
                    await wacht(150);
                    if (!inp.checked) throw new Error('Extra "' + naam + '" aanvinken is niet gelukt');
                }
            }

            // Aantal en toevoegen
            for (let i = 1; i < item.aantal; i++) {
                modal.querySelector('button[data-ng-click="increaseClick()"]').click();
                await wacht(80);
            }
            const toevoegen = modal.querySelector('button[data-ng-click="addToOrder()"]');
            if (!toevoegen || toevoegen.disabled) throw new Error('E-food laat toevoegen nog niet toe');
            const voorToevoegen = totaalStuks();
            toevoegen.click();
            if (!await wachtOp(() => !modalEl() && totaalStuks() >= voorToevoegen + item.aantal, 4000)) {
                throw new Error('Toevoegen is niet gelukt');
            }
        } finally {
            if (modalEl()) sluitModal();
            await wacht(300);
        }
    }

    // ---------- Bestellingen en menu ----------
    function parseOpties(tekst, namen) {
        if (!tekst) return [];
        const gesorteerd = [...new Set(namen)].sort((a, b) => b.length - a.length);
        // Namen kunnen zelf komma's bevatten ("Paprika, champignon, ui"), dus niet blind op ", " splitsen
        function zoek(pos) {
            if (pos >= tekst.length) return [];
            for (const naam of gesorteerd) {
                if (!tekst.startsWith(naam, pos)) continue;
                const eind = pos + naam.length;
                if (eind === tekst.length) return [naam];
                if (tekst.startsWith(', ', eind)) {
                    const rest = zoek(eind + 2);
                    if (rest) return [naam, ...rest];
                }
            }
            return null;
        }
        return zoek(0);
    }

    function vindMenuProduct(regel, producten) {
        let beste = null;
        for (const p of producten) {
            if ((regel === p.name || regel.startsWith(p.name + ' (')) && (!beste || p.name.length > beste.name.length)) beste = p;
        }
        return beste;
    }

    function maakPlan(menu, bestellingen) {
        const groepen = new Map();
        for (const b of bestellingen) {
            const g = groepen.get(b.Product) || { product: b.Product, aantal: 0, wie: new Map() };
            const n = Number(b.Aantal) || 0;
            g.aantal += n;
            g.wie.set(b.Naam, (g.wie.get(b.Naam) || 0) + n);
            groepen.set(b.Product, g);
        }

        const vragenPerSet = new Map();
        for (const v of menu.vragen) {
            const set = vragenPerSet.get(String(v.vragenSetID)) || new Map();
            const vraag = set.get(v.vraagID) || [];
            vraag.push(v.antwoordTekst);
            set.set(v.vraagID, vraag);
            vragenPerSet.set(String(v.vragenSetID), set);
        }

        const items = [], problemen = [];
        for (const g of groepen.values()) {
            const wie = [...g.wie].map(([naam, n]) => n > 1 ? naam + ' (' + n + '×)' : naam).join(', ');
            const p = vindMenuProduct(g.product, menu.producten);
            if (!p) { problemen.push({ tekst: g.product, aantal: g.aantal, reden: 'Staat niet (meer) in het menu', wie }); continue; }

            const optieTekst = g.product === p.name ? '' : g.product.slice(p.name.length + 2, -1);
            const vragen = p.vragenSetID && vragenPerSet.get(String(p.vragenSetID)) ? [...vragenPerSet.get(String(p.vragenSetID)).values()] : [];
            const extraNamen = (p.extraSets || []).flatMap(id => ((menu.extras || {})[id] ? menu.extras[id].opties.map(o => o.naam) : []));
            const tokens = parseOpties(optieTekst, [...vragen.flat(), ...extraNamen]);
            if (tokens === null || tokens.length < vragen.length) {
                problemen.push({ tekst: g.product, aantal: g.aantal, reden: 'Opties niet herkend', wie });
                continue;
            }
            items.push({
                id: p.id, naam: p.name, tekst: g.product, aantal: g.aantal, wie,
                antwoorden: tokens.slice(0, vragen.length), extras: tokens.slice(vragen.length)
            });
        }
        return { items, problemen };
    }

    // ---------- Scherm ----------
    const KLEUR = { bg: '#22173f', tekst: '#fff8ef', gedempt: '#c3b8de', geel: '#ffc21a', groen: '#2fe3a3', rood: '#ff5a6e' };
    const VIBE = 'linear-gradient(120deg,#ffc21a,#ff7a2f 45%,#ff3d81)';

    function el(tag, stijl, tekst) {
        const e = document.createElement(tag);
        if (stijl) e.style.cssText = stijl;
        if (tekst !== undefined) e.textContent = tekst;
        return e;
    }

    const paneel = el('div', 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(440px,calc(100vw - 32px));max-height:80vh;display:flex;flex-direction:column;' +
        'background:' + KLEUR.bg + ';color:' + KLEUR.tekst + ';border:1px solid rgba(255,255,255,.18);border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);' +
        'font:14px/1.45 system-ui,Segoe UI,sans-serif;overflow:hidden');
    paneel.id = 'family-hulpje';
    const kop = el('div', 'display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:' + VIBE + ';color:#1c0d00;font-weight:800;font-size:16px');
    kop.appendChild(el('span', '', '🍟 Family hulpje'));
    const sluit = el('button', 'border:0;background:rgba(0,0,0,.15);color:#1c0d00;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:15px', '✕');
    sluit.title = 'Sluiten';
    kop.appendChild(sluit);
    const inhoud = el('div', 'padding:14px 16px;overflow:auto');
    const voet = el('div', 'padding:12px 16px;border-top:1px solid rgba(255,255,255,.12);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap');
    paneel.append(kop, inhoud, voet);
    document.body.appendChild(paneel);

    function knopMaken(tekst, hoofd, onclick) {
        const k = el('button', 'border:0;border-radius:12px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer;' +
            (hoofd ? 'background:' + VIBE + ';color:#1c0d00' : 'background:rgba(255,255,255,.12);color:' + KLEUR.tekst), tekst);
        k.onclick = onclick;
        return k;
    }

    function toon(nodes, knoppen) {
        inhoud.replaceChildren(...nodes);
        voet.replaceChildren(...(knoppen || []));
    }
    const regel = (tekst, kleur) => el('div', 'margin:2px 0;' + (kleur ? 'color:' + kleur : ''), tekst);

    let plan = null;
    let bezig = false;

    // De beheercode blijft alleen in het geheugen van dit venster en wordt bij sluiten gewist
    let beheercode = '';

    // Het Google-script geeft de bestellingen alleen aan de beheerder, dus we vragen om de code (afgeschermd)
    function vraagCode(fout) {
        const veld = el('input', 'width:100%;box-sizing:border-box;padding:11px 14px;margin-top:10px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.3);color:' + KLEUR.tekst + ';font:15px system-ui,sans-serif');
        veld.type = 'password';
        veld.placeholder = 'Beheercode';
        veld.autocomplete = 'off';
        const doorgaan = () => { if (!veld.value) return; beheercode = veld.value; laden(); };
        veld.onkeydown = e => { if (e.key === 'Enter') doorgaan(); };
        toon([regel('🔑 De bestellingen zijn alleen zichtbaar voor de beheerder. Vul je beheercode in.'), fout ? regel(fout, KLEUR.rood) : el('div'), veld],
            [knopMaken('Sluiten', false, sluitPaneel), knopMaken('Doorgaan', true, doorgaan)]);
        setTimeout(() => veld.focus(), 50);
    }

    async function laden() {
        toon([regel('⏳ Bestellingen en menu ophalen…')], []);
        try {
            if (typeof angular === 'undefined' || !kaarten().length) {
                toon([regel('Open eerst de menukaart van Cafetaria Family Mijdrecht op e-food.nl en klik daarna opnieuw op de bladwijzer.', KLEUR.rood)],
                    [knopMaken('Naar de menukaart', true, () => { location.href = 'https://e-food.nl/skin/family/mijdrecht/cafetaria-family-mijdrecht/browse'; })]);
                return;
            }
            let menu, antwoord;
            if (ingebouwd) {
                menu = ingebouwd.menu;
                antwoord = { ok: true, bestellingen: ingebouwd.bestellingen };
            } else {
                // Een testbestand (?orders=...) wordt gewoon gelezen; het echte script alleen met de beheercode
                const uitScript = /^https:\/\/script\.google\.com\//.test(BESTELLINGEN_URL);
                if (uitScript && !beheercode) { vraagCode(); return; }
                const bestelde = uitScript
                    ? fetch(BESTELLINGEN_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ actie: 'bestellingen', beheercode, datum: 'vandaag' }) }).then(r => r.json())
                    : fetch(BESTELLINGEN_URL).then(r => r.json());
                [menu, antwoord] = await Promise.all([fetch(BASIS + 'menu.json?' + Date.now()).then(r => r.json()), bestelde]);
            }
            if (!antwoord.ok) {
                if (antwoord.code === 'CODE') { beheercode = ''; vraagCode(antwoord.error); return; }
                throw new Error(antwoord.error || 'Bestellingen ophalen mislukt');
            }
            if (!antwoord.bestellingen.length) {
                toon([regel('Er zijn vandaag nog geen bestellingen. 🍽️')], [knopMaken('Opnieuw kijken', false, laden)]);
                return;
            }
            plan = maakPlan(menu, antwoord.bestellingen);
            overzicht(antwoord.bestellingen);
        } catch (err) {
            toon([regel('😬 Ophalen mislukt: ' + err.message, KLEUR.rood)], [knopMaken('Opnieuw proberen', true, laden)]);
        }
    }

    function overzicht(bestellingen) {
        const mensen = new Set(bestellingen.map(b => b.Naam)).size;
        const stuks = plan.items.reduce((s, i) => s + i.aantal, 0);
        const nodes = [
            regel('👥 ' + mensen + ' ' + (mensen === 1 ? 'persoon' : 'mensen') + ' · 🍽️ ' + stuks + ' stuks in ' + plan.items.length + ' regels', KLEUR.gedempt),
            el('div', 'height:8px')
        ];
        plan.items.forEach(i => {
            const r = el('div', 'padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.14)');
            const t = el('div', 'font-weight:700');
            t.append(el('span', 'color:' + KLEUR.geel + ';margin-right:8px', i.aantal + '×'), document.createTextNode(i.tekst));
            r.append(t, el('div', 'font-size:12px;color:' + KLEUR.gedempt, i.wie));
            nodes.push(r);
        });
        if (plan.problemen.length) {
            nodes.push(el('div', 'margin-top:12px;font-weight:700;color:' + KLEUR.rood, '⚠️ Deze doe je zelf (' + plan.problemen.length + '):'));
            plan.problemen.forEach(p => nodes.push(regel(p.aantal + '× ' + p.tekst + ' — ' + p.reden + ' (' + p.wie + ')', KLEUR.rood)));
        }

        const nu = mandje().reduce((s, p) => s + (p.quantity || 0), 0);
        const leeg = el('input');
        leeg.type = 'checkbox';
        leeg.checked = false;
        leeg.style.cssText = 'margin-right:8px;accent-color:#2fe3a3';
        if (nu > 0) {
            const lab = el('label', 'display:block;margin-top:12px;padding:10px;border-radius:12px;background:rgba(255,194,26,.12);cursor:pointer');
            lab.append(leeg, document.createTextNode('Je mandje bevat al ' + nu + ' producten. Eerst leegmaken?'));
            nodes.push(lab);
        }

        toon(nodes, [
            knopMaken('Sluiten', false, sluitPaneel),
            knopMaken('🛒 Zet in mandje', true, () => uitvoeren(leeg.checked))
        ]);
    }

    async function uitvoeren(eerstLeeg) {
        if (bezig) return;
        bezig = true;
        const lijst = el('div');
        toon([regel('Bezig… blijf even op deze pagina.', KLEUR.gedempt), lijst], []);
        const log = (tekst, kleur) => { lijst.appendChild(regel(tekst, kleur)); inhoud.scrollTop = inhoud.scrollHeight; };

        try {
            if (eerstLeeg) {
                [...mandje()].forEach(p => orderService().removeProduct(p));
                await wacht(400);
                log('🗑️ Mandje leeggemaakt');
            }
            const basis = new Map(plan.items.map(i => [i.id, aantalVan(i.id, i.naam)]));
            const fouten = [];

            for (const item of plan.items) {
                try {
                    await voegToe(item);
                    log('✅ ' + item.aantal + '× ' + item.tekst);
                } catch (err) {
                    fouten.push({ item, reden: err.message });
                    log('❌ ' + item.aantal + '× ' + item.tekst + ' — ' + err.message, KLEUR.rood);
                }
                await wacht(200);
            }

            // Controle: staat er in het mandje wat er moet staan?
            const afwijkingen = plan.items.filter(i => !fouten.some(f => f.item === i))
                .filter(i => aantalVan(i.id, i.naam) - basis.get(i.id) < i.aantal);
            afwijkingen.forEach(i => fouten.push({ item: i, reden: 'Controle: aantal in mandje klopt niet' }));

            const klaar = [
                el('div', 'font-weight:800;font-size:16px;margin-bottom:6px', fouten.length ? '⚠️ Bijna klaar' : '🎉 Alles staat in je mandje!'),
                regel('Controleer je mandje en reken zelf af op e-food. Dit hulpje bestelt niets.', KLEUR.gedempt),
                el('div', 'height:8px'), lijst
            ];
            const handwerk = [...fouten.map(f => f.item.aantal + '× ' + f.item.tekst + ' — ' + f.reden), ...plan.problemen.map(p => p.aantal + '× ' + p.tekst + ' — ' + p.reden)];
            if (handwerk.length) {
                klaar.push(el('div', 'margin-top:12px;font-weight:700;color:' + KLEUR.rood, 'Deze moet je zelf nog doen of nakijken:'));
                handwerk.forEach(t => klaar.push(regel('• ' + t, KLEUR.rood)));
            }
            toon(klaar, [knopMaken('Sluiten', true, sluitPaneel)]);
        } catch (err) {
            toon([regel('😬 Er ging iets mis: ' + err.message, KLEUR.rood), lijst], [knopMaken('Sluiten', true, sluitPaneel)]);
        } finally {
            bezig = false;
        }
    }

    function sluitPaneel() {
        if (bezig) return;
        ingebouwd = null; // de volgende keer weer verse gegevens gebruiken
        beheercode = '';
        paneel.style.display = 'none';
    }
    sluit.onclick = sluitPaneel;

    window.__familyHelper = {
        open() { neemIngebouwd(); paneel.style.display = 'flex'; if (!bezig) laden(); }
    };
    paneel.style.display = 'flex';
    laden();
})();
