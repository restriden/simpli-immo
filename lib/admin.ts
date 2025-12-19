import { supabase } from './supabase';

export interface ApprovedSubaccount {
  id: string;
  location_id: string;
  location_name: string | null;
  company_name: string | null;
  contact_email: string | null;
  notes: string | null;
  is_active: boolean;
  max_users: number;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  expires_at: string | null;
}

export interface ActiveConnection {
  id: string;
  user_id: string;
  location_id: string;
  location_name: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  user_email?: string;
}

export interface AdminStats {
  total_approved: number;
  active_connections: number;
  total_leads: number;
  total_messages: number;
}

/**
 * Check if current user is admin
 */
export async function isAdmin(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, role')
      .eq('user_id', userId)
      .single();

    if (error || !data) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if current user is super admin
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (error || !data) return false;
    return data.role === 'super_admin';
  } catch {
    return false;
  }
}

/**
 * Get all approved subaccounts (whitelist)
 */
export async function getApprovedSubaccounts(): Promise<ApprovedSubaccount[]> {
  const { data, error } = await supabase
    .from('approved_subaccounts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching approved subaccounts:', error);
    return [];
  }

  return data || [];
}

/**
 * Add a subaccount to whitelist
 */
export async function addApprovedSubaccount(
  subaccount: Partial<ApprovedSubaccount>
): Promise<{ success: boolean; data?: ApprovedSubaccount; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('approved_subaccounts')
    .insert({
      location_id: subaccount.location_id,
      location_name: subaccount.location_name,
      company_name: subaccount.company_name,
      contact_email: subaccount.contact_email,
      notes: subaccount.notes,
      max_users: subaccount.max_users || 5,
      is_active: true,
      approved_by: user?.id,
      expires_at: subaccount.expires_at,
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding subaccount:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Update a subaccount in whitelist
 */
export async function updateApprovedSubaccount(
  id: string,
  updates: Partial<ApprovedSubaccount>
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('approved_subaccounts')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating subaccount:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Remove a subaccount from whitelist
 */
export async function removeApprovedSubaccount(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('approved_subaccounts')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error removing subaccount:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Toggle subaccount active status
 */
export async function toggleSubaccountStatus(
  id: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  return updateApprovedSubaccount(id, { is_active: isActive });
}

/**
 * Get all active CRM connections
 */
export async function getActiveConnections(): Promise<ActiveConnection[]> {
  const { data, error } = await supabase
    .from('ghl_connections')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching connections:', error);
    return [];
  }

  return data || [];
}

/**
 * Get admin dashboard stats
 */
export async function getAdminStats(): Promise<AdminStats> {
  const [approved, connections, leads, messages] = await Promise.all([
    supabase.from('approved_subaccounts').select('id', { count: 'exact' }),
    supabase.from('ghl_connections').select('id', { count: 'exact' }).eq('is_active', true),
    supabase.from('leads').select('id', { count: 'exact' }),
    supabase.from('messages').select('id', { count: 'exact' }),
  ]);

  return {
    total_approved: approved.count || 0,
    active_connections: connections.count || 0,
    total_leads: leads.count || 0,
    total_messages: messages.count || 0,
  };
}

/**
 * Disconnect a connection (admin action)
 */
export async function disconnectConnection(
  connectionId: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('ghl_connections')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', connectionId);

  if (error) {
    console.error('Error disconnecting:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
