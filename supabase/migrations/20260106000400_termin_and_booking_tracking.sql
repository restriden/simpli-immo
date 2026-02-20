-- Add fields for tracking appointment dates and completion
-- Also create table for detailed booking page event tracking

-- ============================================
-- 1. TERMIN STATTGEFUNDEN TRACKING
-- ============================================

-- Add appointment date and status fields to leads table
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS sf_termin_datum TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sf_termin_stattgefunden BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sf_termin_stattgefunden_at TIMESTAMPTZ;

-- Index for appointment date queries
CREATE INDEX IF NOT EXISTS idx_leads_sf_termin_datum ON leads(sf_termin_datum) WHERE sf_termin_datum IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_sf_termin_stattgefunden ON leads(sf_termin_stattgefunden) WHERE sf_termin_stattgefunden = true;

COMMENT ON COLUMN leads.sf_termin_datum IS 'Scheduled appointment date/time from GHL Calendar';
COMMENT ON COLUMN leads.sf_termin_stattgefunden IS 'Whether the SF consultation appointment actually took place';
COMMENT ON COLUMN leads.sf_termin_stattgefunden_at IS 'When the appointment was marked as completed';

-- ============================================
-- 2. BOOKING PAGE EVENT TRACKING
-- ============================================

-- Create table for tracking all booking page events
CREATE TABLE IF NOT EXISTS booking_page_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lead identification (at least one should be provided)
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  ghl_contact_id TEXT,
  email TEXT,
  phone TEXT,

  -- Session tracking
  session_id TEXT NOT NULL,
  visitor_id TEXT, -- For unique visitor tracking (stored in localStorage)

  -- Event details
  event_type TEXT NOT NULL, -- 'page_view', 'scroll_25', 'scroll_50', 'scroll_75', 'scroll_100', 'time_5s', 'time_30s', 'time_60s', 'time_120s', 'calendar_open', 'calendar_time_selected', 'calendar_info_entered', 'form_submitted', 'button_click'
  event_data JSONB DEFAULT '{}', -- Additional event-specific data (button name, scroll position, etc.)

  -- Page info
  page_url TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,

  -- Device/browser info
  user_agent TEXT,
  device_type TEXT, -- 'mobile', 'tablet', 'desktop'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_booking_events_lead_id ON booking_page_events(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_events_session ON booking_page_events(session_id);
CREATE INDEX IF NOT EXISTS idx_booking_events_visitor ON booking_page_events(visitor_id) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_events_type ON booking_page_events(event_type);
CREATE INDEX IF NOT EXISTS idx_booking_events_created ON booking_page_events(created_at);
CREATE INDEX IF NOT EXISTS idx_booking_events_contact ON booking_page_events(ghl_contact_id) WHERE ghl_contact_id IS NOT NULL;

-- Enable RLS
ALTER TABLE booking_page_events ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "service_role_all" ON booking_page_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policy: Authenticated users can read
CREATE POLICY "authenticated_read" ON booking_page_events
  FOR SELECT TO authenticated USING (true);

-- Policy: Anon can insert (for tracking from the booking page)
CREATE POLICY "anon_insert" ON booking_page_events
  FOR INSERT TO anon WITH CHECK (true);

COMMENT ON TABLE booking_page_events IS 'Tracks all user interactions on the Simpli Finance booking landing page';

-- ============================================
-- 3. AGGREGATED STATS VIEW (for KPI dashboard)
-- ============================================

CREATE OR REPLACE VIEW booking_page_stats AS
SELECT
  DATE(created_at) as date,

  -- Page views
  COUNT(*) FILTER (WHERE event_type = 'page_view') as total_page_views,
  COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'page_view') as unique_visitors,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'page_view') as total_sessions,

  -- Engagement
  COUNT(*) FILTER (WHERE event_type = 'scroll_50') as scrolled_50_percent,
  COUNT(*) FILTER (WHERE event_type = 'scroll_100') as scrolled_100_percent,
  COUNT(*) FILTER (WHERE event_type = 'time_30s') as stayed_30s,
  COUNT(*) FILTER (WHERE event_type = 'time_60s') as stayed_60s,

  -- Calendar funnel
  COUNT(*) FILTER (WHERE event_type = 'calendar_open') as calendar_opened,
  COUNT(*) FILTER (WHERE event_type = 'calendar_time_selected') as calendar_time_selected,
  COUNT(*) FILTER (WHERE event_type = 'calendar_info_entered') as calendar_info_entered,
  COUNT(*) FILTER (WHERE event_type = 'form_submitted') as form_submitted,

  -- Conversion rates (as percentages)
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE event_type = 'calendar_open') /
    NULLIF(COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'page_view'), 0), 1
  ) as calendar_open_rate,

  ROUND(
    100.0 * COUNT(*) FILTER (WHERE event_type = 'form_submitted') /
    NULLIF(COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'page_view'), 0), 1
  ) as form_submit_rate

FROM booking_page_events
GROUP BY DATE(created_at)
ORDER BY date DESC;

COMMENT ON VIEW booking_page_stats IS 'Daily aggregated statistics for booking page performance';
