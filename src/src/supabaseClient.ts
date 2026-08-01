import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dzebbrsougjsypdejfkg.supabase.co';
const supabaseKey = 'sb_publishable_Wp2Iok3D-HxD5fQdwfFwSA_cjtkFx0U';

export const supabase = createClient(supabaseUrl, supabaseKey);
