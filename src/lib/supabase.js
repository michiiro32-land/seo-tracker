import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://sbjnaragykwcwwowtcwg.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiam5hcmFneWt3Y3d3b3d0Y3dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4Mjg5MDEsImV4cCI6MjA4NzQwNDkwMX0.cg3K_Y5-U274rhtEK9OsP14Zy_CXd9-byE93Lq_ew5I'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
