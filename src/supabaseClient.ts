import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tcyizrfuqoevcechalix.supabase.co';
const supabaseKey = 'sb_publishable_p_XNCIvqRPM_rrnCqTY75A_xTYFhk-u';

export const supabase = createClient(supabaseUrl, supabaseKey);
