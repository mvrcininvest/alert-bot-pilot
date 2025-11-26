import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

// AES-256-GCM decryption using Web Crypto API
async function decrypt(encryptedHex: string, key: string): Promise<string> {
  const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  // Extract IV and encrypted data
  const iv = encrypted.slice(0, 12);
  const data = encrypted.slice(12);
  
  // Convert hex key to buffer
  const keyBuffer = new Uint8Array(key.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data
  );
  
  return new TextDecoder().decode(decrypted);
}

export interface UserApiKeys {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export async function getUserApiKeys(userId: string): Promise<UserApiKeys | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration');
  }

  if (!encryptionKey) {
    throw new Error('Encryption key not configured');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch encrypted keys from database
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('api_key_encrypted, secret_key_encrypted, passphrase_encrypted, is_active')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (!data.is_active) {
    throw new Error('User API keys are inactive');
  }

  // Decrypt keys
  const apiKey = await decrypt(data.api_key_encrypted, encryptionKey);
  const secretKey = await decrypt(data.secret_key_encrypted, encryptionKey);
  const passphrase = await decrypt(data.passphrase_encrypted, encryptionKey);

  return { apiKey, secretKey, passphrase };
}
