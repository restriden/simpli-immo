-- Migration: Erweiterte Objekt-Daten für Finanzierung
-- Datum: 2024-12-28

-- ============ OBJEKT-STAMMDATEN ============
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS strasse TEXT;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS hausnummer TEXT;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS plz TEXT;
-- city existiert bereits
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS grundstueck_qm NUMERIC;
-- area_sqm existiert bereits als wohnflaeche
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS nutzflaeche_qm NUMERIC;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS baujahr INTEGER;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS objektart TEXT CHECK (objektart IN ('efh', 'dhh', 'rh', 'mfh', 'etw', 'grundstueck', 'gewerbe', 'sonstiges'));
-- rooms existiert bereits
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS etage INTEGER;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS stockwerke_gesamt INTEGER;

-- ============ TECHNISCHE DATEN ============
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS energieausweis_typ TEXT CHECK (energieausweis_typ IN ('bedarfsausweis', 'verbrauchsausweis', 'nicht_vorhanden'));
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS energiekennwert NUMERIC; -- kWh/m²a
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS energieeffizienzklasse TEXT CHECK (energieeffizienzklasse IN ('A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'));
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS heizungsart TEXT CHECK (heizungsart IN ('gas', 'oel', 'waermepumpe', 'fernwaerme', 'pellets', 'elektro', 'solar', 'sonstiges'));
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS heizung_baujahr INTEGER;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS letzte_modernisierung_jahr INTEGER;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS letzte_modernisierung_art TEXT;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS fenster_material TEXT CHECK (fenster_material IN ('kunststoff', 'holz', 'alu', 'holz_alu', 'sonstiges'));
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS fenster_baujahr INTEGER;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS dach_material TEXT CHECK (dach_material IN ('ziegel', 'beton', 'schiefer', 'metall', 'flachdach', 'sonstiges'));
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS dach_baujahr INTEGER;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS keller BOOLEAN DEFAULT FALSE;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS keller_beheizt BOOLEAN DEFAULT FALSE;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS garage_stellplatz TEXT CHECK (garage_stellplatz IN ('keine', 'garage', 'carport', 'stellplatz', 'tiefgarage', 'duplex'));

-- ============ RECHTLICHES ============
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS grundbuch_belastungen TEXT;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS baulasten TEXT;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS denkmalschutz BOOLEAN DEFAULT FALSE;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS erbbaurecht BOOLEAN DEFAULT FALSE;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS erbbaurecht_details TEXT;

-- ============ BEI WOHNUNGEN (ETW) ============
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS hausgeld_monatlich NUMERIC;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS instandhaltungsruecklage NUMERIC;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS sonderumlagen_geplant BOOLEAN DEFAULT FALSE;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS sonderumlagen_details TEXT;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS einheiten_im_haus INTEGER;

-- ============ FINANZIERUNG ============
-- price existiert bereits als kaufpreis
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS provision_prozent NUMERIC;
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS grunderwerbsteuer_prozent NUMERIC; -- Je Bundesland unterschiedlich
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS notar_grundbuch_prozent NUMERIC DEFAULT 2.0;

-- ============ DOKUMENTE ============
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS dokumente JSONB DEFAULT '[]'::jsonb;
-- Format: [{name: "Energieausweis.pdf", type: "energieausweis", uploaded_at: "...", url: "..."}]

-- ============ VOLLSTÄNDIGKEIT ============
ALTER TABLE objekte ADD COLUMN IF NOT EXISTS vollstaendigkeit_prozent INTEGER DEFAULT 0;

-- ============ INDEX für Performance ============
CREATE INDEX IF NOT EXISTS idx_objekte_vollstaendigkeit ON objekte(vollstaendigkeit_prozent);
CREATE INDEX IF NOT EXISTS idx_objekte_objektart ON objekte(objektart);

-- ============ KOMMENTAR ============
COMMENT ON COLUMN objekte.vollstaendigkeit_prozent IS 'Berechnet aus Pflichtfeldern für Finanzierung (0-100%)';
COMMENT ON COLUMN objekte.dokumente IS 'Array von hochgeladenen Dokumenten als JSONB';
