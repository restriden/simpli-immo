-- Detailed Analysis Fields for Leads
-- Based on the new comprehensive analysis prompt

-- Add new enum types for analysis
DO $$ BEGIN
    CREATE TYPE simpli_platzierung_enum AS ENUM ('erfolg', 'teilweise', 'nicht');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE lead_interesse_enum AS ENUM ('klar', 'unsicher', 'kein');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE termin_status_enum AS ENUM ('gebucht', 'interesse', 'kein');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE gespraechs_status_enum AS ENUM ('qualifiziert', 'offen', 'abgebrochen');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new columns to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS simpli_platzierung simpli_platzierung_enum DEFAULT 'nicht';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_interesse lead_interesse_enum DEFAULT 'kein';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS termin_status termin_status_enum DEFAULT 'kein';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS gespraechs_status gespraechs_status_enum DEFAULT 'offen';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_punkte jsonb DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS analyse_details jsonb DEFAULT '{}'::jsonb;

-- Add table to store the analysis prompt (editable)
CREATE TABLE IF NOT EXISTS analysis_prompts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL DEFAULT 'default',
    prompt_text text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Insert the default prompt
INSERT INTO analysis_prompts (name, prompt_text, is_active) VALUES (
    'default',
    'Du bist ein Senior Conversation-, Sales- und Funnel-Analyst mit Fokus auf Immobilien, Finanzierungsberatung und KI-gestützte Lead-Qualifizierung.

Der folgende Chat ist ein Gespräch zwischen einem Interessenten (Lead) und der KI des Maklers.
Ziel der Makler-KI ist es, Simpli Finance sinnvoll und glaubwürdig zu platzieren, sodass der Lead Interesse an Simpli Finance entwickelt und einen Termin buchen möchte.

KONVERSATION:
{{conversation}}

Analysiere und bewerte:

1. SIMPLI_PLATZIERUNG - Wurde Simpli Finance sinnvoll platziert?
   - erfolg: Erfolgreich und natürlich platziert
   - teilweise: Erwähnt aber verbesserungsfähig
   - nicht: Nicht oder unpassend platziert

2. LEAD_INTERESSE - Hat der Lead Interesse an Simpli Finance gezeigt?
   - klar: Klares Interesse, Nachfragen, positive Reaktionen
   - unsicher: Latentes oder unklares Interesse
   - kein: Kein erkennbares Interesse

3. TERMIN_STATUS - Stand bezüglich Terminen:
   - gebucht: Termin mit Simpli Finance oder Makler gebucht
   - interesse: Interesse an Termin gezeigt, aber nicht gebucht
   - kein: Kein Termininteresse

4. GESPRAECHS_STATUS - Qualifizierungsstatus:
   - qualifiziert: Erfolgreich qualifiziert & übergeben
   - offen: Interesse vorhanden, Abschluss offen
   - abgebrochen: Früh abgebrochen / nicht qualifiziert

5. FOLLOW_UP - Offene Punkte zum Nachfassen (Array mit max 3 Punkten)

6. VERBESSERUNG - Konkreter Vorschlag was besser gemacht werden könnte

Antworte NUR mit JSON:
{
  "simpli_platzierung": "erfolg|teilweise|nicht",
  "lead_interesse": "klar|unsicher|kein",
  "termin_status": "gebucht|interesse|kein",
  "gespraechs_status": "qualifiziert|offen|abgebrochen",
  "follow_up": ["Punkt 1", "Punkt 2"],
  "verbesserung": "Konkreter Verbesserungsvorschlag",
  "zusammenfassung": "Kurze 1-Satz Zusammenfassung des Gesprächsstands"
}',
    true
) ON CONFLICT DO NOTHING;
