import { supabase } from './supabase';

// ============ TYPEN ============

export interface Objekt {
  id: string;
  user_id: string;
  name: string;
  city: string;
  price: number;
  rooms: number;
  area_sqm: number;
  status: 'aktiv' | 'verkauft' | 'pausiert';
  ai_ready: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  user_id: string;
  objekt_id: string;
  name: string;
  email?: string;
  phone?: string;
  status: string;
  source: 'simpli' | 'extern';
  finanzierung_status?: string;
  last_customer_message_hours?: number;
  protected_until?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  objekt?: Objekt;
}

export interface Todo {
  id: string;
  user_id: string;
  lead_id?: string;
  objekt_id?: string;
  type: string;
  priority: string;
  title: string;
  subtitle?: string;
  completed: boolean;
  due_date?: string;
  created_at: string;
  lead?: Lead;
  objekt?: Objekt;
}

export interface Message {
  id: string;
  user_id: string;
  lead_id: string;
  type: 'incoming' | 'outgoing' | 'system';
  content: string;
  created_at: string;
}

export interface KiWissen {
  id: string;
  user_id: string;
  objekt_id?: string;
  kategorie: string;
  frage: string;
  antwort: string;
  quelle: string;
  is_auto_learned: boolean;
  kontakt_name?: string;
  created_at: string;
  updated_at: string;
}

export interface Provision {
  id: string;
  user_id: string;
  objekt_id: string;
  lead_id?: string;
  type: 'simpli' | 'makler';
  amount: number;
  status: 'erwartet' | 'bestaetigt' | 'ausgezahlt';
  datum?: string;
  created_at: string;
  objekt?: Objekt;
  lead?: Lead;
}

// ============ OBJEKTE ============

export async function getObjekte(userId: string): Promise<Objekt[]> {
  console.log('[DEBUG] getObjekte called with userId:', userId);

  const { data, error } = await supabase
    .from('objekte')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log('[DEBUG] getObjekte result - data:', data, 'error:', error);

  if (error) {
    console.error('Error fetching objekte:', error);
    return [];
  }
  return data || [];
}

export async function getObjekt(objektId: string): Promise<Objekt | null> {
  const { data, error } = await supabase
    .from('objekte')
    .select('*')
    .eq('id', objektId)
    .single();

  if (error) {
    console.error('Error fetching objekt:', error);
    return null;
  }
  return data;
}

export async function createObjekt(objekt: Partial<Objekt>): Promise<Objekt | null> {
  const { data, error } = await supabase
    .from('objekte')
    .insert(objekt)
    .select()
    .single();

  if (error) {
    console.error('Error creating objekt:', error);
    return null;
  }
  return data;
}

export async function updateObjekt(objektId: string, updates: Partial<Objekt>): Promise<Objekt | null> {
  const { data, error } = await supabase
    .from('objekte')
    .update(updates)
    .eq('id', objektId)
    .select()
    .single();

  if (error) {
    console.error('Error updating objekt:', error);
    return null;
  }
  return data;
}

// ============ LEADS ============

export async function getLeads(userId: string): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select(`
      *,
      objekt:objekte(*)
    `)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching leads:', error);
    return [];
  }
  return data || [];
}

export async function getLeadsByObjekt(objektId: string): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('objekt_id', objektId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching leads by objekt:', error);
    return [];
  }
  return data || [];
}

export async function getLead(leadId: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select(`
      *,
      objekt:objekte(*)
    `)
    .eq('id', leadId)
    .single();

  if (error) {
    console.error('Error fetching lead:', error);
    return null;
  }
  return data;
}

export async function createLead(lead: Partial<Lead>): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .insert(lead)
    .select()
    .single();

  if (error) {
    console.error('Error creating lead:', error);
    return null;
  }
  return data;
}

export async function updateLead(leadId: string, updates: Partial<Lead>): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', leadId)
    .select()
    .single();

  if (error) {
    console.error('Error updating lead:', error);
    return null;
  }
  return data;
}

// ============ TODOS ============

export async function getTodos(userId: string): Promise<Todo[]> {
  console.log('[DEBUG] getTodos called with userId:', userId);

  const { data, error } = await supabase
    .from('todos')
    .select(`
      *,
      lead:leads(*),
      objekt:objekte(*)
    `)
    .eq('user_id', userId)
    .eq('completed', false)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false });

  console.log('[DEBUG] getTodos result - data:', data, 'error:', error);

  if (error) {
    console.error('Error fetching todos:', error);
    return [];
  }
  return data || [];
}

export async function createTodo(todo: Partial<Todo>): Promise<Todo | null> {
  const { data, error } = await supabase
    .from('todos')
    .insert(todo)
    .select()
    .single();

  if (error) {
    console.error('Error creating todo:', error);
    return null;
  }
  return data;
}

export async function updateTodo(todoId: string, updates: Partial<Todo>): Promise<Todo | null> {
  const { data, error } = await supabase
    .from('todos')
    .update(updates)
    .eq('id', todoId)
    .select()
    .single();

  if (error) {
    console.error('Error updating todo:', error);
    return null;
  }
  return data;
}

export async function completeTodo(todoId: string): Promise<boolean> {
  const { error } = await supabase
    .from('todos')
    .update({ completed: true })
    .eq('id', todoId);

  if (error) {
    console.error('Error completing todo:', error);
    return false;
  }
  return true;
}

// ============ MESSAGES ============

export async function getMessages(leadId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
  return data || [];
}

export async function sendMessage(message: Partial<Message>): Promise<Message | null> {
  const { data, error } = await supabase
    .from('messages')
    .insert(message)
    .select()
    .single();

  if (error) {
    console.error('Error sending message:', error);
    return null;
  }
  return data;
}

// ============ KI-WISSEN ============

export async function getKiWissen(objektId: string): Promise<KiWissen[]> {
  const { data, error } = await supabase
    .from('ki_wissen')
    .select('*')
    .eq('objekt_id', objektId)
    .order('kategorie', { ascending: true });

  if (error) {
    console.error('Error fetching ki_wissen:', error);
    return [];
  }
  return data || [];
}

export async function getGeneralKiWissen(userId: string): Promise<KiWissen[]> {
  const { data, error } = await supabase
    .from('ki_wissen')
    .select('*')
    .eq('user_id', userId)
    .is('objekt_id', null)
    .order('kategorie', { ascending: true });

  if (error) {
    console.error('Error fetching general ki_wissen:', error);
    return [];
  }
  return data || [];
}

export async function createKiWissen(wissen: Partial<KiWissen>): Promise<KiWissen | null> {
  const { data, error } = await supabase
    .from('ki_wissen')
    .insert(wissen)
    .select()
    .single();

  if (error) {
    console.error('Error creating ki_wissen:', error);
    return null;
  }
  return data;
}

export async function updateKiWissen(wissenId: string, updates: Partial<KiWissen>): Promise<KiWissen | null> {
  const { data, error } = await supabase
    .from('ki_wissen')
    .update(updates)
    .eq('id', wissenId)
    .select()
    .single();

  if (error) {
    console.error('Error updating ki_wissen:', error);
    return null;
  }
  return data;
}

export async function deleteKiWissen(wissenId: string): Promise<boolean> {
  const { error } = await supabase
    .from('ki_wissen')
    .delete()
    .eq('id', wissenId);

  if (error) {
    console.error('Error deleting ki_wissen:', error);
    return false;
  }
  return true;
}

// ============ PROVISIONEN ============

export async function getProvisionen(userId: string): Promise<Provision[]> {
  const { data, error } = await supabase
    .from('provisionen')
    .select(`
      *,
      objekt:objekte(*),
      lead:leads(*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching provisionen:', error);
    return [];
  }
  return data || [];
}

export async function createProvision(provision: Partial<Provision>): Promise<Provision | null> {
  const { data, error } = await supabase
    .from('provisionen')
    .insert(provision)
    .select()
    .single();

  if (error) {
    console.error('Error creating provision:', error);
    return null;
  }
  return data;
}

// ============ STATS ============

export async function getObjektStats(objektId: string) {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('status, source')
    .eq('objekt_id', objektId);

  if (error || !leads) {
    return {
      anfragen: 0,
      kontaktiert: 0,
      simpliGesendet: 0,
      simpliBestaetigt: 0,
      externFinanziert: 0,
      besichtigungen: 0,
    };
  }

  return {
    anfragen: leads.length,
    kontaktiert: leads.filter(l => l.status !== 'neu').length,
    simpliGesendet: leads.filter(l => l.status === 'simpli_gesendet').length,
    simpliBestaetigt: leads.filter(l => l.status === 'simpli_bestaetigt').length,
    externFinanziert: leads.filter(l => l.status === 'extern_finanziert').length,
    besichtigungen: leads.filter(l => l.status === 'besichtigt' || l.status === 'gekauft').length,
  };
}

export async function getDashboardStats(userId: string) {
  console.log('[DEBUG] getDashboardStats called with userId:', userId);

  const [objekte, todos, provisionen] = await Promise.all([
    getObjekte(userId),
    getTodos(userId),
    getProvisionen(userId),
  ]);

  console.log('[DEBUG] getDashboardStats results - objekte:', objekte.length, 'todos:', todos.length, 'provisionen:', provisionen.length);

  const activeObjekte = objekte.filter(o => o.status === 'aktiv').length;
  const openTodos = todos.filter(t => !t.completed).length;
  
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthlyProvision = provisionen
    .filter(p => {
      const date = new Date(p.created_at);
      return date.getMonth() === currentMonth && 
             date.getFullYear() === currentYear &&
             p.status === 'ausgezahlt';
    })
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    activeObjekte,
    openTodos,
    monthlyProvision,
  };
}

// ============ OBJEKT MERGE ============

export interface MergeResult {
  success: boolean;
  message?: string;
  error?: string;
  stats?: {
    leads_moved: number;
    ki_wissen_moved: number;
    todos_moved: number;
  };
}

export async function mergeObjekte(
  sourceObjektId: string,
  targetObjektId: string,
  userId: string
): Promise<MergeResult> {
  try {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.access_token) {
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch(
      `https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/objekt-matcher`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({
          action: 'merge',
          source_objekt_id: sourceObjektId,
          target_objekt_id: targetObjektId,
          user_id: userId,
        }),
      }
    );

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error merging objekte:', error);
    return { success: false, error: 'Network error' };
  }
}
