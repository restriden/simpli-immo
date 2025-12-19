import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const agencyKey = Deno.env.get('GHL_AGENCY_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the admin user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nicht autorisiert' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Verify admin status
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Ungültiger Token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Check if user is admin
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!adminData) {
      return new Response(
        JSON.stringify({ success: false, error: 'Keine Admin-Berechtigung' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const { location_id } = await req.json();

    if (!location_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'location_id erforderlich' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Check if location is whitelisted
    const { data: whitelist } = await supabase
      .from('approved_subaccounts')
      .select('*')
      .eq('location_id', location_id)
      .eq('is_active', true)
      .single();

    if (!whitelist) {
      return new Response(
        JSON.stringify({ success: false, error: 'Location nicht in der Whitelist' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Check if already connected
    const { data: existingConnection } = await supabase
      .from('ghl_connections')
      .select('id')
      .eq('location_id', location_id)
      .single();

    if (existingConnection) {
      // Reactivate existing connection
      await supabase
        .from('ghl_connections')
        .update({
          is_active: true,
          access_token: agencyKey,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingConnection.id);

      return new Response(
        JSON.stringify({ success: true, message: 'Verbindung reaktiviert', connection_id: existingConnection.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch location info from GHL API
    let locationName = whitelist.location_name || 'Unbekannt';

    try {
      const ghlResponse = await fetch(`https://services.leadconnectorhq.com/locations/${location_id}`, {
        headers: {
          'Authorization': `Bearer ${agencyKey}`,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      });

      if (ghlResponse.ok) {
        const ghlData = await ghlResponse.json();
        if (ghlData.location?.name) {
          locationName = ghlData.location.name;
        }
      } else {
        console.log('GHL API response:', ghlResponse.status, await ghlResponse.text());
      }
    } catch (e) {
      console.error('Failed to fetch location from GHL:', e);
      // Continue with whitelist name
    }

    // Create new connection
    const { data: newConnection, error: insertError } = await supabase
      .from('ghl_connections')
      .insert({
        user_id: user.id, // Admin's user ID for now
        location_id: location_id,
        location_name: locationName,
        access_token: agencyKey,
        refresh_token: null, // Agency key doesn't need refresh
        token_expires_at: null, // Agency key doesn't expire
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to create connection:', insertError);
      return new Response(
        JSON.stringify({ success: false, error: 'Verbindung konnte nicht erstellt werden: ' + insertError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Update whitelist with location name if we got it from GHL
    if (locationName !== whitelist.location_name) {
      await supabase
        .from('approved_subaccounts')
        .update({ location_name: locationName })
        .eq('id', whitelist.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Subaccount erfolgreich verbunden',
        connection_id: newConnection.id,
        location_name: locationName
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Connect subaccount error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
