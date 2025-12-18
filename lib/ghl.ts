import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// GHL OAuth Configuration
const GHL_CLIENT_ID = '69432ebdab47804bce51b78a-mjalsvpx';
const GHL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const REDIRECT_URI = 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/oauth-callback';
const SUPABASE_FUNCTIONS_URL = 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1';

// Required scopes for GHL API access
const GHL_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'conversations.readonly',
  'conversations.write',
  'conversations/message.readonly',
  'conversations/message.write',
  'calendars.readonly',
  'calendars/events.readonly',
  'locations.readonly',
].join(' ');

export interface GHLConnection {
  id: string;
  user_id: string;
  location_id: string;
  location_name: string | null;
  location_email: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GHLSyncResult {
  success: boolean;
  synced_connections: number;
  results: Record<string, {
    contacts: { synced: number; errors: number };
    conversations: { synced: number; errors: number };
    appointments: { synced: number; errors: number };
  }>;
}

/**
 * Start the GHL OAuth flow
 * Opens the GHL authorization page in an in-app browser
 */
export async function startGHLOAuth(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Build OAuth URL with state (user_id for callback)
    const authUrl = buildOAuthUrl(userId);

    console.log('[GHL] Starting OAuth flow for user:', userId);
    console.log('[GHL] Auth URL:', authUrl);

    // Open browser for OAuth
    const result = await WebBrowser.openAuthSessionAsync(
      authUrl,
      'simpliimmo://oauth' // Deep link scheme for redirect
    );

    console.log('[GHL] OAuth result:', result);

    if (result.type === 'success') {
      // Parse the redirect URL for success/error
      const url = new URL(result.url);
      const message = url.searchParams.get('message');

      if (url.pathname.includes('success')) {
        return { success: true };
      } else {
        return { success: false, error: message || 'OAuth failed' };
      }
    } else if (result.type === 'cancel') {
      return { success: false, error: 'OAuth abgebrochen' };
    } else {
      return { success: false, error: 'OAuth fehlgeschlagen' };
    }
  } catch (error) {
    console.error('[GHL] OAuth error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unbekannter Fehler' };
  }
}

/**
 * Build the GHL OAuth authorization URL
 */
function buildOAuthUrl(userId: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: GHL_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: GHL_SCOPES,
    state: userId, // Pass user_id to callback
  });

  return `${GHL_AUTH_URL}?${params.toString()}`;
}

/**
 * Check if user has an active GHL connection
 */
export async function checkGHLConnection(userId: string): Promise<GHLConnection | null> {
  console.log('[GHL] Checking connection for user:', userId);

  try {
    const { data, error } = await supabase
      .from('ghl_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    console.log('[GHL] Connection check result - data:', data, 'error:', error);

    if (error) {
      // PGRST116 = no rows returned (not connected)
      // 42P01 = table doesn't exist
      // PGRST204 = no rows found
      if (error.code === 'PGRST116' || error.code === '42P01' || error.code === 'PGRST204') {
        console.log('[GHL] No connection found (expected)');
        return null;
      }
      console.error('[GHL] Error checking connection:', error.code, error.message);
      return null;
    }

    console.log('[GHL] Found active connection:', data?.location_name);
    return data as GHLConnection;
  } catch (error) {
    console.error('[GHL] Exception checking connection:', error);
    return null;
  }
}

/**
 * Disconnect GHL (deactivate connection)
 */
export async function disconnectGHL(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('ghl_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('[GHL] Error disconnecting:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[GHL] Error disconnecting:', error);
    return false;
  }
}

/**
 * Trigger a manual sync of GHL data
 */
export async function syncGHLData(
  userId: string,
  syncType: 'full' | 'contacts' | 'conversations' | 'appointments' = 'full'
): Promise<GHLSyncResult> {
  try {
    // Get current session for auth
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/ghl-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        sync_type: syncType,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Sync failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[GHL] Sync error:', error);
    return {
      success: false,
      synced_connections: 0,
      results: {},
    };
  }
}

/**
 * Get sync logs for debugging
 */
export async function getGHLSyncLogs(connectionId: string, limit = 10): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('ghl_sync_logs')
      .select('*')
      .eq('connection_id', connectionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[GHL] Error fetching sync logs:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[GHL] Error fetching sync logs:', error);
    return [];
  }
}

/**
 * Get connection status with last sync info
 */
export async function getGHLStatus(userId: string): Promise<{
  connected: boolean;
  connection: GHLConnection | null;
  lastSync: string | null;
  syncStatus: 'idle' | 'syncing' | 'error';
}> {
  const connection = await checkGHLConnection(userId);

  if (!connection) {
    return {
      connected: false,
      connection: null,
      lastSync: null,
      syncStatus: 'idle',
    };
  }

  // Check latest sync log for status
  const logs = await getGHLSyncLogs(connection.id, 1);
  const latestLog = logs[0];

  let syncStatus: 'idle' | 'syncing' | 'error' = 'idle';
  if (latestLog) {
    if (latestLog.status === 'error') {
      syncStatus = 'error';
    } else if (latestLog.status === 'in_progress') {
      syncStatus = 'syncing';
    }
  }

  return {
    connected: true,
    connection,
    lastSync: connection.last_sync_at,
    syncStatus,
  };
}

/**
 * Debug function to check all GHL connections regardless of status
 * This is for troubleshooting only
 */
export async function debugGHLConnections(userId: string): Promise<{
  allConnections: any[];
  activeConnection: any | null;
  error: string | null;
}> {
  console.log('[GHL Debug] Checking all connections for user:', userId);

  try {
    // Check ALL connections for this user (not just active)
    const { data: allConnections, error: allError } = await supabase
      .from('ghl_connections')
      .select('*')
      .eq('user_id', userId);

    console.log('[GHL Debug] All connections:', allConnections);
    console.log('[GHL Debug] All error:', allError);

    // Check active connections
    const { data: activeConnection, error: activeError } = await supabase
      .from('ghl_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    console.log('[GHL Debug] Active connection:', activeConnection);
    console.log('[GHL Debug] Active error:', activeError);

    return {
      allConnections: allConnections || [],
      activeConnection: activeConnection || null,
      error: allError?.message || activeError?.message || null,
    };
  } catch (error) {
    console.error('[GHL Debug] Exception:', error);
    return {
      allConnections: [],
      activeConnection: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send a message via GHL
 */
export async function sendGHLMessage(
  userId: string,
  leadId: string,
  message: string,
  type: 'SMS' | 'WhatsApp' | 'Email' = 'WhatsApp'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/ghl-send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        lead_id: leadId,
        message,
        type,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `Failed: ${response.status}` };
    }

    const result = await response.json();
    return { success: true, messageId: result.message_id };
  } catch (error) {
    console.error('[GHL] Send message error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Subscribe to real-time message updates for a lead
 * Returns an unsubscribe function
 */
export function subscribeToMessages(
  leadId: string,
  onMessage: (message: any) => void
): () => void {
  console.log('[GHL] Subscribing to messages for lead:', leadId);

  const channel = supabase
    .channel(`messages:${leadId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `lead_id=eq.${leadId}`,
      },
      (payload) => {
        console.log('[GHL] New message received:', payload.new);
        onMessage(payload.new);
      }
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    console.log('[GHL] Unsubscribing from messages for lead:', leadId);
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to all message updates for a user (all leads)
 */
export function subscribeToAllMessages(
  userId: string,
  onMessage: (message: any) => void
): () => void {
  console.log('[GHL] Subscribing to all messages for user:', userId);

  const channel = supabase
    .channel(`user_messages:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        console.log('[GHL] New message for user:', payload.new);
        onMessage(payload.new);
      }
    )
    .subscribe();

  return () => {
    console.log('[GHL] Unsubscribing from all messages');
    supabase.removeChannel(channel);
  };
}

/**
 * Format last sync time for display
 */
export function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) {
    return 'Noch nie synchronisiert';
  }

  const date = new Date(lastSyncAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'Gerade eben';
  } else if (diffMins < 60) {
    return `Vor ${diffMins} Minuten`;
  } else if (diffHours < 24) {
    return `Vor ${diffHours} Stunden`;
  } else if (diffDays === 1) {
    return 'Gestern';
  } else {
    return `Vor ${diffDays} Tagen`;
  }
}

/**
 * Complete a task and sync with GHL
 */
export async function completeGHLTask(
  userId: string,
  todoId: string,
  completed: boolean = true
): Promise<{ success: boolean; syncedToGhl: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, syncedToGhl: false, error: 'Not authenticated' };
    }

    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/ghl-complete-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        todo_id: todoId,
        completed,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        syncedToGhl: false,
        error: errorData.error || `HTTP ${response.status}`,
      };
    }

    const result = await response.json();
    return {
      success: result.success,
      syncedToGhl: result.synced_to_ghl || false,
    };
  } catch (error) {
    console.error('[GHL] Complete task error:', error);
    return {
      success: false,
      syncedToGhl: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Subscribe to real-time todo updates for a user
 */
export function subscribeToTodos(
  userId: string,
  onTodo: (todo: any, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void
): () => void {
  console.log('[GHL] Subscribing to todos for user:', userId);

  const channel = supabase
    .channel(`todos:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'todos',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        console.log('[GHL] Todo change received:', payload.eventType, payload.new || payload.old);
        onTodo(payload.new || payload.old, payload.eventType as any);
      }
    )
    .subscribe();

  return () => {
    console.log('[GHL] Unsubscribing from todos');
    supabase.removeChannel(channel);
  };
}

/**
 * Register webhooks for existing GHL connection
 * Call this for users who connected before automatic webhook registration was added
 */
export async function registerGHLWebhooks(userId: string): Promise<{
  success: boolean;
  webhooksRegistered: number;
  errors: string[];
}> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, webhooksRegistered: 0, errors: ['Not authenticated'] };
    }

    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/ghl-register-webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ user_id: userId }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        webhooksRegistered: 0,
        errors: [errorData.error || `HTTP ${response.status}`],
      };
    }

    const result = await response.json();
    return {
      success: result.success,
      webhooksRegistered: result.webhooks_registered || 0,
      errors: result.errors || [],
    };
  } catch (error) {
    console.error('[GHL] Register webhooks error:', error);
    return {
      success: false,
      webhooksRegistered: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * Create a new task
 */
export async function createGHLTask(
  userId: string,
  task: {
    title: string;
    description?: string;
    type?: string;
    priority?: string;
    leadId?: string;
    dueDate?: string;
  }
): Promise<{ success: boolean; todo?: any; syncedToGhl: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, syncedToGhl: false, error: 'Not authenticated' };
    }

    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/ghl-create-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        lead_id: task.leadId,
        title: task.title,
        description: task.description,
        type: task.type || 'nachricht',
        priority: task.priority || 'normal',
        due_date: task.dueDate,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        syncedToGhl: false,
        error: errorData.error || `HTTP ${response.status}`,
      };
    }

    const result = await response.json();
    return {
      success: result.success,
      todo: result.todo,
      syncedToGhl: result.synced_to_ghl || false,
    };
  } catch (error) {
    console.error('[GHL] Create task error:', error);
    return {
      success: false,
      syncedToGhl: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
