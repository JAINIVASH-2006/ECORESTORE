import {createClient,SupabaseClient} from '@supabase/supabase-js';
let client:SupabaseClient|null=null;
export async function getSupabase(){if(client)return client;const r=await fetch('/api/config');if(!r.ok)throw new Error('Connection configuration unavailable');const {url,key}=await r.json() as {url:string;key:string};if(!url||!key)return null;client=createClient(url,key);return client;}
