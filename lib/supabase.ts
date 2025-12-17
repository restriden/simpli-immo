
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hsfrdovpgxtqbitmkrhs.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZnJkb3ZwZ3h0cWJpdG1rcmhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MjM2MjQsImV4cCI6MjA4MTQ5OTYyNH0.GQhnvrYlcCcx0qZg0-yVolu5J5aa9RwyNxW-gG4ccsk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  company_name: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
  company_website?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Objekt {
  id: string;
  user_id: string;
  name: string;
  city: string;
  price: number;
  type: string;
  rooms: string;
  area_sqm: number;
  status: 'aktiv' | 'verkauft' | 'pausiert';
  ai_ready: boolean;
  image_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  user_id: string;
  objekt_id?: string;
  name: string;
  email?: string;
  phone?: string;
  status: string;
  finanzierung_status?: string;
  source: 'simpli' | 'extern';
  protected_until: string;
  notes?: string;
  last_message_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  user_id: string;
  lead_id?: string;
  objekt_id?: string;
  type: string;
  priority: 'dringend' | 'normal';
  title: string;
  subtitle?: string;
  completed: boolean;
  due_date?: string;
  created_at: string;
}

export interface Message {
  id: string;
  lead_id: string;
  user_id: string;
  content: string;
  type: 'incoming' | 'outgoing' | 'system';
  is_template: boolean;
  created_at: string;
}
