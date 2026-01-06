import { supabase } from './supabase';

const SUPABASE_FUNCTIONS_URL = 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1';

export interface CRMConnection {
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

export interface CRMSyncResult {
  success: boolean;
  synced_connections: number;
  results: Record<string, {
    contacts: { synced: number; errors: number };
    conversations: { synced: number; errors: number };
    appointments: { synced: number; errors: number };
  }>;
}

/**
 * Check if user has an active CRM connection
 */
export async function checkCRMConnection(userId: string): Promise<CRMConnection | null> {
  try {
    console.log('[CRM] Checking connection for user:', userId);

    const { data, error } = await supabase
      .from('ghl_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.code === '42P01' || error.code === 'PGRST204') {
        console.log('[CRM] No connection found for user (error code:', error.code, ')');
        return null;
      }
      console.error('[CRM] Error checking connection:', error.code, error.message);
      return null;
    }

    console.log('[CRM] Found connection:', data?.location_id, data?.location_name);
    return data as CRMConnection;
  } catch (error) {
    console.error('[CRM] Exception checking connection:', error);
    return null;
  }
}

/**
 * Disconnect CRM (deactivate connection)
 */
export async function disconnectCRM(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('ghl_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('Error disconnecting CRM:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error disconnecting CRM:', error);
    return false;
  }
}

/**
 * Trigger a manual sync of CRM data
 */
export async function syncCRMData(
  userId: string,
  syncType: 'full' | 'contacts' | 'conversations' | 'appointments' | 'tasks' = 'full'
): Promise<CRMSyncResult> {
  try {
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
    console.error('CRM Sync error:', error);
    return {
      success: false,
      synced_connections: 0,
      results: {},
    };
  }
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
 * Send a message via CRM
 */
export async function sendCRMMessage(
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
    console.error('Send message error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Send media (image, video, audio) via CRM
 */
export async function sendCRMMedia(
  userId: string,
  leadId: string,
  fileUri: string,
  mediaType: 'image' | 'video' | 'audio',
  fileName: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, error: 'Not authenticated' };
    }

    // Read file as blob
    const response = await fetch(fileUri);
    const blob = await response.blob();

    // Create FormData
    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: mediaType === 'audio' ? 'audio/m4a' : mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
    } as any);
    formData.append('user_id', userId);
    formData.append('lead_id', leadId);
    formData.append('media_type', mediaType);

    const uploadResponse = await fetch(`${SUPABASE_FUNCTIONS_URL}/ghl-send-media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({}));
      return { success: false, error: errorData.error || `Failed: ${uploadResponse.status}` };
    }

    const result = await uploadResponse.json();
    return { success: true, messageId: result.message_id };
  } catch (error) {
    console.error('Send media error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Subscribe to real-time message updates for a lead
 */
export function subscribeToMessages(
  leadId: string,
  onMessage: (message: any) => void
): () => void {
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
        onMessage(payload.new);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to real-time todo updates for a user
 */
export function subscribeToTodos(
  userId: string,
  onTodo: (todo: any, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void
): () => void {
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
        onTodo(payload.new || payload.old, payload.eventType as any);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Complete a task and sync with CRM
 */
export async function completeCRMTask(
  userId: string,
  todoId: string,
  completed: boolean = true
): Promise<{ success: boolean; syncedToCrm: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, syncedToCrm: false, error: 'Not authenticated' };
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
        syncedToCrm: false,
        error: errorData.error || `HTTP ${response.status}`,
      };
    }

    const result = await response.json();
    return {
      success: result.success,
      syncedToCrm: result.synced_to_ghl || false,
    };
  } catch (error) {
    console.error('Complete task error:', error);
    return {
      success: false,
      syncedToCrm: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create a new task
 */
export async function createCRMTask(
  userId: string,
  task: {
    title: string;
    description?: string;
    type?: string;
    priority?: string;
    leadId?: string;
    dueDate?: string;
  }
): Promise<{ success: boolean; todo?: any; syncedToCrm: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, syncedToCrm: false, error: 'Not authenticated' };
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
        syncedToCrm: false,
        error: errorData.error || `HTTP ${response.status}`,
      };
    }

    const result = await response.json();
    return {
      success: result.success,
      todo: result.todo,
      syncedToCrm: result.synced_to_ghl || false,
    };
  } catch (error) {
    console.error('Create task error:', error);
    return {
      success: false,
      syncedToCrm: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Register webhooks for existing CRM connection
 */
export async function registerCRMWebhooks(userId: string): Promise<{
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
    console.error('Register webhooks error:', error);
    return {
      success: false,
      webhooksRegistered: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}
