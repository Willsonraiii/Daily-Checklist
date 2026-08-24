import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://tcyizrfuqoevcechalix.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_p_XNCIvqRPM_rrnCqTY75A_xTYFhk-u';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
