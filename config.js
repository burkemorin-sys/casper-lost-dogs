/*
 * Casper Lost Dogs - backend settings.
 *
 * Leave supabaseUrl / supabaseAnonKey empty and the app runs in DEMO mode
 * (sample data, reports saved only on the device that made them).
 *
 * To make reports shared by everyone, create a free Supabase project, run
 * supabase/schema.sql in its SQL editor, then paste the Project URL and the
 * anon / publishable key below (Supabase dashboard > Project Settings > API).
 * The anon key is MEANT to be public; never put the service_role / secret key here.
 *
 * backend:
 *   'auto'     - Supabase if configured, else the Node server (npm start) if present, else demo
 *   'supabase' | 'server' | 'demo' - force one
 */
window.LOST_DOGS_CONFIG = {
  backend: 'auto',
  supabaseUrl: '',      // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseAnonKey: '',  // e.g. 'eyJhbGciOi...' or 'sb_publishable_...'
  photoBucket: 'dog-photos',
};
