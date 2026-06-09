import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pqzdeqfxeqswjxejeduu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nZ_t0dhGgmKv7Zf9VPWEmQ_fnlIdEFG';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { SUPABASE_URL, SUPABASE_ANON_KEY, supabase };
